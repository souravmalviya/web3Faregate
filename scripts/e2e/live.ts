/**
 * Live end-to-end test of Faregate against a running gateway.
 *
 * Everything here is real and testnet-only: requests are interpreted by the
 * configured model, data comes from The Graph, the agent pays in Hedera testnet
 * USDC through Blocky402, and a passport is revoked and restored on Sepolia.
 *
 * It spends about 0.046 testnet USDC from the agent account and two Sepolia
 * transactions from the ENS owner, and it leaves test requests in the queue.
 * Reset before recording a demo (docs/DEMO_SCRIPT.md).
 *
 * Usage (gateway running, .env configured, from the repository root):
 *   npm run e2e:live -- --yes
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { createPublicClient, http } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';

import { buildActionMessage } from '@faregate/shared';

if (!process.argv.includes('--yes')) {
  console.error('This spends testnet USDC and sends Sepolia transactions. Re-run with --yes.');
  process.exit(2);
}

const run = promisify(execFile);
const GATEWAY = process.env.FAREGATE_GATEWAY_URL ?? 'http://localhost:8402';
const MIRROR = 'https://testnet.mirrornode.hedera.com/api/v1';
const SUBJECT = '0x742d35Cc6634C0532925a3b844Bc454e4438f44e';
const RESEARCH = 'research.agents.faregate.eth';
const TRIAL = 'trial.agents.faregate.eth';
const AGENT_ACCOUNT = '0.0.10455772';
const GATEWAY_ACCOUNT = '0.0.10457565';
const USDC = '0.0.429274';
const UNIVERSAL_RESOLVER = '0x4a1817d13e9cf196f471725176355c1234b63c70';

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}
const results: Check[] = [];

function check(name: string, ok: unknown, detail = ''): void {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const plain = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '');

async function api(path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const response = await fetch(`${GATEWAY}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

const submit = (agentId: string, prompt: string) =>
  api('/requests', { method: 'POST', body: JSON.stringify({ agentId, prompt }) });

async function usdcBalance(account: string): Promise<number> {
  const body = (await fetch(`${MIRROR}/accounts/${account}/tokens?token.id=${USDC}`).then((r) => r.json())) as {
    tokens?: Array<{ balance: number }>;
  };
  return body.tokens?.[0]?.balance ?? 0;
}

async function node(args: string[], timeout = 300_000): Promise<{ code: number; out: string }> {
  try {
    const { stdout } = await run(process.execPath, args, { timeout, maxBuffer: 10_000_000 });
    return { code: 0, out: plain(stdout) };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    return { code: typeof e.code === 'number' ? e.code : 1, out: plain(`${e.stdout ?? ''}${e.stderr ?? ''}`) };
  }
}

const agent = (args: string[]) => node(['apps/agent/src/index.ts', ...args], 240_000);
const lastLines = (out: string, n = 6) => out.trim().split('\n').slice(-n).map((l) => l.trim()).join(' | ');

const sepoliaClient = createPublicClient({ chain: sepolia, transport: http('https://ethereum-sepolia-rpc.publicnode.com') });

async function waitForStatus(name: string, want: string): Promise<boolean> {
  for (let i = 0; i < 25; i += 1) {
    const status = await sepoliaClient
      .getEnsText({ name, key: 'faregate.status', universalResolverAddress: UNIVERSAL_RESOLVER })
      .catch(() => null);
    if (status === want) return true;
    await sleep(3000);
  }
  return false;
}

// --- run ---------------------------------------------------------------------

const agentBefore = await usdcBalance(AGENT_ACCOUNT);
const gatewayBefore = await usdcBalance(GATEWAY_ACCOUNT);
console.log(`USDC before: agent ${agentBefore / 1e6}, gateway ${gatewayBefore / 1e6}\n`);

// 1. The gateway and its four integrations.
const health = await api('/health');
check(
  'gateway: payment, data, AI and ENS all live',
  ['payment', 'data', 'ai', 'ens'].every((k) => health.body.modes?.[k] === 'live'),
  JSON.stringify(health.body.modes),
);
check('gateway: no configuration warnings', (health.body.notes ?? []).length === 0);
check('gateway: human actions must be signed', health.body.signedActions === true);

// 2. Passports come from ENS on Sepolia.
const agents: any[] = (await api('/agents')).body.agents ?? [];
const research = agents.find((a) => a.id === RESEARCH);
const trial = agents.find((a) => a.id === TRIAL);
check(
  'ENS: research passport and its limits read from Sepolia',
  research?.source === 'ens' && research?.status === 'active' && research?.policy?.humanApprovalAboveUsd === 0.02,
  research ? `$${research.policy?.maxCostPerQueryUsd}/query, $${research.policy?.dailyLimitUsd}/day, approval above $${research.policy?.humanApprovalAboveUsd}` : 'missing',
);
check('ENS: trial passport read from Sepolia', trial?.source === 'ens' && trial?.status === 'active');

// 3. Policy refusals.
const unknown = await submit('nobody.agents.faregate.eth', `Show the balances of ${SUBJECT}`);
check(
  'policy: an unknown agent is refused, and the AI is never called for it',
  unknown.status === 403 && unknown.body.request?.decision?.reasons?.[0]?.code === 'agent_unknown' && unknown.body.interpretedBy === 'rule-based',
);
const outOfScope = await submit(RESEARCH, `Show me the lending positions of ${SUBJECT}`);
check(
  'policy: data outside the agent’s scope is refused',
  outOfScope.status === 403 && outOfScope.body.request?.decision?.reasons?.[0]?.code === 'resource_not_allowed',
  `AI read it as ${outOfScope.body.request?.query?.resource}`,
);

// 4. Human approval, signed.
const big = await submit(RESEARCH, `Analyze the recent activity of ${SUBJECT} over the last month`);
const bigId: string = big.body.request?.id;
check(
  'policy: a $0.036 request waits for a human',
  big.status === 201 && big.body.request?.status === 'awaiting_approval' && big.body.request?.estimatedCostUsd === 0.036,
  `interpreted by ${big.body.interpretedBy}`,
);
const early = await fetch(`${GATEWAY}/data/${bigId}`);
check('gate: the data cannot be collected before approval', early.status === 403, `HTTP ${early.status}`);

const unsigned = await api(`/requests/${bigId}/approval`, {
  method: 'POST',
  body: JSON.stringify({ decision: 'approved', by: '0x000000000000000000000000000000000000dEaD' }),
});
check('signatures: an unsigned approval is refused', unsigned.status === 401 && unsigned.body.error?.code === 'signature_required');

const tester = privateKeyToAccount(generatePrivateKey());
const issuedAt = new Date().toISOString();
const signature = await tester.signMessage({
  message: buildActionMessage({ action: 'approve-request', subject: bigId, issuedAt }),
});
const approval = await api(`/requests/${bigId}/approval`, {
  method: 'POST',
  body: JSON.stringify({ decision: 'approved', by: tester.address, issuedAt, signature }),
});
check(
  'signatures: a wallet-signed approval is verified and recorded as signed',
  approval.status === 200 && approval.body.request?.approval?.signed === true && approval.body.request?.status === 'payment_required',
);
const twice = await api(`/requests/${bigId}/approval`, {
  method: 'POST',
  body: JSON.stringify({ decision: 'approved', by: tester.address, issuedAt, signature }),
});
check('signatures: the same approval cannot be sent twice', twice.status === 409, `HTTP ${twice.status} ${twice.body.error?.code ?? ''}`);

// 5. A real x402 payment on Hedera for the approved request.
const paid = await agent(['--agent', RESEARCH, '--request', bigId]);
const paidTx = /hashscan\s+(\S+)/.exec(paid.out)?.[1];
check(
  'Hedera x402: the agent pays $0.036 in USDC and receives live data',
  paid.code === 0 && /Data released/.test(paid.out) && /live indexed chain data/.test(paid.out),
  paidTx ?? lastLines(paid.out),
);
await sleep(3000);
const bigAfter = (await api(`/requests/${bigId}`)).body.request;
check(
  'Hedera x402: the payment is settled and its transaction recorded',
  bigAfter?.payment?.settled === true && Boolean(bigAfter?.payment?.txHash),
  bigAfter?.payment?.txHash,
);
check(
  'The Graph: live data with provenance, summarised by the AI',
  bigAfter?.result?.provenance?.provider === 'the-graph' && bigAfter?.result?.provenance?.simulated === false && Boolean(bigAfter?.result?.analysis),
  bigAfter?.result?.provenance?.source?.split(' | ').map((s: string) => s.split(':')[0]).join(', '),
);

// 6. The same request cannot be collected, or paid for, twice.
const again = await agent(['--agent', RESEARCH, '--request', bigId]);
check('replay: collecting a fulfilled request again is refused before any payment', again.code === 4, `agent exit ${again.code}`);

// 7. A small in-scope request pays with no human involved.
const small = await agent(['--agent', TRIAL, '--ask', `What is the token balance of ${SUBJECT} today?`]);
const smallTx = /hashscan\s+(\S+)/.exec(small.out)?.[1];
check(
  'policy + Hedera: a $0.0102 in-scope request pays without a human',
  small.code === 0 && !/Wait for a human/.test(small.out) && /Data released/.test(small.out),
  smallTx ?? lastLines(small.out),
);

// 8. An onchain revocation beats a quote the agent already holds.
const quote = await submit(TRIAL, `What is the token balance of ${SUBJECT} today?`);
const quoteId: string = quote.body.request?.id;
check('setup: the trial agent holds a payable quote', quote.body.request?.status === 'payment_required');

const revoke = await node(['scripts/ens/passport.ts', 'revoke', '--send', '--name', TRIAL]);
const revokeTx = /tx:\s+(\S+)/.exec(revoke.out)?.[1];
check('ENS: the owner revokes the trial passport onchain', revoke.code === 0 && /confirmed/.test(revoke.out), revokeTx);
check('ENS: the revocation is visible through the Universal Resolver', await waitForStatus(TRIAL, 'revoked'));
await sleep(6000);

const atGate = await agent(['--agent', TRIAL, '--request', quoteId]);
check(
  'gate: the revoked agent is refused with its quote in hand, before paying',
  atGate.code === 4 && /Refused at the gate/.test(atGate.out),
  atGate.out.split('\n').find((l) => /Refused/.test(l))?.trim() ?? lastLines(atGate.out),
);
const afterRevoke = await submit(TRIAL, `What is the token balance of ${SUBJECT} today?`);
check(
  'policy: a new request from the revoked agent is refused',
  afterRevoke.status === 403 && afterRevoke.body.request?.decision?.reasons?.[0]?.code === 'agent_revoked',
);

// 9. Restore, so the demo passports are active again.
const restore = await node(['scripts/ens/setup.ts', '--send'], 400_000);
check('ENS: restore sets the trial passport back to active', restore.code === 0 && (await waitForStatus(TRIAL, 'active')));
await sleep(6000);
const restored = await api('/requests', {
  method: 'POST',
  body: JSON.stringify({ agentId: TRIAL, query: { resource: 'wallet.balances', address: SUBJECT, lookbackDays: 1 } }),
});
check('policy: the restored agent is allowed again', restored.status === 201 && restored.body.request?.status === 'payment_required');

// 10. The money moved exactly as quoted, and only for delivered data.
await sleep(8000);
const agentAfter = await usdcBalance(AGENT_ACCOUNT);
const gatewayAfter = await usdcBalance(GATEWAY_ACCOUNT);
const expected = 36_000 + 10_200;
check('Hedera: the agent paid exactly $0.0462 in total', agentBefore - agentAfter === expected, `${(agentBefore - agentAfter) / 1e6} USDC`);
check('Hedera: the gateway received exactly $0.0462', gatewayAfter - gatewayBefore === expected, `${(gatewayAfter - gatewayBefore) / 1e6} USDC`);

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
console.log(JSON.stringify({ approvedRequest: bigId, paidTx, smallTx, revokeTx }));
process.exitCode = passed === results.length ? 0 : 1;
