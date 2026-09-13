import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BLOCKY402_MAINNET,
  BLOCKY402_TESTNET,
  corsAllowList,
  defaultFacilitator,
  parseCorsOrigins,
} from './config.ts';

test('the default facilitator is the Blocky402 host for the configured network', () => {
  // Blocky402 serves each network from its own host, and each host's
  // /supported lists only that network, so pairing them wrongly leaves the
  // gateway unable to settle anything.
  assert.equal(defaultFacilitator('hedera:testnet'), BLOCKY402_TESTNET);
  assert.equal(defaultFacilitator('hedera:mainnet'), BLOCKY402_MAINNET);
  assert.equal(BLOCKY402_TESTNET, 'https://api.testnet.blocky402.com');
  assert.equal(BLOCKY402_MAINNET, 'https://api.blocky402.com');
});

test('an unknown network falls back to the testnet facilitator, never mainnet', () => {
  assert.equal(defaultFacilitator('hedera:previewnet'), BLOCKY402_TESTNET);
});

test('CORS origins are normalised, so a pasted trailing slash or capital letter still matches', () => {
  const { origins, ignored } = parseCorsOrigins(' https://Web3-Faregate.vercel.app/ , http://localhost:3000 ');
  assert.deepEqual(origins, ['https://web3-faregate.vercel.app', 'http://localhost:3000']);
  assert.deepEqual(ignored, []);
});

test('an unset CORS setting allows only the local dashboard', () => {
  assert.deepEqual(parseCorsOrigins(undefined).origins, ['http://localhost:3000']);
});

test('CORS entries that are not origins, or wildcards covering a whole shared domain, are reported instead of used', () => {
  const { origins, ignored } = parseCorsOrigins(
    'https://faregate.vercel.app/dashboard,faregate.vercel.app,https://*.vercel.app,https://faregate-*.vercel.app',
  );
  assert.deepEqual(origins, ['https://faregate-*.vercel.app']);
  assert.deepEqual(
    ignored.map((item) => item.entry),
    ['https://faregate.vercel.app/dashboard', 'faregate.vercel.app', 'https://*.vercel.app'],
  );
  assert.match(ignored[2]?.reason ?? '', /every site on that domain/);
});

test('a CORS wildcard matches one part of a host name and never crosses a dot', () => {
  const [exact, pattern] = corsAllowList(['http://localhost:3000', 'https://web3-faregate-*-team.vercel.app']);
  assert.equal(exact, 'http://localhost:3000');
  assert.ok(pattern instanceof RegExp);
  assert.ok(pattern.test('https://web3-faregate-mctorm9a9-team.vercel.app'));
  assert.ok(!pattern.test('https://web3-faregate-x.attacker-team.vercel.app'));
  assert.ok(!pattern.test('http://web3-faregate-mctorm9a9-team.vercel.app'));
  assert.ok(!pattern.test('https://web3-faregate-mctorm9a9-team.vercel.app.attacker.com'));
});
