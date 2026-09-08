/**
 * Faregate domain model.
 *
 * These types are the contract between the gateway, the dashboard and the
 * agent client. They deliberately contain no I/O and no framework types so
 * that the policy engine built on top of them stays pure and testable.
 */

/** A 0x-prefixed EVM address. Validated at the edges, not by the type. */
export type Address = `0x${string}`;

/**
 * An agent's passport. This is an ENS name, not a database row id: the name
 * is the identity, and control of the name is what grants and revokes access.
 */
export type AgentId = string;

/** The kinds of onchain data an agent can be granted access to. */
export const RESOURCE_KINDS = [
  'wallet.balances',
  'wallet.transfers',
  'wallet.activity',
  'protocol.positions',
  'protocol.markets',
] as const;

export type ResourceKind = (typeof RESOURCE_KINDS)[number];

export function isResourceKind(value: unknown): value is ResourceKind {
  return typeof value === 'string' && (RESOURCE_KINDS as readonly string[]).includes(value);
}

/** Human-readable descriptions used in the dashboard and in approval prompts. */
export const RESOURCE_LABELS: Record<ResourceKind, string> = {
  'wallet.balances': 'Token balances',
  'wallet.transfers': 'Token transfers',
  'wallet.activity': 'Recent transaction activity',
  'protocol.positions': 'Lending and borrowing positions',
  'protocol.markets': 'Protocol market state',
};

export type AgentStatus = 'active' | 'revoked' | 'expired';

export interface Agent {
  /** ENS passport name, for example `research.agents.faregate.eth`. */
  id: AgentId;
  /** Short human label shown in the dashboard. */
  label: string;
  /** Wallet that controls this agent's passport. */
  owner: Address;
  status: AgentStatus;
  /** ISO 8601. */
  createdAt: string;
  /** ISO 8601, or null for a passport with no expiry. */
  expiresAt: string | null;
  /**
   * Where the agent's status and policy were read from. `ens` means the
   * gateway resolved the passport onchain; `local` means it came from the
   * gateway's own store because ENS resolution was unavailable.
   */
  source: 'ens' | 'local';
}

/**
 * The capability granted to an agent. Every field is a hard limit enforced by
 * the deterministic policy engine, never by the language model.
 */
export interface Policy {
  agentId: AgentId;
  allowedResources: ResourceKind[];
  maxCostPerQueryUsd: number;
  dailyLimitUsd: number;
  /** Requests costing strictly more than this need a human to approve them. */
  humanApprovalAboveUsd: number;
  /** ISO 8601, or null for a policy with no expiry. */
  expiresAt: string | null;
}

export type RequestStatus =
  | 'pending'
  | 'awaiting_approval'
  | 'approved'
  | 'rejected'
  | 'payment_required'
  | 'paid'
  | 'fulfilled'
  | 'failed';

/** A structured, machine-checkable data request derived from agent input. */
export interface ResourceQuery {
  resource: ResourceKind;
  /** Subject of the query. An EVM address for every wallet.* resource. */
  address: Address;
  /** Lookback window in days. Drives both cost and the underlying query. */
  lookbackDays: number;
  /** Optional protocol slug for protocol.* resources. */
  protocol?: string;
}

export interface AccessRequest {
  id: string;
  agentId: AgentId;
  /** The agent's original natural-language ask, kept for the audit trail. */
  prompt: string;
  /** The structured form the gateway actually evaluates and prices. */
  query: ResourceQuery;
  status: RequestStatus;
  estimatedCostUsd: number;
  createdAt: string;
  updatedAt: string;
  /** Set once a policy decision has been computed. */
  decision?: PolicyDecision;
  /** Set once a human has acted on an approval request. */
  approval?: ApprovalRecord;
  /** Set once payment has been verified onchain. */
  payment?: PaymentReceipt;
  /** Set once data has been retrieved and analysed. */
  result?: RequestResult;
  /** Set when the request ends in `failed`. */
  error?: string;
}

/**
 * Why the policy engine decided what it decided. Codes are stable and
 * testable; the language model may explain them but never produces them.
 */
export type PolicyReasonCode =
  | 'agent_unknown'
  | 'agent_revoked'
  | 'agent_expired'
  | 'policy_expired'
  | 'resource_not_allowed'
  | 'invalid_query'
  | 'exceeds_per_query_limit'
  | 'exceeds_daily_limit'
  | 'requires_human_approval'
  | 'within_limits';

export interface PolicyReason {
  code: PolicyReasonCode;
  message: string;
  /** Supporting numbers, so the dashboard can render specifics. */
  detail?: Record<string, string | number>;
}

export interface PolicyDecision {
  allowed: boolean;
  requiresHumanApproval: boolean;
  reasons: PolicyReason[];
  estimatedCostUsd: number;
  spentTodayUsd: number;
  remainingTodayUsd: number;
  /** ISO 8601 timestamp of the evaluation, for the audit trail. */
  evaluatedAt: string;
}

export interface ApprovalRecord {
  decision: 'approved' | 'rejected';
  /** Wallet address of the human who acted. */
  by: Address;
  at: string;
  note?: string;
}

/**
 * What the gateway tells an unpaid caller it needs. Mirrors the shape an
 * x402 challenge carries; the concrete wire encoding lives in the payment
 * provider, not here.
 */
export interface PaymentRequirement {
  scheme: string;
  network: string;
  /** Asset contract address, or a chain-native marker. */
  asset: string;
  /** Amount in the asset's smallest unit, as a decimal string. */
  amount: string;
  /** Human-readable amount for display only. */
  amountDisplay: string;
  payTo: string;
  resource: string;
  description: string;
  maxTimeoutSeconds: number;
  /** Single-use value that binds a payment to one request. */
  nonce: string;
}

export interface PaymentReceipt {
  requestId: string;
  txHash: string;
  network: string;
  from: string;
  to: string;
  amount: string;
  asset: string;
  /** True only after server-side verification against the chain. */
  settled: boolean;
  verifiedAt: string;
  /** Where the verification came from, for the audit trail. */
  verifiedBy: 'facilitator' | 'rpc' | 'simulated';
}

export interface RequestResult {
  /** The raw structured data returned by the data provider. */
  data: unknown;
  /** Provenance of that data. Never presented as real if `simulated`. */
  provenance: DataProvenance;
  /** Model-written summary. Grounded in `data`, never a source of facts. */
  analysis?: string;
  /** Set when the analysis step failed but data retrieval succeeded. */
  analysisError?: string;
  fulfilledAt: string;
}

export interface DataProvenance {
  provider: 'the-graph' | 'simulated';
  /** Subgraph or endpoint identifier the data came from. */
  source: string;
  /** Block number the indexed data was current to, when known. */
  blockNumber?: number;
  queriedAt: string;
  /** True when the data did not come from a live chain index. */
  simulated: boolean;
}

export type AuditEventType =
  | 'agent.created'
  | 'agent.revoked'
  | 'policy.updated'
  | 'request.received'
  | 'request.evaluated'
  | 'request.approval_requested'
  | 'request.approved'
  | 'request.rejected'
  | 'payment.required'
  | 'payment.verified'
  | 'payment.rejected'
  | 'data.retrieved'
  | 'analysis.completed'
  | 'request.fulfilled'
  | 'request.failed';

export interface AuditEvent {
  id: string;
  at: string;
  type: AuditEventType;
  actor: 'agent' | 'human' | 'system';
  agentId?: AgentId;
  requestId?: string;
  /** Structured payload. Must never contain secrets. */
  detail: Record<string, unknown>;
}
