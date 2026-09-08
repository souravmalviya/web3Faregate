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
import type { Server } from 'node:http';

import { RuleBasedAIProvider } from './ai/provider.ts';
import { createApp } from './app.ts';
import type { AppConfig } from './config.ts';
import { SimulatedDataProvider } from './data/provider.ts';
import { LocalIdentityService } from './identity/service.ts';
import { GatewayStore, seedDemoData } from './store.ts';

const SUBJECT = '0x742d35Cc6634C0532925a3b844Bc454e4438f44e';
const HUMAN = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const RESEARCH = 'research.agents.faregate.eth';
const TRIAL = 'trial.agents.faregate.eth';

function simulatedConfig(): AppConfig {
  return {
    port: 0,
    corsOrigin: 'http://localhost:3000',
    payment: {
      mode: 'simulated',
      network: 'hedera:testnet',
      facilitatorUrl: 'https://example.invalid',
      payTo: undefined,
      asset: '0.0.429274',
      maxTimeoutSeconds: 60,
      reason: 'test',
    },
    data: { mode: 'simulated', graphApiKey: undefined, subgraphUrl: undefined, reason: 'test' },
    ai: { mode: 'simulated', apiKey: undefined, model: 'claude-opus-5', reason: 'test' },
    ens: {
      mode: 'simulated',
      rpcUrl: undefined,
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

async function boot(): Promise<Harness> {
  const store = new GatewayStore();
  seedDemoData(store, new Date('2026-09-10T00:00:00.000Z'));
  const app = createApp({
    config: simulatedConfig(),
    store,
    dataProvider: new SimulatedDataProvider(),
    aiProvider: new RuleBasedAIProvider(),
    identity: new LocalIdentityService(store),
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
      return { status: response.status, body: await response.json().catch(() => ({})) };
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
    const revoked = await h.json(`/agents/${RESEARCH}/revoke`, { method: 'POST' });
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

    await h.json(`/agents/${RESEARCH}/revoke`, { method: 'POST' });

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
    const { status } = await h.json('/agents/ghost.agents.faregate.eth/revoke', { method: 'POST' });
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
