import test from 'node:test';
import assert from 'node:assert/strict';

import { RuleBasedAIProvider, groundAnalysis } from './provider.ts';
import { parseStructuredQuery } from '../query-parser.ts';
import type { DataProvenance, PolicyDecision, ResourceQuery } from '@faregate/shared';

const ADDRESS = '0x742d35cc6634c0532925a3b844bc454e4438f44e' as const;

const provenance: DataProvenance = {
  provider: 'simulated',
  source: 'test',
  queriedAt: '2026-09-10T12:00:00.000Z',
  simulated: true,
};

// --- grounding -----------------------------------------------------------

test('grounding keeps hashes that appear in the data', () => {
  const data = { events: [{ hash: '0xabcdef1234567890abcdef1234567890' }] };
  const out = groundAnalysis('Transfer 0xabcdef1234567890abcdef1234567890 was the largest.', data);
  assert.equal(out.warnings.length, 0);
  assert.match(out.text, /0xabcdef1234567890abcdef1234567890/);
});

test('grounding strips a hash the data never contained and records it', () => {
  const data = { events: [{ hash: '0xabcdef1234567890abcdef1234567890' }] };
  const out = groundAnalysis('See 0xdeadbeefdeadbeefdeadbeefdeadbeef for details.', data);
  assert.deepEqual(out.warnings, ['0xdeadbeefdeadbeefdeadbeefdeadbeef']);
  assert.doesNotMatch(out.text, /0xdeadbeef/);
  assert.match(out.text, /\[unverified value removed\]/);
});

test('grounding is case-insensitive on hex', () => {
  const data = { hash: '0xABCDEF1234567890ABCDEF1234567890' };
  const out = groundAnalysis('hash 0xabcdef1234567890abcdef1234567890', data);
  assert.equal(out.warnings.length, 0);
});

test('grounding leaves short hex-like fragments alone', () => {
  // Fewer than 8 hex chars is not treated as an onchain identifier.
  const out = groundAnalysis('code 0xdead was set', {});
  assert.equal(out.warnings.length, 0);
  assert.equal(out.text, 'code 0xdead was set');
});

// --- rule-based provider ------------------------------------------------

test('rule-based interpret produces a proposal the validator accepts', async () => {
  const ai = new RuleBasedAIProvider();
  const out = await ai.interpret(`Show transfers for ${ADDRESS} over the last week`);
  const validated = parseStructuredQuery(out.proposal);
  assert.ok(validated.query);
  assert.equal(validated.query.resource, 'wallet.transfers');
  assert.equal(validated.query.lookbackDays, 7);
  assert.equal(out.provider, 'rule-based');
});

test('rule-based interpret returns a null proposal for an unparseable ask', async () => {
  const ai = new RuleBasedAIProvider();
  const out = await ai.interpret('tell me something interesting');
  assert.equal(out.proposal, null);
  const validated = parseStructuredQuery(out.proposal);
  assert.equal(validated.query, null);
});

test('rule-based explain includes every reason and the outcome', async () => {
  const ai = new RuleBasedAIProvider();
  const query: ResourceQuery = { resource: 'wallet.activity', address: ADDRESS, lookbackDays: 30 };
  const decision: PolicyDecision = {
    allowed: true,
    requiresHumanApproval: true,
    reasons: [{ code: 'requires_human_approval', message: 'Cost is above the automatic approval threshold.' }],
    estimatedCostUsd: 0.036,
    spentTodayUsd: 0,
    remainingTodayUsd: 1,
    evaluatedAt: '2026-09-10T12:00:00.000Z',
  };
  const text = await ai.explain(decision, query, null);
  assert.match(text, /above the automatic approval threshold/);
  assert.match(text, /human must approve/);
  assert.match(text, /\$0\.0360/);
});

test('rule-based analyze labels simulated data as simulated', async () => {
  const ai = new RuleBasedAIProvider();
  const query: ResourceQuery = { resource: 'wallet.balances', address: ADDRESS, lookbackDays: 1 };
  const out = await ai.analyze(query, { events: [1, 2, 3], totalUsd: 42 }, provenance);
  assert.match(out.text, /^Simulated data, not sourced from any chain/);
  assert.match(out.text, /3 events/);
  assert.equal(out.groundingWarnings.length, 0);
});
