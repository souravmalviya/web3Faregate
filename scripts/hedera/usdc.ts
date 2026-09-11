/**
 * Hedera testnet setup for Faregate: check both accounts and associate them
 * with USDC.
 *
 * An HTS token can only land in an account that is associated with it, unless
 * the account has free automatic-association slots. The gateway receives fares
 * in USDC and the agent holds USDC to pay them, so both need it.
 *
 * `status` reads the public mirror node and needs no key.
 * `associate` signs a TokenAssociateTransaction with the account's own key from
 * .env. It dry-runs unless --send is given, and does nothing at all when the
 * account is already able to receive USDC.
 *
 * Usage:
 *   node scripts/hedera/usdc.ts status                        both accounts from .env
 *   node scripts/hedera/usdc.ts status --account 0.0.1234567  any account
 *   node scripts/hedera/usdc.ts associate --who agent   [--send]
 *   node scripts/hedera/usdc.ts associate --who gateway [--send]
 *
 * Environment (.env at the repository root):
 *   HEDERA_ACCOUNT_ID, HEDERA_PRIVATE_KEY           the agent, which pays
 *   FAREGATE_PAY_TO, FAREGATE_PAY_TO_PRIVATE_KEY    the gateway, which receives;
 *                                                   the gateway itself never
 *                                                   reads this key
 *
 * Keys may be the HEX or the DER encoding shown in the Hedera portal. They are
 * never printed.
 */

import {
  AccountId,
  Client,
  HEDERA_TESTNET_MIRROR_NODE_URL,
  HEDERA_TESTNET_USDC,
  HEDERA_USDC_DECIMALS,
  PrivateKey,
  TokenAssociateTransaction,
  TokenId,
} from '@x402/hedera';

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
  type MirrorAccount,
} from './common.ts';

loadEnv();

type Who = 'agent' | 'gateway';

const ROLE: Record<Who, { idVar: string; keyVar: string; describe: string }> = {
  agent: { idVar: 'HEDERA_ACCOUNT_ID', keyVar: 'HEDERA_PRIVATE_KEY', describe: 'agent (pays)' },
  gateway: { idVar: 'FAREGATE_PAY_TO', keyVar: 'FAREGATE_PAY_TO_PRIVATE_KEY', describe: 'gateway (receives)' },
};

// --- mirror node ---------------------------------------------------------

interface MirrorTokenRelationship {
  token_id: string;
  balance: number;
  decimals: number;
  automatic_association: boolean;
}

interface AccountReport {
  id: string;
  exists: boolean;
  keyType?: string;
  publicKey?: string;
  hbar?: number;
  autoSlots?: number;
  associated?: boolean;
  usdc?: number;
  canReceiveUsdc?: boolean;
}

async function inspect(id: string): Promise<AccountReport> {
  const account = await mirror<MirrorAccount>(`/api/v1/accounts/${id}`);
  if (!account || account.deleted) return { id, exists: false };

  const relationships = await mirror<{ tokens: MirrorTokenRelationship[] }>(
    `/api/v1/accounts/${id}/tokens?token.id=${HEDERA_TESTNET_USDC}`,
  );
  const usdc = relationships?.tokens.find((t) => t.token_id === HEDERA_TESTNET_USDC);
  const autoSlots = account.max_automatic_token_associations;

  return {
    id,
    exists: true,
    keyType: account.key?._type,
    publicKey: account.key?.key,
    hbar: (account.balance?.balance ?? 0) / 1e8,
    autoSlots,
    associated: Boolean(usdc),
    usdc: usdc ? usdc.balance / 10 ** HEDERA_USDC_DECIMALS : 0,
    // Only an explicit association counts. Unlimited slots (-1) accept a
    // wallet transfer, but the Circle faucet skips accounts without an explicit
    // association, and a positive slot count may already be used up.
    canReceiveUsdc: Boolean(usdc),
  };
}

function print(label: string, report: AccountReport): void {
  console.log(`\n${label}: ${report.id}`);
  if (!report.exists) {
    console.log('  not found on Hedera testnet. Check the account id.');
    return;
  }
  const slots =
    report.autoSlots === -1 ? 'unlimited' : report.autoSlots === 0 ? 'none' : String(report.autoSlots);
  console.log(`  key type            ${report.keyType ?? 'unknown'}`);
  console.log(`  HBAR                ${report.hbar?.toFixed(4)}`);
  console.log(`  auto-association    ${slots}`);
  console.log(`  USDC associated     ${report.associated ? 'yes' : 'no'}`);
  console.log(`  USDC balance        ${report.usdc?.toFixed(HEDERA_USDC_DECIMALS)}`);
  console.log(`  can receive USDC    ${report.canReceiveUsdc ? 'yes' : 'not yet, run associate'}`);
}

// --- commands ------------------------------------------------------------

async function status(): Promise<void> {
  const explicit = arg('account');
  console.log(`Hedera testnet · USDC ${HEDERA_TESTNET_USDC} · ${HEDERA_TESTNET_MIRROR_NODE_URL}`);

  if (explicit) {
    if (!ACCOUNT_RE.test(explicit)) fail(`--account must look like 0.0.1234567, got ${explicit}`);
    print('account', await inspect(explicit));
    return;
  }

  let any = false;
  for (const who of ['gateway', 'agent'] as const) {
    const { idVar, describe } = ROLE[who];
    const id = env(idVar);
    if (!id) {
      console.log(`\n${describe}: ${idVar} is not set in .env`);
      continue;
    }
    if (!ACCOUNT_RE.test(id)) {
      console.log(`\n${describe}: ${idVar} must look like 0.0.1234567`);
      continue;
    }
    any = true;
    const report = await inspect(id);
    print(describe, report);
    if (who === 'agent' && report.exists && report.canReceiveUsdc && (report.usdc ?? 0) === 0) {
      console.log('  next                fund this account with testnet USDC so it can pay fares');
    }
  }
  if (!any) console.log('\nNothing to check yet. Add the account ids to .env first.');
}

async function associate(): Promise<void> {
  const who = arg('who');
  if (who !== 'agent' && who !== 'gateway') fail('--who must be agent or gateway');
  const { idVar, keyVar, describe } = ROLE[who];

  const id = env(idVar);
  if (!id || !ACCOUNT_RE.test(id)) fail(`${idVar} must be set in .env and look like 0.0.1234567`);

  const report = await inspect(id);
  print(describe, report);
  if (!report.exists) process.exit(1);

  if (report.associated) {
    console.log('\nAlready associated with USDC. Nothing to do.');
    return;
  }
  if (report.autoSlots === -1) {
    // Unlimited slots accept a transfer from a wallet, but Circle's testnet
    // faucet only delivers to accounts with an explicit USDC association: on
    // 2026-09-11 every account it had paid was associated manually beforehand,
    // and requests for an auto-association-only account were never delivered.
    console.log('\nUnlimited automatic associations, but the Circle faucet needs an explicit association. Associating.');
  }

  const rawKey = env(keyVar);
  if (!rawKey) fail(`\n${keyVar} is not set in .env. It is needed once, to sign the association.`);

  let key: PrivateKey;
  try {
    key = parseHederaKey(rawKey);
  } catch (error) {
    fail(`\n${keyVar} could not be read: ${errorMessage(error)}`);
  }

  // Refuse early with a clear message rather than failing onchain with
  // INVALID_SIGNATURE. --force skips this if the encodings ever disagree.
  const matches = keyMatches(key, report.publicKey);
  console.log(`\n  ${keyVar} matches account key: ${matches ? 'yes' : 'NO'}`);
  if (!matches && !flag('force')) {
    fail(`  The key in ${keyVar} does not belong to ${id}. Fix .env, or pass --force if you are sure.`);
  }

  if (!flag('send')) {
    console.log(`\nDry run. Would submit TokenAssociateTransaction(${id}, [${HEDERA_TESTNET_USDC}]) signed by ${keyVar}.`);
    console.log('Nothing was sent. Add --send to broadcast. The fee is paid in testnet HBAR.');
    return;
  }

  const accountId = AccountId.fromString(id);
  const client = Client.forTestnet().setOperator(accountId, key);
  try {
    const transaction = await new TokenAssociateTransaction()
      .setAccountId(accountId)
      .setTokenIds([TokenId.fromString(HEDERA_TESTNET_USDC)])
      .freezeWith(client)
      .sign(key);
    const response = await transaction.execute(client);
    const receipt = await response.getReceipt(client);
    const txId = response.transactionId.toString();
    console.log(`\n  status  ${receipt.status.toString()}`);
    console.log(`  tx      ${txId}`);
    console.log(`  view    https://hashscan.io/testnet/account/${id}`);
  } finally {
    client.close();
  }
}

const command = process.argv[2];
const run = command === 'status' ? status : command === 'associate' ? associate : null;
if (!run) fail('usage: usdc.ts <status|associate> [--account 0.0.x] [--who agent|gateway] [--send]');
run().catch((error: unknown) => {
  console.error(errorMessage(error));
  process.exit(1);
});
