import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BASE_PRICE_MICROS,
  LOOKBACK_SURCHARGE_MICROS_PER_DAY,
  MAX_LOOKBACK_DAYS,
  MIN_LOOKBACK_DAYS,
  clampLookbackDays,
  formatUsd,
  microsToUsd,
  priceQueryMicros,
  usdToMicros,
} from './pricing.ts';
import type { ResourceQuery } from './domain.ts';

const ADDRESS = '0x1111111111111111111111111111111111111111' as const;

function query(partial: Partial<ResourceQuery> = {}): ResourceQuery {
  return {
    resource: 'wallet.activity',
    address: ADDRESS,
    lookbackDays: 30,
    ...partial,
  };
}

test('usd and micro conversions round-trip without drift', () => {
  assert.equal(usdToMicros(0.03), 30_000);
  assert.equal(usdToMicros(1), 1_000_000);
  assert.equal(microsToUsd(36_000), 0.036);
  // 0.1 + 0.2 style drift must not survive the conversion.
  assert.equal(usdToMicros(0.1) + usdToMicros(0.2), usdToMicros(0.3));
});

test('usdToMicros is defensive about non-finite input', () => {
  assert.equal(usdToMicros(Number.NaN), 0);
  assert.equal(usdToMicros(Number.POSITIVE_INFINITY), 0);
});

test('lookback is clamped to a sane range', () => {
  assert.equal(clampLookbackDays(0), MIN_LOOKBACK_DAYS);
  assert.equal(clampLookbackDays(-5), MIN_LOOKBACK_DAYS);
  assert.equal(clampLookbackDays(10_000), MAX_LOOKBACK_DAYS);
  assert.equal(clampLookbackDays(30.9), 30);
  assert.equal(clampLookbackDays(Number.NaN), MIN_LOOKBACK_DAYS);
});

test('pricing is base plus a per-day lookback surcharge', () => {
  const priced = priceQueryMicros(query({ resource: 'wallet.activity', lookbackDays: 30 }));
  assert.equal(
    priced,
    BASE_PRICE_MICROS['wallet.activity'] + 30 * LOOKBACK_SURCHARGE_MICROS_PER_DAY,
  );
  assert.equal(priced, 36_000);
});

test('pricing is deterministic for identical queries', () => {
  const a = priceQueryMicros(query());
  const b = priceQueryMicros(query());
  assert.equal(a, b);
});

test('pricing uses the clamped lookback, not the raw one', () => {
  const huge = priceQueryMicros(query({ lookbackDays: 100_000 }));
  const capped = priceQueryMicros(query({ lookbackDays: MAX_LOOKBACK_DAYS }));
  assert.equal(huge, capped);
});

test('every resource kind has a price', () => {
  for (const resource of Object.keys(BASE_PRICE_MICROS)) {
    const priced = priceQueryMicros(query({ resource: resource as ResourceQuery['resource'] }));
    assert.ok(priced > 0, `${resource} should be priced above zero`);
  }
});

test('sub-cent amounts keep their precision when formatted', () => {
  assert.equal(formatUsd(36_000), '$0.0360');
  assert.equal(formatUsd(1_000_000), '$1.00');
  assert.equal(formatUsd(0), '$0.00');
});
