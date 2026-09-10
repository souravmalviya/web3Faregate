/**
 * The Faregate gateway HTTP surface.
 *
 * Two audiences share this server. The dashboard drives the human side:
 * listing agents, approving requests, revoking passports. Agents drive the
 * machine side: submitting a request and then paying for it.
 *
 * `createApp` takes its dependencies as arguments so tests can build a gateway
 * with a fresh store and a fixed clock.
 */

import cors from 'cors';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import {
  evaluatePolicy,
  priceQueryUsd,
  usdToMicros,
  type AccessRequest,
  type Policy,
  type RequestStatus,
  type ResourceQuery,
} from '@faregate/shared';

import type { x402HTTPResourceServer } from '@x402/core/server';
import { paymentMiddlewareFromHTTPServer } from '@x402/express';

import type { AIProvider } from './ai/provider.ts';
import { describeModes, type AppConfig } from './config.ts';
import type { DataProvider } from './data/provider.ts';
import type { IdentityService } from './identity/service.ts';
import { parsePrompt, parseStructuredQuery, isAddress } from './query-parser.ts';
import { createDataRouter } from './routes/data.ts';
import { GatewayStore } from './store.ts';

export interface AppDeps {
  config: AppConfig;
  store: GatewayStore;
  dataProvider: DataProvider;
  aiProvider: AIProvider;
  identity: IdentityService;
  /**
   * The x402 resource server, already initialised against its facilitator.
   * Required in live payment mode. The entrypoint initialises it before the
   * gateway listens, so a facilitator that cannot settle on the configured
   * network stops startup instead of failing every paid request later.
   */
  paymentServer?: x402HTTPResourceServer;
  /** Injected so tests can pin time. */
  now?: () => Date;
}

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

/**
 * Express 4 does not route a rejected promise to the error handler, so an async
 * handler that throws would hang the request. This forwards the rejection.
 */
const wrap =
  (fn: AsyncHandler) =>
  (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };

/**
 * Thrown by handlers to produce a structured error response.
 *
 * Fields are declared and assigned explicitly rather than using TypeScript
 * parameter properties. Node runs these sources directly with type stripping,
 * which erases types but cannot emit code, so `constructor(readonly x: T)` is a
 * runtime syntax error. The same rule rules out enums and decorators here.
 */
class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

const createRequestSchema = z.object({
  agentId: z.string().min(1).max(255),
  prompt: z.string().min(1).max(2000).optional(),
  query: z.unknown().optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

const approvalSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  by: z.string().refine(isAddress, 'must be a 0x-prefixed EVM address'),
  note: z.string().max(500).optional(),
});

const policySchema = z.object({
  allowedResources: z.array(z.string()).min(1).max(16),
  maxCostPerQueryUsd: z.number().nonnegative().max(1000),
  dailyLimitUsd: z.number().nonnegative().max(100000),
  humanApprovalAboveUsd: z.number().nonnegative().max(1000),
  expiresAt: z.string().datetime().nullable().optional(),
});

export function createApp(deps: AppDeps): Express {
  const { config, store, aiProvider, identity } = deps;
  const now = deps.now ?? (() => new Date());

  const app = express();
  app.use(express.json({ limit: '64kb' }));
  app.use(cors({ origin: config.corsOrigin }));
  app.disable('x-powered-by');

  // --- health ------------------------------------------------------------

  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      service: 'faregate-gateway',
      time: now().toISOString(),
      modes: describeModes(config),
      notes: [
        config.payment.reason,
        config.data.reason,
        config.ai.reason,
        config.ens.reason,
      ].filter(Boolean),
      network: config.payment.network,
      providers: {
        data: deps.dataProvider.describe(),
        ai: aiProvider.describe(),
        identity: identity.describe(),
      },
    });
  });

  // --- agents and policies ----------------------------------------------

  app.get('/agents', (_req: Request, res: Response) => {
    const agents = store.listAgents().map((agent) => ({
      ...agent,
      policy: store.getPolicy(agent.id),
      spentTodayUsd: store.spentTodayMicros(agent.id, now()) / 1_000_000,
    }));
    res.json({ agents });
  });

  app.get('/agents/:id', (req: Request, res: Response) => {
    const id = String(req.params.id);
    const agent = store.getAgent(id);
    if (!agent) throw new HttpError(404, 'agent_not_found', `No passport for ${id}.`);
    res.json({
      agent,
      policy: store.getPolicy(id),
      spentTodayUsd: store.spentTodayMicros(id, now()) / 1_000_000,
    });
  });

  app.put('/agents/:id/policy', (req: Request, res: Response) => {
    const id = String(req.params.id);
    const agent = store.getAgent(id);
    if (!agent) throw new HttpError(404, 'agent_not_found', `No passport for ${id}.`);

    const parsed = policySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, 'invalid_policy', parsed.error.issues[0]?.message ?? 'Invalid policy.');
    }

    const allowedResources = parsed.data.allowedResources.filter((r): r is Policy['allowedResources'][number] =>
      ['wallet.balances', 'wallet.transfers', 'wallet.activity', 'protocol.positions', 'protocol.markets'].includes(r),
    );
    if (allowedResources.length === 0) {
      throw new HttpError(400, 'invalid_policy', 'No recognised resource kinds were supplied.');
    }

    const policy = store.putPolicy({
      agentId: id,
      allowedResources,
      maxCostPerQueryUsd: parsed.data.maxCostPerQueryUsd,
      dailyLimitUsd: parsed.data.dailyLimitUsd,
      humanApprovalAboveUsd: parsed.data.humanApprovalAboveUsd,
      expiresAt: parsed.data.expiresAt ?? null,
    });
    store.recordEvent(
      { type: 'policy.updated', actor: 'human', agentId: id, detail: { policy } },
      now(),
    );
    res.json({ policy });
  });

  /**
   * Revokes a passport. This is the product's kill switch, so it is a single
   * unconditional call with no confirmation token: the human already decided.
   */
  app.post('/agents/:id/revoke', (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!identity.canRevokeLocally(id)) {
      // An ENS passport is revoked by its owner, onchain, with their own
      // wallet. The gateway only reads the chain; it never writes to it.
      throw new HttpError(
        409,
        'revoke_onchain',
        `${id} is an ENS passport. Revoke it by setting the text record faregate.status to "revoked" on the name, or by unregistering the subname. The gateway will refuse the agent at its next request.`,
      );
    }
    const agent = store.revokeAgent(id);
    if (!agent) throw new HttpError(404, 'agent_not_found', `No passport for ${id}.`);
    store.recordEvent({ type: 'agent.revoked', actor: 'human', agentId: id }, now());
    res.json({ agent });
  });

  // --- requests ----------------------------------------------------------

  /**
   * Submits a request on behalf of an agent and evaluates it.
   *
   * This endpoint never returns data. It returns a decision and, when the
   * request is cleared to proceed, the price the agent must pay. Data is only
   * released by the paid `/data/:id` route once a payment has settled.
   */
  app.post('/requests', wrap(async (req: Request, res: Response) => {
    const parsed = createRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, 'invalid_request', parsed.error.issues[0]?.message ?? 'Invalid request.');
    }
    const { agentId, prompt, query: rawQuery, idempotencyKey } = parsed.data;

    if (idempotencyKey) {
      const existingId = store.lookupIdempotent(idempotencyKey);
      if (existingId) {
        const existing = store.getRequest(existingId);
        if (existing) return void res.status(200).json({ request: existing, replayed: true });
      }
    }

    if (!prompt && rawQuery === undefined) {
      throw new HttpError(400, 'invalid_request', 'Supply either a prompt or a structured query.');
    }

    const at = now();

    // A structured query is validated directly. A prompt goes through the
    // interpreter, whose proposal is untrusted and is validated by the same
    // rule-based parser. If the proposal fails validation, the rule-based
    // parser has the final word. The model can suggest; it cannot widen scope.
    let parseResult: { query: ResourceQuery | null; note: string };
    let interpretedBy: AIProvider['name'] | 'structured' = 'structured';
    if (rawQuery !== undefined) {
      parseResult = parseStructuredQuery(rawQuery);
    } else {
      const interpretation = await aiProvider.interpret(prompt ?? '');
      const validated = parseStructuredQuery(interpretation.proposal);
      if (validated.query) {
        parseResult = { query: validated.query, note: interpretation.rationale };
        interpretedBy = interpretation.provider;
      } else {
        parseResult = parsePrompt(prompt ?? '');
        interpretedBy = 'rule-based';
      }
    }

    const resolved = await identity.resolve(agentId, at);
    const { agent, policy } = resolved;

    const decision = evaluatePolicy({
      agent,
      policy,
      query: parseResult.query,
      spentTodayMicros: store.spentTodayMicros(agentId, at),
      now: at,
    });

    const status: RequestStatus = !decision.allowed
      ? 'rejected'
      : decision.requiresHumanApproval
        ? 'awaiting_approval'
        : 'payment_required';

    const request: AccessRequest = {
      id: randomUUID(),
      agentId,
      prompt: prompt ?? JSON.stringify(rawQuery),
      // A denied request may have no parseable query. Keep a placeholder so the
      // record is still renderable, and mark it through the decision reasons.
      query: parseResult.query ?? {
        resource: 'wallet.balances',
        address: '0x0000000000000000000000000000000000000000',
        lookbackDays: 1,
      },
      status,
      estimatedCostUsd: parseResult.query ? priceQueryUsd(parseResult.query) : 0,
      createdAt: at.toISOString(),
      updatedAt: at.toISOString(),
      decision,
    };

    store.putRequest(request);
    if (idempotencyKey) store.rememberIdempotent(idempotencyKey, request.id);

    store.recordEvent(
      {
        type: 'request.received',
        actor: 'agent',
        agentId,
        requestId: request.id,
        detail: {
          prompt: request.prompt,
          parseNote: parseResult.note,
          interpretedBy,
          identitySource: resolved.source,
          ...(resolved.note ? { identityNote: resolved.note } : {}),
        },
      },
      at,
    );
    store.recordEvent(
      {
        type: 'request.evaluated',
        actor: 'system',
        agentId,
        requestId: request.id,
        detail: {
          allowed: decision.allowed,
          requiresHumanApproval: decision.requiresHumanApproval,
          reasons: decision.reasons.map((r) => r.code),
          estimatedCostUsd: decision.estimatedCostUsd,
        },
      },
      at,
    );
    if (status === 'awaiting_approval') {
      store.recordEvent(
        { type: 'request.approval_requested', actor: 'system', agentId, requestId: request.id },
        at,
      );
    } else if (status === 'rejected') {
      store.recordEvent(
        {
          type: 'request.rejected',
          actor: 'system',
          agentId,
          requestId: request.id,
          detail: { reasons: decision.reasons.map((r) => r.code) },
        },
        at,
      );
    }

    res.status(decision.allowed ? 201 : 403).json({
      request,
      parseNote: parseResult.note,
      interpretedBy,
    });
  }));

  /**
   * Explains a decision in prose, on demand. The explanation narrates what the
   * deterministic engine already decided; it is never an input to it.
   */
  app.get('/requests/:id/explain', wrap(async (req: Request, res: Response) => {
    const request = store.getRequest(String(req.params.id));
    if (!request) throw new HttpError(404, 'request_not_found', 'No such request.');
    if (!request.decision) throw new HttpError(409, 'not_evaluated', 'Request has no decision yet.');
    const agent = store.getAgent(request.agentId);
    const explanation = await aiProvider.explain(request.decision, request.query, agent);
    res.json({ requestId: request.id, explanation, provider: aiProvider.name });
  }));

  app.get('/requests', (_req: Request, res: Response) => {
    res.json({ requests: store.listRequests() });
  });

  app.get('/requests/:id', (req: Request, res: Response) => {
    const request = store.getRequest(String(req.params.id));
    if (!request) throw new HttpError(404, 'request_not_found', 'No such request.');
    res.json({ request });
  });

  /** The human approval step. Only meaningful for `awaiting_approval`. */
  app.post('/requests/:id/approval', (req: Request, res: Response) => {
    const id = String(req.params.id);
    const request = store.getRequest(id);
    if (!request) throw new HttpError(404, 'request_not_found', 'No such request.');
    if (request.status !== 'awaiting_approval') {
      throw new HttpError(
        409,
        'not_awaiting_approval',
        `Request is ${request.status} and is not waiting on a human.`,
      );
    }

    const parsed = approvalSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, 'invalid_approval', parsed.error.issues[0]?.message ?? 'Invalid approval.');
    }

    const at = now();
    const approval = {
      decision: parsed.data.decision,
      by: parsed.data.by as `0x${string}`,
      at: at.toISOString(),
      ...(parsed.data.note ? { note: parsed.data.note } : {}),
    };

    const updated = store.updateRequest(
      id,
      {
        approval,
        status: parsed.data.decision === 'approved' ? 'payment_required' : 'rejected',
      },
      at,
    );

    store.recordEvent(
      {
        type: parsed.data.decision === 'approved' ? 'request.approved' : 'request.rejected',
        actor: 'human',
        agentId: request.agentId,
        requestId: id,
        detail: { by: approval.by, note: approval.note ?? null },
      },
      at,
    );

    res.json({ request: updated });
  });

  // --- paid data route ---------------------------------------------------

  // In live mode the x402 middleware sits in front of the data router: it
  // returns 402 with payment requirements, verifies the payment the agent sends
  // back, and only then lets the router run. In simulated mode there is nothing
  // to verify against, so the middleware is not mounted and the router issues a
  // receipt stamped `simulated`.
  if (config.payment.mode === 'live') {
    if (!deps.paymentServer) {
      throw new Error(
        'Live payment mode needs an initialised payment server. Build it with createHttpResourceServer and await initialize() before createApp.',
      );
    }
    // Already initialised by the entrypoint, so the middleware must not start
    // its own background sync, whose failure would go unhandled and end the
    // process after /health had already reported payments as live.
    app.use(paymentMiddlewareFromHTTPServer(deps.paymentServer, undefined, undefined, false));
  }
  app.use(
    createDataRouter({ config, store, dataProvider: deps.dataProvider, aiProvider, identity, now }),
  );

  // --- audit -------------------------------------------------------------

  app.get('/events', (req: Request, res: Response) => {
    const limit = Math.min(Number.parseInt(String(req.query.limit ?? '200'), 10) || 200, 1000);
    res.json({ events: store.listEvents(limit) });
  });

  // --- errors ------------------------------------------------------------

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: { code: 'not_found', message: 'No such route.' } });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      return void res.status(err.status).json({ error: { code: err.code, message: err.message } });
    }
    // Never leak an internal message or stack to the caller.
    console.error('[faregate] unhandled error', err);
    res.status(500).json({ error: { code: 'internal_error', message: 'Something went wrong.' } });
  });

  return app;
}

export { HttpError };
export const __testing = { usdToMicros };
