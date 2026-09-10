/**
 * The data layer.
 *
 * Faregate sells access to indexed onchain data, so this is the thing an agent
 * is actually paying for. Two rules govern everything here:
 *
 * 1. A provider always reports its own provenance, and `simulated: true` is
 *    carried all the way to the API response and the dashboard. Simulated data
 *    is never dressed up as a chain fact.
 * 2. A live provider that fails, fails loudly. It does not quietly fall back to
 *    simulated data, because an agent that paid real HBAR for a real answer
 *    must not receive an invented one.
 */

import type { DataProvenance, ResourceQuery } from '@faregate/shared';

export interface DataResult {
  data: unknown;
  provenance: DataProvenance;
}

export interface DataProvider {
  readonly name: DataProvenance['provider'];
  /** Human-readable description of where data comes from, for /health. */
  describe(): string;
  fetch(query: ResourceQuery): Promise<DataResult>;
}

export class DataProviderError extends Error {
  readonly code: string;
  readonly detail: unknown;

  constructor(code: string, message: string, detail?: unknown) {
    super(message);
    this.name = 'DataProviderError';
    this.code = code;
    this.detail = detail;
  }
}

// --- The Graph -----------------------------------------------------------

/**
 * GraphQL documents, one per resource kind.
 *
 * These are written once against the Messari standardized lending schema and
 * that is the whole point: the same document runs unchanged against every
 * protocol that publishes the standard. Faregate never needs a per-protocol
 * query, and an agent can ask about "lending positions" without the gateway
 * knowing or caring which protocol answers.
 *
 * Entity and field names must still match the subgraph the operator points at,
 * so a mismatch surfaces as a `schema_mismatch` error rather than being
 * swallowed. `provider.test.ts` pins every selected field to Messari lending
 * schema 3.1.0, the version the configured subgraphs report.
 */
export const DOCUMENTS: Record<ResourceQuery['resource'], string> = {
  'wallet.balances': `
    query WalletBalances($account: ID!) {
      account(id: $account) {
        id
        positionCount
        openPositionCount
        positions(first: 50, orderBy: balance, orderDirection: desc) {
          id
          balance
          asset { id symbol decimals }
        }
      }
    }
  `,
  'wallet.transfers': `
    query WalletTransfers($account: String!, $since: BigInt!, $first: Int!) {
      deposits(
        first: $first
        orderBy: timestamp
        orderDirection: desc
        where: { account: $account, timestamp_gte: $since }
      ) {
        id hash timestamp amount amountUSD asset { symbol decimals }
      }
      withdraws(
        first: $first
        orderBy: timestamp
        orderDirection: desc
        where: { account: $account, timestamp_gte: $since }
      ) {
        id hash timestamp amount amountUSD asset { symbol decimals }
      }
    }
  `,
  'wallet.activity': `
    query WalletActivity($account: String!, $since: BigInt!, $first: Int!) {
      deposits(
        first: $first
        orderBy: timestamp
        orderDirection: desc
        where: { account: $account, timestamp_gte: $since }
      ) {
        id hash timestamp amountUSD asset { symbol }
      }
      withdraws(
        first: $first
        orderBy: timestamp
        orderDirection: desc
        where: { account: $account, timestamp_gte: $since }
      ) {
        id hash timestamp amountUSD asset { symbol }
      }
      borrows(
        first: $first
        orderBy: timestamp
        orderDirection: desc
        where: { account: $account, timestamp_gte: $since }
      ) {
        id hash timestamp amountUSD asset { symbol }
      }
      repays(
        first: $first
        orderBy: timestamp
        orderDirection: desc
        where: { account: $account, timestamp_gte: $since }
      ) {
        id hash timestamp amountUSD asset { symbol }
      }
    }
  `,
  'protocol.positions': `
    query ProtocolPositions($account: String!, $first: Int!) {
      positions(
        first: $first
        orderBy: balance
        orderDirection: desc
        where: { account: $account }
      ) {
        id side type balance isCollateral
        asset { symbol decimals }
        market { id name inputToken { symbol } }
      }
    }
  `,
  'protocol.markets': `
    query ProtocolMarkets($first: Int!) {
      markets(first: $first, orderBy: totalValueLockedUSD, orderDirection: desc) {
        id name isActive canBorrowFrom
        totalValueLockedUSD totalBorrowBalanceUSD
        inputToken { symbol decimals }
        rates { side rate type }
      }
    }
  `,
};

/**
 * Variable names an operation declares in its header.
 *
 * Only declared variables are sent, so what reaches a subgraph is exactly what
 * the document asks for and nothing a document does not use.
 */
export function declaredVariables(document: string): string[] {
  const header = document.match(/query\s+\w+\s*\(([^)]*)\)/);
  if (!header?.[1]) return [];
  return [...header[1].matchAll(/\$([A-Za-z_]\w*)\s*:/g)].map((m) => m[1] as string);
}

/** One protocol's subgraph. `protocol` is the slug an agent may ask for. */
export interface GraphTarget {
  protocol: string;
  url: string;
}

export interface GraphProviderOptions {
  /** Every protocol subgraph the gateway can query. At least one. */
  targets: GraphTarget[];
  apiKey?: string | undefined;
  /** Injected for tests. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const GATEWAY_BASE = 'https://gateway.thegraph.com/api/subgraphs/id';

/**
 * Turns `aave-v3=ID_OR_URL,compound-v3=ID_OR_URL` into targets. A bare id is
 * composed into a gateway URL; anything starting with http is used as-is so an
 * operator can pin a Studio or self-hosted endpoint.
 */
export function parseGraphTargets(spec: string | undefined): GraphTarget[] {
  if (!spec) return [];
  return spec
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .flatMap((entry) => {
      const eq = entry.indexOf('=');
      if (eq <= 0) return [];
      const protocol = entry.slice(0, eq).trim().toLowerCase();
      const value = entry.slice(eq + 1).trim();
      if (!/^[a-z0-9-]{1,40}$/.test(protocol) || value.length === 0) return [];
      const url = /^https?:\/\//i.test(value) ? value : `${GATEWAY_BASE}/${value}`;
      return [{ protocol, url }];
    });
}

interface ProtocolOutcome {
  protocol: string;
  source: string;
  data?: unknown;
  error?: { code: string; message: string };
}

export class GraphDataProvider implements DataProvider {
  readonly name = 'the-graph' as const;
  private readonly targets: GraphTarget[];
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: GraphProviderOptions) {
    if (options.targets.length === 0) {
      throw new DataProviderError('not_configured', 'GraphDataProvider needs at least one subgraph.');
    }
    this.targets = options.targets;
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  describe(): string {
    // Never log or expose the key itself.
    const names = this.targets.map((t) => t.protocol).join(', ');
    return `The Graph gateway, ${this.targets.length} protocol(s) on the Messari standard schema (${names})${this.apiKey ? ', authenticated' : ', no key'}`;
  }

  /**
   * Runs one standardized document against one or many protocol subgraphs.
   *
   * A query that names a protocol goes to that protocol only. A query that does
   * not is fanned out to every configured protocol with the same document, and
   * the answer is keyed by protocol. That fan-out is what the shared schema
   * buys: breadth for free, with no per-protocol code.
   *
   * Per-protocol failures are reported alongside the successes rather than
   * hidden. The call as a whole fails only when nothing answered.
   */
  async fetch(query: ResourceQuery): Promise<DataResult> {
    const selected = query.protocol
      ? this.targets.filter((t) => t.protocol === query.protocol)
      : this.targets;

    if (selected.length === 0) {
      throw new DataProviderError(
        'unknown_protocol',
        `No subgraph is configured for protocol "${query.protocol}".`,
        { known: this.targets.map((t) => t.protocol) },
      );
    }

    const document = DOCUMENTS[query.resource];
    const sinceSeconds = Math.floor(Date.now() / 1000) - query.lookbackDays * 86_400;
    // Account ids are stored as lowercase hex. Normalising here means a query
    // never depends on how the agent happened to capitalise the address.
    const available: Record<string, unknown> = {
      account: query.address.toLowerCase(),
      since: String(sinceSeconds),
      first: 50,
    };
    const variables = Object.fromEntries(
      declaredVariables(document).map((name) => [name, available[name]]),
    );

    const outcomes = await Promise.all(
      selected.map((target) => this.queryOne(target, document, variables)),
    );

    const succeeded = outcomes.filter((o) => o.data !== undefined);
    if (succeeded.length === 0) {
      const first = outcomes[0]?.error;
      throw new DataProviderError(
        first?.code ?? 'gateway_error',
        first?.message ?? 'Every configured subgraph failed.',
        outcomes.map((o) => ({ protocol: o.protocol, error: o.error })),
      );
    }

    const protocols: Record<string, unknown> = {};
    const errors: Record<string, { code: string; message: string }> = {};
    for (const outcome of outcomes) {
      if (outcome.data !== undefined) protocols[outcome.protocol] = outcome.data;
      else if (outcome.error) errors[outcome.protocol] = outcome.error;
    }

    const data =
      selected.length === 1 && query.protocol
        ? // A single named protocol returns its data directly, which keeps the
          // shape stable for an agent that asked for one thing.
          (succeeded[0]?.data as unknown)
        : { schema: 'messari-standard', protocols, ...(Object.keys(errors).length ? { errors } : {}) };

    return {
      data,
      provenance: {
        provider: 'the-graph',
        source: succeeded.map((o) => `${o.protocol}:${o.source}`).join(' | '),
        queriedAt: new Date().toISOString(),
        simulated: false,
      },
    };
  }

  private async queryOne(
    target: GraphTarget,
    document: string,
    variables: Record<string, unknown>,
  ): Promise<ProtocolOutcome> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const base = { protocol: target.protocol, source: target.url };

    let response: Response;
    try {
      response = await this.fetchImpl(target.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // Bearer form keeps the API key out of the URL, which matters because
          // URLs end up in logs, proxies and error reports.
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({ query: document, variables }),
        signal: controller.signal,
      });
    } catch (cause) {
      return {
        ...base,
        error: {
          code: 'network_error',
          message: `Unreachable: ${cause instanceof Error ? cause.message : String(cause)}`,
        },
      };
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      return {
        ...base,
        error: { code: 'gateway_error', message: `HTTP ${response.status}: ${await safeText(response)}` },
      };
    }

    let body: { data?: unknown; errors?: unknown[] };
    try {
      body = (await response.json()) as { data?: unknown; errors?: unknown[] };
    } catch {
      return { ...base, error: { code: 'bad_response', message: 'Response was not JSON.' } };
    }

    if (Array.isArray(body.errors) && body.errors.length > 0) {
      return {
        ...base,
        error: {
          code: 'schema_mismatch',
          message: 'The subgraph rejected the query. Check that it publishes the Messari standard schema.',
        },
      };
    }
    if (body.data === undefined || body.data === null) {
      return { ...base, error: { code: 'empty_response', message: 'No data field in response.' } };
    }
    return { ...base, data: body.data };
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 300);
  } catch {
    return '<unreadable body>';
  }
}

// --- Simulated -----------------------------------------------------------

/**
 * Deterministic stand-in used when no Graph credentials are configured.
 *
 * Values are derived from the query itself so a demo is reproducible, and every
 * result is stamped `simulated: true`. The API and the dashboard both render
 * that stamp; nothing here is presented as a real chain fact.
 */
export class SimulatedDataProvider implements DataProvider {
  readonly name = 'simulated' as const;

  describe(): string {
    return 'Deterministic simulated data. Not sourced from any chain.';
  }

  async fetch(query: ResourceQuery): Promise<DataResult> {
    const seed = hash(`${query.resource}:${query.address}:${query.lookbackDays}`);
    const pick = <T>(items: readonly T[], salt: number): T =>
      items[(seed + salt) % items.length] as T;

    const symbols = ['USDC', 'WETH', 'DAI', 'WBTC', 'LINK'] as const;
    const events = Array.from({ length: 3 + (seed % 5) }, (_, i) => ({
      hash: `0x${((seed + i) * 2654435761).toString(16).padStart(64, '0').slice(0, 64)}`,
      timestampSeconds: Math.floor(Date.now() / 1000) - i * 3600 * 7,
      symbol: pick(symbols, i),
      amountUsd: Number((((seed % 900) + 100 + i * 37) / 3).toFixed(2)),
      kind: pick(['deposit', 'withdraw', 'borrow', 'repay'] as const, i),
    }));

    return {
      data: {
        simulated: true,
        resource: query.resource,
        address: query.address,
        lookbackDays: query.lookbackDays,
        eventCount: events.length,
        totalUsd: Number(events.reduce((sum, e) => sum + e.amountUsd, 0).toFixed(2)),
        events,
      },
      provenance: {
        provider: 'simulated',
        source: 'faregate-simulated-provider',
        queriedAt: new Date().toISOString(),
        simulated: true,
      },
    };
  }
}

function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}
