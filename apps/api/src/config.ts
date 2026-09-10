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
  reason?: string;
}

export interface EnsConfig {
  mode: SubsystemMode;
  rpcUrl: string | undefined;
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
  corsOrigin: string;
  /**
   * Whether approve, reject, revoke, policy and agent-creation calls must
   * carry a wallet signature. On by default; off only for local experiments.
   */
  requireSignedActions: boolean;
  /** Snapshot file for gateway state, or null to keep everything in memory. */
  stateFile: string | null;
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

function loadAi(): AiConfig {
  const apiKey = str('OPENROUTER_API_KEY');
  const model = str('OPENROUTER_MODEL') ?? DEFAULT_AI_MODEL;
  if (!apiKey) {
    return {
      mode: 'simulated',
      apiKey,
      model,
      reason: 'OPENROUTER_API_KEY is not set, so requests are parsed by the rule-based fallback.',
    };
  }
  return { mode: 'live', apiKey, model };
}

function loadEns(): EnsConfig {
  const rpcUrl = str('ENS_RPC_URL');
  const parentName = str('FAREGATE_PARENT_NAME') ?? 'agents.faregate.eth';
  const universalResolver = str('ENS_UNIVERSAL_RESOLVER');
  if (!rpcUrl) {
    return {
      mode: 'simulated',
      rpcUrl,
      parentName,
      universalResolver,
      reason: 'ENS_RPC_URL is not set, so passports resolve from the local store.',
    };
  }
  return { mode: 'live', rpcUrl, parentName, universalResolver };
}

function loadStateFile(): string | null {
  const raw = str('FAREGATE_STATE_FILE') ?? 'data/faregate-state.json';
  if (['off', 'none', 'memory'].includes(raw.toLowerCase())) return null;
  return path.isAbsolute(raw) ? raw : path.resolve(REPO_ROOT, raw);
}

export function loadConfig(): AppConfig {
  return {
    port: int('PORT', 8402),
    corsOrigin: str('FAREGATE_CORS_ORIGIN') ?? 'http://localhost:3000',
    requireSignedActions: bool('FAREGATE_REQUIRE_SIGNED_ACTIONS', true),
    stateFile: loadStateFile(),
    rateLimit: {
      requestsPerMinute: Math.max(1, int('FAREGATE_RATE_LIMIT_REQUESTS_PER_MINUTE', 60)),
      actionsPerMinute: Math.max(1, int('FAREGATE_RATE_LIMIT_ACTIONS_PER_MINUTE', 30)),
    },
    payment: loadPayment(),
    data: loadData(),
    ai: loadAi(),
    ens: loadEns(),
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
