/**
 * ENS passports.
 *
 * An agent's identity in Faregate is an ENS name, and the capability attached
 * to it lives in that name's text records. This is what makes revocation a
 * real onchain act rather than a row update: the owner sets
 * `faregate.status` to `revoked`, or unregisters the subname outright, and the
 * gateway refuses the agent at its next request because the passport no longer
 * says what it used to.
 *
 * Resolution goes through the ENSv2 Universal Resolver on Sepolia, so the
 * gateway reads the same view any wallet would. Nothing here is written to the
 * chain; the human writes records with their own wallet, and the gateway only
 * reads them.
 *
 * Text record keys, all namespaced under `faregate.`:
 *
 *   faregate.status              active | revoked
 *   faregate.label               human-readable name for the dashboard
 *   faregate.scope               comma-separated resource kinds
 *   faregate.max_per_query_usd   decimal string
 *   faregate.daily_limit_usd     decimal string
 *   faregate.approval_above_usd  decimal string
 *   faregate.expires_at          ISO 8601, or empty for no expiry
 */

import { createPublicClient, http, type Address as EvmAddress, type PublicClient } from 'viem';
import { sepolia } from 'viem/chains';
import { normalize } from 'viem/ens';

import {
  isResourceKind,
  type Address,
  type Agent,
  type Policy,
  type ResourceKind,
} from '@faregate/shared';

/**
 * ENSv2 beta Universal Resolver on Sepolia, from the ENS deployments page.
 * viem's chain config points at the v1 resolver, so this is passed explicitly.
 */
export const ENSV2_SEPOLIA_UNIVERSAL_RESOLVER: EvmAddress =
  '0x4a1817d13e9cf196f471725176355c1234b63c70';

export const TEXT_KEYS = {
  status: 'faregate.status',
  label: 'faregate.label',
  scope: 'faregate.scope',
  maxPerQuery: 'faregate.max_per_query_usd',
  dailyLimit: 'faregate.daily_limit_usd',
  approvalAbove: 'faregate.approval_above_usd',
  expiresAt: 'faregate.expires_at',
} as const;

export interface EnsPassport {
  agent: Agent;
  policy: Policy;
}

export interface EnsResolverOptions {
  rpcUrl: string;
  universalResolverAddress?: EvmAddress;
  /** Injected for tests. */
  client?: PublicClient;
  timeoutMs?: number;
}

export class EnsResolverError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'EnsResolverError';
    this.code = code;
  }
}

function parseUsd(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseScope(value: string | null): ResourceKind[] {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(isResourceKind);
}

function parseExpiry(value: string | null): string | null {
  if (!value) return null;
  const ts = Date.parse(value);
  return Number.isNaN(ts) ? null : new Date(ts).toISOString();
}

/**
 * Reads agent passports from ENS.
 *
 * Every call resolves live. Caching would be cheaper, but it would also mean a
 * revoked passport could keep working until the cache expired, which defeats
 * the point of putting revocation onchain.
 */
export class EnsPassportResolver {
  private readonly client: PublicClient;
  private readonly universalResolverAddress: EvmAddress;
  private readonly rpcUrl: string;

  constructor(options: EnsResolverOptions) {
    this.rpcUrl = options.rpcUrl;
    this.universalResolverAddress =
      options.universalResolverAddress ?? ENSV2_SEPOLIA_UNIVERSAL_RESOLVER;
    this.client =
      options.client ??
      createPublicClient({
        chain: sepolia,
        transport: http(options.rpcUrl, { timeout: options.timeoutMs ?? 10_000 }),
      });
  }

  describe(): string {
    return `ENSv2 on Sepolia via ${redactRpc(this.rpcUrl)}, resolver ${this.universalResolverAddress}`;
  }

  private async text(name: string, key: string): Promise<string | null> {
    return this.client.getEnsText({
      name,
      key,
      universalResolverAddress: this.universalResolverAddress,
    });
  }

  /**
   * Resolves a passport, or returns null when the name does not resolve to a
   * Faregate passport at all. Throws only on infrastructure failure, so the
   * caller can distinguish "no such agent" from "could not check".
   */
  async resolve(agentId: string, now: Date = new Date()): Promise<EnsPassport | null> {
    let name: string;
    try {
      name = normalize(agentId);
    } catch {
      return null;
    }

    let owner: EvmAddress | null;
    let status: string | null;
    try {
      [owner, status] = await Promise.all([
        this.client.getEnsAddress({
          name,
          universalResolverAddress: this.universalResolverAddress,
        }),
        this.text(name, TEXT_KEYS.status),
      ]);
    } catch (error) {
      throw new EnsResolverError(
        'rpc_error',
        `ENS resolution failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // A name with no Faregate status record is not a passport, even if it is a
    // perfectly good ENS name. Refusing here means a stranger's name cannot be
    // used as an agent identity by accident.
    if (!status) return null;

    const [label, scope, maxPerQuery, dailyLimit, approvalAbove, expiresAt] = await Promise.all([
      this.text(name, TEXT_KEYS.label),
      this.text(name, TEXT_KEYS.scope),
      this.text(name, TEXT_KEYS.maxPerQuery),
      this.text(name, TEXT_KEYS.dailyLimit),
      this.text(name, TEXT_KEYS.approvalAbove),
      this.text(name, TEXT_KEYS.expiresAt),
    ]);

    const expiry = parseExpiry(expiresAt);
    const expired = expiry !== null && Date.parse(expiry) <= now.getTime();

    const agent: Agent = {
      id: name,
      label: label ?? name,
      owner: (owner ?? '0x0000000000000000000000000000000000000000') as Address,
      status: status.trim().toLowerCase() === 'revoked' ? 'revoked' : expired ? 'expired' : 'active',
      createdAt: now.toISOString(),
      expiresAt: expiry,
      source: 'ens',
    };

    const policy: Policy = {
      agentId: name,
      allowedResources: parseScope(scope),
      // Conservative defaults: a passport with no limit records gets no budget.
      maxCostPerQueryUsd: parseUsd(maxPerQuery, 0),
      dailyLimitUsd: parseUsd(dailyLimit, 0),
      humanApprovalAboveUsd: parseUsd(approvalAbove, 0),
      expiresAt: expiry,
    };

    return { agent, policy };
  }
}

/** Keeps API keys embedded in RPC URLs out of logs and /health. */
function redactRpc(url: string): string {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/').filter(Boolean);
    const redactedPath = segments
      .map((segment) => (segment.length >= 20 ? `${segment.slice(0, 4)}…` : segment))
      .join('/');
    return `${parsed.protocol}//${parsed.host}/${redactedPath}`;
  } catch {
    return 'rpc';
  }
}
