import test from 'node:test';
import assert from 'node:assert/strict';

import { buildActionMessage, canonicalDigest, canonicalJson, isHumanAction } from './actions.ts';

test('the action message is deterministic and readable', () => {
  const message = buildActionMessage({
    action: 'approve-request',
    subject: 'req-1',
    issuedAt: '2026-09-10T12:00:00.000Z',
  });
  assert.equal(
    message,
    [
      'Faregate action',
      'action: approve-request',
      'subject: req-1',
      'digest: -',
      'issued: 2026-09-10T12:00:00.000Z',
      '',
      'Signing authorises exactly this action on your Faregate gateway. It sends no transaction and spends nothing.',
    ].join('\n'),
  );
});

test('a different subject or action produces a different message', () => {
  const base = { subject: 'req-1', issuedAt: '2026-09-10T12:00:00.000Z' } as const;
  const approve = buildActionMessage({ action: 'approve-request', ...base });
  const reject = buildActionMessage({ action: 'reject-request', ...base });
  const other = buildActionMessage({ action: 'approve-request', ...base, subject: 'req-2' });
  assert.notEqual(approve, reject);
  assert.notEqual(approve, other);
});

test('canonical JSON ignores key order and drops undefined', () => {
  const a = canonicalJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: undefined } });
  const b = canonicalJson({ a: { d: [1, { y: 2, z: 1 }] }, b: 1 });
  assert.equal(a, b);
  assert.equal(a, '{"a":{"d":[1,{"y":2,"z":1}]},"b":1}');
});

test('the digest is stable across key order and changes with content', async () => {
  const one = await canonicalDigest({ dailyLimitUsd: 1, maxCostPerQueryUsd: 0.1 });
  const two = await canonicalDigest({ maxCostPerQueryUsd: 0.1, dailyLimitUsd: 1 });
  const three = await canonicalDigest({ maxCostPerQueryUsd: 0.1, dailyLimitUsd: 2 });
  assert.equal(one, two);
  assert.notEqual(one, three);
  assert.match(one, /^[0-9a-f]{64}$/);
});

test('isHumanAction accepts only the known actions', () => {
  assert.equal(isHumanAction('revoke-agent'), true);
  assert.equal(isHumanAction('delete-everything'), false);
  assert.equal(isHumanAction(42), false);
});
