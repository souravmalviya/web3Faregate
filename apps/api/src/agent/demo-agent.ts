/**
 * The demo agent.
 *
 * On the hosted testnet demo, a visitor approves a request on the dashboard and
 * expects the data to arrive. Something has to pay for it, and in Faregate that
 * is always the agent, from its own account: never the gateway, never the
 * human. So a hosted gateway can run this demo agent in the same process.
 *
 * It is the same kind of client as `apps/agent`. It lists requests over HTTP
 * and collects each cleared one through the public x402 route, paying from its
 * own Hedera account. The gateway's code paths never see its key; this module
 * holds it, and only to sign its own payments.
 *
 * It collects only for the passports it was given, only requests the policy has
 * cleared (by a human approval, or within every limit), one at a time and each
 * at most once. The gateway re-checks the policy at the gate as it does for any
 * agent, so a revoked passport or a spent daily budget stops it too.
 */

import { wrapFetchWithPayment, x402Client } from '@x402/fetch';
import { ExactHederaScheme, PrivateKey, createClientHederaSigner } from '@x402/hedera';

export interface DemoAgentStatus {
  /** The Hedera account it pays from, or null when payments are simulated. */
  account: string | null;
  /** Passports it collects for. */
  passports: string[];
  /** When it last delivered a request, or null before the first. */
  lastCollectedAt: string | null;
  /** The last thing that went wrong, or null. */
  lastError: string | null;
}

export interface DemoAgentPayer {
  accountId: string;
  /** HEX or DER encoding. Never logged. */
  privateKey: string;
  network: string;
}

export interface DemoAgentOptions {
  /** Where the gateway listens, as seen from this process. */
  gatewayUrl: string;
  passports: readonly string[];
  /** Who pays. Omit when the gateway's payments are simulated and nothing is charged. */
  payer?: DemoAgentPayer;
  /** How often it looks for cleared requests. */
  pollMs?: number;
  /** Injected for tests: the fetch it lists requests with. */
  fetchImpl?: typeof fetch;
  /** Injected for tests: the fetch it collects with, in place of the paying one. */
  collectFetch?: typeof fetch;
  log?: (line: string) => void;
  now?: () => Date;
}

interface ListedRequest {
  id: string;
  agentId: string;
  status: string;
  createdAt: string;
  estimatedCostUsd: number;
  lastRefusal?: unknown;
}

/** How many times a request that failed in transit is tried before it is left alone. */
const MAX_ATTEMPTS = 3;

export class DemoAgent {
  private readonly gatewayUrl: string;
  private readonly passports: Set<string>;
  private readonly account: string | null;
  private readonly pollMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly collectFetch: typeof fetch;
  private readonly log: (line: string) => void;
  private readonly now: () => Date;
  private readonly finished = new Set<string>();
  private readonly attempts = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private lastCollectedAt: string | null = null;
  private lastError: string | null = null;

  /** Throws when the payer's key cannot be read. The message never includes the key. */
  constructor(options: DemoAgentOptions) {
    this.gatewayUrl = options.gatewayUrl.replace(/\/+$/, '');
    this.passports = new Set(options.passports.map((passport) => passport.toLowerCase()));
    this.account = options.payer?.accountId ?? null;
    this.pollMs = options.pollMs ?? 2_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.log = options.log ?? ((line) => console.log(line));
    this.now = options.now ?? (() => new Date());
    this.collectFetch =
      options.collectFetch ?? (options.payer ? payingFetch(this.fetchImpl, options.payer) : this.fetchImpl);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.pollMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  status(): DemoAgentStatus {
    return {
      account: this.account,
      passports: [...this.passports],
      lastCollectedAt: this.lastCollectedAt,
      lastError: this.lastError,
    };
  }

  /** One pass over the gateway's requests. Never throws, and never overlaps another pass. */
  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const listed = await this.fetchImpl(`${this.gatewayUrl}/requests`);
      if (!listed.ok) {
        this.lastError = `listing requests answered HTTP ${listed.status}`;
        return;
      }
      const body = (await listed.json()) as { requests?: ListedRequest[] };
      const due = (body.requests ?? [])
        .filter(
          (request) =>
            this.passports.has(request.agentId.toLowerCase()) &&
            request.status === 'payment_required' &&
            !request.lastRefusal &&
            !this.finished.has(request.id),
        )
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      for (const request of due) {
        if (!(await this.collect(request))) break;
      }
    } catch (error) {
      this.lastError = `could not reach the gateway: ${messageOf(error)}`;
    } finally {
      this.busy = false;
    }
  }

  /** Collects one request. False means the rest of this pass should wait for the next. */
  private async collect(request: ListedRequest): Promise<boolean> {
    let response: Response;
    try {
      response = await this.collectFetch(`${this.gatewayUrl}/data/${request.id}`);
    } catch (error) {
      const tries = (this.attempts.get(request.id) ?? 0) + 1;
      this.attempts.set(request.id, tries);
      if (tries >= MAX_ATTEMPTS) this.finished.add(request.id);
      this.lastError = `collecting ${request.id} failed: ${messageOf(error)}`;
      this.log(`[faregate] agent    ${this.lastError}`);
      return false;
    }

    const text = await response.text().catch(() => '');
    if (response.ok) {
      this.finished.add(request.id);
      this.lastCollectedAt = this.now().toISOString();
      this.lastError = null;
      const transaction = settlementOf(response.headers.get('payment-response'))?.transaction;
      this.log(
        `[faregate] agent    collected ${request.id} for ${request.agentId}, fare $${request.estimatedCostUsd}${transaction ? `, Hedera transaction ${transaction}` : ''}`,
      );
      return true;
    }
    if (response.status === 503 || response.status === 409) {
      // Payments are not open yet, or the request is being collected already.
      return false;
    }
    // Refused at the gate, or a payment the facilitator would not accept. Left
    // alone rather than retried, so a failure never becomes a loop of charges.
    this.finished.add(request.id);
    this.lastError = `collecting ${request.id} answered HTTP ${response.status}: ${reasonOf(text)}`;
    this.log(`[faregate] agent    ${this.lastError}`);
    return true;
  }
}

/** A fetch that answers x402 challenges by signing a Hedera transfer from the payer's account. */
function payingFetch(fetchImpl: typeof fetch, payer: DemoAgentPayer): typeof fetch {
  let key: InstanceType<typeof PrivateKey>;
  try {
    key = parseHederaKey(payer.privateKey);
  } catch {
    throw new Error('the payer key could not be read');
  }
  const signer = createClientHederaSigner(payer.accountId, key, { network: payer.network });
  const client = new x402Client().register(payer.network as `${string}:${string}`, new ExactHederaScheme(signer));
  return wrapFetchWithPayment(fetchImpl, client);
}

/** The Hedera portal shows a key as 64 hex characters (ECDSA) or as a longer DER string. */
function parseHederaKey(raw: string): InstanceType<typeof PrivateKey> {
  const text = raw.trim().replace(/^0x/i, '');
  if (text.length > 64 && /^30/.test(text)) return PrivateKey.fromStringDer(text);
  return PrivateKey.fromStringECDSA(text);
}

function settlementOf(header: string | null): { transaction?: string } | null {
  if (!header) return null;
  try {
    return JSON.parse(Buffer.from(header, 'base64').toString('utf8')) as { transaction?: string };
  } catch {
    return null;
  }
}

function reasonOf(text: string): string {
  try {
    const error = (JSON.parse(text) as { error?: string | { message?: string } }).error;
    return (typeof error === 'string' ? error : error?.message) ?? text.slice(0, 160);
  } catch {
    return text.slice(0, 160);
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
