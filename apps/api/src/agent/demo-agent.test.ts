/**
 * The demo agent against a real gateway on an ephemeral port, with payments
 * simulated so nothing is charged, plus its retry rules against stubbed
 * answers.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';

import { RuleBasedAIProvider } from '../ai/provider.ts';
import { createApp } from '../app.ts';
import type { AppConfig } from '../config.ts';
import { SimulatedDataProvider } from '../data/provider.ts';
import { LocalIdentityService } from '../identity/service.ts';
import { GatewayStore, seedDemoData } from '../store.ts';
import { DemoAgent } from './demo-agent.ts';

const SUBJECT = '0x742d35Cc6634C0532925a3b844Bc454e4438f44e';
const RESEARCH = 'research.agents.faregate.eth';
const TRIAL = 'trial.agents.faregate.eth';
const NOW = new Date('2026-09-10T12:00:00.000Z');

function simulatedConfig(): AppConfig {
  return {
    port: 0,
    corsOrigins: ['http://localhost:3000'],
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
    ens: { mode: 'simulated', rpcUrls: [], parentName: 'agents.faregate.eth', universalResolver: undefined, reason: 'test' },
  };
}

async function gateway(): Promise<{ url: string; store: GatewayStore; close: () => Promise<void> }> {
  const store = new GatewayStore();
  seedDemoData(store, new Date('2026-09-10T00:00:00.000Z'));
  const app = createApp({
    config: simulatedConfig(),
    store,
    dataProvider: new SimulatedDataProvider({ now: () => NOW }),
    aiProvider: new RuleBasedAIProvider(),
    identity: new LocalIdentityService(store),
    now: () => NOW,
  });
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const address = server.address();
  const url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  return { url, store, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

async function submit(url: string, agentId: string, prompt: string): Promise<{ id: string; status: string }> {
  const response = await fetch(`${url}/requests`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ agentId, prompt }),
  });
  return ((await response.json()) as { request: { id: string; status: string } }).request;
}

test('the demo agent collects a cleared request for its passports, once, and leaves the rest alone', async () => {
  const g = await gateway();
  try {
    const cheap = await submit(g.url, TRIAL, `balance of ${SUBJECT} today`);
    const waiting = await submit(g.url, RESEARCH, `Analyze the recent activity of ${SUBJECT} over the last month`);
    const stranger = await submit(g.url, 'nobody.agents.faregate.eth', `balance of ${SUBJECT} today`);
    assert.equal(cheap.status, 'payment_required');
    assert.equal(waiting.status, 'awaiting_approval');
    assert.equal(stranger.status, 'rejected');

    const agent = new DemoAgent({ gatewayUrl: g.url, passports: [TRIAL, RESEARCH], log: () => {} });
    await agent.tick();
    assert.equal(g.store.getRequest(cheap.id)?.status, 'fulfilled');
    assert.equal(g.store.getRequest(waiting.id)?.status, 'awaiting_approval');
    assert.equal(g.store.getRequest(stranger.id)?.status, 'rejected');
    assert.ok(agent.status().lastCollectedAt);

    await agent.tick();
    const deliveries = g.store.listEventsForRequest(cheap.id).filter((event) => event.type === 'request.fulfilled');
    assert.equal(deliveries.length, 1);
  } finally {
    await g.close();
  }
});

test('an approval is collected on the next pass, so approving is the only step a person takes', async () => {
  const g = await gateway();
  try {
    const waiting = await submit(g.url, RESEARCH, `Analyze the recent activity of ${SUBJECT} over the last month`);
    const agent = new DemoAgent({ gatewayUrl: g.url, passports: [RESEARCH], log: () => {} });
    await agent.tick();
    assert.equal(g.store.getRequest(waiting.id)?.status, 'awaiting_approval');

    const approved = await fetch(`${g.url}/requests/${waiting.id}/approval`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'approved', by: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }),
    });
    assert.equal(approved.status, 200);
    await agent.tick();
    assert.equal(g.store.getRequest(waiting.id)?.status, 'fulfilled');
  } finally {
    await g.close();
  }
});

test('a passport the demo agent does not hold is never collected', async () => {
  const g = await gateway();
  try {
    const cheap = await submit(g.url, TRIAL, `balance of ${SUBJECT} today`);
    const agent = new DemoAgent({ gatewayUrl: g.url, passports: [RESEARCH], log: () => {} });
    await agent.tick();
    assert.equal(g.store.getRequest(cheap.id)?.status, 'payment_required');
  } finally {
    await g.close();
  }
});

function listing(...ids: string[]): typeof fetch {
  const requests = ids.map((id, i) => ({
    id,
    agentId: TRIAL,
    status: 'payment_required',
    createdAt: `2026-09-10T12:0${i}:00.000Z`,
    estimatedCostUsd: 0.0102,
  }));
  return (async () => Response.json({ requests })) as typeof fetch;
}

test('a paused payment is tried again on the next pass, and a refusal is left alone', async () => {
  const calls: string[] = [];
  let paused = true;
  const agent = new DemoAgent({
    gatewayUrl: 'http://gateway.test',
    passports: [TRIAL],
    fetchImpl: listing('a', 'b'),
    collectFetch: (async (input: Parameters<typeof fetch>[0]) => {
      const id = String(input).split('/').pop() ?? '';
      calls.push(id);
      if (id === 'a' && paused) return Response.json({ error: { code: 'payment_unavailable' } }, { status: 503 });
      if (id === 'b') {
        return Response.json(
          { error: { code: 'forbidden', message: 'This agent passport has been revoked by its owner.' } },
          { status: 403 },
        );
      }
      return Response.json({ ok: true });
    }) as typeof fetch,
    log: () => {},
  });

  await agent.tick();
  assert.deepEqual(calls, ['a'], 'a paused payment stops the pass');
  paused = false;
  await agent.tick();
  assert.deepEqual(calls, ['a', 'a', 'b']);
  await agent.tick();
  assert.deepEqual(calls, ['a', 'a', 'b'], 'nothing is collected or refused twice');
  assert.ok(agent.status().lastCollectedAt);
  assert.match(agent.status().lastError ?? '', /revoked by its owner/);
});

test('two passes at once never collect the same request twice', async () => {
  let collections = 0;
  const agent = new DemoAgent({
    gatewayUrl: 'http://gateway.test',
    passports: [TRIAL],
    fetchImpl: listing('a'),
    collectFetch: (async () => {
      collections += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return Response.json({ ok: true });
    }) as typeof fetch,
    log: () => {},
  });
  await Promise.all([agent.tick(), agent.tick()]);
  await agent.tick();
  assert.equal(collections, 1);
});
