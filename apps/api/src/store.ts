/**
 * Gateway state.
 *
 * A hackathon MVP does not need Postgres to make its point, and a database
 * would add setup friction to the demo without changing the architecture. What
 * this store does need to get right is the parts that carry security meaning:
 * the spend ledger, nonce replay protection, and an append-only audit log.
 *
 * State lives in memory and, when a file is configured, is snapshotted to disk
 * after every change and loaded back on start. That is enough for a gateway
 * restart mid-demo to keep its queue, its spend and, above all, its
 * revocations: a passport revoked before a restart stays revoked after it.
 *
 * Everything is behind one class so that swapping in a real database later is
 * a single-file change.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
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

export interface StoreOptions {
  /** Snapshot file. Omit for a purely in-memory store, as the tests use. */
  file?: string;
}

/** The on-disk shape. Versioned so a future migration has something to check. */
interface Snapshot {
  version: 1;
  savedAt: string;
  agents: Agent[];
  policies: Policy[];
  requests: AccessRequest[];
  audit: AuditEvent[];
  spend: Array<[string, number]>;
  usedNonces: string[];
  idempotency: Array<[string, string]>;
}

/** Audit events kept in memory. Older ones are dropped from the head, never edited. */
const AUDIT_CAP = 10_000;

/** How long after a change the snapshot is written. Coalesces bursts of writes. */
const SAVE_DELAY_MS = 50;

export class GatewayStore {
  private readonly agents = new Map<AgentId, Agent>();
  private readonly policies = new Map<AgentId, Policy>();
  private readonly requests = new Map<string, AccessRequest>();
  private audit: AuditEvent[] = [];

  /** `${agentId}|${utcDay}` to micro-USD spent. */
  private readonly spend = new Map<string, number>();

  /** Payment nonces and signature digests already consumed, for replay protection. */
  private readonly usedNonces = new Set<string>();

  /** Caller-supplied idempotency key to the request id it created. */
  private readonly idempotency = new Map<string, string>();

  private readonly file: string | null;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(options: StoreOptions = {}) {
    this.file = options.file ?? null;
    if (this.file) this.load();
  }

  // --- agents ------------------------------------------------------------

  listAgents(): Agent[] {
    return [...this.agents.values()].sort((a, b) => a.label.localeCompare(b.label));
  }

  getAgent(id: AgentId): Agent | null {
    return this.agents.get(id) ?? null;
  }

  putAgent(agent: Agent): Agent {
    this.agents.set(agent.id, agent);
    this.markDirty();
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
    this.markDirty();
    return revoked;
  }

  // --- policies ----------------------------------------------------------

  getPolicy(agentId: AgentId): Policy | null {
    return this.policies.get(agentId) ?? null;
  }

  putPolicy(policy: Policy): Policy {
    this.policies.set(policy.agentId, policy);
    this.markDirty();
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
    this.markDirty();
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
    this.markDirty();
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
    this.markDirty();
    return next;
  }

  // --- replay protection -------------------------------------------------

  /**
   * Consumes a nonce: a payment nonce, or the digest of a human's signature.
   *
   * Returns false when the nonce has been seen before, which means the caller
   * is replaying something that was already used. The check and the insert
   * happen together so two concurrent requests cannot both win.
   */
  consumeNonce(nonce: string): boolean {
    if (this.usedNonces.has(nonce)) return false;
    this.usedNonces.add(nonce);
    this.markDirty();
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
    this.markDirty();
  }

  // --- audit -------------------------------------------------------------

  /**
   * Appends an audit event. The log is append-only: nothing in this class
   * mutates or deletes an event once written. Only the oldest events are
   * dropped, from the head, when the in-memory cap is reached.
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
    if (this.audit.length > AUDIT_CAP) this.audit = this.audit.slice(-AUDIT_CAP);
    this.markDirty();
    return stored;
  }

  listEvents(limit = 200): AuditEvent[] {
    return this.audit.slice(-limit).reverse();
  }

  /** Every event about one request, oldest first: the request's own timeline. */
  listEventsForRequest(requestId: string): AuditEvent[] {
    return this.audit.filter((event) => event.requestId === requestId);
  }

  // --- persistence -------------------------------------------------------

  /** Where state is kept, for /health and the startup log. */
  describePersistence(): string {
    return this.file ? `snapshot file ${this.file}` : 'memory only';
  }

  private markDirty(): void {
    if (!this.file || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flush();
    }, SAVE_DELAY_MS);
    // A pending save must not keep a finishing process alive; `flush()` is
    // called explicitly on shutdown.
    this.saveTimer.unref();
  }

  /** Writes the snapshot now. Atomic: written to a sibling file, then renamed over. */
  flush(): void {
    if (!this.file) return;
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const snapshot: Snapshot = {
      version: 1,
      savedAt: new Date().toISOString(),
      agents: [...this.agents.values()],
      policies: [...this.policies.values()],
      requests: [...this.requests.values()],
      audit: this.audit,
      spend: [...this.spend.entries()],
      usedNonces: [...this.usedNonces],
      idempotency: [...this.idempotency.entries()],
    };
    mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(snapshot), { encoding: 'utf8', mode: 0o600 });
    renameSync(tmp, this.file);
  }

  private load(): void {
    if (!this.file || !existsSync(this.file)) return;
    let snapshot: Snapshot;
    try {
      snapshot = JSON.parse(readFileSync(this.file, 'utf8')) as Snapshot;
      if (snapshot.version !== 1) throw new Error(`unsupported snapshot version ${String(snapshot.version)}`);
    } catch (error) {
      // A corrupt snapshot is set aside rather than deleted, and the gateway
      // starts empty. Losing demo state is recoverable; losing the evidence
      // of what went wrong is not.
      const aside = `${this.file}.corrupt-${Date.now()}`;
      renameSync(this.file, aside);
      console.error(
        `[faregate] state file could not be read (${error instanceof Error ? error.message : String(error)}); moved to ${aside} and starting empty`,
      );
      return;
    }
    for (const agent of snapshot.agents ?? []) this.agents.set(agent.id, agent);
    for (const policy of snapshot.policies ?? []) this.policies.set(policy.agentId, policy);
    for (const request of snapshot.requests ?? []) this.requests.set(request.id, request);
    this.audit = [...(snapshot.audit ?? [])].slice(-AUDIT_CAP);
    for (const [key, value] of snapshot.spend ?? []) this.spend.set(key, value);
    for (const nonce of snapshot.usedNonces ?? []) this.usedNonces.add(nonce);
    for (const [key, value] of snapshot.idempotency ?? []) this.idempotency.set(key, value);
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
