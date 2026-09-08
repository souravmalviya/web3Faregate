/**
 * The x402 payment gate.
 *
 * Faregate protects exactly one route, `GET /data/:requestId`, and that route is
 * the only way data leaves the gateway. Everything else in the API returns
 * decisions and prices, never results.
 *
 * Three properties matter here, and each is enforced structurally rather than
 * by convention:
 *
 * 1. The price is read from the stored request, never from anything the caller
 *    sends. A caller cannot name its own price.
 * 2. The policy is re-evaluated inside `onProtectedRequest`, which runs BEFORE
 *    payment is offered. A revoked passport is refused with 403 and is never
 *    quoted a price, so revocation cannot be outrun by paying quickly.
 * 3. Spend is recorded against the daily budget only after the facilitator has
 *    verified the payment.
 */

import { HTTPFacilitatorClient, x402HTTPResourceServer, x402ResourceServer } from '@x402/core/server';
import type { HTTPRequestContext, RouteConfig, RoutesConfig } from '@x402/core/server';
import type { Price } from '@x402/core/types';
import { ExactHederaScheme } from '@x402/hedera/exact/server';

import { evaluatePolicy, priceQueryMicros, type PolicyDecision } from '@faregate/shared';

import type { AppConfig } from '../config.ts';
import type { GatewayStore } from '../store.ts';

/** The single protected route pattern. */
export const DATA_ROUTE_PATTERN = 'GET /data/:requestId';

/** Pulls the request id out of `/data/<id>`. Returns null when it does not match. */
export function requestIdFromPath(path: string): string | null {
  const match = /^\/data\/([A-Za-z0-9-]{8,64})\/?$/.exec(path);
  return match?.[1] ?? null;
}

export interface PaymentGateDeps {
  config: AppConfig;
  store: GatewayStore;
  now?: () => Date;
}

/**
 * Re-evaluates the stored request against current state.
 *
 * The decision recorded when the request was created is not trusted here. A
 * passport can be revoked, a policy tightened or a budget consumed between the
 * quote and the payment, and the gate has to see the world as it is now.
 */
export function reevaluate(
  deps: PaymentGateDeps,
  requestId: string,
): { ok: true; decision: PolicyDecision; costMicros: number } | { ok: false; reason: string } {
  const { store } = deps;
  const now = deps.now ?? (() => new Date());
  const at = now();

  const request = store.getRequest(requestId);
  if (!request) return { ok: false, reason: 'No such request.' };

  if (request.status === 'fulfilled') {
    return { ok: false, reason: 'This request has already been fulfilled.' };
  }
  if (request.status === 'rejected') {
    return { ok: false, reason: 'This request was rejected.' };
  }
  if (request.status === 'awaiting_approval') {
    return { ok: false, reason: 'This request is still waiting on human approval.' };
  }

  const agent = store.getAgent(request.agentId);
  const policy = agent ? store.getPolicy(request.agentId) : null;

  const decision = evaluatePolicy({
    agent,
    policy,
    query: request.query,
    spentTodayMicros: store.spentTodayMicros(request.agentId, at),
    now: at,
  });

  if (!decision.allowed) {
    return { ok: false, reason: decision.reasons[0]?.message ?? 'Policy denied the request.' };
  }
  if (decision.requiresHumanApproval && request.approval?.decision !== 'approved') {
    return { ok: false, reason: 'Human approval is required and has not been given.' };
  }

  return { ok: true, decision, costMicros: priceQueryMicros(request.query) };
}

/**
 * Builds the x402 resource server.
 *
 * `ExactHederaScheme` handles the Hedera side of the exact scheme, and the
 * facilitator verifies and settles. Both come from the published @x402 packages
 * rather than a hand-rolled imitation of the protocol.
 */
export function createResourceServer(config: AppConfig): x402ResourceServer {
  const facilitator = new HTTPFacilitatorClient({ url: config.payment.facilitatorUrl });
  return new x402ResourceServer(facilitator).register(
    config.payment.network as `${string}:${string}`,
    new ExactHederaScheme(),
  );
}

/**
 * Builds the protected route configuration.
 *
 * The price is a dynamic callback so each request is quoted at the price the
 * gateway computed for that specific query. USDC on Hedera has six decimals and
 * Faregate accounts in micro-USD, so the atomic amount is the micro-USD figure
 * with no conversion and no exchange rate to get wrong. Charging in native HBAR
 * would need a price oracle, and inventing a rate would put a fabricated number
 * in front of a judge.
 */
export function createRoutes(deps: PaymentGateDeps): RoutesConfig {
  const { config } = deps;

  const route: RouteConfig = {
    accepts: [
      {
        scheme: 'exact',
        network: config.payment.network as `${string}:${string}`,
        payTo: config.payment.payTo ?? '0.0.0',
        maxTimeoutSeconds: config.payment.maxTimeoutSeconds,
        price: (context: HTTPRequestContext): Price => {
          const requestId = requestIdFromPath(context.path);
          if (!requestId) {
            throw new Error('Protected route was reached without a request id.');
          }
          const check = reevaluate(deps, requestId);
          if (!check.ok) {
            // Should be unreachable: onProtectedRequest aborts first. Throwing
            // here is the backstop that prevents quoting an unauthorised request.
            throw new Error(check.reason);
          }
          return { asset: config.payment.asset, amount: String(check.costMicros) };
        },
      },
    ],
    resource: '/data/:requestId',
    description: 'Indexed onchain data for one authorised Faregate request.',
    mimeType: 'application/json',
    serviceName: 'Faregate',
    tags: ['onchain-data', 'agent-access', 'the-graph'],
  };

  return { [DATA_ROUTE_PATTERN]: route };
}

/**
 * Wraps the resource server with the pre-payment authorisation hook.
 *
 * This is the most important integration point in the product. `onProtectedRequest`
 * runs before x402 quotes a price, so an agent whose passport was revoked one
 * second ago is turned away at the gate rather than being invited to pay.
 */
export function createHttpResourceServer(deps: PaymentGateDeps): x402HTTPResourceServer {
  const resourceServer = createResourceServer(deps.config);
  const routes = createRoutes(deps);

  return new x402HTTPResourceServer(resourceServer, routes).onProtectedRequest(
    async (context: HTTPRequestContext) => {
      const requestId = requestIdFromPath(context.path);
      if (!requestId) {
        return { abort: true as const, reason: 'Malformed data request path.' };
      }

      const check = reevaluate(deps, requestId);
      if (!check.ok) {
        const request = deps.store.getRequest(requestId);
        deps.store.recordEvent({
          type: 'payment.rejected',
          actor: 'system',
          requestId,
          ...(request ? { agentId: request.agentId } : {}),
          detail: { reason: check.reason, stage: 'pre-payment' },
        });
        return { abort: true as const, reason: check.reason };
      }

      const request = deps.store.getRequest(requestId);
      deps.store.recordEvent({
        type: 'payment.required',
        actor: 'system',
        requestId,
        ...(request ? { agentId: request.agentId } : {}),
        detail: {
          amountMicros: check.costMicros,
          asset: deps.config.payment.asset,
          network: deps.config.payment.network,
        },
      });
      return undefined;
    },
  );
}
