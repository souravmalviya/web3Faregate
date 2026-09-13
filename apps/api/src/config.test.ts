import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BLOCKY402_MAINNET,
  BLOCKY402_TESTNET,
  corsAllowList,
  defaultFacilitator,
  keepAwakeTarget,
  parseCorsOrigins,
  parseRpcUrls,
  resolveDemoAgent,
} from './config.ts';

test('the demo agent runs only when asked, pays only on Hedera testnet, and needs its key to pay', () => {
  const base = {
    requested: true,
    paymentMode: 'live' as const,
    network: 'hedera:testnet',
    accountId: '0.0.10455772',
    hasKey: true,
    passports: undefined,
    parentName: 'agents.faregate.eth',
  };
  assert.equal(resolveDemoAgent(base).enabled, true);
  assert.deepEqual(resolveDemoAgent(base).passports, ['research.agents.faregate.eth', 'trial.agents.faregate.eth']);
  assert.equal(resolveDemoAgent({ ...base, requested: false }).enabled, false);

  const mainnet = resolveDemoAgent({ ...base, network: 'hedera:mainnet' });
  assert.equal(mainnet.enabled, false);
  assert.match(mainnet.reason ?? '', /only pays on hedera:testnet/);

  const keyless = resolveDemoAgent({ ...base, hasKey: false });
  assert.equal(keyless.enabled, false);
  assert.match(keyless.reason ?? '', /HEDERA_PRIVATE_KEY/);

  // With simulated payments nothing is charged, so no key is needed.
  assert.equal(resolveDemoAgent({ ...base, paymentMode: 'simulated', hasKey: false, accountId: undefined }).enabled, true);
  assert.deepEqual(resolveDemoAgent({ ...base, passports: ' Trial.agents.faregate.eth , ' }).passports, [
    'trial.agents.faregate.eth',
  ]);
});

test('a hosted gateway visits its own public health check to stay awake, unless told otherwise', () => {
  const render = 'https://faregate-gateway.onrender.com';
  assert.equal(keepAwakeTarget(undefined, render), `${render}/health`);
  assert.equal(keepAwakeTarget(undefined, `${render}/`), `${render}/health`);
  assert.equal(keepAwakeTarget('https://ping.example/health', render), 'https://ping.example/health');
  assert.equal(keepAwakeTarget('off', render), null);
  assert.equal(keepAwakeTarget(undefined, undefined), null);
});

test('ENS RPCs may be listed as fallbacks, kept in order, blanks ignored', () => {
  assert.deepEqual(parseRpcUrls(' https://a.example , ,https://b.example '), ['https://a.example', 'https://b.example']);
  assert.deepEqual(parseRpcUrls(undefined), []);
});

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
