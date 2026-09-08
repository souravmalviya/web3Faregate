/**
 * Deterministic pricing for onchain data queries.
 *
 * All money in this codebase is handled as an integer number of micro-USD
 * (1_000_000 micros = $1.00). Floating point dollars are used only at the
 * display edge. This matters because the policy engine compares costs against
 * hard limits, and a limit check that drifts by a rounding error is a bug that
 * lets an agent spend more than its owner allowed.
 */

import type { ResourceQuery, ResourceKind } from './domain.ts';

export const MICROS_PER_USD = 1_000_000;

/** Base price per resource kind, in micro-USD. */
export const BASE_PRICE_MICROS: Record<ResourceKind, number> = {
  'wallet.balances': 10_000, // $0.010
  'wallet.transfers': 20_000, // $0.020
  'wallet.activity': 30_000, // $0.030
  'protocol.positions': 40_000, // $0.040
  'protocol.markets': 50_000, // $0.050
};

/** Additional cost per day of lookback, in micro-USD. */
export const LOOKBACK_SURCHARGE_MICROS_PER_DAY = 200; // $0.0002

/** Lookback is clamped to this range before pricing and before querying. */
export const MIN_LOOKBACK_DAYS = 1;
export const MAX_LOOKBACK_DAYS = 365;

export function usdToMicros(usd: number): number {
  if (!Number.isFinite(usd)) return 0;
  return Math.round(usd * MICROS_PER_USD);
}

export function microsToUsd(micros: number): number {
  return micros / MICROS_PER_USD;
}

/** Micro-USD in one cent. Used to decide display precision. */
const MICROS_PER_CENT = 10_000;

/**
 * Formats micro-USD for display.
 *
 * Any amount that is not a whole number of cents is rendered to four decimal
 * places. Rounding $0.0360 to "$0.04" would overstate the price by 11% in a
 * product whose entire pitch is sub-cent metering, so precision wins over
 * tidiness here.
 */
export function formatUsd(micros: number): string {
  const usd = microsToUsd(micros);
  if (Math.round(micros) % MICROS_PER_CENT !== 0) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

export function clampLookbackDays(days: number): number {
  if (!Number.isFinite(days)) return MIN_LOOKBACK_DAYS;
  const whole = Math.floor(days);
  if (whole < MIN_LOOKBACK_DAYS) return MIN_LOOKBACK_DAYS;
  if (whole > MAX_LOOKBACK_DAYS) return MAX_LOOKBACK_DAYS;
  return whole;
}

/**
 * Prices a structured query. Pure and total: the same query always yields the
 * same integer, which is what makes the policy decision reproducible and the
 * payment amount auditable after the fact.
 */
export function priceQueryMicros(query: ResourceQuery): number {
  const base = BASE_PRICE_MICROS[query.resource];
  const days = clampLookbackDays(query.lookbackDays);
  return base + days * LOOKBACK_SURCHARGE_MICROS_PER_DAY;
}

/** Convenience wrapper for display and API payloads. */
export function priceQueryUsd(query: ResourceQuery): number {
  return microsToUsd(priceQueryMicros(query));
}
