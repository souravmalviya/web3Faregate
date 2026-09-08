/**
 * In-memory gateway state.
 *
 * A hackathon MVP does not need Postgres to make its point, and a database
 * would add setup friction to the demo without changing the architecture. What
 * this store does need to get right is the parts that carry security meaning:
 * the spend ledger, nonce replay protection, and an append-only audit log.
 *
 * Everything here is deliberately behind one class so that swapping in a real
 * database later is a single-file change.
 */

import { randomUUID } from 'node:crypto';
import type {
  AccessRequest,
  Agent,
  AgentId,
  AuditEvent,
  AuditEventType,
  Policy,
} from '@faregate/shared';

/** UTC day key, so daily limits reset at a defined instant rather than local midnight. */
export function utcDayKey(at: Date): string {
  return at.toISOString().slice(0, 10);
}

export interface CreateAuditEvent {
  type: AuditEventType;
  actor: AuditEvent['actor'];
  agentId?: AgentId;
  requestId?: string;
  detail?: Record<string, unknown>;
}

export class GatewayStore {
  private readonly agents = new Map<AgentId, Agent>();
  private readonly policies = new Map<AgentId, Policy>();
  private readonly requests = new Map<string, AccessRequest>();
  private readonly audit: AuditEvent[] = [];

  /** `${agentId}|${utcDay}` to micro-USD spent. */
  private readonly spend = new Map<string, number>();

  /** Payment nonces already consumed, for replay protection. */
  private readonly usedNonces = new Set<string>();

  /** Caller-supplied idempotency key to the request id it created. */
  private readonly idempotency = new Map<string, string>();

  // --- agents ------------------------------------------------------------

  listAgents(): Agent[] {
    return [...this.agents.values()].sort((a, b) => a.label.localeCompare(b.label));
  }

  getAgent(id: AgentId): Agent | null {
    return this.agents.get(id) ?? null;
  }

  putAgent(agent: Agent): Agent {
    this.agents.set(agent.id, agent);
    return agent;
  }

  /**
   * Marks a passport revoked. Returns the updated agent, or null when the
   * passport is unknown. Revocation is intentionally irreversible through this
   * API: re-granting access means issuing a new passport, which is also how the
   * ENS-backed path behaves.
   */
  revokeAgent(id: AgentId): Agent | null {
    const existing = this.agents.get(id);
    if (!existing) return null;
    const revoked: Agent = { ...existing, status: 'revoked' };
    this.agents.set(id, revoked);
    return revoked;
  }

  // --- policies ----------------------------------------------------------

  getPolicy(agentId: AgentId): Policy | null {
    return this.policies.get(agentId) ?? null;
  }

  putPolicy(policy: Policy): Policy {
    this.policies.set(policy.agentId, policy);
    return policy;
  }

  // --- requests ----------------------------------------------------------

  listRequests(limit = 100): AccessRequest[] {
    return [...this.requests.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  getRequest(id: string): AccessRequest | null {
    return this.requests.get(id) ?? null;
  }

  putRequest(request: AccessRequest): AccessRequest {
    this.requests.set(request.id, request);
    return request;
  }

  updateRequest(
    id: string,
    patch: Partial<AccessRequest>,
    at: Date = new Date(),
  ): AccessRequest | null {
    const existing = this.requests.get(id);
    if (!existing) return null;
    const updated: AccessRequest = { ...existing, ...patch, updatedAt: at.toISOString() };
    this.requests.set(id, updated);
    return updated;
  }

  // --- spend ledger ------------------------------------------------------

  spentTodayMicros(agentId: AgentId, at: Date = new Date()): number {
    return this.spend.get(`${agentId}|${utcDayKey(at)}`) ?? 0;
  }

  /**
   * Records spend against an agent's daily budget.
   *
   * Called only after a payment has been verified, never at quote time. If it
   * were called when the price was quoted, an agent could exhaust its own
   * budget by requesting quotes it never pays for.
   */
  recordSpend(agentId: AgentId, micros: number, at: Date = new Date()): number {
    if (micros <= 0) return this.spentTodayMicros(agentId, at);
    const key = `${agentId}|${utcDayKey(at)}`;
    const next = (this.spend.get(key) ?? 0) + Math.floor(micros);
    this.spend.set(key, next);
    return next;
  }

  // --- replay protection -------------------------------------------------

  /**
   * Consumes a payment nonce.
   *
   * Returns false when the nonce has been seen before, which means the caller
   * is replaying a payment that was already settled. The check and the insert
   * happen together so two concurrent requests cannot both win.
   */
  consumeNonce(nonce: string): boolean {
    if (this.usedNonces.has(nonce)) return false;
    this.usedNonces.add(nonce);
    return true;
  }

  hasConsumedNonce(nonce: string): boolean {
    return this.usedNonces.has(nonce);
  }

  /** Returns the request id a previous call with this idempotency key created. */
  lookupIdempotent(key: string): string | null {
    return this.idempotency.get(key) ?? null;
  }

  rememberIdempotent(key: string, requestId: string): void {
    this.idempotency.set(key, requestId);
  }

  // --- audit -------------------------------------------------------------

  /**
   * Appends an audit event. The log is append-only: nothing in this class
   * mutates or deletes an event once written.
   */
  recordEvent(event: CreateAuditEvent, at: Date = new Date()): AuditEvent {
    const stored: AuditEvent = {
      id: randomUUID(),
      at: at.toISOString(),
      type: event.type,
      actor: event.actor,
      detail: event.detail ?? {},
      ...(event.agentId ? { agentId: event.agentId } : {}),
      ...(event.requestId ? { requestId: event.requestId } : {}),
    };
    this.audit.push(stored);
    return stored;
  }

  listEvents(limit = 200): AuditEvent[] {
    return this.audit.slice(-limit).reverse();
  }
}

/**
 * Seeds the two passports the demo uses.
 *
 * The contrast between them is the point: the research agent has a real budget
 * and an approval threshold low enough that a normal query needs a human, while
 * the trial agent is scoped to one cheap resource and can act alone inside a
 * tiny budget.
 */
export function seedDemoData(store: GatewayStore, now: Date = new Date()): void {
  const owner = '0x0000000000000000000000000000000000000000' as const;
  const createdAt = now.toISOString();

  store.putAgent({
    id: 'research.agents.faregate.eth',
    label: 'Treasury Research Agent',
    owner,
    status: 'active',
    createdAt,
    expiresAt: null,
    source: 'local',
  });
  store.putPolicy({
    agentId: 'research.agents.faregate.eth',
    allowedResources: ['wallet.balances', 'wallet.transfers', 'wallet.activity'],
    maxCostPerQueryUsd: 0.1,
    dailyLimitUsd: 1,
    humanApprovalAboveUsd: 0.02,
    expiresAt: null,
  });

  store.putAgent({
    id: 'trial.agents.faregate.eth',
    label: 'Trial Scout Agent',
    owner,
    status: 'active',
    createdAt,
    expiresAt: null,
    source: 'local',
  });
  store.putPolicy({
    agentId: 'trial.agents.faregate.eth',
    allowedResources: ['wallet.balances'],
    maxCostPerQueryUsd: 0.015,
    dailyLimitUsd: 0.05,
    humanApprovalAboveUsd: 0.05,
    expiresAt: null,
  });
}
