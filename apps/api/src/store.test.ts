import test from 'node:test';
import assert from 'node:assert/strict';

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { GatewayStore, seedDemoData, utcDayKey } from './store.ts';

const AGENT = 'research.agents.faregate.eth';

test('daily spend is keyed by UTC day and resets across days', () => {
  const store = new GatewayStore();
  const day1 = new Date('2026-09-10T23:59:00.000Z');
  const day2 = new Date('2026-09-11T00:01:00.000Z');

  store.recordSpend(AGENT, 36_000, day1);
  assert.equal(store.spentTodayMicros(AGENT, day1), 36_000);
  assert.equal(store.spentTodayMicros(AGENT, day2), 0);
  assert.equal(utcDayKey(day1), '2026-09-10');
  assert.equal(utcDayKey(day2), '2026-09-11');
});

test('spend accumulates and ignores non-positive amounts', () => {
  const store = new GatewayStore();
  const at = new Date('2026-09-10T12:00:00.000Z');
  store.recordSpend(AGENT, 10_200, at);
  store.recordSpend(AGENT, 10_200, at);
  store.recordSpend(AGENT, 0, at);
  store.recordSpend(AGENT, -5_000, at);
  assert.equal(store.spentTodayMicros(AGENT, at), 20_400);
});

test('a nonce can be consumed exactly once', () => {
  const store = new GatewayStore();
  assert.equal(store.consumeNonce('abc'), true);
  assert.equal(store.consumeNonce('abc'), false);
  assert.equal(store.hasConsumedNonce('abc'), true);
  assert.equal(store.hasConsumedNonce('other'), false);
});

test('revocation is a one-way door', () => {
  const store = new GatewayStore();
  seedDemoData(store);
  const revoked = store.revokeAgent(AGENT);
  assert.equal(revoked?.status, 'revoked');
  assert.equal(store.getAgent(AGENT)?.status, 'revoked');
  assert.equal(store.revokeAgent('ghost.agents.faregate.eth'), null);
});

test('audit log is append-only and newest-first on read', () => {
  const store = new GatewayStore();
  const a = store.recordEvent({ type: 'request.received', actor: 'agent' }, new Date('2026-09-10T12:00:00Z'));
  const b = store.recordEvent({ type: 'request.evaluated', actor: 'system' }, new Date('2026-09-10T12:00:01Z'));
  const events = store.listEvents();
  assert.equal(events[0]?.id, b.id);
  assert.equal(events[1]?.id, a.id);
  assert.notEqual(a.id, b.id);
});

test('seeded demo agents contrast a budgeted passport with a trial one', () => {
  const store = new GatewayStore();
  seedDemoData(store);
  const research = store.getPolicy(AGENT);
  const trial = store.getPolicy('trial.agents.faregate.eth');
  assert.ok(research && trial);
  assert.ok(research.dailyLimitUsd > trial.dailyLimitUsd);
  assert.ok(research.allowedResources.length > trial.allowedResources.length);
  // The research agent's threshold is below the cost of a 30-day activity
  // query, which is what makes the demo stop for a human.
  assert.ok(research.humanApprovalAboveUsd < 0.036);
});

// --- persistence -------------------------------------------------------------

function scratchFile(): string {
  return path.join(mkdtempSync(path.join(tmpdir(), 'faregate-store-')), 'state.json');
}

test('state survives a restart through the snapshot file, including a revocation', () => {
  const file = scratchFile();
  try {
    const first = new GatewayStore({ file });
    seedDemoData(first);
    first.revokeAgent(AGENT);
    first.recordSpend('trial.agents.faregate.eth', 10_200, new Date('2026-09-10T12:00:00.000Z'));
    first.consumeNonce('nonce-1');
    first.rememberIdempotent('key-1', 'req-1');
    first.putRequest({
      id: 'req-1',
      agentId: AGENT,
      prompt: 'x',
      query: { resource: 'wallet.balances', address: '0x0000000000000000000000000000000000000000', lookbackDays: 1 },
      status: 'rejected',
      estimatedCostUsd: 0,
      createdAt: '2026-09-10T12:00:00.000Z',
      updatedAt: '2026-09-10T12:00:00.000Z',
    });
    first.recordEvent({ type: 'agent.revoked', actor: 'human', agentId: AGENT });
    first.flush();
    assert.ok(existsSync(file));

    const second = new GatewayStore({ file });
    assert.equal(second.getAgent(AGENT)?.status, 'revoked');
    assert.equal(second.getPolicy(AGENT)?.dailyLimitUsd, 1);
    assert.equal(second.spentTodayMicros('trial.agents.faregate.eth', new Date('2026-09-10T18:00:00.000Z')), 10_200);
    assert.equal(second.hasConsumedNonce('nonce-1'), true);
    assert.equal(second.lookupIdempotent('key-1'), 'req-1');
    assert.equal(second.getRequest('req-1')?.status, 'rejected');
    assert.equal(second.listEvents()[0]?.type, 'agent.revoked');
    assert.equal(second.listAgents().length, 2);
  } finally {
    rmSync(path.dirname(file), { recursive: true, force: true });
  }
});

test('changes are written automatically shortly after they happen', async () => {
  const file = scratchFile();
  try {
    const store = new GatewayStore({ file });
    seedDemoData(store);
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.ok(existsSync(file), 'snapshot written without an explicit flush');
    const snapshot = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(snapshot.version, 1);
    assert.equal(snapshot.agents.length, 2);
  } finally {
    rmSync(path.dirname(file), { recursive: true, force: true });
  }
});

test('a corrupt snapshot is set aside and the store starts empty', (t) => {
  const file = scratchFile();
  const errors = t.mock.method(console, 'error', () => {});
  try {
    writeFileSync(file, '{ this is not json');
    const store = new GatewayStore({ file });
    assert.equal(store.listAgents().length, 0);
    assert.equal(existsSync(file), false);
    assert.match(String(errors.mock.calls[0]?.arguments[0]), /could not be read/);
  } finally {
    rmSync(path.dirname(file), { recursive: true, force: true });
  }
});

test('a store without a file never touches the disk', () => {
  const store = new GatewayStore();
  seedDemoData(store);
  store.flush();
  assert.equal(store.describePersistence(), 'memory only');
});
