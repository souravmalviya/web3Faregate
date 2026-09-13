/**
 * End-to-end tests for the gateway HTTP surface.
 *
 * These boot the real Express app on an ephemeral port with every subsystem in
 * simulated mode, a fixed clock, and a fresh store per test. They exercise the
 * same routes the dashboard and the agent call, so a change that breaks either
 * client breaks here first.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest, type Server } from 'node:http';

import type { x402HTTPResourceServer } from '@x402/core/server';
import { privateKeyToAccount } from 'viem/accounts';

import { buildActionMessage, canonicalDigest, type HumanAction } from '@faregate/shared';

import { RuleBasedAIProvider, type AIProvider } from './ai/provider.ts';
import { createApp } from './app.ts';
import type { AppConfig } from './config.ts';
import { DataProviderError, SimulatedDataProvider, type DataProvider } from './data/provider.ts';
import { LocalIdentityService, type IdentityService } from './identity/service.ts';
import { GatewayStore, seedDemoData } from './store.ts';

const SUBJECT = '0x742d35Cc6634C0532925a3b844Bc454e4438f44e';
const HUMAN = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const RESEARCH = 'research.agents.faregate.eth';
const TRIAL = 'trial.agents.faregate.eth';

function simulatedConfig(): AppConfig {
  return {
    port: 0,
    corsOrigins: ['http://localhost:3000'],
    // Most tests exercise the flow without a wallet; the signature tests
    // below opt in explicitly.
    requireSignedActions: false,
    stateFile: null,
    rateLimit: { requestsPerMinute: 1000, actionsPerMinute: 1000 },
    payment: {
      mode: 'simulated',
      network: 'hedera:testnet',
      facilitatorUrl: 'https://example.invalid',
      payTo: undefined,
      asset: '0.0.429274',
      maxTimeoutSeconds: 60,
      reason: 'test',
    },
    data: { mode: 'simulated', graphApiKey: undefined, subgraphs: undefined, reason: 'test' },
    ai: { mode: 'simulated', apiKey: undefined, model: 'openai/gpt-4.1-mini', callsPerHour: 300, reason: 'test' },
    ens: {
      mode: 'simulated',
      rpcUrls: [],
      parentName: 'agents.faregate.eth',
      universalResolver: undefined,
      reason: 'test',
    },
  };
}

interface Harness {
  url: string;
  store: GatewayStore;
  close: () => Promise<void>;
  json: <T = any>(path: string, init?: RequestInit) => Promise<{ status: number; body: T }>;
}

async function boot(
  overrides: Partial<AppConfig> = {},
  identityFor: (store: GatewayStore) => IdentityService = (store) => new LocalIdentityService(store),
  aiProvider: AIProvider = new RuleBasedAIProvider(),
  dataProvider: DataProvider = new SimulatedDataProvider(),
): Promise<Harness> {
  const store = new GatewayStore();
  seedDemoData(store, new Date('2026-09-10T00:00:00.000Z'));
  const app = createApp({
    config: { ...simulatedConfig(), ...overrides },
    store,
    dataProvider,
    aiProvider,
    identity: identityFor(store),
    now: () => new Date('2026-09-10T12:00:00.000Z'),
  });

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const url = `http://127.0.0.1:${port}`;

  return {
    url,
    store,
    close: () => new Promise((resolve) => server.close(() => resolve())),
    json: async (path, init) => {
      const response = await fetch(`${url}${path}`, {
        ...init,
        headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
      });
      const body = (await response.json().catch(() => ({}))) as any;
      return { status: response.status, body };
    },
  };
}

function submit(h: Harness, agentId: string, prompt: string, extra: Record<string, unknown> = {}) {
  return h.json('/requests', { method: 'POST', body: JSON.stringify({ agentId, prompt, ...extra }) });
}

function approve(h: Harness, id: string, decision: 'approved' | 'rejected' = 'approved') {
  return h.json(`/requests/${id}/approval`, {
    method: 'POST',
    body: JSON.stringify({ decision, by: HUMAN }),
  });
}

// --- health and listing ---------------------------------------------------

test('health reports every subsystem as simulated with a reason', async () => {
  const h = await boot();
  try {
    const { status, body } = await h.json('/health');
    assert.equal(status, 200);
    assert.deepEqual(body.modes, { payment: 'simulated', data: 'simulated', ai: 'simulated', ens: 'simulated' });
    assert.ok(body.notes.length >= 4);
  } finally {
    await h.close();
  }
});

test('agents are listed with their policy and spend', async () => {
  const h = await boot();
  try {
    const { body } = await h.json('/agents');
    assert.equal(body.agents.length, 2);
    const research = body.agents.find((a: any) => a.id === RESEARCH);
    assert.equal(research.policy.dailyLimitUsd, 1);
    assert.equal(research.spentTodayUsd, 0);
  } finally {
    await h.close();
  }
});

// --- request validation --------------------------------------------------

test('a malformed request is rejected with 400', async () => {
  const h = await boot();
  try {
    const { status, body } = await h.json('/requests', { method: 'POST', body: JSON.stringify({}) });
    assert.equal(status, 400);
    assert.equal(body.error.code, 'invalid_request');
  } finally {
    await h.close();
  }
});

test('an unknown agent is refused as agent_unknown', async () => {
  const h = await boot();
  try {
    const { status, body } = await submit(h, 'nobody.agents.faregate.eth', `balance of ${SUBJECT}`);
    assert.equal(status, 403);
    assert.equal(body.request.status, 'rejected');
    assert.deepEqual(body.request.decision.reasons.map((r: any) => r.code), ['agent_unknown']);
  } finally {
    await h.close();
  }
});

test('an unknown passport is refused without a model call', async () => {
  const neverCalled: AIProvider = {
    name: 'openrouter',
    describe: () => 'a model that must not be reached',
    interpret: async () => {
      throw new Error('the interpreter was called for an unknown passport');
    },
    explain: async () => 'unused',
    analyze: async () => {
      throw new Error('unused');
    },
  };
  const h = await boot({}, undefined, neverCalled);
  try {
    const { status, body } = await submit(h, 'nobody.agents.faregate.eth', `Show the balances of ${SUBJECT}`);
    assert.equal(status, 403);
    assert.equal(body.request.decision.reasons[0].code, 'agent_unknown');
    assert.equal(body.interpretedBy, 'rule-based');
  } finally {
    await h.close();
  }
});

test('a request with no address cannot be priced and is refused', async () => {
  const h = await boot();
  try {
    const { status, body } = await submit(h, TRIAL, 'what is my balance');
    assert.equal(status, 403);
    assert.deepEqual(body.request.decision.reasons.map((r: any) => r.code), ['invalid_query']);
  } finally {
    await h.close();
  }
});

test('a structured query from an untrusted caller is validated, not trusted', async () => {
  const h = await boot();
  try {
    // The research agent has room for a 365-day query; the trial agent does
    // not, and would be refused on cost rather than exercising validation.
    const { status, body } = await h.json('/requests', {
      method: 'POST',
      body: JSON.stringify({
        agentId: RESEARCH,
        query: { resource: 'wallet.balances', address: SUBJECT, lookbackDays: 99999, protocol: '../../etc' },
      }),
    });
    assert.equal(status, 201);
    // Lookback is clamped and the malformed protocol slug is dropped.
    assert.equal(body.request.query.lookbackDays, 365);
    assert.equal(body.request.query.protocol, undefined);
    assert.equal(body.request.estimatedCostUsd, 0.083);
  } finally {
    await h.close();
  }
});

// --- idempotency ---------------------------------------------------------

test('duplicate submissions with the same idempotency key return the same request', async () => {
  const h = await boot();
  try {
    const first = await submit(h, TRIAL, `balance of ${SUBJECT} today`, { idempotencyKey: 'demo-key-0001' });
    const second = await submit(h, TRIAL, `balance of ${SUBJECT} today`, { idempotencyKey: 'demo-key-0001' });
    assert.equal(first.status, 201);
    assert.equal(second.status, 200);
    assert.equal(second.body.replayed, true);
    assert.equal(second.body.request.id, first.body.request.id);
    const { body } = await h.json('/requests');
    assert.equal(body.requests.length, 1);
  } finally {
    await h.close();
  }
});

// --- the full flow -------------------------------------------------------

test('cheap in-scope request clears automatically and releases data on collection', async () => {
  const h = await boot();
  try {
    const created = await submit(h, TRIAL, `What is the token balance of ${SUBJECT} today?`);
    assert.equal(created.status, 201);
    assert.equal(created.body.request.status, 'payment_required');
    assert.equal(created.body.request.estimatedCostUsd, 0.0102);

    const collected = await h.json(`/data/${created.body.request.id}`);
    assert.equal(collected.status, 200);
    assert.equal(collected.body.payment.verifiedBy, 'simulated');
    assert.equal(collected.body.payment.amount, '10200');
    assert.equal(collected.body.result.provenance.simulated, true);
    assert.match(collected.body.result.analysis, /^Simulated data/);
    assert.equal(collected.body.budget.spentTodayUsd, 0.0102);

    const after = await h.json('/agents');
    const trial = after.body.agents.find((a: any) => a.id === TRIAL);
    assert.equal(trial.spentTodayUsd, 0.0102);
  } finally {
    await h.close();
  }
});

test('a request above the threshold waits for a human and cannot be collected early', async () => {
  const h = await boot();
  try {
    const created = await submit(h, RESEARCH, `Analyze the recent activity of ${SUBJECT} over the last month`);
    assert.equal(created.body.request.status, 'awaiting_approval');
    assert.equal(created.body.request.estimatedCostUsd, 0.036);

    const early = await h.json(`/data/${created.body.request.id}`);
    assert.equal(early.status, 403);
    assert.match(early.body.error.message, /waiting on human approval/);

    const approved = await approve(h, created.body.request.id);
    assert.equal(approved.status, 200);
    assert.equal(approved.body.request.status, 'payment_required');
    assert.equal(approved.body.request.approval.by, HUMAN);

    const collected = await h.json(`/data/${created.body.request.id}`);
    assert.equal(collected.status, 200);
    assert.equal(collected.body.budget.chargedUsd, 0.036);
  } finally {
    await h.close();
  }
});

test('a rejected approval ends the request and refuses collection', async () => {
  const h = await boot();
  try {
    const created = await submit(h, RESEARCH, `Analyze the recent activity of ${SUBJECT} over the last month`);
    const rejected = await approve(h, created.body.request.id, 'rejected');
    assert.equal(rejected.body.request.status, 'rejected');
    const collected = await h.json(`/data/${created.body.request.id}`);
    assert.equal(collected.status, 403);
  } finally {
    await h.close();
  }
});

test('approving a request that is not waiting is a conflict', async () => {
  const h = await boot();
  try {
    const created = await submit(h, TRIAL, `balance of ${SUBJECT} today`);
    const { status, body } = await approve(h, created.body.request.id);
    assert.equal(status, 409);
    assert.equal(body.error.code, 'not_awaiting_approval');
  } finally {
    await h.close();
  }
});

test('an approval must carry a valid wallet address', async () => {
  const h = await boot();
  try {
    const created = await submit(h, RESEARCH, `Analyze the recent activity of ${SUBJECT} over the last month`);
    const { status } = await h.json(`/requests/${created.body.request.id}/approval`, {
      method: 'POST',
      body: JSON.stringify({ decision: 'approved', by: 'not-an-address' }),
    });
    assert.equal(status, 400);
  } finally {
    await h.close();
  }
});

test('collecting the same request twice is refused', async () => {
  const h = await boot();
  try {
    const created = await submit(h, TRIAL, `balance of ${SUBJECT} today`);
    const first = await h.json(`/data/${created.body.request.id}`);
    assert.equal(first.status, 200);
    const second = await h.json(`/data/${created.body.request.id}`);
    assert.equal(second.status, 403);
    assert.match(second.body.error.message, /already been fulfilled/);
  } finally {
    await h.close();
  }
});

// --- limits --------------------------------------------------------------

test('the daily limit is enforced across requests', async () => {
  const h = await boot();
  try {
    // Trial agent: $0.05/day, $0.0102 per balance query. Four succeed, the
    // fifth would cross the line and is refused.
    for (let i = 0; i < 4; i += 1) {
      const created = await submit(h, TRIAL, `balance of ${SUBJECT} today`);
      assert.equal(created.status, 201, `request ${i + 1} should be allowed`);
      const collected = await h.json(`/data/${created.body.request.id}`);
      assert.equal(collected.status, 200);
    }
    const fifth = await submit(h, TRIAL, `balance of ${SUBJECT} today`);
    assert.equal(fifth.status, 403);
    assert.deepEqual(fifth.body.request.decision.reasons.map((r: any) => r.code), ['exceeds_daily_limit']);
  } finally {
    await h.close();
  }
});

test('spend is recorded at collection, not at quote', async () => {
  const h = await boot();
  try {
    // Ten quotes the agent never pays for must not consume its budget.
    for (let i = 0; i < 10; i += 1) {
      await submit(h, TRIAL, `balance of ${SUBJECT} today`);
    }
    const { body } = await h.json('/agents');
    const trial = body.agents.find((a: any) => a.id === TRIAL);
    assert.equal(trial.spentTodayUsd, 0);
  } finally {
    await h.close();
  }
});

// --- revocation ----------------------------------------------------------

test('a revoked passport is refused at submission', async () => {
  const h = await boot();
  try {
    const revoked = await h.json(`/agents/${RESEARCH}/revoke`, { method: 'POST', body: JSON.stringify({ by: HUMAN }) });
    assert.equal(revoked.body.agent.status, 'revoked');
    const { status, body } = await submit(h, RESEARCH, `balance of ${SUBJECT} today`);
    assert.equal(status, 403);
    assert.deepEqual(body.request.decision.reasons.map((r: any) => r.code), ['agent_revoked']);
  } finally {
    await h.close();
  }
});

test('revocation between approval and collection is refused at the gate', async () => {
  const h = await boot();
  try {
    const created = await submit(h, RESEARCH, `Analyze the recent activity of ${SUBJECT} over the last month`);
    await approve(h, created.body.request.id);

    await h.json(`/agents/${RESEARCH}/revoke`, { method: 'POST', body: JSON.stringify({ by: HUMAN }) });

    const collected = await h.json(`/data/${created.body.request.id}`);
    assert.equal(collected.status, 403);
    assert.match(collected.body.error.message, /revoked/);

    const events = await h.json('/events?limit=5');
    const refusal = events.body.events.find((e: any) => e.type === 'payment.rejected');
    assert.ok(refusal, 'the refusal is in the audit trail');
    assert.equal(refusal.detail.stage, 'data-release');
  } finally {
    await h.close();
  }
});

test('revoking an unknown passport is a 404', async () => {
  const h = await boot();
  try {
    const { status } = await h.json('/agents/ghost.agents.faregate.eth/revoke', { method: 'POST', body: JSON.stringify({ by: HUMAN }) });
    assert.equal(status, 404);
  } finally {
    await h.close();
  }
});

// --- policy edits --------------------------------------------------------

test('a policy update takes effect on the next request', async () => {
  const h = await boot();
  try {
    const tightened = await h.json(`/agents/${TRIAL}/policy`, {
      method: 'PUT',
      body: JSON.stringify({
        by: HUMAN,
        allowedResources: ['wallet.balances'],
        maxCostPerQueryUsd: 0.005,
        dailyLimitUsd: 0.05,
        humanApprovalAboveUsd: 0.05,
        expiresAt: null,
      }),
    });
    assert.equal(tightened.status, 200);
    const { status, body } = await submit(h, TRIAL, `balance of ${SUBJECT} today`);
    assert.equal(status, 403);
    assert.deepEqual(body.request.decision.reasons.map((r: any) => r.code), ['exceeds_per_query_limit']);
  } finally {
    await h.close();
  }
});

test('a policy with no recognised resources is rejected', async () => {
  const h = await boot();
  try {
    const { status, body } = await h.json(`/agents/${TRIAL}/policy`, {
      method: 'PUT',
      body: JSON.stringify({
        by: HUMAN,
        allowedResources: ['not.a.resource'],
        maxCostPerQueryUsd: 1,
        dailyLimitUsd: 1,
        humanApprovalAboveUsd: 1,
      }),
    });
    assert.equal(status, 400);
    assert.equal(body.error.code, 'invalid_policy');
  } finally {
    await h.close();
  }
});

// --- audit ---------------------------------------------------------------

test('the audit trail records the whole lifecycle in order', async () => {
  const h = await boot();
  try {
    const created = await submit(h, RESEARCH, `Analyze the recent activity of ${SUBJECT} over the last month`);
    await approve(h, created.body.request.id);
    await h.json(`/data/${created.body.request.id}`);

    const { body } = await h.json('/events?limit=50');
    const types = body.events
      .filter((e: any) => e.requestId === created.body.request.id)
      .map((e: any) => e.type)
      .reverse();

    assert.deepEqual(types, [
      'request.received',
      'request.evaluated',
      'request.approval_requested',
      'request.approved',
      'payment.verified',
      'analysis.completed',
      'data.retrieved',
      'request.fulfilled',
    ]);
  } finally {
    await h.close();
  }
});

test('unknown routes return a structured 404', async () => {
  const h = await boot();
  try {
    const { status, body } = await h.json('/nope');
    assert.equal(status, 404);
    assert.equal(body.error.code, 'not_found');
  } finally {
    await h.close();
  }
});

// --- live payment wiring -------------------------------------------------

test('live payment mode will not build without an initialised payment server', () => {
  const store = new GatewayStore();
  const config = simulatedConfig();
  const live: AppConfig = {
    ...config,
    payment: { ...config.payment, mode: 'live', payTo: '0.0.10457565' },
  };
  assert.throws(
    () =>
      createApp({
        config: live,
        store,
        dataProvider: new SimulatedDataProvider(),
        aiProvider: new RuleBasedAIProvider(),
        identity: new LocalIdentityService(store),
      }),
    /initialised payment server/,
  );
});

// --- signed human actions ------------------------------------------------

const OWNER_KEY = `0x${'11'.repeat(32)}` as const;
const owner = privateKeyToAccount(OWNER_KEY);
const stranger = privateKeyToAccount(`0x${'22'.repeat(32)}`);

async function sign(
  account: typeof owner,
  action: HumanAction,
  subject: string,
  extra: { digest?: string; issuedAt?: string } = {},
) {
  const issuedAt = extra.issuedAt ?? '2026-09-10T12:00:00.000Z';
  const message = buildActionMessage({ action, subject, issuedAt, ...(extra.digest ? { digest: extra.digest } : {}) });
  const signature = await account.signMessage({ message });
  return { by: account.address, issuedAt, signature };
}

test('when signatures are required, an unsigned approval is refused', async () => {
  const h = await boot({ requireSignedActions: true });
  try {
    const created = await submit(h, RESEARCH, `Analyze the recent activity of ${SUBJECT} over the last month`);
    const { status, body } = await h.json(`/requests/${created.body.request.id}/approval`, {
      method: 'POST',
      body: JSON.stringify({ decision: 'approved', by: owner.address }),
    });
    assert.equal(status, 401);
    assert.equal(body.error.code, 'signature_required');
    const check = await h.json(`/requests/${created.body.request.id}`);
    assert.equal(check.body.request.status, 'awaiting_approval');
  } finally {
    await h.close();
  }
});

test('a wallet-signed approval is verified and recorded as signed', async () => {
  const h = await boot({ requireSignedActions: true });
  try {
    const created = await submit(h, RESEARCH, `Analyze the recent activity of ${SUBJECT} over the last month`);
    const id = created.body.request.id;
    const envelope = await sign(owner, 'approve-request', id);
    const { status, body } = await h.json(`/requests/${id}/approval`, {
      method: 'POST',
      body: JSON.stringify({ decision: 'approved', ...envelope }),
    });
    assert.equal(status, 200);
    assert.equal(body.request.status, 'payment_required');
    assert.equal(body.request.approval.by, owner.address);
    assert.equal(body.request.approval.signed, true);

    const events = await h.json(`/requests/${id}/events`);
    const approved = events.body.events.find((e: any) => e.type === 'request.approved');
    assert.equal(approved.detail.signed, true);
  } finally {
    await h.close();
  }
});

test('a signature by a different wallet, or for a different action, is refused', async () => {
  const h = await boot({ requireSignedActions: true });
  try {
    const created = await submit(h, RESEARCH, `Analyze the recent activity of ${SUBJECT} over the last month`);
    const id = created.body.request.id;

    // Signed by a stranger but claiming to be the owner.
    const forged = await sign(stranger, 'approve-request', id);
    const a = await h.json(`/requests/${id}/approval`, {
      method: 'POST',
      body: JSON.stringify({ decision: 'approved', ...forged, by: owner.address }),
    });
    assert.equal(a.status, 401);
    assert.equal(a.body.error.code, 'bad_signature');

    // A real signature for "reject" cannot be presented as an approval.
    const wrongAction = await sign(owner, 'reject-request', id);
    const b = await h.json(`/requests/${id}/approval`, {
      method: 'POST',
      body: JSON.stringify({ decision: 'approved', ...wrongAction }),
    });
    assert.equal(b.status, 401);
    assert.equal(b.body.error.code, 'bad_signature');

    const check = await h.json(`/requests/${id}`);
    assert.equal(check.body.request.status, 'awaiting_approval');
  } finally {
    await h.close();
  }
});

test('an expired signature is refused', async () => {
  const h = await boot({ requireSignedActions: true });
  try {
    const created = await submit(h, RESEARCH, `Analyze the recent activity of ${SUBJECT} over the last month`);
    const id = created.body.request.id;
    const stale = await sign(owner, 'approve-request', id, { issuedAt: '2026-09-10T11:00:00.000Z' });
    const { status, body } = await h.json(`/requests/${id}/approval`, {
      method: 'POST',
      body: JSON.stringify({ decision: 'approved', ...stale }),
    });
    assert.equal(status, 401);
    assert.equal(body.error.code, 'signature_expired');
  } finally {
    await h.close();
  }
});

test('a signed revocation works once and its signature cannot be replayed', async () => {
  const h = await boot({ requireSignedActions: true });
  try {
    const envelope = await sign(owner, 'revoke-agent', TRIAL);
    const first = await h.json(`/agents/${TRIAL}/revoke`, { method: 'POST', body: JSON.stringify(envelope) });
    assert.equal(first.status, 200);
    assert.equal(first.body.agent.status, 'revoked');

    const replay = await h.json(`/agents/${TRIAL}/revoke`, { method: 'POST', body: JSON.stringify(envelope) });
    assert.equal(replay.status, 409);
    assert.equal(replay.body.error.code, 'signature_replayed');

    const refused = await submit(h, TRIAL, `balance of ${SUBJECT} today`);
    assert.equal(refused.status, 403);
    assert.deepEqual(refused.body.request.decision.reasons.map((r: any) => r.code), ['agent_revoked']);
  } finally {
    await h.close();
  }
});

test('a signed policy change is bound to the exact policy content', async () => {
  const h = await boot({ requireSignedActions: true });
  try {
    const policy = {
      allowedResources: ['wallet.balances'],
      maxCostPerQueryUsd: 0.05,
      dailyLimitUsd: 0.5,
      humanApprovalAboveUsd: 0.01,
      expiresAt: null,
    };
    const digest = await canonicalDigest(policy);
    const envelope = await sign(owner, 'set-policy', TRIAL, { digest });

    // Same signature, tampered content: refused.
    const tampered = await h.json(`/agents/${TRIAL}/policy`, {
      method: 'PUT',
      body: JSON.stringify({ ...policy, dailyLimitUsd: 500, ...envelope }),
    });
    assert.equal(tampered.status, 401);
    assert.equal(tampered.body.error.code, 'bad_signature');

    const honest = await h.json(`/agents/${TRIAL}/policy`, {
      method: 'PUT',
      body: JSON.stringify({ ...policy, ...envelope }),
    });
    assert.equal(honest.status, 200);
    assert.equal(honest.body.policy.dailyLimitUsd, 0.5);
  } finally {
    await h.close();
  }
});

// --- creating agents -------------------------------------------------------

test('a human creates an agent with a capability and it can request data', async () => {
  const h = await boot({ requireSignedActions: true });
  try {
    const policy = {
      allowedResources: ['wallet.balances', 'wallet.activity'],
      maxCostPerQueryUsd: 0.1,
      dailyLimitUsd: 1,
      humanApprovalAboveUsd: 0.02,
      expiresAt: null,
    };
    const id = 'researchbot.agents.faregate.eth';
    const digest = await canonicalDigest({ id, label: 'ResearchBot', policy });
    const envelope = await sign(owner, 'create-agent', id, { digest });

    const created = await h.json('/agents', {
      method: 'POST',
      body: JSON.stringify({ label: 'ResearchBot', policy, ...envelope }),
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.agent.id, id);
    assert.equal(created.body.agent.owner, owner.address);
    assert.equal(created.body.agent.status, 'active');
    assert.deepEqual(created.body.policy.allowedResources, policy.allowedResources);

    const listed = await h.json('/agents');
    assert.ok(listed.body.agents.some((a: any) => a.id === id));

    const request = await submit(h, id, `Analyze the recent activity of ${SUBJECT} over the last month`);
    assert.equal(request.status, 201);
    assert.equal(request.body.request.status, 'awaiting_approval');

    const events = await h.json('/events?limit=50');
    const createdEvent = events.body.events.find((e: any) => e.type === 'agent.created');
    assert.equal(createdEvent.agentId, id);
    assert.equal(createdEvent.detail.signed, true);
  } finally {
    await h.close();
  }
});

test('creating an agent that already exists, or with an empty scope, is refused', async () => {
  const h = await boot();
  try {
    const policy = { allowedResources: ['wallet.balances'], maxCostPerQueryUsd: 0.1, dailyLimitUsd: 1, humanApprovalAboveUsd: 0.02 };
    const dup = await h.json('/agents', {
      method: 'POST',
      body: JSON.stringify({ label: 'Trial Scout Agent', id: TRIAL, policy, by: HUMAN }),
    });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.error.code, 'agent_exists');

    const empty = await h.json('/agents', {
      method: 'POST',
      body: JSON.stringify({ label: 'Nobody', policy: { ...policy, allowedResources: ['nope'] }, by: HUMAN }),
    });
    assert.equal(empty.status, 400);
    assert.equal(empty.body.error.code, 'invalid_policy');

    const badId = await h.json('/agents', {
      method: 'POST',
      body: JSON.stringify({ label: 'Bad', id: 'no-parent', policy, by: HUMAN }),
    });
    assert.equal(badId.status, 400);
    assert.equal(badId.body.error.code, 'invalid_agent_id');
  } finally {
    await h.close();
  }
});

// --- collection edge cases ---------------------------------------------------

async function spentToday(h: Harness, agentId: string): Promise<number> {
  const { body } = await h.json('/agents');
  return body.agents.find((a: any) => a.id === agentId).spentTodayUsd;
}

test('a failed data retrieval charges nothing and the request can be collected again', async () => {
  const down: DataProvider = {
    name: 'the-graph',
    describe: () => 'always fails',
    fetch: async () => {
      throw new DataProviderError('gateway_error', 'The Graph is down in this test.');
    },
  };
  const h = await boot({}, undefined, undefined, down);
  try {
    const created = await submit(h, TRIAL, `balance of ${SUBJECT} today`);
    assert.equal(created.body.request.status, 'payment_required');
    const id = created.body.request.id;

    const first = await h.json(`/data/${id}`);
    assert.equal(first.status, 502);
    assert.equal(first.body.error.charged, false);
    assert.equal(await spentToday(h, TRIAL), 0);
    assert.equal((await h.json(`/requests/${id}`)).body.request.status, 'failed');

    // Not refused as already fulfilled: the agent can try again later.
    const second = await h.json(`/data/${id}`);
    assert.equal(second.status, 502);
    assert.equal(await spentToday(h, TRIAL), 0);
  } finally {
    await h.close();
  }
});

test('two concurrent collections of one request are served and charged once', async () => {
  class SlowProvider extends SimulatedDataProvider {
    override async fetch(query: Parameters<SimulatedDataProvider['fetch']>[0]) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return super.fetch(query);
    }
  }
  const h = await boot({}, undefined, undefined, new SlowProvider());
  try {
    const created = await submit(h, TRIAL, `balance of ${SUBJECT} today`);
    const id = created.body.request.id;

    const [a, b] = await Promise.all([h.json(`/data/${id}`), h.json(`/data/${id}`)]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409]);
    assert.equal(await spentToday(h, TRIAL), created.body.request.estimatedCostUsd);

    // Once fulfilled, a later attempt is refused and charged nothing more.
    const later = await h.json(`/data/${id}`);
    assert.equal(later.status, 403);
    assert.equal(await spentToday(h, TRIAL), created.body.request.estimatedCostUsd);
  } finally {
    await h.close();
  }
});

// --- ENS mode ----------------------------------------------------------------

/**
 * An identity service in ENS mode with no chain behind it, where no name under
 * the parent has a passport. Enough to test the gateway's ENS-mode rules
 * without an RPC.
 */
function ensWithoutPassports(): IdentityService {
  return {
    mode: 'ens',
    describe: () => 'ENS (test, no passports)',
    resolve: async () => ({ agent: null, policy: null, source: 'none', note: 'no_passport_on_ens' }),
    canRevokeLocally: (agentId) => !agentId.endsWith('.agents.faregate.eth'),
  };
}

test('with ENS live, a passport under the parent cannot be created through the gateway', async () => {
  const h = await boot({}, ensWithoutPassports);
  try {
    const policy = { allowedResources: ['wallet.balances'], maxCostPerQueryUsd: 0.1, dailyLimitUsd: 1, humanApprovalAboveUsd: 0.02 };
    const created = await h.json('/agents', {
      method: 'POST',
      body: JSON.stringify({ label: 'ResearchBot', policy, by: HUMAN }),
    });
    assert.equal(created.status, 409);
    assert.equal(created.body.error.code, 'create_onchain');
    assert.ok(!h.store.getAgent('researchbot.agents.faregate.eth'));
  } finally {
    await h.close();
  }
});

test('with ENS live, a passport is revoked onchain, not through the gateway', async () => {
  const h = await boot({}, ensWithoutPassports);
  try {
    const revoked = await h.json(`/agents/${RESEARCH}/revoke`, { method: 'POST', body: JSON.stringify({ by: HUMAN }) });
    assert.equal(revoked.status, 409);
    assert.equal(revoked.body.error.code, 'revoke_onchain');
    assert.equal(h.store.getAgent(RESEARCH)?.status, 'active');
  } finally {
    await h.close();
  }
});

// --- rate limiting -----------------------------------------------------------

test('an agent that submits too fast is rate limited with a Retry-After', async () => {
  const h = await boot({ rateLimit: { requestsPerMinute: 2, actionsPerMinute: 1000 } });
  try {
    await submit(h, TRIAL, `balance of ${SUBJECT} today`);
    await submit(h, TRIAL, `balance of ${SUBJECT} today`);
    const third = await fetch(`${h.url}/requests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentId: TRIAL, prompt: `balance of ${SUBJECT} today` }),
    });
    assert.equal(third.status, 429);
    assert.ok(Number(third.headers.get('retry-after')) >= 1);
    const body = (await third.json()) as any;
    assert.equal(body.error.code, 'rate_limited');

    // Another agent is unaffected: limits are per passport.
    const other = await submit(h, RESEARCH, `balance of ${SUBJECT} today`);
    assert.equal(other.status, 201);
  } finally {
    await h.close();
  }
});

test('one caller cannot dodge the passport limit by inventing names', async () => {
  const h = await boot({ rateLimit: { requestsPerMinute: 1, actionsPerMinute: 1000 } });
  try {
    // The per-caller layer is five times the per-passport limit.
    for (let i = 0; i < 5; i += 1) {
      const { status } = await submit(h, `made-up-${i}.agents.faregate.eth`, `balance of ${SUBJECT} today`);
      assert.equal(status, 403, `unknown passport ${i} is refused, not rate limited`);
    }
    const sixth = await submit(h, 'made-up-5.agents.faregate.eth', `balance of ${SUBJECT} today`);
    assert.equal(sixth.status, 429);
    assert.equal(sixth.body.error.code, 'rate_limited');
  } finally {
    await h.close();
  }
});

// --- browser origins ---------------------------------------------------------

interface PreflightVerdict {
  status: number;
  allowOrigin: string | undefined;
  maxAge: string | undefined;
}

/** Sends the CORS preflight a browser sends before a JSON POST, and reads the answer. */
function preflight(h: Harness, origin: string): Promise<PreflightVerdict> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      `${h.url}/requests`,
      {
        method: 'OPTIONS',
        headers: {
          origin,
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type',
        },
      },
      (res) => {
        res.resume();
        const header = (name: string): string | undefined => {
          const value = res.headers[name];
          return Array.isArray(value) ? value[0] : value;
        };
        resolve({
          status: res.statusCode ?? 0,
          allowOrigin: header('access-control-allow-origin'),
          maxAge: header('access-control-max-age'),
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

test('only the dashboard origins, named or matched by a one-label wildcard, may call from a browser', async () => {
  const h = await boot({
    corsOrigins: ['https://web3-faregate.vercel.app', 'https://web3-faregate-*-team.vercel.app'],
  });
  try {
    const named = await preflight(h, 'https://web3-faregate.vercel.app');
    assert.equal(named.status, 204);
    assert.equal(named.allowOrigin, 'https://web3-faregate.vercel.app');
    assert.equal(named.maxAge, '600');

    const deployment = await preflight(h, 'https://web3-faregate-mctorm9a9-team.vercel.app');
    assert.equal(deployment.allowOrigin, 'https://web3-faregate-mctorm9a9-team.vercel.app');

    // Any other page gets no permission header, so its browser withholds the response.
    for (const origin of [
      'https://example.invalid',
      'https://web3-faregate-x.attacker-team.vercel.app',
      'http://localhost:3000',
    ]) {
      assert.equal((await preflight(h, origin)).allowOrigin, undefined, origin);
    }
  } finally {
    await h.close();
  }
});

// --- request trace -----------------------------------------------------------

test('a request exposes its own timeline, oldest first', async () => {
  const h = await boot();
  try {
    const created = await submit(h, RESEARCH, `Analyze the recent activity of ${SUBJECT} over the last month`);
    const id = created.body.request.id;
    await approve(h, id);
    await h.json(`/data/${id}`);

    const { status, body } = await h.json(`/requests/${id}/events`);
    assert.equal(status, 200);
    assert.equal(body.requestId, id);
    assert.ok(body.events.every((e: any) => e.requestId === id));
    assert.deepEqual(
      body.events.map((e: any) => e.type),
      [
        'request.received',
        'request.evaluated',
        'request.approval_requested',
        'request.approved',
        'payment.verified',
        'analysis.completed',
        'data.retrieved',
        'request.fulfilled',
      ],
    );

    const missing = await h.json('/requests/does-not-exist/events');
    assert.equal(missing.status, 404);
  } finally {
    await h.close();
  }
});

test('malformed JSON is a 400, not an internal error', async () => {
  const h = await boot();
  try {
    const response = await fetch(`${h.url}/requests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    assert.equal(response.status, 400);
    const body = (await response.json()) as any;
    assert.equal(body.error.code, 'invalid_json');
  } finally {
    await h.close();
  }
});

// --- names, limits and caching -------------------------------------------------

test('a passport name in any letter case is one passport, with one rate limit and one budget', async () => {
  const h = await boot({ rateLimit: { requestsPerMinute: 1, actionsPerMinute: 1000 } });
  try {
    const shouted = await submit(h, 'TRIAL.Agents.Faregate.ETH', `balance of ${SUBJECT} today`);
    assert.equal(shouted.status, 201);
    assert.equal(shouted.body.request.agentId, TRIAL);

    // The usual spelling of the same passport shares its per-passport limit.
    const plain = await submit(h, TRIAL, `balance of ${SUBJECT} today`);
    assert.equal(plain.status, 429);

    // And the fare lands on the one ledger the policy engine reads.
    const collected = await h.json(`/data/${shouted.body.request.id}`);
    assert.equal(collected.status, 200);
    assert.equal(h.store.spentTodayMicros(TRIAL, new Date('2026-09-10T12:00:00.000Z')), 10_200);
  } finally {
    await h.close();
  }
});

test('the audit list never grows past what was asked for, whatever limit a caller sends', async () => {
  const h = await boot();
  try {
    await submit(h, TRIAL, `balance of ${SUBJECT} today`);
    await submit(h, RESEARCH, `balance of ${SUBJECT} today`);
    const all = await h.json('/events');
    assert.ok(all.body.events.length >= 4);
    for (const limit of ['-1', '0', '1']) {
      const { body } = await h.json(`/events?limit=${limit}`);
      assert.equal(body.events.length, 1, `limit=${limit}`);
    }
    const junk = await h.json('/events?limit=lots');
    assert.equal(junk.body.events.length, all.body.events.length);
  } finally {
    await h.close();
  }
});

test('explaining a request that never parsed does not invent a query for it', async () => {
  const h = await boot();
  try {
    const refused = await submit(h, TRIAL, 'tell me something interesting');
    assert.equal(refused.body.request.decision.reasons[0].code, 'invalid_query');
    const { status, body } = await h.json(`/requests/${refused.body.request.id}/explain`);
    assert.equal(status, 200);
    assert.match(body.explanation, /could not be resolved to a supported data query/);
    assert.doesNotMatch(body.explanation, /0x0{40}/);
  } finally {
    await h.close();
  }
});

test('the gateway root says what it is, and every answer revalidates instead of being cached', async () => {
  const h = await boot();
  try {
    const root = await fetch(`${h.url}/`);
    assert.equal(root.status, 200);
    assert.equal(((await root.json()) as { service?: string }).service, 'faregate-gateway');
    assert.equal(root.headers.get('cache-control'), 'private, no-cache');
    assert.equal(root.headers.get('x-content-type-options'), 'nosniff');

    // An unchanged list comes back as a bodiless 304, which keeps a polling dashboard cheap.
    const list = await fetch(`${h.url}/requests`);
    const etag = list.headers.get('etag');
    assert.ok(etag);
    await list.arrayBuffer();
    // Sent the way a browser revalidates. Node's fetch cannot be used here: with
    // If-None-Match it adds Cache-Control: no-cache, which rules out a 304.
    const revalidated = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        `${h.url}/requests`,
        { headers: { 'if-none-match': etag, 'cache-control': 'max-age=0' } },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on('error', reject);
      req.end();
    });
    assert.equal(revalidated, 304);
  } finally {
    await h.close();
  }
});

// --- the model must not invent a subject -------------------------------------

/** A model that answers every ask with one fixed proposal, the way a guessing model might. */
function modelProposing(proposal: Record<string, unknown>): AIProvider {
  const fallback = new RuleBasedAIProvider();
  return {
    name: 'openrouter',
    describe: () => 'test model',
    interpret: async () => ({ proposal, rationale: 'test model proposal', provider: 'openrouter' }),
    explain: (decision, query, agent) => fallback.explain(decision, query, agent),
    analyze: (query, data, provenance) => fallback.analyze(query, data, provenance),
  };
}

const ZERO = '0x0000000000000000000000000000000000000000';

test('a model that fills in the zero address for a request naming no wallet is overruled', async () => {
  const h = await boot({}, undefined, modelProposing({ resource: 'wallet.activity', address: ZERO, lookbackDays: 30 }));
  try {
    const { status, body } = await submit(h, RESEARCH, 'tell me something interesting about wallets');
    assert.equal(status, 403);
    assert.equal(body.interpretedBy, 'rule-based');
    assert.deepEqual(body.request.decision.reasons.map((r: any) => r.code), ['invalid_query']);
  } finally {
    await h.close();
  }
});

test('a model that swaps in an address the agent never wrote is overruled by the address it did write', async () => {
  const other = '0x1111111111111111111111111111111111111111';
  const h = await boot({}, undefined, modelProposing({ resource: 'wallet.activity', address: other, lookbackDays: 30 }));
  try {
    const { status, body } = await submit(h, RESEARCH, `Analyze the recent activity of ${SUBJECT} over the last month`);
    assert.equal(status, 201);
    assert.equal(body.interpretedBy, 'rule-based');
    assert.equal(body.request.query.address, SUBJECT.toLowerCase());
  } finally {
    await h.close();
  }
});

test('a transaction hash is not read as a wallet, and only market data may name no wallet', async () => {
  const h = await boot();
  try {
    const hash = `0x${'ab'.repeat(32)}`;
    const fromHash = await submit(h, RESEARCH, `Show the transfers in ${hash}`);
    assert.deepEqual(fromHash.body.request.decision.reasons.map((r: any) => r.code), ['invalid_query']);

    const zeroWallet = await h.json('/requests', {
      method: 'POST',
      body: JSON.stringify({ agentId: RESEARCH, query: { resource: 'wallet.balances', address: ZERO, lookbackDays: 1 } }),
    });
    assert.deepEqual(zeroWallet.body.request.decision.reasons.map((r: any) => r.code), ['invalid_query']);

    // Market data is not about a wallet: the query parses, and the passport's scope refuses it.
    const markets = await h.json('/requests', {
      method: 'POST',
      body: JSON.stringify({ agentId: RESEARCH, query: { resource: 'protocol.markets', address: ZERO, lookbackDays: 1 } }),
    });
    assert.deepEqual(markets.body.request.decision.reasons.map((r: any) => r.code), ['resource_not_allowed']);
  } finally {
    await h.close();
  }
});

// --- a facilitator that has not answered yet ---------------------------------

test('while the payment facilitator has not answered, collection waits with a 503 and health says why', async () => {
  let ready = false;
  // Enough of an x402 server for the middleware to mount and pass requests on.
  const paymentServer = {
    routes: {},
    server: { hasExtension: () => true, registerExtension: () => undefined },
    initialize: async () => undefined,
    requiresPayment: () => false,
  } as unknown as x402HTTPResourceServer;
  const store = new GatewayStore();
  seedDemoData(store, new Date('2026-09-10T00:00:00.000Z'));
  const config = simulatedConfig();
  const app = createApp({
    config: { ...config, payment: { ...config.payment, mode: 'live', payTo: '0.0.10457565' } },
    store,
    dataProvider: new SimulatedDataProvider(),
    aiProvider: new RuleBasedAIProvider(),
    identity: new LocalIdentityService(store),
    paymentServer,
    paymentReady: () => ready,
    now: () => new Date('2026-09-10T12:00:00.000Z'),
  });
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const address = server.address();
  const url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  const missing = `${url}/data/00000000-0000-4000-8000-000000000000`;
  try {
    const waiting = await fetch(missing);
    assert.equal(waiting.status, 503);
    assert.equal(waiting.headers.get('retry-after'), '30');
    assert.equal(((await waiting.json()) as any).error.code, 'payment_unavailable');

    const paused = (await (await fetch(`${url}/health`)).json()) as any;
    assert.equal(paused.paymentReady, false);
    assert.ok(paused.notes.some((note: string) => /facilitator/.test(note)));

    ready = true;
    const open = (await (await fetch(`${url}/health`)).json()) as any;
    assert.equal(open.paymentReady, true);
    assert.ok(!open.notes.some((note: string) => /facilitator/.test(note)));
    const through = await fetch(missing);
    assert.notEqual(through.status, 503);
    await through.arrayBuffer();
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
