/**
 * Turns an agent's natural-language ask into a structured, priceable query.
 *
 * This module is deliberately rule-based and pure. The AI layer in
 * `ai/provider.ts` wraps it: the model may propose a structured query, but
 * whatever it proposes is validated by `parseStructuredQuery` below before the
 * policy engine ever sees it. A model that invents a resource kind, an address
 * or a 900-day lookback produces a rejected parse, not a privileged query.
 *
 * The practical consequence is that Faregate degrades to a working product with
 * no AI key at all, and that the AI can never widen an agent's scope.
 */

import {
  clampLookbackDays,
  isResourceKind,
  type Address,
  type ResourceKind,
  type ResourceQuery,
} from '@faregate/shared';

const ADDRESS_RE = /0x[a-fA-F0-9]{40}/;
const FULL_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export interface ParseResult {
  query: ResourceQuery | null;
  /** Human-readable explanation used in the audit trail and the dashboard. */
  note: string;
}

export function extractAddress(text: string): Address | null {
  const match = ADDRESS_RE.exec(text);
  if (!match) return null;
  return match[0].toLowerCase() as Address;
}

export function isAddress(value: unknown): value is Address {
  return typeof value === 'string' && FULL_ADDRESS_RE.test(value);
}

/** Keyword table, most specific first. Order matters: `transfers` beats `activity`. */
const RESOURCE_KEYWORDS: ReadonlyArray<readonly [ResourceKind, readonly string[]]> = [
  ['protocol.positions', ['position', 'borrow', 'collateral', 'lending', 'loan', 'health factor']],
  ['protocol.markets', ['market', 'supply rate', 'borrow rate', 'liquidity pool', 'tvl']],
  ['wallet.transfers', ['transfer', 'sent', 'received', 'inflow', 'outflow']],
  ['wallet.balances', ['balance', 'holding', 'portfolio', 'how much', 'net worth']],
  ['wallet.activity', ['activity', 'active', 'transaction', 'history', 'recent', 'behaviour', 'behavior']],
];

export function inferResource(text: string): ResourceKind | null {
  const haystack = text.toLowerCase();
  for (const [resource, keywords] of RESOURCE_KEYWORDS) {
    for (const keyword of keywords) {
      if (haystack.includes(keyword)) return resource;
    }
  }
  return null;
}

const RELATIVE_WINDOWS: ReadonlyArray<readonly [RegExp, number]> = [
  [/\btoday\b/i, 1],
  [/\byesterday\b/i, 2],
  [/\blast week\b|\bpast week\b/i, 7],
  [/\blast month\b|\bpast month\b/i, 30],
  [/\blast quarter\b|\bpast quarter\b/i, 90],
  [/\blast year\b|\bpast year\b/i, 365],
];

const EXPLICIT_WINDOW_RE = /\b(\d{1,4})\s*(day|days|d|week|weeks|w|month|months|year|years)\b/i;

export function inferLookbackDays(text: string, fallback = 30): number {
  const explicit = EXPLICIT_WINDOW_RE.exec(text);
  if (explicit) {
    const amount = Number.parseInt(explicit[1] ?? '', 10);
    const unit = (explicit[2] ?? '').toLowerCase();
    if (Number.isFinite(amount)) {
      const multiplier = unit.startsWith('w') ? 7 : unit.startsWith('m') ? 30 : unit.startsWith('y') ? 365 : 1;
      return clampLookbackDays(amount * multiplier);
    }
  }
  for (const [pattern, days] of RELATIVE_WINDOWS) {
    if (pattern.test(text)) return clampLookbackDays(days);
  }
  return clampLookbackDays(fallback);
}

/**
 * Parses a free-text agent request. Never throws: an unparseable request is a
 * normal outcome that the policy engine denies with `invalid_query`.
 */
export function parsePrompt(prompt: string): ParseResult {
  const text = typeof prompt === 'string' ? prompt.trim() : '';
  if (text.length === 0) {
    return { query: null, note: 'The request was empty.' };
  }
  if (text.length > 2000) {
    return { query: null, note: 'The request exceeded the 2000 character limit.' };
  }

  const address = extractAddress(text);
  if (!address) {
    return { query: null, note: 'No EVM address was found in the request.' };
  }

  const resource = inferResource(text);
  if (!resource) {
    return {
      query: null,
      note: 'The request did not name a supported resource such as balances, transfers or activity.',
    };
  }

  const lookbackDays = inferLookbackDays(text);
  return {
    query: { resource, address, lookbackDays },
    note: `Interpreted as ${resource} for ${address} over ${lookbackDays} day(s).`,
  };
}

/**
 * Validates a structured query that came from somewhere untrusted, such as a
 * model response or a raw API caller. Unknown fields are dropped rather than
 * passed through, so nothing can smuggle extra parameters into the data layer.
 */
export function parseStructuredQuery(value: unknown): ParseResult {
  if (typeof value !== 'object' || value === null) {
    return { query: null, note: 'Structured query was not an object.' };
  }
  const candidate = value as Record<string, unknown>;

  if (!isResourceKind(candidate.resource)) {
    return { query: null, note: `Unsupported resource: ${String(candidate.resource)}.` };
  }
  if (!isAddress(candidate.address)) {
    return { query: null, note: 'Structured query did not carry a valid EVM address.' };
  }

  const rawLookback = candidate.lookbackDays;
  const lookbackDays = clampLookbackDays(
    typeof rawLookback === 'number' ? rawLookback : Number.parseInt(String(rawLookback ?? 30), 10),
  );

  const query: ResourceQuery = {
    resource: candidate.resource,
    address: candidate.address.toLowerCase() as Address,
    lookbackDays,
  };

  if (typeof candidate.protocol === 'string' && /^[a-z0-9-]{1,40}$/.test(candidate.protocol)) {
    query.protocol = candidate.protocol;
  }

  return {
    query,
    note: `Accepted structured query for ${query.resource} over ${lookbackDays} day(s).`,
  };
}
