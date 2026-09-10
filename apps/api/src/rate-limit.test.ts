import test from 'node:test';
import assert from 'node:assert/strict';

import { SlidingWindowLimiter } from './rate-limit.ts';

test('allows up to the limit inside the window and refuses the next', () => {
  const limiter = new SlidingWindowLimiter({ limit: 3, windowMs: 1000 });
  const t = 1_000_000;
  assert.equal(limiter.check('a', t).allowed, true);
  assert.equal(limiter.check('a', t + 10).allowed, true);
  assert.equal(limiter.check('a', t + 20).allowed, true);
  const fourth = limiter.check('a', t + 30);
  assert.equal(fourth.allowed, false);
  // The oldest hit was at t, so the window frees up at t + 1000.
  assert.equal(fourth.retryAfterMs, 970);
});

test('keys are independent', () => {
  const limiter = new SlidingWindowLimiter({ limit: 1, windowMs: 1000 });
  assert.equal(limiter.check('a', 0).allowed, true);
  assert.equal(limiter.check('b', 0).allowed, true);
  assert.equal(limiter.check('a', 1).allowed, false);
});

test('the window slides: old hits stop counting', () => {
  const limiter = new SlidingWindowLimiter({ limit: 2, windowMs: 1000 });
  assert.equal(limiter.check('a', 0).allowed, true);
  assert.equal(limiter.check('a', 500).allowed, true);
  assert.equal(limiter.check('a', 999).allowed, false);
  assert.equal(limiter.check('a', 1001).allowed, true);
});

test('a refused check does not count as a hit', () => {
  const limiter = new SlidingWindowLimiter({ limit: 1, windowMs: 1000 });
  limiter.check('a', 0);
  limiter.check('a', 100);
  limiter.check('a', 200);
  // Only the first hit is inside the window, so it clears exactly when that
  // one expires rather than being pushed out by the refused attempts.
  assert.equal(limiter.check('a', 1001).allowed, true);
});

test('prune drops idle keys and keeps active ones', () => {
  const limiter = new SlidingWindowLimiter({ limit: 5, windowMs: 1000 });
  limiter.check('idle', 0);
  limiter.check('active', 900);
  limiter.prune(1500);
  // An idle key that was pruned starts fresh; an active key keeps its count.
  assert.equal(limiter.check('idle', 1500).remaining, 4);
  assert.equal(limiter.check('active', 1500).remaining, 3);
});
