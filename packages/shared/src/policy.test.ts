import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluatePolicy, type PolicyEvaluationInput } from './policy.ts';
import { priceQueryMicros, usdToMicros } from './pricing.ts';
import type { Agent, Policy, ResourceQuery } from './domain.ts';

const OWNER = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const;
const SUBJECT = '0x1111111111111111111111111111111111111111' as const;
const NOW = new Date('2026-09-10T12:00:00.000Z');

function agent(partial: Partial<Agent> = {}): Agent {
  return {
    id: 'research.agents.faregate.eth',
    label: 'Treasury Research Agent',
    owner: OWNER,
    status: 'active',
    createdAt: '2026-09-09T00:00:00.000Z',
    expiresAt: null,
    source: 'local',
    ...partial,
  };
}

function policy(partial: Partial<Policy> = {}): Policy {
  return {
    agentId: 'research.agents.faregate.eth',
    allowedResources: ['wallet.balances', 'wallet.transfers', 'wallet.activity'],
    maxCostPerQueryUsd: 0.1,
    dailyLimitUsd: 1,
    humanApprovalAboveUsd: 0.02,
    expiresAt: null,
    ...partial,
  };
}

function query(partial: Partial<ResourceQuery> = {}): ResourceQuery {
  return {
    resource: 'wallet.activity',
    address: SUBJECT,
    lookbackDays: 30,
    ...partial,
  };
}

function input(partial: Partial<PolicyEvaluationInput> = {}): PolicyEvaluationInput {
  return {
    agent: agent(),
    policy: policy(),
    query: query(),
    spentTodayMicros: 0,
    now: NOW,
    ...partial,
  };
}

function codes(decision: ReturnType<typeof evaluatePolicy>): string[] {
  return decision.reasons.map((r) => r.code);
}

// --- allowed paths -------------------------------------------------------

test('allows a request that sits inside every limit', () => {
  const decision = evaluatePolicy(
    input({ query: query({ resource: 'wallet.balances', lookbackDays: 1 }) }),
  );
  assert.equal(decision.allowed, true);
  assert.equal(decision.requiresHumanApproval, false);
  assert.deepEqual(codes(decision), ['within_limits']);
});

test('allows but requires approval above the threshold', () => {
  const decision = evaluatePolicy(input());
  assert.equal(decision.allowed, true);
  assert.equal(decision.requiresHumanApproval, true);
  assert.deepEqual(codes(decision), ['requires_human_approval']);
  assert.equal(decision.estimatedCostUsd, 0.036);
});

test('the approval threshold is exclusive: cost exactly at it is automatic', () => {
  const q = query({ resource: 'wallet.balances', lookbackDays: 1 });
  const costUsd = priceQueryMicros(q) / 1_000_000;
  const decision = evaluatePolicy(
    input({ query: q, policy: policy({ humanApprovalAboveUsd: costUsd }) }),
  );
  assert.equal(decision.allowed, true);
  assert.equal(decision.requiresHumanApproval, false);
});

test('reports remaining daily budget alongside the decision', () => {
  const decision = evaluatePolicy(input({ spentTodayMicros: usdToMicros(0.25) }));
  assert.equal(decision.spentTodayUsd, 0.25);
  assert.equal(decision.remainingTodayUsd, 0.75);
});

// --- identity denials ----------------------------------------------------

test('denies when the passport does not resolve', () => {
  const decision = evaluatePolicy(input({ agent: null }));
  assert.equal(decision.allowed, false);
  assert.deepEqual(codes(decision), ['agent_unknown']);
});

test('denies a revoked passport', () => {
  const decision = evaluatePolicy(input({ agent: agent({ status: 'revoked' }) }));
  assert.equal(decision.allowed, false);
  assert.deepEqual(codes(decision), ['agent_revoked']);
});

test('revocation is checked before cost, scope or budget', () => {
  // A revoked agent asking for a disallowed resource, over every limit, must
  // still be reported as revoked. The audit trail depends on this ordering.
  const decision = evaluatePolicy(
    input({
      agent: agent({ status: 'revoked' }),
      query: query({ resource: 'protocol.markets', lookbackDays: 365 }),
      spentTodayMicros: usdToMicros(999),
    }),
  );
  assert.deepEqual(codes(decision), ['agent_revoked']);
});

test('denies a passport past its expiry even when status says active', () => {
  const decision = evaluatePolicy(
    input({ agent: agent({ expiresAt: '2026-09-09T00:00:00.000Z' }) }),
  );
  assert.equal(decision.allowed, false);
  assert.deepEqual(codes(decision), ['agent_expired']);
});

test('a passport expiring in the future is still valid', () => {
  const decision = evaluatePolicy(
    input({ agent: agent({ expiresAt: '2026-12-01T00:00:00.000Z' }) }),
  );
  assert.equal(decision.allowed, true);
});

test('denies when no capability is attached to the passport', () => {
  const decision = evaluatePolicy(input({ policy: null }));
  assert.equal(decision.allowed, false);
  assert.deepEqual(codes(decision), ['agent_unknown']);
});

test('denies an expired capability', () => {
  const decision = evaluatePolicy(
    input({ policy: policy({ expiresAt: '2026-09-09T23:59:59.000Z' }) }),
  );
  assert.equal(decision.allowed, false);
  assert.deepEqual(codes(decision), ['policy_expired']);
});

// --- scope and budget denials -------------------------------------------

test('denies a request that could not be parsed', () => {
  const decision = evaluatePolicy(input({ query: null }));
  assert.equal(decision.allowed, false);
  assert.deepEqual(codes(decision), ['invalid_query']);
});

test('denies a resource outside the granted scope', () => {
  const decision = evaluatePolicy(input({ query: query({ resource: 'protocol.positions' }) }));
  assert.equal(decision.allowed, false);
  assert.deepEqual(codes(decision), ['resource_not_allowed']);
});

test('denies a query above the per-query ceiling', () => {
  const decision = evaluatePolicy(
    input({ policy: policy({ maxCostPerQueryUsd: 0.02 }) }),
  );
  assert.equal(decision.allowed, false);
  assert.deepEqual(codes(decision), ['exceeds_per_query_limit']);
});

test('the per-query ceiling is inclusive: cost exactly at it is allowed', () => {
  const costUsd = priceQueryMicros(query()) / 1_000_000;
  const decision = evaluatePolicy(input({ policy: policy({ maxCostPerQueryUsd: costUsd }) }));
  assert.equal(decision.allowed, true);
});

test('denies a query that would push the agent past its daily limit', () => {
  const decision = evaluatePolicy(input({ spentTodayMicros: usdToMicros(0.98) }));
  assert.equal(decision.allowed, false);
  assert.deepEqual(codes(decision), ['exceeds_daily_limit']);
});

test('a query that lands exactly on the daily limit is allowed', () => {
  const cost = priceQueryMicros(query());
  const decision = evaluatePolicy(
    input({ spentTodayMicros: usdToMicros(1) - cost }),
  );
  assert.equal(decision.allowed, true);
});

test('negative recorded spend cannot be used to widen the budget', () => {
  const decision = evaluatePolicy(input({ spentTodayMicros: -usdToMicros(50) }));
  assert.equal(decision.spentTodayUsd, 0);
  assert.equal(decision.remainingTodayUsd, 1);
});

// --- determinism ---------------------------------------------------------

test('evaluation is pure: identical input yields an identical decision', () => {
  const a = evaluatePolicy(input());
  const b = evaluatePolicy(input());
  assert.deepEqual(a, b);
});
