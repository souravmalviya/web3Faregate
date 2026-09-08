/**
 * The paid data route.
 *
 * This is the only place in Faregate where onchain data leaves the gateway. In
 * live mode the x402 middleware sits in front of it and this handler only runs
 * once a payment has been verified. In simulated mode there is no middleware,
 * so the handler issues a receipt explicitly marked as simulated.
 *
 * Either way the handler re-checks policy itself. Defence in depth: if the
 * middleware were ever misconfigured or mounted on the wrong path, an
 * unauthorised caller would still be refused here rather than served.
 */

import type { Request, Response, Router } from 'express';
import express from 'express';
import { randomUUID } from 'node:crypto';

import { microsToUsd, type PaymentReceipt, type RequestResult } from '@faregate/shared';

import type { AIProvider } from '../ai/provider.ts';
import type { AppConfig } from '../config.ts';
import { DataProviderError, type DataProvider } from '../data/provider.ts';
import type { IdentityService } from '../identity/service.ts';
import { reevaluate, type PaymentGateDeps } from '../payment/x402.ts';
import type { GatewayStore } from '../store.ts';

export interface DataRouteDeps {
  config: AppConfig;
  store: GatewayStore;
  dataProvider: DataProvider;
  aiProvider: AIProvider;
  identity: IdentityService;
  now?: () => Date;
}

/** Header the x402 middleware sets once settlement completes. */
const SETTLEMENT_HEADER = 'PAYMENT-RESPONSE';

/**
 * Reads the settlement header the middleware writes after the handler returns.
 *
 * The header carries base64 JSON. A malformed or missing header is not an error
 * worth failing the request over, because the data was already served; it is
 * recorded as an unverified receipt so the audit trail stays truthful.
 */
function decodeSettlement(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  try {
    return JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function createDataRouter(deps: DataRouteDeps): Router {
  const { config, store, dataProvider, aiProvider, identity } = deps;
  const now = deps.now ?? (() => new Date());
  const gateDeps: PaymentGateDeps = { config, store, identity, now };

  const router = express.Router();

  // Express 4 does not route a rejected promise to the error handler, so the
  // async body lives in `handle` and its rejection is forwarded explicitly.
  router.get('/data/:requestId', (req: Request, res: Response, next) => {
    handle(req, res).catch(next);
  });

  async function handle(req: Request, res: Response): Promise<void> {
    const requestId = String(req.params.requestId);
    const at = now();

    // Defence in depth. In live mode the middleware already ran this check
    // before quoting a price; running it again costs nothing and closes the
    // gap if the middleware is ever mounted incorrectly.
    const check = await reevaluate(gateDeps, requestId);
    if (!check.ok) {
      store.recordEvent(
        {
          type: 'payment.rejected',
          actor: 'system',
          requestId,
          detail: { reason: check.reason, stage: 'data-release' },
        },
        at,
      );
      return void res.status(403).json({ error: { code: 'forbidden', message: check.reason } });
    }

    const request = store.getRequest(requestId);
    if (!request) {
      return void res.status(404).json({ error: { code: 'request_not_found', message: 'No such request.' } });
    }

    // Record spend before serving. The payment is verified by this point, and
    // recording first means a crash mid-response cannot hand out free data.
    const spentAfter = store.recordSpend(request.agentId, check.costMicros, at);

    let receipt: PaymentReceipt;
    if (config.payment.mode === 'live') {
      // The real receipt is completed on 'finish', once the middleware has
      // settled and written its header. Until then it is recorded as verified
      // by the facilitator but without a hash.
      receipt = {
        requestId,
        txHash: '',
        network: config.payment.network,
        from: '',
        to: config.payment.payTo ?? '',
        amount: String(check.costMicros),
        asset: config.payment.asset,
        settled: false,
        verifiedAt: at.toISOString(),
        verifiedBy: 'facilitator',
      };
      res.on('finish', () => {
        const settlement = decodeSettlement(res.getHeader(SETTLEMENT_HEADER));
        const completed: PaymentReceipt = {
          ...receipt,
          txHash: typeof settlement?.transaction === 'string' ? settlement.transaction : '',
          from: typeof settlement?.payer === 'string' ? settlement.payer : '',
          settled: settlement?.success === true,
        };
        store.updateRequest(requestId, { payment: completed });
        store.recordEvent({
          type: 'payment.verified',
          actor: 'system',
          agentId: request.agentId,
          requestId,
          detail: {
            txHash: completed.txHash,
            settled: completed.settled,
            network: completed.network,
            amountMicros: check.costMicros,
          },
        });
      });
    } else {
      receipt = {
        requestId,
        txHash: `simulated-${randomUUID()}`,
        network: config.payment.network,
        from: 'simulated-payer',
        to: config.payment.payTo ?? 'simulated-payee',
        amount: String(check.costMicros),
        asset: config.payment.asset,
        settled: true,
        verifiedAt: at.toISOString(),
        // The honest label. Nothing downstream may render this as a chain fact.
        verifiedBy: 'simulated',
      };
      store.recordEvent(
        {
          type: 'payment.verified',
          actor: 'system',
          agentId: request.agentId,
          requestId,
          detail: { simulated: true, amountMicros: check.costMicros, reason: config.payment.reason },
        },
        at,
      );
    }

    let result: RequestResult;
    try {
      const fetched = await dataProvider.fetch(request.query);
      result = {
        data: fetched.data,
        provenance: fetched.provenance,
        fulfilledAt: now().toISOString(),
      };
    } catch (error) {
      const failure =
        error instanceof DataProviderError
          ? { code: error.code, message: error.message }
          : { code: 'provider_error', message: 'The data provider failed.' };

      store.updateRequest(requestId, { status: 'failed', error: failure.message, payment: receipt }, at);
      store.recordEvent(
        {
          type: 'request.failed',
          actor: 'system',
          agentId: request.agentId,
          requestId,
          detail: failure,
        },
        at,
      );

      // The agent paid and got nothing. Say so plainly rather than inventing a
      // result, and tell it the payment stands so it can seek a refund offchain.
      return void res.status(502).json({
        error: {
          code: failure.code,
          message: failure.message,
          paymentSettled: receipt.settled,
          note: 'Payment was taken but data retrieval failed. This request is marked failed.',
        },
      });
    }

    // Analysis runs after the data is in hand and never blocks delivery. A
    // model failure leaves the data intact and records why the summary is
    // missing; a grounding failure strips the unverified value and logs it.
    try {
      const analysis = await aiProvider.analyze(request.query, result.data, result.provenance);
      result = { ...result, analysis: analysis.text };
      store.recordEvent(
        {
          type: 'analysis.completed',
          actor: 'system',
          agentId: request.agentId,
          requestId,
          detail: {
            provider: analysis.provider,
            groundingWarnings: analysis.groundingWarnings,
          },
        },
        at,
      );
    } catch (error) {
      result = {
        ...result,
        analysisError: error instanceof Error ? error.message : 'Analysis failed.',
      };
    }

    store.updateRequest(requestId, { status: 'fulfilled', payment: receipt, result }, at);
    store.recordEvent(
      {
        type: 'data.retrieved',
        actor: 'system',
        agentId: request.agentId,
        requestId,
        detail: {
          provider: result.provenance.provider,
          simulated: result.provenance.simulated,
          source: result.provenance.source,
        },
      },
      at,
    );
    store.recordEvent(
      {
        type: 'request.fulfilled',
        actor: 'system',
        agentId: request.agentId,
        requestId,
        detail: { spentTodayUsd: microsToUsd(spentAfter) },
      },
      at,
    );

    res.json({
      requestId,
      query: request.query,
      result,
      payment: receipt,
      budget: {
        chargedUsd: microsToUsd(check.costMicros),
        spentTodayUsd: microsToUsd(spentAfter),
      },
    });
  }

  return router;
}
