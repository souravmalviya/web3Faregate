/**
 * One-time ENSv2 Sepolia setup for Faregate passports.
 *
 * Creates everything the gateway needs to read agent passports from ENS:
 *
 *   faregate.eth                  registered through the ETHRegistrar
 *   agents.faregate.eth           a subname with its own UserRegistry
 *   <agent>.agents.faregate.eth   one passport per demo agent, carrying the
 *                                 faregate.* text records the gateway reads
 *
 * Every name points at one PermissionedResolver owned by the same account, so
 * that account can revoke any passport by changing a single text record
 * (`npm run ens:passport -- revoke ...`).
 *
 * Sepolia only, test tokens only. The ENSv2 registrar on Sepolia charges its
 * fee in MockUSDC, which anyone can mint for free, and gas is Sepolia ETH from
 * a faucet. The script refuses to run against any other chain.
 *
 * Safe to re-run. Each step checks the chain first and is skipped when it is
 * already done, and each transaction is simulated before it is sent, so a call
 * that would fail is never broadcast. Deployed addresses are kept in
 * data/ens-setup.json (gitignored).
 *
 * Contract addresses come from https://docs.ens.domains/learn/deployments
 * (Sepolia, ENSv2 beta). ABIs were checked against the verified sources on
 * Sourcify and Etherscan. ENS notes that Sepolia ENSv2 state may be reset when
 * they redeploy; if that happens, run this again.
 *
 * Usage:
 *   npm run ens:setup -- --owner 0x...   dry run for an address: checks and simulates, sends nothing
 *   npm run ens:setup                    dry run for the ENS_OWNER_PRIVATE_KEY account
 *   npm run ens:setup -- --send          do it
 *
 * Environment (.env at the repository root):
 *   ENS_OWNER_PRIVATE_KEY  key of the test account that will own the names.
 *                          Never the key of a wallet holding real funds.
 *   FAREGATE_PARENT_NAME   defaults to agents.faregate.eth
 *   ENS_SETUP_RPC_URL      optional Sepolia RPC. Deliberately not ENS_RPC_URL,
 *                          because setting that switches the gateway to ENS.
 */

import { config as loadDotenv } from 'dotenv';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  formatEther,
  formatUnits,
  getAddress,
  http,
  isAddressEqual,
  keccak256,
  namehash,
  parseAbi,
  parseEther,
  toHex,
  zeroAddress,
  zeroHash,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { normalize } from 'viem/ens';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const STATE_PATH = path.join(ROOT, 'data', 'ens-setup.json');
loadDotenv({ path: path.join(ROOT, '.env'), quiet: true });

const DEFAULT_RPC = 'https://ethereum-sepolia-rpc.publicnode.com';

/** ENSv2 beta on Sepolia, from https://docs.ens.domains/learn/deployments */
const CONTRACTS = {
  ethRegistrar: '0xa88553f454b77203b0d036a05c894d555eaaa2cc',
  ethRegistry: '0xbdc85dd5b15d7ecb354cd7cb6f2c50b4f2c4f0e2',
  verifiableFactory: '0x10dc6333cdfe1fcef624c6e0a8221b91804cd7ef',
  userRegistryImpl: '0x624a25d67b59d587752ebec8dded8827dae52050',
  permissionedResolverImpl: '0x9eae5c2730a7dd16bdd1dee6421a1b91e3b0365e',
  mockUsdc: '0x768f42455a2d082e23ceef7d51e5787c82d67a39',
  universalResolver: '0x4a1817d13e9cf196f471725176355c1234b63c70',
} as const;

const FACTORY_ABI = parseAbi([
  'function deployProxy(address implementation, uint256 salt, bytes data) returns (address)',
]);

const ERC20_ABI = parseAbi([
  'function mint(address to, uint256 amount)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
]);

const REGISTRAR_ABI = parseAbi([
  'function isAvailable(string label) view returns (bool)',
  'function getRegisterPrice(string label, uint64 duration, address paymentToken) view returns (uint256 base, uint256 premium)',
  'function MIN_COMMITMENT_AGE() view returns (uint64)',
  'function MAX_COMMITMENT_AGE() view returns (uint64)',
  'function commitmentAt(bytes32 commitment) view returns (uint64)',
  'function makeCommitment(string label, address owner, bytes32 secret, address subregistry, address resolver, uint64 duration, bytes32 referrer) pure returns (bytes32)',
  'function commit(bytes32 commitment)',
  'function register(string label, address owner, bytes32 secret, address subregistry, address resolver, uint64 duration, address paymentToken, bytes32 referrer) returns (uint256)',
  'error CommitmentTooNew(bytes32 commitment, uint64 validFrom, uint64 blockTimestamp)',
  'error CommitmentTooOld(bytes32 commitment, uint64 validTo, uint64 blockTimestamp)',
  'error DurationTooShort(uint64 duration, uint64 minDuration)',
  'error NameNotAvailable(string label)',
  'error UnexpiredCommitmentExists(bytes32 commitment)',
  'error SafeERC20FailedOperation(address token)',
  'error InvalidOwner()',
]);

const REGISTRY_ABI = parseAbi([
  'function initialize(address rootAccount, uint256 roleBitmap)',
  'function register(string label, address owner, address registry, address resolver, uint256 roleBitmap, uint64 expiry) returns (uint256)',
  'function findOwner(string label) view returns (address)',
  'function findExpiry(string label) view returns (uint64)',
  'function getSubregistry(string label) view returns (address)',
  'function getResolver(string label) view returns (address)',
  'function getParent() view returns (address parent, string label)',
  'function setParent(address parent, string label)',
  'error LabelAlreadyRegistered(string label)',
  'error CannotSetPastExpiry(uint64 expiry)',
  'error InvalidOwner()',
  'error EACUnauthorizedAccountRoles(uint256 resource, uint256 roleBitmap, address account)',
  'error EACCannotGrantRoles(uint256 resource, uint256 roleBitmap, address account)',
  'error EACInvalidRoleBitmap(uint256 roleBitmap)',
]);

const RESOLVER_ABI = parseAbi([
  'function initialize(address admin, uint256 roleBitmap, bytes[] setters)',
  'function setText(bytes32 node, string key, string value)',
  'function text(bytes32 node, string key) view returns (string)',
  'function setAddr(bytes32 node, address addr_)',
  'function addr(bytes32 node) view returns (address)',
  'function multicall(bytes[] calls) returns (bytes[] results)',
  'error EACUnauthorizedAccountRoles(uint256 resource, uint256 roleBitmap, address account)',
]);

/** Every role and every admin role, as the Verifiable Factory docs pass to initialize(). */
const ALL_ROLES = BigInt(`0x${'1'.repeat(64)}`);
// From the EAC table at https://docs.ens.domains/ensv2/permissioned-registry
const ROLE_RENEW = 1n << 16n;
const ROLE_SET_SUBREGISTRY = 1n << 20n;
const ROLE_SET_RESOLVER = 1n << 24n;

const ONE_YEAR = 365n * 24n * 60n * 60n;
const MIN_BALANCE_TO_SEND = parseEther('0.005');
/** A generous gas figure per transaction, used only for the dry-run estimate. */
const GAS_PER_TX_ESTIMATE = 250_000n;

const TEXT_KEYS = {
  status: 'faregate.status',
  label: 'faregate.label',
  scope: 'faregate.scope',
  maxPerQuery: 'faregate.max_per_query_usd',
  dailyLimit: 'faregate.daily_limit_usd',
  approvalAbove: 'faregate.approval_above_usd',
  expiresAt: 'faregate.expires_at',
} as const;

type TextField = keyof typeof TEXT_KEYS;

/**
 * The demo passports. The values match seedDemoData in apps/api/src/store.ts,
 * so the demo agents keep the same limits when the gateway switches to ENS.
 */
const PASSPORTS: Array<{ label: string; records: Record<TextField, string> }> = [
  {
    label: 'research',
    records: {
      status: 'active',
      label: 'Treasury Research Agent',
      scope: 'wallet.balances,wallet.transfers,wallet.activity',
      maxPerQuery: '0.10',
      dailyLimit: '1.00',
      approvalAbove: '0.02',
      expiresAt: '',
    },
  },
  {
    label: 'trial',
    records: {
      status: 'active',
      label: 'Trial Scout Agent',
      scope: 'wallet.balances',
      maxPerQuery: '0.015',
      dailyLimit: '0.05',
      approvalAbove: '0.05',
      expiresAt: '',
    },
  },
];

// --- helpers -----------------------------------------------------------------

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function fail(message: string, code = 2): never {
  console.error(message);
  process.exit(code);
}

function revertName(error: unknown): string | undefined {
  if (!(error instanceof BaseError)) return undefined;
  const revert = error.walk((e) => e instanceof ContractFunctionRevertedError);
  return revert instanceof ContractFunctionRevertedError ? revert.data?.errorName : undefined;
}

function describeError(error: unknown): string {
  if (error instanceof BaseError) {
    const revert = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError && revert.data) {
      return `${revert.data.errorName}(${(revert.data.args ?? []).map(String).join(', ')})`;
    }
    return error.shortMessage;
  }
  return error instanceof Error ? error.message : String(error);
}

/** Reads the owner key. MetaMask exports it without 0x, so both forms work. Never printed. */
function ownerKey(): Hex | null {
  const raw = process.env.ENS_OWNER_PRIVATE_KEY?.trim().replace(/^['"]|['"]$/g, '');
  if (!raw) return null;
  const hex = raw.replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    fail('ENS_OWNER_PRIVATE_KEY should be 64 hex characters, with or without 0x. The value was not printed.');
  }
  return `0x${hex}`;
}

// --- configuration -----------------------------------------------------------

const send = process.argv.includes('--send');
const key = ownerKey();
const account = key ? privateKeyToAccount(key) : null;
const ownerArg = arg('owner');
if (ownerArg !== undefined && !/^0x[0-9a-fA-F]{40}$/.test(ownerArg)) fail(`--owner is not an address: ${ownerArg}`);
if (send && !account) fail('--send needs ENS_OWNER_PRIVATE_KEY in .env: the key of the test account that will own the names.');
if (account && ownerArg && !isAddressEqual(account.address, ownerArg as Address)) {
  fail(`--owner ${ownerArg} is not the account of ENS_OWNER_PRIVATE_KEY (${account.address}).`);
}
const owner: Address =
  account?.address ?? (ownerArg ? getAddress(ownerArg) : fail('Put ENS_OWNER_PRIVATE_KEY in .env, or pass --owner 0x... for a dry run.'));
const signer = account ?? owner;

const parentName = normalize(process.env.FAREGATE_PARENT_NAME?.trim() || 'agents.faregate.eth');
const nameParts = parentName.split('.');
if (nameParts.length !== 3 || nameParts[2] !== 'eth') {
  fail(`FAREGATE_PARENT_NAME must look like agents.<name>.eth, got ${parentName}.`);
}
const agentsLabel = nameParts[0] as string;
const rootLabel = nameParts[1] as string;
const rootName = `${rootLabel}.eth`;

const rpcUrl = process.env.ENS_SETUP_RPC_URL?.trim() || DEFAULT_RPC;
const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl, { timeout: 30_000 }) });
const walletClient =
  send && account ? createWalletClient({ account, chain: sepolia, transport: http(rpcUrl, { timeout: 30_000 }) }) : null;

// --- state -------------------------------------------------------------------

interface SetupState {
  owner: Address;
  parentName: string;
  resolver?: Address;
  rootRegistry?: Address;
  agentsRegistry?: Address;
  /** Kept between commit and register, so an interrupted run can finish. */
  commitSecret?: Hex;
}

function loadState(): SetupState {
  try {
    const saved = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) as SetupState;
    if (isAddressEqual(saved.owner, owner) && saved.parentName === parentName) return saved;
    console.log(`  note      ${path.relative(ROOT, STATE_PATH)} is for another owner or name, so it is ignored`);
  } catch {
    // No saved state yet.
  }
  return { owner, parentName };
}

function saveState(state: SetupState): void {
  if (!send) return;
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
}

// --- chain -------------------------------------------------------------------

// viem infers exact types from a literal ABI. These helpers accept any call,
// so they give that inference up on purpose.
interface Call {
  address: Address;
  abi: any;
  functionName: string;
  args: readonly unknown[];
}

async function read<T>(address: Address, abi: any, functionName: string, args: readonly unknown[] = []): Promise<T> {
  return (await publicClient.readContract({ address, abi, functionName, args })) as T;
}

async function isContract(address: Address | undefined): Promise<boolean> {
  if (!address || isAddressEqual(address, zeroAddress)) return false;
  const code = await publicClient.getCode({ address });
  return code !== undefined && code !== '0x';
}

async function simulate(call: Call): Promise<{ result: unknown; request: any }> {
  return publicClient.simulateContract({ ...call, account: signer } as any);
}

let transactions = 0;

function next(text: string, count: number): void {
  transactions += count;
  console.log(`  [next] ${text}`);
}

/**
 * Simulates a call, then sends it when --send is on and waits until it is
 * mined. A call whose simulation fails is never sent.
 */
async function transact(description: string, call: Call, options: { optional?: boolean } = {}): Promise<unknown> {
  let simulation: { result: unknown; request: any };
  try {
    simulation = await simulate(call);
  } catch (error) {
    if (options.optional) {
      console.log(`  [skip] ${description}: ${describeError(error)}. Not needed for resolution.`);
      return undefined;
    }
    return fail(`  [fail] ${description}: the simulation failed, so nothing was sent. ${describeError(error)}`, 1);
  }
  transactions += 1;
  if (!walletClient) {
    console.log(`  [ok]   ${description} (simulated, not sent)`);
    return simulation.result;
  }
  const hash = await walletClient.writeContract(simulation.request);
  console.log(`  [sent] ${description}\n         https://sepolia.etherscan.io/tx/${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 240_000 });
  if (receipt.status !== 'success') fail(`  [fail] ${description} reverted onchain: ${hash}`, 1);
  return simulation.result;
}

/** Salts follow the examples in the Verifiable Factory docs. */
function resolverSalt(index: bigint): bigint {
  return BigInt(
    keccak256(
      encodeAbiParameters(
        [{ type: 'bytes32' }, { type: 'address' }, { type: 'uint256' }],
        [keccak256(toHex('OwnedResolver')), owner, index],
      ),
    ),
  );
}

function registrySalt(name: string, index: bigint): bigint {
  return BigInt(
    keccak256(
      encodeAbiParameters(
        [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }],
        [keccak256(toHex('UserRegistry')), namehash(name), index],
      ),
    ),
  );
}

async function deployProxy(
  what: string,
  implementation: Address,
  saltFor: (index: bigint) => bigint,
  data: Hex,
): Promise<Address> {
  // A salt works once. If an earlier run used it and the state file was lost,
  // move on to the next one.
  for (let index = 0n; index < 5n; index += 1n) {
    const call: Call = {
      address: CONTRACTS.verifiableFactory,
      abi: FACTORY_ABI,
      functionName: 'deployProxy',
      args: [implementation, saltFor(index), data],
    };
    let predicted: Address;
    try {
      predicted = (await simulate(call)).result as Address;
    } catch {
      continue;
    }
    await transact(`deploy ${what} at ${predicted}`, call);
    return predicted;
  }
  return fail(`  [fail] could not deploy ${what}: every salt tried is already used`, 1);
}

async function waitForChainTime(target: bigint): Promise<void> {
  let announced = false;
  for (;;) {
    const { timestamp } = await publicClient.getBlock();
    if (timestamp >= target) return;
    if (!announced) {
      console.log(`  [wait] about ${target - timestamp}s, because ENS makes a registration wait after its commitment`);
      announced = true;
    }
    await sleep(6_000);
  }
}

/** Re-simulates while the chain still reports `retryOn`, such as a commitment one block too young. */
async function waitForSimulation(call: Call, retryOn: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await simulate(call);
      return;
    } catch (error) {
      // Any other failure is left for transact() to report.
      if (revertName(error) !== retryOn) return;
      await sleep(6_000);
    }
  }
}

// --- setup -------------------------------------------------------------------

async function main(): Promise<void> {
  const chainId = await publicClient.getChainId();
  if (chainId !== sepolia.id) {
    fail(`The RPC is on chain ${chainId}, not Sepolia (${sepolia.id}). Stopping so nothing touches a real network.`);
  }

  const [balance, gasPrice] = await Promise.all([publicClient.getBalance({ address: owner }), publicClient.getGasPrice()]);

  console.log(`Faregate ENS setup on Sepolia: ${send ? 'SENDING transactions' : 'dry run, nothing will be sent'}`);
  console.log(`  owner     ${owner}`);
  console.log(`  test ETH  ${formatEther(balance)}`);
  console.log(`  names     ${rootName}, ${parentName}, ${PASSPORTS.map((p) => `${p.label}.${parentName}`).join(', ')}`);
  const state = loadState();
  if (balance < MIN_BALANCE_TO_SEND) {
    const need = `the owner needs at least ${formatEther(MIN_BALANCE_TO_SEND)} Sepolia ETH, free from https://ethglobal.com/faucet`;
    if (send) fail(`  Stopping: ${need}.`);
    console.log(`  note      before --send, ${need}`);
  }

  // 1. Is the name free, or ours already?
  console.log(`\n1. ${rootName}`);
  const available = await read<boolean>(CONTRACTS.ethRegistrar, REGISTRAR_ABI, 'isAvailable', [rootLabel]);
  const holder = await read<Address>(CONTRACTS.ethRegistry, REGISTRY_ABI, 'findOwner', [rootLabel]);
  let ownsRoot = !available && isAddressEqual(holder, owner);
  if (!available && !ownsRoot) {
    fail(`  ${rootName} belongs to ${holder}. Pick another name and set FAREGATE_PARENT_NAME=agents.<name>.eth in .env.`, 1);
  }
  if (ownsRoot) {
    // Read the setup back from the chain, in case the state file is gone.
    const [registry, resolver] = await Promise.all([
      read<Address>(CONTRACTS.ethRegistry, REGISTRY_ABI, 'getSubregistry', [rootLabel]),
      read<Address>(CONTRACTS.ethRegistry, REGISTRY_ABI, 'getResolver', [rootLabel]),
    ]);
    if (!isAddressEqual(registry, zeroAddress)) state.rootRegistry = registry;
    if (!isAddressEqual(resolver, zeroAddress)) state.resolver = resolver;
    console.log('  [done] registered to the owner');
  } else {
    console.log('  available');
  }

  // 2. One resolver for every name.
  console.log('\n2. Resolver (one PermissionedResolver holds every record)');
  if (await isContract(state.resolver)) {
    console.log(`  [done] ${state.resolver}`);
  } else {
    const data = encodeFunctionData({ abi: RESOLVER_ABI, functionName: 'initialize', args: [owner, ALL_ROLES, []] });
    state.resolver = await deployProxy('the PermissionedResolver', CONTRACTS.permissionedResolverImpl, resolverSalt, data);
    saveState(state);
  }
  const resolver = state.resolver as Address;

  // 3. A registry under faregate.eth, and one under agents.faregate.eth.
  console.log('\n3. Registries');
  const registryInit = encodeFunctionData({ abi: REGISTRY_ABI, functionName: 'initialize', args: [owner, ALL_ROLES] });
  if (await isContract(state.rootRegistry)) {
    console.log(`  [done] ${rootName} registry ${state.rootRegistry}`);
  } else {
    state.rootRegistry = await deployProxy(`the ${rootName} registry`, CONTRACTS.userRegistryImpl, (i) => registrySalt(rootName, i), registryInit);
    saveState(state);
  }
  const rootRegistry = state.rootRegistry as Address;

  if (!state.agentsRegistry && (await isContract(rootRegistry))) {
    const existing = await read<Address>(rootRegistry, REGISTRY_ABI, 'getSubregistry', [agentsLabel]);
    if (!isAddressEqual(existing, zeroAddress)) state.agentsRegistry = existing;
  }
  if (await isContract(state.agentsRegistry)) {
    console.log(`  [done] ${parentName} registry ${state.agentsRegistry}`);
  } else {
    state.agentsRegistry = await deployProxy(`the ${parentName} registry`, CONTRACTS.userRegistryImpl, (i) => registrySalt(parentName, i), registryInit);
    saveState(state);
  }
  const agentsRegistry = state.agentsRegistry as Address;

  // 4. Register faregate.eth, paying the fee in free MockUSDC.
  console.log(`\n4. Register ${rootName}`);
  if (ownsRoot) {
    console.log('  [done] already registered');
  } else {
    const [base, premium] = await read<readonly [bigint, bigint]>(CONTRACTS.ethRegistrar, REGISTRAR_ABI, 'getRegisterPrice', [
      rootLabel,
      ONE_YEAR,
      CONTRACTS.mockUsdc,
    ]);
    const fee = base + premium;
    // One MockUSDC of headroom, in case the price moves between now and the register call.
    const budget = fee + 1_000_000n;
    console.log(`  fee ${formatUnits(fee, 6)} MockUSDC for one year. MockUSDC is a free test token.`);

    const [usdc, allowance] = await Promise.all([
      read<bigint>(CONTRACTS.mockUsdc, ERC20_ABI, 'balanceOf', [owner]),
      read<bigint>(CONTRACTS.mockUsdc, ERC20_ABI, 'allowance', [owner, CONTRACTS.ethRegistrar]),
    ]);
    if (usdc >= fee) {
      console.log(`  [done] the owner holds ${formatUnits(usdc, 6)} MockUSDC`);
    } else {
      await transact(`mint ${formatUnits(budget, 6)} free MockUSDC to the owner`, {
        address: CONTRACTS.mockUsdc,
        abi: ERC20_ABI,
        functionName: 'mint',
        args: [owner, budget],
      });
    }
    if (allowance >= fee) {
      console.log('  [done] the registrar may collect the fee');
    } else {
      await transact('let the registrar collect the fee', {
        address: CONTRACTS.mockUsdc,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [CONTRACTS.ethRegistrar, budget],
      });
    }

    if (!(await isContract(resolver)) || !(await isContract(rootRegistry))) {
      next(`commit, wait about a minute (ENS requires it), then register ${rootName} with the resolver and registry above`, 2);
    } else {
      const [minAge, maxAge] = await Promise.all([
        read<bigint>(CONTRACTS.ethRegistrar, REGISTRAR_ABI, 'MIN_COMMITMENT_AGE'),
        read<bigint>(CONTRACTS.ethRegistrar, REGISTRAR_ABI, 'MAX_COMMITMENT_AGE'),
      ]);
      const commitmentFor = (secret: Hex) =>
        read<Hex>(CONTRACTS.ethRegistrar, REGISTRAR_ABI, 'makeCommitment', [
          rootLabel,
          owner,
          secret,
          rootRegistry,
          resolver,
          ONE_YEAR,
          zeroHash,
        ]);
      const committedAtFor = async (secret: Hex) =>
        read<bigint>(CONTRACTS.ethRegistrar, REGISTRAR_ABI, 'commitmentAt', [await commitmentFor(secret)]);
      const now = (await publicClient.getBlock()).timestamp;

      let secret = state.commitSecret;
      let committedAt = secret ? await committedAtFor(secret) : 0n;
      if (!secret || committedAt === 0n || now > committedAt + maxAge) {
        secret = toHex(randomBytes(32));
        // Saved before sending, so an interrupted run can still finish the registration.
        state.commitSecret = secret;
        saveState(state);
        await transact(`commit to registering ${rootName}`, {
          address: CONTRACTS.ethRegistrar,
          abi: REGISTRAR_ABI,
          functionName: 'commit',
          args: [await commitmentFor(secret)],
        });
        committedAt = send ? await committedAtFor(secret) : now;
      } else {
        console.log('  [done] commitment already made');
      }

      if (!send) {
        next(`wait ${minAge}s, then register ${rootName} for one year, paying the MockUSDC fee`, 1);
      } else {
        await waitForChainTime(committedAt + minAge + 1n);
        const register: Call = {
          address: CONTRACTS.ethRegistrar,
          abi: REGISTRAR_ABI,
          functionName: 'register',
          args: [rootLabel, owner, secret, rootRegistry, resolver, ONE_YEAR, CONTRACTS.mockUsdc, zeroHash],
        };
        await waitForSimulation(register, 'CommitmentTooNew');
        await transact(`register ${rootName} for one year`, register);
        delete state.commitSecret;
        saveState(state);
        ownsRoot = true;
      }
    }
  }

  // 5. agents.faregate.eth, pointing at its own registry.
  console.log(`\n5. ${parentName}`);
  if (!ownsRoot || !(await isContract(rootRegistry)) || !(await isContract(agentsRegistry))) {
    next(`register ${parentName} in the ${rootName} registry`, 1);
  } else {
    const current = await read<Address>(rootRegistry, REGISTRY_ABI, 'getSubregistry', [agentsLabel]);
    if (isAddressEqual(current, agentsRegistry)) {
      console.log('  [done] registered');
    } else if (!isAddressEqual(current, zeroAddress)) {
      fail(`  [fail] ${parentName} points at registry ${current}, not ${agentsRegistry}. Delete data/ens-setup.json and run again to adopt it.`, 1);
    } else {
      const expiry = await read<bigint>(CONTRACTS.ethRegistry, REGISTRY_ABI, 'findExpiry', [rootLabel]);
      await transact(`register ${parentName}`, {
        address: rootRegistry,
        abi: REGISTRY_ABI,
        functionName: 'register',
        args: [agentsLabel, owner, agentsRegistry, resolver, ROLE_SET_SUBREGISTRY | ROLE_SET_RESOLVER | ROLE_RENEW, expiry],
      });
    }
  }

  // 6. Parent pointers. Resolution works without them; explorers use them to
  //    show a registry's full name.
  console.log('\n6. Parent pointers (let ENS explorers show the full names)');
  const links: Array<[Address, Address, string, string]> = [
    [rootRegistry, CONTRACTS.ethRegistry, rootLabel, rootName],
    [agentsRegistry, rootRegistry, agentsLabel, parentName],
  ];
  for (const [registry, parent, label, name] of links) {
    if (!(await isContract(registry))) {
      next(`point the ${name} registry at its parent`, 1);
      continue;
    }
    const [currentParent, currentLabel] = await read<readonly [Address, string]>(registry, REGISTRY_ABI, 'getParent');
    if (isAddressEqual(currentParent, parent) && currentLabel === label) {
      console.log(`  [done] ${name}`);
      continue;
    }
    await transact(
      `point the ${name} registry at its parent`,
      { address: registry, abi: REGISTRY_ABI, functionName: 'setParent', args: [parent, label] },
      { optional: true },
    );
  }

  // 7. The passports and their records.
  console.log('\n7. Passports');
  const passportsReady = (await isContract(agentsRegistry)) && (await isContract(resolver));
  const passportExpiry =
    passportsReady && (await isContract(rootRegistry))
      ? await read<bigint>(rootRegistry, REGISTRY_ABI, 'findExpiry', [agentsLabel])
      : 0n;
  for (const passport of PASSPORTS) {
    const name = `${passport.label}.${parentName}`;
    if (!passportsReady || passportExpiry === 0n) {
      next(`register ${name} and write its ${Object.keys(TEXT_KEYS).length} records`, 2);
      continue;
    }

    const passportHolder = await read<Address>(agentsRegistry, REGISTRY_ABI, 'findOwner', [passport.label]);
    if (isAddressEqual(passportHolder, zeroAddress)) {
      await transact(`register ${name}`, {
        address: agentsRegistry,
        abi: REGISTRY_ABI,
        functionName: 'register',
        args: [passport.label, owner, zeroAddress, resolver, ROLE_SET_RESOLVER | ROLE_RENEW, passportExpiry],
      });
    } else if (isAddressEqual(passportHolder, owner)) {
      console.log(`  [done] ${name} registered`);
    } else {
      fail(`  [fail] ${name} belongs to ${passportHolder}`, 1);
    }

    const node = namehash(name);
    const updates: Hex[] = [];
    for (const field of Object.keys(TEXT_KEYS) as TextField[]) {
      const current = await read<string>(resolver, RESOLVER_ABI, 'text', [node, TEXT_KEYS[field]]);
      if (current !== passport.records[field]) {
        updates.push(
          encodeFunctionData({ abi: RESOLVER_ABI, functionName: 'setText', args: [node, TEXT_KEYS[field], passport.records[field]] }),
        );
      }
    }
    const currentAddr = await read<Address>(resolver, RESOLVER_ABI, 'addr', [node]);
    if (!isAddressEqual(currentAddr, owner)) {
      updates.push(encodeFunctionData({ abi: RESOLVER_ABI, functionName: 'setAddr', args: [node, owner] }));
    }
    if (updates.length === 0) {
      console.log(`  [done] ${name} records match`);
    } else {
      await transact(`write ${updates.length} record(s) for ${name}`, {
        address: resolver,
        abi: RESOLVER_ABI,
        functionName: 'multicall',
        args: [updates],
      });
    }
  }

  // 8. Read the passports back the way the gateway does.
  console.log('\n8. Read back through the ENS Universal Resolver, as the gateway will');
  let problems = 0;
  if (!ownsRoot || !passportsReady) {
    next('check that each passport resolves', 0);
  } else {
    for (const passport of PASSPORTS) {
      const name = `${passport.label}.${parentName}`;
      try {
        const [status, label, address] = await Promise.all([
          publicClient.getEnsText({ name, key: TEXT_KEYS.status, universalResolverAddress: CONTRACTS.universalResolver }),
          publicClient.getEnsText({ name, key: TEXT_KEYS.label, universalResolverAddress: CONTRACTS.universalResolver }),
          publicClient.getEnsAddress({ name, universalResolverAddress: CONTRACTS.universalResolver }),
        ]);
        const ok = status === passport.records.status && label === passport.records.label;
        if (!ok) problems += 1;
        console.log(`  [${ok ? 'ok' : 'odd'}]${ok ? '   ' : '  '}${name}: status ${status ?? '(none)'}, label ${label ?? '(none)'}, address ${address ?? '(none)'}`);
      } catch (error) {
        problems += 1;
        console.log(`  [fail] ${name}: ${describeError(error)}`);
      }
    }
  }

  console.log('');
  if (!send) {
    const estimate = gasPrice * GAS_PER_TX_ESTIMATE * BigInt(transactions);
    console.log('Dry run finished. Nothing was sent.');
    console.log(
      `About ${transactions} transaction(s), roughly ${formatEther(estimate)} Sepolia ETH at today's gas price. The owner has ${formatEther(balance)}.`,
    );
    console.log('Run again with --send to do it.');
    return;
  }

  console.log('Done.');
  console.log(`  resolver                       ${resolver}`);
  console.log(`  ${rootName} registry          ${rootRegistry}`);
  console.log(`  ${parentName} registry   ${agentsRegistry}`);
  if (problems > 0) {
    fail(`${problems} passport(s) did not read back as expected. Check the lines above before switching the gateway to ENS.`, 1);
  }
  console.log('\nTo switch the gateway to ENS, add this line to .env and restart it with npm run dev:api:');
  console.log(`  ENS_RPC_URL=${DEFAULT_RPC}`);
  console.log('\nTo revoke a passport onchain:');
  console.log(`  npm run ens:passport -- revoke --name research.${parentName} --resolver ${resolver} --send`);
}

main().catch((error) => fail(describeError(error), 1));
