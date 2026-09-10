/**
 * Create the gateway's Hedera testnet account from the agent's.
 *
 * Faregate needs two accounts: the agent that pays and the gateway that
 * receives. The Hedera portal gives you one. This script uses that one (the
 * agent account in .env) to create the second, with a fresh ECDSA key, a small
 * HBAR balance, and unlimited automatic token associations, so the gateway can
 * receive USDC without a separate association step.
 *
 * The new key is generated on this machine and written straight into .env. It
 * is never printed. It is saved before the transaction is sent, so an
 * interrupted run can be retried with the same key instead of leaving a funded
 * account nobody holds the key to.
 *
 * Usage:
 *   node scripts/hedera/create-gateway.ts              dry run, sends nothing
 *   node scripts/hedera/create-gateway.ts --send       create the account
 *   node scripts/hedera/create-gateway.ts --hbar 5     initial balance, 1 to 100 (default 5)
 *
 * Reads:  HEDERA_ACCOUNT_ID, HEDERA_PRIVATE_KEY   the agent; pays the fee and the balance
 * Writes: FAREGATE_PAY_TO_PRIVATE_KEY, FAREGATE_PAY_TO
 */

import { AccountCreateTransaction, AccountId, Client, Hbar, PrivateKey } from '@hiero-ledger/sdk';

import {
  ACCOUNT_RE,
  arg,
  env,
  errorMessage,
  fail,
  flag,
  keyMatches,
  loadEnv,
  mirror,
  parseHederaKey,
  setEnvValues,
  type MirrorAccount,
} from './common.ts';

loadEnv();

const DEFAULT_HBAR = 5;

async function main(): Promise<void> {
  const send = flag('send');
  const force = flag('force');
  const hbarArg = arg('hbar');
  const hbar = hbarArg === undefined ? DEFAULT_HBAR : Number(hbarArg);
  if (!Number.isFinite(hbar) || hbar < 1 || hbar > 100) fail('--hbar must be a number from 1 to 100');

  console.log('Create the Faregate gateway account on Hedera testnet');

  const existing = env('FAREGATE_PAY_TO');
  if (existing && !force) {
    console.log(`\nFAREGATE_PAY_TO is already set to ${existing}. Nothing to do.`);
    console.log('Check it with: npm run hedera:usdc -- status');
    return;
  }

  const payerId = env('HEDERA_ACCOUNT_ID');
  const payerRaw = env('HEDERA_PRIVATE_KEY');
  if (!payerId || !ACCOUNT_RE.test(payerId)) {
    fail('\nHEDERA_ACCOUNT_ID must be set in .env and look like 0.0.1234567. Use the account the Hedera portal gave you.');
  }
  if (!payerRaw) fail('\nHEDERA_PRIVATE_KEY must be set in .env. That account pays for creating the gateway account.');

  let payerKey: PrivateKey;
  try {
    payerKey = parseHederaKey(payerRaw);
  } catch (error) {
    fail(`\nHEDERA_PRIVATE_KEY could not be read: ${errorMessage(error)}`);
  }

  const payer = await mirror<MirrorAccount>(`/api/v1/accounts/${payerId}`);
  if (!payer || payer.deleted) fail(`\n${payerId} was not found on Hedera testnet. Check HEDERA_ACCOUNT_ID.`, 1);

  const balance = (payer.balance?.balance ?? 0) / 1e8;
  const matches = keyMatches(payerKey, payer.key?.key);

  console.log(`\npaying account       ${payerId}`);
  console.log(`  key type           ${payer.key?._type ?? 'unknown'}`);
  console.log(`  key in .env        ${matches ? 'matches' : 'DOES NOT MATCH'}`);
  console.log(`  HBAR               ${balance.toFixed(4)}`);

  if (!matches && !force) {
    fail(`\nHEDERA_PRIVATE_KEY does not belong to ${payerId}. Fix .env, or pass --force if you are sure.`);
  }
  if (balance < hbar + 1) {
    fail(`\n${payerId} has ${balance.toFixed(4)} HBAR and needs at least ${hbar + 1}: ${hbar} for the gateway plus fees.`, 1);
  }

  console.log('\nplan');
  console.log('  AccountCreateTransaction');
  console.log('    key                        new ECDSA key, generated on this machine');
  console.log(`    initial balance            ${hbar} HBAR from ${payerId}`);
  console.log('    automatic associations     unlimited, so USDC needs no association step');
  console.log('    memo                       Faregate gateway');
  console.log('  then save FAREGATE_PAY_TO and FAREGATE_PAY_TO_PRIVATE_KEY to .env (the key is never printed)');

  if (!send) {
    console.log('\nDry run. Nothing was sent and no key was generated. Add --send to create the account.');
    return;
  }

  // Reuse a key left by an interrupted earlier run, so a funded account is
  // never created without its key already on disk.
  let gatewayKey: PrivateKey;
  const pending = env('FAREGATE_PAY_TO_PRIVATE_KEY');
  if (pending) {
    try {
      gatewayKey = parseHederaKey(pending);
    } catch (error) {
      fail(`\nFAREGATE_PAY_TO_PRIVATE_KEY is set but could not be read: ${errorMessage(error)}`);
    }
    console.log('\nUsing the gateway key already saved in .env.');
  } else {
    gatewayKey = PrivateKey.generateECDSA();
    setEnvValues({ FAREGATE_PAY_TO_PRIVATE_KEY: gatewayKey.toStringRaw() });
    console.log('\nGenerated a new ECDSA key and saved it to .env.');
  }

  const client = Client.forTestnet().setOperator(AccountId.fromString(payerId), payerKey);
  let newId: string;
  try {
    const response = await new AccountCreateTransaction()
      .setKeyWithoutAlias(gatewayKey.publicKey)
      .setInitialBalance(new Hbar(hbar))
      .setMaxAutomaticTokenAssociations(-1)
      .setAccountMemo('Faregate gateway')
      .execute(client);
    const receipt = await response.getReceipt(client);
    const created = receipt.accountId?.toString();
    if (!created) {
      fail(`\nTransaction ${response.transactionId.toString()} returned no account id. The key is still in .env; re-run to retry.`, 1);
    }
    newId = created;
    setEnvValues({ FAREGATE_PAY_TO: newId });
    console.log(`\n  status             ${receipt.status.toString()}`);
    console.log(`  gateway account    ${newId}  (saved to .env as FAREGATE_PAY_TO)`);
    console.log(`  transaction        ${response.transactionId.toString()}`);
    console.log(`  view               https://hashscan.io/testnet/account/${newId}`);
  } finally {
    client.close();
  }

  // The mirror node trails consensus by a few seconds.
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const account = await mirror<MirrorAccount>(`/api/v1/accounts/${newId}`);
    if (account) {
      const slots = account.max_automatic_token_associations;
      console.log(`  mirror node        HBAR ${((account.balance?.balance ?? 0) / 1e8).toFixed(4)}, automatic associations ${slots === -1 ? 'unlimited' : slots}`);
      console.log('\nNext: npm run hedera:usdc -- status');
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  console.log('  mirror node        not visible yet; check again in a minute with npm run hedera:usdc -- status');
}

main().catch((error: unknown) => {
  console.error(errorMessage(error));
  process.exit(1);
});
