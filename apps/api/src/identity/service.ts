/**
 * Identity resolution.
 *
 * Every decision in the gateway starts with "who is this agent and what may it
 * do". This service answers that from ENS when ENS is configured and from the
 * local store otherwise, and it is the only place that ordering is decided.
 *
 * When ENS is configured it is the source of truth, and the service fails
 * closed: if the chain cannot be reached, the agent is treated as unknown and
 * the policy engine denies. Falling back to a local copy would let a passport
 * that was revoked onchain keep working until the RPC came back, which is the
 * exact failure the onchain passport exists to prevent.
 */

import type { Agent, AgentId, Policy } from '@faregate/shared';

import { EnsPassportResolver, EnsResolverError } from './ens.ts';
import type { GatewayStore } from '../store.ts';

export interface ResolvedIdentity {
  agent: Agent | null;
  policy: Policy | null;
  /** Where the answer came from, for the audit trail and the dashboard. */
  source: 'ens' | 'local' | 'none';
  /** Set when resolution was refused or degraded, so the reason is recorded. */
  note?: string;
}

export interface IdentityService {
  readonly mode: 'ens' | 'local';
  describe(): string;
  resolve(agentId: AgentId, now?: Date): Promise<ResolvedIdentity>;
  /**
   * Whether the gateway can revoke this passport itself. ENS passports are
   * revoked by their owner onchain, not by an API call.
   */
  canRevokeLocally(agentId: AgentId): boolean;
}

export class LocalIdentityService implements IdentityService {
  readonly mode = 'local' as const;
  private readonly store: GatewayStore;

  constructor(store: GatewayStore) {
    this.store = store;
  }

  describe(): string {
    return 'Local passports from the gateway store. ENS_RPC_URL is not set.';
  }

  async resolve(agentId: AgentId): Promise<ResolvedIdentity> {
    const agent = this.store.getAgent(agentId);
    if (!agent) return { agent: null, policy: null, source: 'none' };
    return { agent, policy: this.store.getPolicy(agentId), source: 'local' };
  }

  canRevokeLocally(): boolean {
    return true;
  }
}

export class EnsIdentityService implements IdentityService {
  readonly mode = 'ens' as const;
  private readonly resolver: EnsPassportResolver;
  private readonly store: GatewayStore;
  private readonly parentName: string;

  constructor(resolver: EnsPassportResolver, store: GatewayStore, parentName: string) {
    this.resolver = resolver;
    this.store = store;
    this.parentName = parentName.toLowerCase();
  }

  describe(): string {
    return `${this.resolver.describe()}; passports under ${this.parentName} fail closed if the chain is unreachable`;
  }

  /** Names under the configured parent are ENS passports by definition. */
  private isPassportName(agentId: AgentId): boolean {
    return agentId.toLowerCase().endsWith(`.${this.parentName}`);
  }

  async resolve(agentId: AgentId, now: Date = new Date()): Promise<ResolvedIdentity> {
    let passport: Awaited<ReturnType<EnsPassportResolver['resolve']>>;
    try {
      passport = await this.resolver.resolve(agentId, now);
    } catch (error) {
      const message = error instanceof EnsResolverError ? error.message : 'ENS resolution failed.';
      if (this.isPassportName(agentId)) {
        // Fail closed. The chain is the source of truth for this name.
        return { agent: null, policy: null, source: 'none', note: `ens_unavailable: ${message}` };
      }
      // A name outside the passport namespace was never going to resolve on
      // ENS in a way we trust, so a local record may still answer for it.
      return this.local(agentId, `ens_unavailable: ${message}`);
    }

    if (passport) {
      // Keep a display copy so the dashboard can list passports it has seen.
      // Decisions never read this copy; they re-resolve live every time.
      this.store.putAgent(passport.agent);
      this.store.putPolicy(passport.policy);
      return { agent: passport.agent, policy: passport.policy, source: 'ens' };
    }

    if (this.isPassportName(agentId)) {
      // The chain answered and there is no passport. A local row must not
      // resurrect it.
      return { agent: null, policy: null, source: 'none', note: 'no_passport_on_ens' };
    }

    return this.local(agentId);
  }

  private local(agentId: AgentId, note?: string): ResolvedIdentity {
    const agent = this.store.getAgent(agentId);
    if (!agent || agent.source === 'ens') {
      return { agent: null, policy: null, source: 'none', ...(note ? { note } : {}) };
    }
    return {
      agent,
      policy: this.store.getPolicy(agentId),
      source: 'local',
      ...(note ? { note } : {}),
    };
  }

  canRevokeLocally(agentId: AgentId): boolean {
    if (this.isPassportName(agentId)) return false;
    const agent = this.store.getAgent(agentId);
    return agent?.source !== 'ens';
  }
}
