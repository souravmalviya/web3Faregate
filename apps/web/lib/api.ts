/**
 * Typed client for the Faregate gateway.
 *
 * The dashboard is a consumer of the same HTTP API the agent uses. Nothing here
 * has privileged access; every action a human takes in the UI is a request any
 * client could make, which is why the gateway, not the dashboard, is where
 * authorisation lives.
 */

import type {
  AccessRequest,
  Agent,
  AuditEvent,
  Policy,
} from '@faregate/shared';

export const GATEWAY_URL =
  process.env.NEXT_PUBLIC_FAREGATE_GATEWAY_URL ?? 'http://localhost:8402';

export type SubsystemMode = 'live' | 'simulated';

export interface Health {
  ok: boolean;
  service: string;
  time: string;
  network: string;
  modes: Record<'payment' | 'data' | 'ai' | 'ens', SubsystemMode>;
  notes: string[];
  providers: Record<'data' | 'ai' | 'identity', string>;
}

export interface AgentWithPolicy extends Agent {
  policy: Policy | null;
  spentTodayUsd: number;
}

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

export const api = {
  health: () => call<Health>('/health'),

  agents: () => call<{ agents: AgentWithPolicy[] }>('/agents').then((r) => r.agents),

  revokeAgent: (id: string) =>
    call<{ agent: Agent }>(`/agents/${encodeURIComponent(id)}/revoke`, { method: 'POST' }).then(
      (r) => r.agent,
    ),

  updatePolicy: (id: string, policy: Omit<Policy, 'agentId'>) =>
    call<{ policy: Policy }>(`/agents/${encodeURIComponent(id)}/policy`, {
      method: 'PUT',
      body: JSON.stringify(policy),
    }).then((r) => r.policy),

  requests: () => call<{ requests: AccessRequest[] }>('/requests').then((r) => r.requests),

  request: (id: string) =>
    call<{ request: AccessRequest }>(`/requests/${encodeURIComponent(id)}`).then((r) => r.request),

  explain: (id: string) =>
    call<{ explanation: string; provider: string }>(`/requests/${encodeURIComponent(id)}/explain`),

  submit: (agentId: string, prompt: string) =>
    call<{ request: AccessRequest; interpretedBy: string }>('/requests', {
      method: 'POST',
      body: JSON.stringify({ agentId, prompt }),
    }),

  approve: (id: string, by: `0x${string}`, decision: 'approved' | 'rejected', note?: string) =>
    call<{ request: AccessRequest }>(`/requests/${encodeURIComponent(id)}/approval`, {
      method: 'POST',
      body: JSON.stringify({ decision, by, ...(note ? { note } : {}) }),
    }).then((r) => r.request),

  events: (limit = 100) =>
    call<{ events: AuditEvent[] }>(`/events?limit=${limit}`).then((r) => r.events),
};

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
