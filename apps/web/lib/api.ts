/**
 * Typed client for the Faregate gateway.
 *
 * The dashboard is a consumer of the same HTTP API the agent uses. Nothing here
 * has privileged access; every action a human takes in the UI is a request any
 * client could make, which is why the gateway, not the dashboard, is where
 * authorisation lives. What the dashboard adds is the wallet signature the
 * gateway verifies before it acts.
 */

import {
  buildActionMessage,
  canonicalDigest,
  type AccessRequest,
  type ActionEnvelope,
  type Agent,
  type AuditEvent,
  type HumanAction,
  type Policy,
} from '@faregate/shared';

export const GATEWAY_URL =
  process.env.NEXT_PUBLIC_FAREGATE_GATEWAY_URL ?? 'http://localhost:8402';

export type SubsystemMode = 'live' | 'simulated';

export interface Health {
  ok: boolean;
  service: string;
  time: string;
  network: string;
  parentName: string;
  signedActions: boolean;
  persistence: string;
  modes: Record<'payment' | 'data' | 'ai' | 'ens', SubsystemMode>;
  notes: string[];
  providers: Record<'data' | 'ai' | 'identity', string>;
}

export interface AgentWithPolicy extends Agent {
  policy: Policy | null;
  spentTodayUsd: number;
}

export type PolicyInput = Omit<Policy, 'agentId'>;

export interface CreateAgentInput {
  label: string;
  id: string;
  policy: PolicyInput;
}

/**
 * Produces a signed envelope for one action. Built by the page from the
 * connected wallet; the wallet prompt is where the human reads and approves.
 */
export type Signer = (action: HumanAction, subject: string, digest?: string) => Promise<ActionEnvelope>;

export interface ApiError {
  code: string;
  message: string;
}

export class GatewayError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'GatewayError';
    this.status = status;
    this.code = code;
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${GATEWAY_URL}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    cache: 'no-store',
  });
  const body = (await response.json().catch(() => ({}))) as { error?: ApiError } & T;
  if (!response.ok) {
    const error = body.error;
    throw new GatewayError(
      response.status,
      error?.code ?? 'http_error',
      error?.message ?? `Gateway returned HTTP ${response.status}.`,
    );
  }
  return body;
}

/** The exact policy fields a signature covers. Must match the gateway's view. */
function policyDigestInput(policy: PolicyInput): Record<string, unknown> {
  return {
    allowedResources: policy.allowedResources,
    maxCostPerQueryUsd: policy.maxCostPerQueryUsd,
    dailyLimitUsd: policy.dailyLimitUsd,
    humanApprovalAboveUsd: policy.humanApprovalAboveUsd,
    expiresAt: policy.expiresAt,
  };
}

export const api = {
  health: () => call<Health>('/health'),

  agents: () => call<{ agents: AgentWithPolicy[] }>('/agents').then((r) => r.agents),

  createAgent: async (input: CreateAgentInput, sign: Signer) => {
    const digest = await canonicalDigest({
      id: input.id,
      label: input.label,
      policy: policyDigestInput(input.policy),
    });
    const envelope = await sign('create-agent', input.id, digest);
    return call<{ agent: Agent; policy: Policy }>('/agents', {
      method: 'POST',
      body: JSON.stringify({ label: input.label, id: input.id, policy: input.policy, ...envelope }),
    });
  },

  revokeAgent: async (id: string, sign: Signer) => {
    const envelope = await sign('revoke-agent', id);
    return call<{ agent: Agent }>(`/agents/${encodeURIComponent(id)}/revoke`, {
      method: 'POST',
      body: JSON.stringify(envelope),
    }).then((r) => r.agent);
  },

  updatePolicy: async (id: string, policy: PolicyInput, sign: Signer) => {
    const digest = await canonicalDigest(policyDigestInput(policy));
    const envelope = await sign('set-policy', id, digest);
    return call<{ policy: Policy }>(`/agents/${encodeURIComponent(id)}/policy`, {
      method: 'PUT',
      body: JSON.stringify({ ...policy, ...envelope }),
    }).then((r) => r.policy);
  },

  requests: () => call<{ requests: AccessRequest[] }>('/requests').then((r) => r.requests),

  request: (id: string) =>
    call<{ request: AccessRequest }>(`/requests/${encodeURIComponent(id)}`).then((r) => r.request),

  requestEvents: (id: string) =>
    call<{ events: AuditEvent[] }>(`/requests/${encodeURIComponent(id)}/events`).then((r) => r.events),

  explain: (id: string) =>
    call<{ explanation: string; provider: string }>(`/requests/${encodeURIComponent(id)}/explain`),

  submit: (agentId: string, prompt: string) =>
    call<{ request: AccessRequest; interpretedBy: string }>('/requests', {
      method: 'POST',
      body: JSON.stringify({ agentId, prompt }),
    }),

  approve: async (id: string, decision: 'approved' | 'rejected', sign: Signer, note?: string) => {
    const envelope = await sign(decision === 'approved' ? 'approve-request' : 'reject-request', id);
    return call<{ request: AccessRequest }>(`/requests/${encodeURIComponent(id)}/approval`, {
      method: 'POST',
      body: JSON.stringify({ decision, ...(note ? { note } : {}), ...envelope }),
    }).then((r) => r.request);
  },

  events: (limit = 100) =>
    call<{ events: AuditEvent[] }>(`/events?limit=${limit}`).then((r) => r.events),
};

/** Re-exported so components can build the message a wallet shows, for previews. */
export { buildActionMessage };

/** Display helpers shared by every component. */
export function usd(value: number): string {
  if (!Number.isFinite(value)) return '$0.00';
  const cents = Math.round(value * 100);
  const whole = Math.abs(value * 100 - cents) < 1e-9;
  return whole ? `$${value.toFixed(2)}` : `$${value.toFixed(4)}`;
}

export function shortAddress(address: string): string {
  if (!address || address.length < 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function shortHash(hash: string): string {
  if (!hash) return '';
  if (hash.startsWith('simulated-')) return 'simulated';
  return hash.length > 18 ? `${hash.slice(0, 10)}…${hash.slice(-6)}` : hash;
}

/** HashScan link for a Hedera transaction or account, or null when there is nothing real to link. */
export function hashscanUrl(network: string, kind: 'transaction' | 'account', id: string): string | null {
  if (!id || id.startsWith('simulated')) return null;
  const net = network === 'hedera:mainnet' ? 'mainnet' : network === 'hedera:testnet' ? 'testnet' : null;
  if (!net) return null;
  return `https://hashscan.io/${net}/${kind}/${encodeURIComponent(id)}`;
}

export function timeAgo(iso: string, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function clockTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
