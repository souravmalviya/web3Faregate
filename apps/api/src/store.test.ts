import test from 'node:test';
import assert from 'node:assert/strict';

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
