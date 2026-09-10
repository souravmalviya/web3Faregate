/**
 * The demo agent.
 *
 * This is a separate process from the gateway on purpose. The whole claim of the
 * product is that an autonomous agent can buy data over HTTP without a human
 * handing it an API key, so the agent has to actually be a client speaking the
 * protocol, not a function call inside the server.
 *
 * It narrates each step because this is what runs during the demo video.
 *
 * Usage:
 *   npm run agent -- --agent research.agents.faregate.eth --ask "..."
 *   npm run agent -- --scenario revoked
 */

import { config as loadDotenv } from 'dotenv';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { wrapFetchWithPayment, x402Client } from '@x402/fetch';
import { ExactHederaScheme, PrivateKey, createClientHederaSigner } from '@x402/hedera';

// Load .env from the repository root rather than the process cwd. `npm run agent`
// runs with apps/agent as the working directory, where there is no .env, so a
// cwd-relative load would silently leave the agent without its wallet.
loadDotenv({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env') });

const GATEWAY = process.env.FAREGATE_GATEWAY_URL ?? 'http://localhost:8402';
const NETWORK = process.env.FAREGATE_NETWORK ?? 'hedera:testnet';

const DEFAULT_AGENT = 'research.agents.faregate.eth';
const DEFAULT_ASK =
  'Analyze the recent activity of 0x742d35Cc6634C0532925a3b844Bc454e4438f44e over the last month';

// --- console helpers -----------------------------------------------------

const DIM = '[2m';
const BOLD = '[1m';
const GREEN = '[32m';
const RED = '[31m';
const YELLOW = '[33m';
const RESET = '[0m';

let stepNumber = 0;
function step(title: string): void {
  stepNumber += 1;
  console.log(`\n${BOLD}${stepNumber}. ${title}${RESET}`);
}
function info(label: string, value: string): void {
  console.log(`   ${DIM}${label.padEnd(14)}${RESET}${value}`);
}
function ok(message: string): void {
  console.log(`   ${GREEN}✓${RESET} ${message}`);
}
function warn(message: string): void {
  console.log(`   ${YELLOW}!${RESET} ${message}`);
}
function fail(message: string): void {
  console.log(`   ${RED}✗${RESET} ${message}`);
}

// --- argument parsing ----------------------------------------------------

interface Args {
  agent: string;
  ask: string;
  waitSeconds: number;
  /** Collect an existing request instead of submitting a new one. */
  requestId: string | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { agent: DEFAULT_AGENT, ask: DEFAULT_ASK, waitSeconds: 120, requestId: null };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--agent' && value) { args.agent = value; i += 1; }
    else if (flag === '--ask' && value) { args.ask = value; i += 1; }
    else if (flag === '--request' && value) { args.requestId = value; i += 1; }
    else if (flag === '--wait' && value) { args.waitSeconds = Number.parseInt(value, 10) || 120; i += 1; }
  }
  return args;
}

// --- payment-capable fetch ----------------------------------------------

/**
 * Builds the fetch the agent uses to collect data.
 *
 * With Hedera credentials present, this is a real x402 client: it receives the
 * 402, builds and signs a Hedera transfer, and retries with the payment header.
 * Without credentials it is plain fetch, which works because the gateway is then
 * running in simulated payment mode and says so on every receipt it issues.
 */
function buildFetch(): { fetchImpl: typeof fetch; paying: boolean } {
  const accountId = process.env.HEDERA_ACCOUNT_ID?.trim();
  const rawKey = process.env.HEDERA_PRIVATE_KEY?.trim();

  if (!accountId || !rawKey) {
    return { fetchImpl: fetch, paying: false };
  }

  const privateKey = parseHederaKey(rawKey);
  const signer = createClientHederaSigner(accountId, privateKey, { network: NETWORK });
  const client = new x402Client().register(
    NETWORK as `${string}:${string}`,
    new ExactHederaScheme(signer),
  );
  return { fetchImpl: wrapFetchWithPayment(fetch, client), paying: true };
}

/**
 * The Hedera portal shows each key in two encodings. A raw ECDSA key is 64 hex
 * characters; the DER form is longer and starts with an ASN.1 SEQUENCE. Either
 * works here, with or without a 0x prefix.
 */
function parseHederaKey(raw: string): InstanceType<typeof PrivateKey> {
  const text = raw.trim().replace(/^0x/i, '');
  if (text.length > 64 && /^30/.test(text)) return PrivateKey.fromStringDer(text);
  return PrivateKey.fromStringECDSA(text);
}

// --- gateway response shapes --------------------------------------------
//
// Typed explicitly rather than reached for with `any`. The agent is a client of
// a documented API, and writing the contract down here means a gateway change
// that breaks the agent shows up as a compile error instead of a demo failure.

interface DecisionReason {
  code: string;
  message: string;
}

interface GatewayRequest {
  id: string;
  status: string;
  estimatedCostUsd: number;
  query: { resource: string; address: string; lookbackDays: number };
  decision?: { reasons: DecisionReason[] };
}

interface SubmitResponse {
  request?: GatewayRequest;
}

interface HealthResponse {
  modes?: Record<string, string>;
}

interface DataResponse {
  result: {
    data: unknown;
    analysis?: string;
    provenance: { provider: string; simulated: boolean };
  };
  payment: { verifiedBy: string; txHash: string };
  budget: { chargedUsd: number; spentTodayUsd: number };
}

/**
 * The gateway's own errors are `{ error: { code, message } }`. A refusal from
 * the x402 middleware in live payment mode is `{ error: "message" }`. Both are
 * a reason a human can read, so both are handled.
 */
interface ErrorResponse {
  error?: string | { message?: string };
}

function errorMessage(body: ErrorResponse, fallback: string): string {
  if (typeof body.error === 'string') return body.error;
  return body.error?.message ?? fallback;
}

// --- gateway calls -------------------------------------------------------

async function getJson<T>(url: string): Promise<{ status: number; body: T }> {
  const response = await fetch(url);
  const body = (await response.json().catch(() => ({}))) as T;
  return { status: response.status, body };
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const { fetchImpl, paying } = buildFetch();

  console.log(`${BOLD}Faregate demo agent${RESET}`);
  info('gateway', GATEWAY);
  info('agent', args.agent);
  info('wallet', paying ? `${process.env.HEDERA_ACCOUNT_ID} on ${NETWORK}` : 'none configured');

  step('Check what the gateway is running');
  const health = await getJson<HealthResponse>(`${GATEWAY}/health`);
  if (health.status !== 200) {
    fail(`Gateway is not reachable at ${GATEWAY}. Start it with: npm run dev:api`);
    return 1;
  }
  for (const [subsystem, mode] of Object.entries(health.body.modes ?? {})) {
    const marker = mode === 'live' ? `${GREEN}live${RESET}` : `${YELLOW}simulated${RESET}`;
    info(subsystem, marker);
  }
  if (health.body.modes?.payment !== 'live' && paying) {
    warn('This agent has a wallet, but the gateway is not charging. No payment will be made.');
  }

  // --request collects a quote the agent already holds. This is what the demo
  // uses to show revocation: the agent walks up to the gate with a valid,
  // human-approved price quote in hand and is still turned away.
  let request: GatewayRequest | undefined;
  if (args.requestId) {
    step('Present a quote this agent already holds');
    info('request id', args.requestId);
    const existing = await getJson<SubmitResponse>(`${GATEWAY}/requests/${args.requestId}`);
    request = existing.body.request;
    if (!request) {
      fail(`No request ${args.requestId} on this gateway.`);
      return 1;
    }
    info('status', request.status);
    info('price', `$${request.estimatedCostUsd}`);
  } else {
    step('Submit the request');
    info('ask', args.ask);
    const submitResponse = await fetch(`${GATEWAY}/requests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentId: args.agent, prompt: args.ask }),
    });
    const submitted = (await submitResponse.json()) as SubmitResponse;
    request = submitted.request;

    if (!request) {
      fail(`Gateway rejected the submission: ${JSON.stringify(submitted)}`);
      return 1;
    }

    info('request id', request.id);
    info('interpreted', `${request.query.resource} over ${request.query.lookbackDays} day(s)`);
    info('price', `$${request.estimatedCostUsd}`);
    info('status', request.status);

    for (const reason of request.decision?.reasons ?? []) {
      console.log(`   ${DIM}reason        ${reason.code}: ${reason.message}${RESET}`);
    }
  }

  if (request.status === 'rejected') {
    fail('The gateway refused this request. The agent gets nothing and pays nothing.');
    return 2;
  }

  if (request.status === 'awaiting_approval') {
    step('Wait for a human to approve');
    warn('Approve it in the dashboard. The approval is signed by the owner wallet; the agent cannot approve itself.');

    const deadline = Date.now() + args.waitSeconds * 1000;
    let approved = false;
    while (Date.now() < deadline) {
      await sleep(1500);
      const polled = await getJson<SubmitResponse>(`${GATEWAY}/requests/${request.id}`);
      const status = polled.body.request?.status;
      if (status === 'payment_required') { approved = true; break; }
      if (status === 'rejected') {
        fail('A human rejected the request.');
        return 2;
      }
    }
    if (!approved) {
      fail(`No decision within ${args.waitSeconds}s.`);
      return 3;
    }
    ok('Approved by a human.');
  }

  step('Collect the data, paying the fare if one is charged');
  const dataResponse = await fetchImpl(`${GATEWAY}/data/${request.id}`);

  if (dataResponse.status === 403) {
    const body = (await dataResponse.json().catch(() => ({}))) as ErrorResponse;
    fail(`Refused at the gate: ${errorMessage(body, 'forbidden')}`);
    console.log(`   ${DIM}The agent offered to pay and was still turned away.${RESET}`);
    return 4;
  }
  if (!dataResponse.ok) {
    const body = await dataResponse.text();
    fail(`HTTP ${dataResponse.status}: ${body.slice(0, 300)}`);
    return 5;
  }

  const payload = (await dataResponse.json()) as DataResponse;
  ok('Data released.');
  info('provider', payload.result.provenance.provider);
  info(
    'provenance',
    payload.result.provenance.simulated
      ? `${YELLOW}SIMULATED — not a chain fact${RESET}`
      : `${GREEN}live indexed chain data${RESET}`,
  );
  info('charged', `$${payload.budget.chargedUsd}`);
  info('spent today', `$${payload.budget.spentTodayUsd}`);
  info(
    'payment',
    payload.payment.verifiedBy === 'simulated'
      ? `${YELLOW}simulated receipt${RESET}`
      : `${GREEN}${payload.payment.txHash || 'settling'}${RESET} via ${payload.payment.verifiedBy}`,
  );

  if (payload.result.analysis) {
    console.log(`\n${BOLD}Analysis${RESET}`);
    console.log(`${payload.result.analysis}`);
  }

  console.log(`\n${DIM}Raw data:${RESET}`);
  console.log(JSON.stringify(payload.result.data, null, 2).slice(0, 1200));
  return 0;
}

// Set exitCode rather than calling process.exit(). Forcing an exit while the
// HTTP keep-alive handles are still closing trips a libuv assertion on Windows
// and prints a crash line after an otherwise clean run, which is not something
// you want happening in the middle of a demo recording.
main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    fail(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
