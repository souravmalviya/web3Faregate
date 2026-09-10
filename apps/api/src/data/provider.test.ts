import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DOCUMENTS,
  DataProviderError,
  GraphDataProvider,
  SimulatedDataProvider,
  declaredVariables,
  parseGraphTargets,
} from './provider.ts';
import type { ResourceQuery } from '@faregate/shared';

const ADDRESS = '0x742d35cc6634c0532925a3b844bc454e4438f44e' as const;

function query(partial: Partial<ResourceQuery> = {}): ResourceQuery {
  return { resource: 'protocol.markets', address: ADDRESS, lookbackDays: 30, ...partial };
}

/** A fake Graph gateway keyed by URL. */
function fakeFetch(routes: Record<string, () => Response | Promise<Response>>): typeof fetch {
  const calls: string[] = [];
  const impl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    const handler = routes[url];
    if (!handler) throw new Error(`no route for ${url}`);
    // Every call must carry the Bearer header and a GraphQL body.
    const headers = init?.headers as Record<string, string>;
    assert.equal(headers['content-type'], 'application/json');
    const body = JSON.parse(String(init?.body));
    assert.ok(typeof body.query === 'string' && body.query.length > 10);
    return handler();
  }) as typeof fetch;
  (impl as unknown as { calls: string[] }).calls = calls;
  return impl;
}

const ok = (data: unknown) => () =>
  new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } });

// --- target parsing ------------------------------------------------------

test('parseGraphTargets composes ids into gateway URLs and keeps full URLs', () => {
  const targets = parseGraphTargets('aave-v3=ABC123, compound-v3=https://example.test/sub, bad entry, =x');
  assert.deepEqual(targets, [
    { protocol: 'aave-v3', url: 'https://gateway.thegraph.com/api/subgraphs/id/ABC123' },
    { protocol: 'compound-v3', url: 'https://example.test/sub' },
  ]);
});

test('parseGraphTargets rejects protocol slugs that are not safe identifiers', () => {
  assert.deepEqual(parseGraphTargets('../etc=ID'), []);
  assert.deepEqual(parseGraphTargets(undefined), []);
});

test('the provider refuses to construct with no targets', () => {
  assert.throws(() => new GraphDataProvider({ targets: [] }), (e: unknown) => e instanceof DataProviderError);
});

// --- fan-out -------------------------------------------------------------

test('one document fans out across every protocol and is keyed by protocol', async () => {
  const fetchImpl = fakeFetch({
    'https://a.test': ok({ markets: [{ id: 'a1' }] }),
    'https://c.test': ok({ markets: [{ id: 'c1' }, { id: 'c2' }] }),
  });
  const provider = new GraphDataProvider({
    targets: [
      { protocol: 'aave-v3', url: 'https://a.test' },
      { protocol: 'compound-v3', url: 'https://c.test' },
    ],
    apiKey: 'k',
    fetchImpl,
  });

  const result = await provider.fetch(query());
  const data = result.data as { schema: string; protocols: Record<string, { markets: unknown[] }> };
  assert.equal(data.schema, 'messari-standard');
  assert.equal(data.protocols['aave-v3']?.markets.length, 1);
  assert.equal(data.protocols['compound-v3']?.markets.length, 2);
  assert.equal(result.provenance.simulated, false);
  assert.match(result.provenance.source, /aave-v3:https:\/\/a\.test/);
  assert.match(result.provenance.source, /compound-v3:https:\/\/c\.test/);
});

test('a named protocol queries only that subgraph and returns its data directly', async () => {
  const fetchImpl = fakeFetch({
    'https://a.test': ok({ positions: [{ id: 'p1' }] }),
    'https://c.test': () => {
      throw new Error('must not be called');
    },
  });
  const provider = new GraphDataProvider({
    targets: [
      { protocol: 'aave-v3', url: 'https://a.test' },
      { protocol: 'compound-v3', url: 'https://c.test' },
    ],
    fetchImpl,
  });
  const result = await provider.fetch(query({ resource: 'protocol.positions', protocol: 'aave-v3' }));
  assert.deepEqual(result.data, { positions: [{ id: 'p1' }] });
  assert.deepEqual((fetchImpl as unknown as { calls: string[] }).calls, ['https://a.test']);
});

test('an unknown protocol is refused before any network call', async () => {
  const fetchImpl = fakeFetch({});
  const provider = new GraphDataProvider({ targets: [{ protocol: 'aave-v3', url: 'https://a.test' }], fetchImpl });
  await assert.rejects(
    provider.fetch(query({ protocol: 'made-up' })),
    (e: unknown) => e instanceof DataProviderError && e.code === 'unknown_protocol',
  );
  assert.deepEqual((fetchImpl as unknown as { calls: string[] }).calls, []);
});

// --- failure semantics ---------------------------------------------------

test('a partial failure is reported per protocol, not hidden', async () => {
  const fetchImpl = fakeFetch({
    'https://a.test': ok({ markets: [] }),
    'https://c.test': () =>
      new Response(JSON.stringify({ errors: [{ message: 'Unknown field' }] }), { status: 200 }),
  });
  const provider = new GraphDataProvider({
    targets: [
      { protocol: 'aave-v3', url: 'https://a.test' },
      { protocol: 'compound-v3', url: 'https://c.test' },
    ],
    fetchImpl,
  });
  const result = await provider.fetch(query());
  const data = result.data as { protocols: Record<string, unknown>; errors: Record<string, { code: string }> };
  assert.ok('aave-v3' in data.protocols);
  assert.equal(data.errors['compound-v3']?.code, 'schema_mismatch');
  // Provenance names only the protocols that actually answered.
  assert.doesNotMatch(result.provenance.source, /compound-v3/);
});

test('when every protocol fails the call fails loudly and never falls back to simulated data', async () => {
  const fetchImpl = fakeFetch({
    'https://a.test': () => new Response('upstream down', { status: 503 }),
  });
  const provider = new GraphDataProvider({ targets: [{ protocol: 'aave-v3', url: 'https://a.test' }], fetchImpl });
  await assert.rejects(
    provider.fetch(query()),
    (e: unknown) => e instanceof DataProviderError && e.code === 'gateway_error',
  );
});

test('the API key travels as a Bearer header, never in the URL', async () => {
  let seenAuth = '';
  const fetchImpl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    seenAuth = (init?.headers as Record<string, string>).authorization ?? '';
    assert.doesNotMatch(String(input), /secret-key/);
    return ok({ markets: [] })();
  }) as typeof fetch;
  const provider = new GraphDataProvider({
    targets: [{ protocol: 'aave-v3', url: 'https://a.test' }],
    apiKey: 'secret-key',
    fetchImpl,
  });
  await provider.fetch(query());
  assert.equal(seenAuth, 'Bearer secret-key');
  assert.doesNotMatch(provider.describe(), /secret-key/);
});

// --- simulated -----------------------------------------------------------

test('simulated data is deterministic for the same query and stamped as simulated', async () => {
  const provider = new SimulatedDataProvider();
  const a = await provider.fetch(query({ resource: 'wallet.activity' }));
  const b = await provider.fetch(query({ resource: 'wallet.activity' }));
  assert.deepEqual((a.data as { events: unknown[] }).events, (b.data as { events: unknown[] }).events);
  assert.equal(a.provenance.simulated, true);
  assert.equal((a.data as { simulated: boolean }).simulated, true);
});

// --- schema conformance --------------------------------------------------

/**
 * Messari standardized lending schema 3.1.0, the version every subgraph in
 * GRAPH_SUBGRAPHS reports in Messari's deployment registry. Field lists are
 * copied from schema-lending.graphql in github.com/messari/subgraphs.
 * `relations` names the entity a nested selection resolves to.
 */
const EVENT_FIELDS = [
  'id', 'hash', 'nonce', 'logIndex', 'gasPrice', 'gasUsed', 'gasLimit', 'blockNumber',
  'timestamp', 'account', 'accountActor', 'market', 'position', 'asset', 'amount', 'amountUSD',
];
const EVENT_RELATIONS = {
  account: 'Account', accountActor: 'Account', market: 'Market', position: 'Position', asset: 'Token',
};

const MESSARI_LENDING_3_1_0: Record<string, { fields: string[]; relations: Record<string, string> }> = {
  Query: {
    fields: ['account', 'positions', 'deposits', 'withdraws', 'borrows', 'repays', 'markets'],
    relations: {
      account: 'Account', positions: 'Position', deposits: 'Deposit', withdraws: 'Withdraw',
      borrows: 'Borrow', repays: 'Repay', markets: 'Market',
    },
  },
  Account: {
    fields: [
      'id', 'positionCount', 'positions', 'openPositionCount', 'closedPositionCount', 'depositCount',
      'deposits', 'withdrawCount', 'withdraws', 'borrowCount', 'borrows', 'repayCount', 'repays',
      'liquidateCount', 'liquidates', 'liquidationCount', 'liquidations', 'transferredCount',
      'transfers', 'receivedCount', 'receives', 'flashloanCount', 'flashloans', 'rewardsClaimedUSD',
    ],
    relations: {
      positions: 'Position', deposits: 'Deposit', withdraws: 'Withdraw', borrows: 'Borrow', repays: 'Repay',
    },
  },
  Position: {
    fields: [
      'id', 'account', 'market', 'asset', 'hashOpened', 'hashClosed', 'blockNumberOpened',
      'timestampOpened', 'blockNumberClosed', 'timestampClosed', 'side', 'type', 'isCollateral',
      'isIsolated', 'balance', 'principal', 'depositCount', 'deposits', 'withdrawCount', 'withdraws',
      'borrowCount', 'borrows', 'repayCount', 'repays', 'liquidationCount', 'liquidations',
      'transferredCount', 'receivedCount', 'transfers', 'snapshots',
    ],
    relations: { account: 'Account', market: 'Market', asset: 'Token' },
  },
  Deposit: { fields: EVENT_FIELDS, relations: EVENT_RELATIONS },
  Withdraw: { fields: EVENT_FIELDS, relations: EVENT_RELATIONS },
  Borrow: { fields: EVENT_FIELDS, relations: EVENT_RELATIONS },
  Repay: { fields: EVENT_FIELDS, relations: EVENT_RELATIONS },
  Market: {
    fields: [
      'id', 'protocol', 'name', 'isActive', 'canBorrowFrom', 'canUseAsCollateral', 'maximumLTV',
      'liquidationThreshold', 'liquidationPenalty', 'canIsolate', 'createdTimestamp',
      'createdBlockNumber', 'oracle', 'relation', 'rewardTokens', 'rewardTokenEmissionsAmount',
      'rewardTokenEmissionsUSD', 'stakedOutputTokenAmount', 'inputToken', 'inputTokenBalance',
      'inputTokenPriceUSD', 'outputToken', 'outputTokenSupply', 'outputTokenPriceUSD', 'exchangeRate',
      'rates', 'reserves', 'reserveFactor', 'borrowedToken', 'variableBorrowedTokenBalance',
      'stableBorrowedTokenBalance', 'indexLastUpdatedTimestamp', 'supplyIndex', 'supplyCap',
      'borrowIndex', 'borrowCap', 'totalValueLockedUSD', 'cumulativeSupplySideRevenueUSD',
      'cumulativeProtocolSideRevenueUSD', 'cumulativeTotalRevenueUSD', 'revenueDetail',
      'totalDepositBalanceUSD', 'cumulativeDepositUSD', 'totalBorrowBalanceUSD', 'cumulativeBorrowUSD',
      'cumulativeLiquidateUSD', 'cumulativeTransferUSD', 'cumulativeFlashloanUSD', 'transactionCount',
      'depositCount', 'withdrawCount', 'borrowCount', 'repayCount', 'liquidationCount', 'transferCount',
      'flashloanCount', 'cumulativeUniqueUsers', 'cumulativeUniqueDepositors',
      'cumulativeUniqueBorrowers', 'cumulativeUniqueLiquidators', 'cumulativeUniqueLiquidatees',
      'cumulativeUniqueTransferrers', 'cumulativeUniqueFlashloaners', 'positions', 'positionCount',
      'openPositionCount', 'closedPositionCount', 'lendingPositionCount', 'borrowingPositionCount',
    ],
    relations: { inputToken: 'Token', outputToken: 'Token', borrowedToken: 'Token', rates: 'InterestRate' },
  },
  InterestRate: { fields: ['id', 'rate', 'duration', 'maturityBlock', 'side', 'type', 'tranche'], relations: {} },
  Token: { fields: ['id', 'name', 'symbol', 'decimals', 'lastPriceUSD', 'lastPriceBlockNumber', 'type'], relations: {} },
};

/** Walks a document's selection sets and returns every field the schema does not define. */
function unknownFields(document: string): string[] {
  let body = document.replace(/query\s+\w+\s*\([^)]*\)/, '');
  let previous: string;
  do {
    previous = body;
    body = body.replace(/\([^()]*\)/g, '');
  } while (body !== previous);

  const tokens = body.match(/[A-Za-z_]\w*|[{}]/g) ?? [];
  const stack: string[] = [];
  const problems: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i] as string;
    if (token === '{') {
      // Only the operation's own selection set opens without a field before it.
      stack.push('Query');
      continue;
    }
    if (token === '}') {
      stack.pop();
      continue;
    }
    const type = stack[stack.length - 1] ?? 'Query';
    const entity = MESSARI_LENDING_3_1_0[type];
    const opensSelection = tokens[i + 1] === '{';
    if (entity && !entity.fields.includes(token)) problems.push(`${type}.${token}`);
    else if (entity && opensSelection && !entity.relations[token]) problems.push(`${type}.${token} is not a relation`);
    if (opensSelection) {
      stack.push(entity?.relations[token] ?? 'Unknown');
      i += 1;
    }
  }
  return problems;
}

test('every field the query documents select exists in Messari lending schema 3.1.0', () => {
  for (const [resource, document] of Object.entries(DOCUMENTS)) {
    assert.deepEqual(unknownFields(document), [], `${resource} selects fields the schema does not define`);
  }
});

test('the conformance check catches an invented field', () => {
  const bad = 'query Bad($first: Int!) { positions(first: $first) { id balanceUSD market { id madeUp } } }';
  assert.deepEqual(unknownFields(bad), ['Position.balanceUSD', 'Market.madeUp']);
});

test('only declared variables are sent and the account is normalised to lowercase', async () => {
  const seen: Array<Record<string, unknown>> = [];
  const fetchImpl = (async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    seen.push(JSON.parse(String(init?.body)).variables);
    return ok({})();
  }) as typeof fetch;
  const provider = new GraphDataProvider({ targets: [{ protocol: 'aave-v3', url: 'https://a.test' }], fetchImpl });

  await provider.fetch(query({ resource: 'protocol.markets' }));
  await provider.fetch(
    query({
      resource: 'wallet.activity',
      address: '0x742D35CC6634C0532925A3B844BC454E4438F44E' as ResourceQuery['address'],
    }),
  );

  assert.deepEqual(seen[0], { first: 50 });
  assert.deepEqual(Object.keys(seen[1] ?? {}).sort(), ['account', 'first', 'since']);
  assert.equal(seen[1]?.account, '0x742d35cc6634c0532925a3b844bc454e4438f44e');
});

test('declaredVariables reads names from the operation header only', () => {
  assert.deepEqual(declaredVariables('query X($a: String!, $b: Int!) { t(where: { a: $a }) { id } }'), ['a', 'b']);
  assert.deepEqual(declaredVariables('{ markets { id } }'), []);
});
