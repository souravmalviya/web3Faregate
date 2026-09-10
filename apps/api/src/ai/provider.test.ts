import test from 'node:test';
import assert from 'node:assert/strict';

import { OpenRouterAIProvider, RuleBasedAIProvider, groundAnalysis } from './provider.ts';
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

test('grounding keeps the validated subject address even when the data does not repeat it', () => {
  const data = { deposits: [{ hash: '0xabcdef1234567890abcdef1234567890' }] };
  const out = groundAnalysis(`The wallet at ${ADDRESS} deposited once.`, data, [ADDRESS]);
  assert.equal(out.warnings.length, 0);
  assert.match(out.text, new RegExp(ADDRESS));
});

test('grounding still removes an address that is neither the subject nor in the data', () => {
  const other = '0x1111111111111111111111111111111111111111';
  const out = groundAnalysis(`Funds moved to ${other}.`, {}, [ADDRESS]);
  assert.deepEqual(out.warnings, [other]);
  assert.doesNotMatch(out.text, /0x1111/);
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

// --- OpenRouter -----------------------------------------------------------

function completion(content: string, finishReason = 'stop'): Response {
  return new Response(
    JSON.stringify({ choices: [{ finish_reason: finishReason, message: { content } }] }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

interface RecordedCall {
  url: string;
  body: any;
  headers: Record<string, string>;
}

function openRouter(respond: () => Response) {
  const calls: RecordedCall[] = [];
  const fetchImpl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: JSON.parse(String(init?.body)),
      headers: init?.headers as Record<string, string>,
    });
    return respond();
  }) as typeof fetch;
  const ai = new OpenRouterAIProvider({ apiKey: 'or-test-key', model: 'openai/gpt-4.1-mini', fetchImpl });
  return { ai, calls };
}

const APPROVAL_DECISION: PolicyDecision = {
  allowed: true,
  requiresHumanApproval: true,
  reasons: [{ code: 'requires_human_approval', message: 'Cost is above the automatic approval threshold.' }],
  estimatedCostUsd: 0.036,
  spentTodayUsd: 0,
  remainingTodayUsd: 1,
  evaluatedAt: '2026-09-10T12:00:00.000Z',
};

test('openrouter interpret requests a strict JSON schema and returns a proposal the validator accepts', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { ai, calls } = openRouter(() =>
    completion(
      JSON.stringify({
        resource: 'wallet.activity',
        address: ADDRESS,
        lookbackDays: 30,
        rationale: 'Recent activity was asked for.',
      }),
    ),
  );

  const out = await ai.interpret(`Analyze the recent activity of ${ADDRESS}`);

  assert.equal(out.provider, 'openrouter');
  assert.equal(out.rationale, 'Recent activity was asked for.');
  assert.equal(parseStructuredQuery(out.proposal).query?.resource, 'wallet.activity');

  const call = calls[0] as RecordedCall;
  assert.equal(call.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(call.headers.authorization, 'Bearer or-test-key');
  assert.equal(call.body.model, 'openai/gpt-4.1-mini');
  assert.equal(call.body.response_format.type, 'json_schema');
  assert.equal(call.body.response_format.json_schema.strict, true);
  assert.deepEqual(call.body.response_format.json_schema.schema.required, [
    'resource',
    'address',
    'lookbackDays',
    'rationale',
  ]);
  assert.equal(call.body.provider.require_parameters, true);
});

test('openrouter interpret falls back to the rule-based parser when the model returns invalid JSON', async (t) => {
  const errors = t.mock.method(console, 'error', () => {});
  const { ai } = openRouter(() => completion('not json at all'));
  const out = await ai.interpret(`Show transfers for ${ADDRESS} over the last week`);
  assert.equal(out.provider, 'rule-based');
  assert.equal(parseStructuredQuery(out.proposal).query?.resource, 'wallet.transfers');
  assert.match(String(errors.mock.calls[0]?.arguments[0]), /invalid JSON/);
});

test('openrouter interpret falls back when the proposal fails schema validation', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { ai } = openRouter(() =>
    completion(JSON.stringify({ resource: 'wallet.everything', address: ADDRESS, lookbackDays: 30, rationale: 'x' })),
  );
  const out = await ai.interpret(`Show transfers for ${ADDRESS} over the last week`);
  assert.equal(out.provider, 'rule-based');
});

test('openrouter out of credits is logged as such and the explanation still arrives', async (t) => {
  const errors = t.mock.method(console, 'error', () => {});
  const { ai } = openRouter(
    () => new Response(JSON.stringify({ error: { code: 402, message: 'Insufficient credits' } }), { status: 402 }),
  );
  const text = await ai.explain(APPROVAL_DECISION, null, null);
  assert.match(text, /human must approve/);
  assert.match(String(errors.mock.calls[0]?.arguments[0]), /credits are exhausted/);
});

test('openrouter analysis is grounding-checked against the retrieved data', async (t) => {
  t.mock.method(console, 'error', () => {});
  const data = { events: [{ hash: '0xabcdef1234567890abcdef1234567890' }] };
  // The subject address is written in checksum-style uppercase, as a model
  // might, and must survive; the invented hash must not.
  const { ai } = openRouter(() =>
    completion(
      'Wallet 0x742D35CC6634C0532925A3B844BC454E4438F44E: the largest transfer was 0xabcdef1234567890abcdef1234567890, followed by 0xdeadbeefdeadbeefdeadbeefdeadbeef.',
    ),
  );
  const query: ResourceQuery = { resource: 'wallet.transfers', address: ADDRESS, lookbackDays: 7 };
  const out = await ai.analyze(query, data, provenance);
  assert.equal(out.provider, 'openrouter');
  assert.deepEqual(out.groundingWarnings, ['0xdeadbeefdeadbeefdeadbeefdeadbeef']);
  assert.match(out.text, /0x742D35CC6634C0532925A3B844BC454E4438F44E/);
  assert.match(out.text, /0xabcdef1234567890abcdef1234567890/);
  assert.doesNotMatch(out.text, /0xdeadbeef/);
});

test('openrouter content-filter declines fall back to the rule-based summary', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { ai } = openRouter(() => completion('', 'content_filter'));
  const query: ResourceQuery = { resource: 'wallet.balances', address: ADDRESS, lookbackDays: 1 };
  const out = await ai.analyze(query, { events: [1] }, provenance);
  assert.equal(out.provider, 'rule-based');
});
