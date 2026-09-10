import test from 'node:test';
import assert from 'node:assert/strict';

import { BLOCKY402_MAINNET, BLOCKY402_TESTNET, defaultFacilitator } from './config.ts';

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
