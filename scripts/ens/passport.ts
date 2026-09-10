/**
 * Mint or update an agent passport on ENSv2 Sepolia.
 *
 * A passport is a subname under the Faregate parent (for example
 * `research.agents.faregate.eth`) whose Permissioned Resolver carries the
 * `faregate.*` text records the gateway reads. This script writes those
 * records with the human owner's own wallet. The gateway never runs it and
 * never holds the key.
 *
 * Interfaces used, with the pages they come from:
 *
 *   PermissionedResolver.setText(bytes32 node, string key, string value)
 *     requires ROLE_SET_TEXT on the node
 *     https://docs.ens.domains/ensv2/permissioned-resolver
 *
 *   UserRegistry.register(string label, address owner, address registry,
 *                         address resolver, uint256 roleBitmap, uint64 expiry)
 *     https://docs.ens.domains/ensv2/permissioned-registry
 *
 *   node = namehash(fullName)
 *
 * ENSv2 is beta on Sepolia and the ENS docs say the interfaces may change, so
 * the default mode is a dry run that prints the exact calls it would make.
 * Pass --send to broadcast.
 *
 * Usage:
 *   node scripts/ens/passport.ts records \
 *     --name research.agents.faregate.eth \
 *     --resolver 0x... \
 *     --status active --label "Treasury Research Agent" \
 *     --scope wallet.balances,wallet.transfers,wallet.activity \
 *     --per-query 0.10 --daily 1.00 --approval-above 0.02 \
 *     [--expires 2026-12-31T00:00:00Z] [--send]
 *
 *   node scripts/ens/passport.ts revoke --name research.agents.faregate.eth --resolver 0x... [--send]
 *
 *   node scripts/ens/passport.ts register \
 *     --registry 0x... --label research --owner 0x... --resolver 0x... \
 *     [--expiry-days 365] [--send]
 *
 * Environment:
 *   ENS_RPC_URL           Sepolia RPC
 *   ENS_OWNER_PRIVATE_KEY the passport owner's key, Sepolia only, never mainnet
 */

import 'dotenv/config';

import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  namehash,
  parseAbi,
  type Address,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { normalize } from 'viem/ens';

const RESOLVER_ABI = parseAbi([
  'function setText(bytes32 node, string key, string value)',
  'function text(bytes32 node, string key) view returns (string)',
]);

const REGISTRY_ABI = parseAbi([
  'function register(string label, address owner, address registry, address resolver, uint256 roleBitmap, uint64 expiry) returns (uint256)',
]);

/** From the ENSv2 Enhanced Access Control docs. */
const ROLE_SET_RESOLVER = 1n << 24n;
const ROLE_RENEW = 1n << 16n;

const TEXT_KEYS = {
  status: 'faregate.status',
  label: 'faregate.label',
  scope: 'faregate.scope',
  maxPerQuery: 'faregate.max_per_query_usd',
  dailyLimit: 'faregate.daily_limit_usd',
  approvalAbove: 'faregate.approval_above_usd',
  expiresAt: 'faregate.expires_at',
} as const;

// --- args ----------------------------------------------------------------

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}
function need(name: string): string {
  const v = arg(name);
  if (!v) {
    console.error(`missing --${name}`);
    process.exit(2);
  }
  return v;
}
function asAddress(v: string, what: string): Address {
  if (!/^0x[a-fA-F0-9]{40}$/.test(v)) {
    console.error(`${what} is not an address: ${v}`);
    process.exit(2);
  }
  return v as Address;
}

// --- clients -------------------------------------------------------------

function clients() {
  const rpcUrl = process.env.ENS_RPC_URL;
  if (!rpcUrl) {
    console.error('ENS_RPC_URL is not set');
    process.exit(2);
  }
  const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });

  const send = flag('send');
  if (!send) return { publicClient, walletClient: null, account: null, send };

  // MetaMask exports keys without 0x, so either form is accepted.
  const key = process.env.ENS_OWNER_PRIVATE_KEY?.trim().replace(/^0x/i, '');
  if (!key || !/^[a-fA-F0-9]{64}$/.test(key)) {
    console.error('ENS_OWNER_PRIVATE_KEY must be a 32-byte hex key (64 characters, 0x optional) when using --send');
    process.exit(2);
  }
  const account = privateKeyToAccount(`0x${key}`);
  const walletClient = createWalletClient({ account, chain: sepolia, transport: http(rpcUrl) });
  return { publicClient, walletClient, account, send };
}

interface Call {
  to: Address;
  abi: typeof RESOLVER_ABI | typeof REGISTRY_ABI;
  functionName: 'setText' | 'register';
  args: readonly unknown[];
  describe: string;
}

async function execute(calls: Call[]): Promise<void> {
  const { publicClient, walletClient, account, send } = clients();

  console.log(`${send ? 'Sending' : 'Dry run of'} ${calls.length} call(s) on ${sepolia.name}`);
  for (const call of calls) {
    const data = encodeFunctionData({ abi: call.abi as any, functionName: call.functionName, args: call.args as any });
    console.log(`\n  ${call.describe}`);
    console.log(`  to:   ${call.to}`);
    console.log(`  data: ${data.slice(0, 74)}…`);

    if (!send || !walletClient || !account) continue;

    const hash = await walletClient.writeContract({
      address: call.to,
      abi: call.abi as any,
      functionName: call.functionName,
      args: call.args as any,
    });
    console.log(`  tx:   https://sepolia.etherscan.io/tx/${hash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log(`  ${receipt.status === 'success' ? 'confirmed' : 'REVERTED'} in block ${receipt.blockNumber}`);
    if (receipt.status !== 'success') process.exit(1);
  }

  if (!send) console.log('\nNothing was sent. Add --send to broadcast with ENS_OWNER_PRIVATE_KEY.');
}

// --- commands ------------------------------------------------------------

async function records(): Promise<void> {
  const name = normalize(need('name'));
  const resolver = asAddress(need('resolver'), '--resolver');
  const node = namehash(name);

  const values: Array<[string, string]> = [
    [TEXT_KEYS.status, arg('status') ?? 'active'],
    [TEXT_KEYS.label, arg('label') ?? name],
    [TEXT_KEYS.scope, need('scope')],
    [TEXT_KEYS.maxPerQuery, need('per-query')],
    [TEXT_KEYS.dailyLimit, need('daily')],
    [TEXT_KEYS.approvalAbove, need('approval-above')],
    [TEXT_KEYS.expiresAt, arg('expires') ?? ''],
  ];

  for (const [, v] of values.slice(3, 6)) {
    if (!Number.isFinite(Number.parseFloat(v))) {
      console.error(`limit values must be decimal numbers, got ${v}`);
      process.exit(2);
    }
  }

  await execute(
    values.map(([key, value]) => ({
      to: resolver,
      abi: RESOLVER_ABI,
      functionName: 'setText',
      args: [node, key, value],
      describe: `setText(${name}, ${key}, "${value}")`,
    })),
  );
}

async function revoke(): Promise<void> {
  const name = normalize(need('name'));
  const resolver = asAddress(need('resolver'), '--resolver');
  const node = namehash(name);
  await execute([
    {
      to: resolver,
      abi: RESOLVER_ABI,
      functionName: 'setText',
      args: [node, TEXT_KEYS.status, 'revoked'],
      describe: `setText(${name}, ${TEXT_KEYS.status}, "revoked")  <- the gateway refuses this agent at its next request`,
    },
  ]);
}

async function register(): Promise<void> {
  const registry = asAddress(need('registry'), '--registry');
  const label = need('label');
  const owner = asAddress(need('owner'), '--owner');
  const resolver = asAddress(need('resolver'), '--resolver');
  const days = Number.parseInt(arg('expiry-days') ?? '365', 10);
  const expiry = BigInt(Math.floor(Date.now() / 1000) + days * 86_400);
  // The owner may change the resolver and renew; nothing else. Revocation is
  // done through the resolver's status record, or by the parent unregistering.
  const roleBitmap = ROLE_SET_RESOLVER | ROLE_RENEW;
  await execute([
    {
      to: registry,
      abi: REGISTRY_ABI,
      functionName: 'register',
      args: [label, owner, '0x0000000000000000000000000000000000000000', resolver, roleBitmap, expiry],
      describe: `register("${label}", owner ${owner}, resolver ${resolver}, roles ${roleBitmap}, expiry +${days}d)`,
    },
  ]);
}

const command = process.argv[2];
const run = command === 'records' ? records : command === 'revoke' ? revoke : command === 'register' ? register : null;
if (!run) {
  console.error('usage: passport.ts <records|revoke|register> ...');
  process.exit(2);
}
run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
