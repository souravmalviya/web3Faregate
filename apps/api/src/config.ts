/**
 * Gateway configuration.
 *
 * Every external dependency in Faregate can be missing, and the gateway is
 * designed to start and run when they are. What it will not do is pretend: each
 * subsystem reports whether it is `live` or `simulated`, that mode travels with
 * the data through provenance and receipts, and the dashboard and the API both
 * render it. A judge should never have to guess whether a transaction hash on
 * screen is real.
 */

import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Load .env from the repository root rather than the process cwd, so the
// gateway behaves the same whether it is started from the root, from apps/api,
// or by a launcher with an unrelated working directory.
loadDotenv({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env') });

export type SubsystemMode = 'live' | 'simulated';

function str(name: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function int(name: string, fallback: number): number {
  const raw = str(name);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = str(name)?.toLowerCase();
  if (raw === undefined) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return fallback;
}

/** The repository root, which relative paths in the environment resolve against. */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** Hedera testnet CAIP-2 identifier, as defined by @x402/hedera. */
export const HEDERA_TESTNET = 'hedera:testnet';

/**
 * Blocky402's hosted facilitators. Testnet and mainnet run on separate hosts,
 * and each host's /supported lists only its own network, so the default has to
 * follow the configured network.
 */
export const BLOCKY402_TESTNET = 'https://api.testnet.blocky402.com';
export const BLOCKY402_MAINNET = 'https://api.blocky402.com';

export function defaultFacilitator(network: string): string {
  return network === 'hedera:mainnet' ? BLOCKY402_MAINNET : BLOCKY402_TESTNET;
}

/** Asset id x402 uses for native HBAR. */
export const HBAR_ASSET = '0.0.0';

/**
 * USDC on Hedera testnet, six decimals.
 *
 * This is the default fare asset because six decimals makes it exactly 1:1 with
 * the micro-USD unit the gateway prices in, so a price becomes an atomic amount
 * with no conversion and no exchange rate. Charging in native HBAR would need a
 * price oracle, and a hardcoded rate would put an invented number on screen.
 */
export const USDC_TESTNET_ASSET = '0.0.429274';

export interface PaymentConfig {
  mode: SubsystemMode;
  /** CAIP-2 network the gateway prices and settles in. */
  network: string;
  /** Facilitator base URL used for /verify and /settle. */
  facilitatorUrl: string;
  /** Hedera account that receives fares, for example `0.0.12345`. */
  payTo: string | undefined;
  /** HTS token id, or `0.0.0` for native HBAR. */
  asset: string;
  /** How long a quoted price stays valid. */
  maxTimeoutSeconds: number;
  /** Why the subsystem is simulated, when it is. Surfaced in the API. */
  reason?: string;
}

export interface DataConfig {
  mode: SubsystemMode;
  /** Gateway API key from Subgraph Studio. */
  graphApiKey: string | undefined;
  /**
   * `protocol=idOrUrl,protocol=idOrUrl`. Every protocol listed here publishes
   * the Messari standard schema, so one document queries all of them.
   */
  subgraphs: string | undefined;
  reason?: string;
}

export interface AiConfig {
  mode: SubsystemMode;
  apiKey: string | undefined;
  model: string;
  /**
   * Model calls allowed in any rolling hour, whoever asks. Request submission
   * is open to every agent that can reach the gateway, so on a public host this
   * is what caps the model bill.
   */
  callsPerHour: number;
  reason?: string;
}

export interface EnsConfig {
  mode: SubsystemMode;
  /** Sepolia RPCs in order. When one fails, a call moves on to the next. */
  rpcUrls: string[];
  /** Parent name that agent passports live under. */
  parentName: string;
  /** Override for the ENSv2 Universal Resolver address. */
  universalResolver: string | undefined;
  reason?: string;
}

export interface RateLimitConfig {
  /** Requests each agent may submit per minute. */
  requestsPerMinute: number;
  /** Human actions each caller may perform per minute. */
  actionsPerMinute: number;
}

export interface AppConfig {
  port: number;
  /**
   * Browser origins allowed to call the gateway: exact origins, or patterns in
   * which `*` stands for one DNS label. See `parseCorsOrigins`.
   */
  corsOrigins: string[];
  /** Entries in FAREGATE_CORS_ORIGIN that were not usable, reported at startup. */
  corsIgnored?: IgnoredOrigin[];
  /**
   * Trust the first X-Forwarded-For hop. Needed behind a hosting provider's
   * proxy, otherwise every caller shares the proxy's address and one per-caller
   * rate limit covers the whole internet.
   */
  trustProxy?: boolean;
  /**
   * Whether approve, reject, revoke, policy and agent-creation calls must
   * carry a wallet signature. On by default; off only for local experiments.
   */
  requireSignedActions: boolean;
  /** Snapshot file for gateway state, or null to keep everything in memory. */
  stateFile: string | null;
  /** An address the gateway visits every ten minutes to stay awake, or null. See `keepAwakeTarget`. */
  keepAwakeUrl?: string | null;
  /** The demo agent that pays for cleared requests on a hosted demo. See `resolveDemoAgent`. */
  demoAgent?: DemoAgentConfig;
  rateLimit: RateLimitConfig;
  payment: PaymentConfig;
  data: DataConfig;
  ai: AiConfig;
  ens: EnsConfig;
}

function loadPayment(): PaymentConfig {
  const payTo = str('FAREGATE_PAY_TO');
  const network = str('FAREGATE_NETWORK') ?? HEDERA_TESTNET;
  const base = {
    network,
    facilitatorUrl: str('X402_FACILITATOR_URL') ?? defaultFacilitator(network),
    payTo,
    asset: str('FAREGATE_ASSET') ?? USDC_TESTNET_ASSET,
    maxTimeoutSeconds: int('FAREGATE_PAYMENT_TIMEOUT_SECONDS', 120),
  };
  if (!payTo) {
    return {
      ...base,
      mode: 'simulated',
      reason: 'FAREGATE_PAY_TO is not set, so no Hedera account can receive a fare.',
    };
  }
  return { ...base, mode: 'live' };
}

function loadData(): DataConfig {
  const graphApiKey = str('GRAPH_API_KEY');
  // Accept the multi-protocol form, or a single id/url as a one-entry list.
  const subgraphs =
    str('GRAPH_SUBGRAPHS')
    ?? (str('GRAPH_SUBGRAPH_URL') ? `default=${str('GRAPH_SUBGRAPH_URL')}` : undefined)
    ?? (str('GRAPH_SUBGRAPH_ID') ? `default=${str('GRAPH_SUBGRAPH_ID')}` : undefined);
  if (!subgraphs) {
    return {
      mode: 'simulated',
      graphApiKey,
      subgraphs,
      reason: 'GRAPH_SUBGRAPHS is not set, so no subgraph can be queried.',
    };
  }
  if (!graphApiKey) {
    return {
      mode: 'simulated',
      graphApiKey,
      subgraphs,
      reason: 'GRAPH_API_KEY is not set, so the Graph gateway would refuse the query.',
    };
  }
  return { mode: 'live', graphApiKey, subgraphs };
}

/**
 * Default OpenRouter model. It supports strict structured outputs and does not
 * spend reasoning tokens, which keeps each Faregate request well under a cent.
 */
export const DEFAULT_AI_MODEL = 'openai/gpt-4.1-mini';

/** Enough for a hundred requests an hour at three model calls each. */
export const DEFAULT_AI_CALLS_PER_HOUR = 300;

function loadAi(): AiConfig {
  const apiKey = str('OPENROUTER_API_KEY');
  const model = str('OPENROUTER_MODEL') ?? DEFAULT_AI_MODEL;
  const callsPerHour = Math.max(1, int('FAREGATE_AI_CALLS_PER_HOUR', DEFAULT_AI_CALLS_PER_HOUR));
  if (!apiKey) {
    return {
      mode: 'simulated',
      apiKey,
      model,
      callsPerHour,
      reason: 'OPENROUTER_API_KEY is not set, so requests are parsed by the rule-based fallback.',
    };
  }
  return { mode: 'live', apiKey, model, callsPerHour };
}

/** ENS_RPC_URL: one Sepolia RPC, or several comma-separated to fall back through in order. */
export function parseRpcUrls(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);
}

function loadEns(): EnsConfig {
  const rpcUrls = parseRpcUrls(str('ENS_RPC_URL'));
  const parentName = str('FAREGATE_PARENT_NAME') ?? 'agents.faregate.eth';
  const universalResolver = str('ENS_UNIVERSAL_RESOLVER');
  if (rpcUrls.length === 0) {
    return {
      mode: 'simulated',
      rpcUrls,
      parentName,
      universalResolver,
      reason: 'ENS_RPC_URL is not set, so passports resolve from the local store.',
    };
  }
  return { mode: 'live', rpcUrls, parentName, universalResolver };
}

function loadStateFile(): string | null {
  const raw = str('FAREGATE_STATE_FILE') ?? 'data/faregate-state.json';
  if (['off', 'none', 'memory'].includes(raw.toLowerCase())) return null;
  return path.isAbsolute(raw) ? raw : path.resolve(REPO_ROOT, raw);
}

/**
 * The address a hosted gateway visits so it is not put to sleep.
 *
 * A free Render instance sleeps after 15 minutes without inbound traffic, and
 * sleeping empties the request queue and the ledger. Render sets
 * RENDER_EXTERNAL_URL on every web service, and a request to that public
 * address comes back in through Render's edge, which counts as traffic.
 * FAREGATE_KEEP_AWAKE_URL names another address, or turns this off with `off`.
 */
export function keepAwakeTarget(explicit: string | undefined, renderExternalUrl: string | undefined): string | null {
  if (explicit) return ['off', 'none', 'false'].includes(explicit.toLowerCase()) ? null : explicit;
  if (!renderExternalUrl) return null;
  return `${renderExternalUrl.replace(/\/+$/, '')}/health`;
}

export const DEFAULT_CORS_ORIGIN = 'http://localhost:3000';

export interface IgnoredOrigin {
  entry: string;
  reason: string;
}

/** Scheme, host and optional port, with `*` allowed inside host labels. */
const ORIGIN_PATTERN_RE = /^https?:\/\/[a-z0-9*-]+(\.[a-z0-9*-]+)*(:\d{1,5})?$/;

/** A `*` that is a whole label, as in `https://*.vercel.app`. */
const WHOLE_LABEL_WILDCARD_RE = /(\/\/|\.)\*(\.|:|$)/;

/**
 * Reads FAREGATE_CORS_ORIGIN: comma-separated origins, each optionally with a
 * `*` standing for one DNS label, so every deployment address of one Vercel
 * project can be allowed with one entry.
 *
 * A browser sends its origin as lowercase scheme and host with no path, so each
 * entry is lowercased and a trailing slash dropped: pasting
 * `https://faregate.vercel.app/` from the address bar must not lock the
 * dashboard out. An entry that is still not an origin, such as a URL with a
 * path, or a wildcard broad enough to admit every site on a shared domain, is
 * returned in `ignored` so the startup log says why, instead of silently never
 * matching.
 */
export function parseCorsOrigins(raw: string | undefined): { origins: string[]; ignored: IgnoredOrigin[] } {
  const origins: string[] = [];
  const ignored: IgnoredOrigin[] = [];
  for (const entry of (raw ?? DEFAULT_CORS_ORIGIN).split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const candidate = trimmed.toLowerCase().replace(/\/+$/, '');
    if (!ORIGIN_PATTERN_RE.test(candidate)) {
      ignored.push({ entry: trimmed, reason: 'an origin is a scheme and host only, like https://faregate.vercel.app' });
    } else if (WHOLE_LABEL_WILDCARD_RE.test(candidate)) {
      ignored.push({
        entry: trimmed,
        reason: 'a * must sit inside a label, like https://faregate-*.vercel.app; on its own it would admit every site on that domain',
      });
    } else {
      origins.push(candidate);
    }
  }
  return { origins, ignored };
}

/**
 * The list the CORS middleware matches a request's Origin against: exact
 * strings, and a RegExp for each pattern in which `*` matches one DNS label and
 * never a dot, so `https://faregate-*.vercel.app` cannot match
 * `https://faregate-x.attacker.vercel.app`.
 */
export function corsAllowList(origins: readonly string[]): Array<string | RegExp> {
  return origins.map((origin) => {
    if (!origin.includes('*')) return origin;
    const source = origin
      .split('*')
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('[a-z0-9-]+');
    return new RegExp(`^${source}$`);
  });
}

export interface DemoAgentConfig {
  /** True when the demo agent will run. */
  enabled: boolean;
  /** True when FAREGATE_DEMO_AGENT asked for it, whether or not it can run. */
  requested: boolean;
  /** Passports it collects for, lowercase. */
  passports: string[];
  /** The Hedera account it pays from. Its key is never part of the config. */
  accountId: string | undefined;
  /** Why it is not running, when it was asked for. */
  reason?: string;
}

export interface DemoAgentInput {
  requested: boolean;
  paymentMode: SubsystemMode;
  network: string;
  accountId: string | undefined;
  hasKey: boolean;
  passports: string | undefined;
  parentName: string;
}

/**
 * Whether the demo agent runs, and for which passports.
 *
 * The demo agent lets a hosted gateway complete a visitor's approval in one
 * click (see agent/demo-agent.ts). It is off unless FAREGATE_DEMO_AGENT asks
 * for it. With live payments it needs the agent's account and key, and it
 * refuses any network but Hedera testnet, so it can never spend real money.
 * By default it collects for the two demo passports under the parent name.
 */
export function resolveDemoAgent(input: DemoAgentInput): DemoAgentConfig {
  const passports = (input.passports ?? `research.${input.parentName},trial.${input.parentName}`)
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  const base = { requested: input.requested, passports, accountId: input.accountId };
  if (!input.requested) return { ...base, enabled: false };
  if (input.paymentMode === 'live') {
    if (input.network !== HEDERA_TESTNET) {
      return {
        ...base,
        enabled: false,
        reason: `the demo agent only pays on ${HEDERA_TESTNET}, and this gateway settles on ${input.network}`,
      };
    }
    if (!input.accountId || !input.hasKey) {
      return { ...base, enabled: false, reason: 'HEDERA_ACCOUNT_ID and HEDERA_PRIVATE_KEY are needed for the demo agent to pay' };
    }
  }
  if (passports.length === 0) {
    return { ...base, enabled: false, reason: 'FAREGATE_DEMO_AGENT_PASSPORTS lists no passports' };
  }
  return { ...base, enabled: true };
}

export function loadConfig(): AppConfig {
  const cors = parseCorsOrigins(str('FAREGATE_CORS_ORIGIN'));
  const payment = loadPayment();
  const ens = loadEns();
  return {
    port: int('PORT', 8402),
    corsOrigins: cors.origins,
    corsIgnored: cors.ignored,
    trustProxy: bool('FAREGATE_TRUST_PROXY', false),
    requireSignedActions: bool('FAREGATE_REQUIRE_SIGNED_ACTIONS', true),
    stateFile: loadStateFile(),
    keepAwakeUrl: keepAwakeTarget(str('FAREGATE_KEEP_AWAKE_URL'), str('RENDER_EXTERNAL_URL')),
    rateLimit: {
      requestsPerMinute: Math.max(1, int('FAREGATE_RATE_LIMIT_REQUESTS_PER_MINUTE', 60)),
      actionsPerMinute: Math.max(1, int('FAREGATE_RATE_LIMIT_ACTIONS_PER_MINUTE', 30)),
    },
    payment,
    data: loadData(),
    ai: loadAi(),
    ens,
    demoAgent: resolveDemoAgent({
      requested: bool('FAREGATE_DEMO_AGENT', false),
      paymentMode: payment.mode,
      network: payment.network,
      accountId: str('HEDERA_ACCOUNT_ID'),
      hasKey: Boolean(str('HEDERA_PRIVATE_KEY')),
      passports: str('FAREGATE_DEMO_AGENT_PASSPORTS'),
      parentName: ens.parentName,
    }),
  };
}

/** One-line readiness summary for logs and the /health endpoint. */
export function describeModes(config: AppConfig): Record<string, SubsystemMode> {
  return {
    payment: config.payment.mode,
    data: config.data.mode,
    ai: config.ai.mode,
    ens: config.ens.mode,
  };
}
