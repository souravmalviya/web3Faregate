/**
 * How a request is described in the console: where it is on its route through
 * the gate, the verdict it carries, and the sentence a person reads before
 * signing. Pure functions of the request, so every view says the same thing.
 */

import type { AccessRequest, PolicyReasonCode, ResourceKind } from '@faregate/shared';

import { shortAddress, usd, type AgentWithPolicy } from '@/lib/api';

import type { Tone } from '../ui';

export type StationState = 'passed' | 'auto' | 'current' | 'stopped' | 'ahead';

export interface Station {
  key: 'asked' | 'checked' | 'approved' | 'paid' | 'delivered';
  label: string;
  state: StationState;
}

export function stationsFor(r: AccessRequest): Station[] {
  const allowed = r.decision?.allowed === true;
  const needsHuman = r.decision?.requiresHumanApproval === true;
  const human = r.approval?.decision;
  const delivered = Boolean(r.result);
  const paid = Boolean(r.payment && (r.payment.settled || r.payment.verifiedBy === 'simulated'));
  const failed = r.status === 'failed';
  const refusedAtGate = Boolean(r.lastRefusal) && !delivered;
  const cleared = allowed && (!needsHuman || human === 'approved');

  const checked: StationState = allowed ? 'passed' : r.decision ? 'stopped' : 'ahead';

  let approved: StationState = 'ahead';
  if (allowed) {
    if (!needsHuman) approved = 'auto';
    else if (human === 'approved') approved = 'passed';
    else if (human === 'rejected') approved = 'stopped';
    else approved = 'current';
  }

  let fare: StationState = 'ahead';
  if (paid) fare = 'passed';
  else if (cleared) fare = refusedAtGate || failed ? 'stopped' : 'current';

  let data: StationState = 'ahead';
  if (delivered) data = 'passed';
  else if (paid) data = failed ? 'stopped' : 'current';

  return [
    { key: 'asked', label: 'Asked', state: 'passed' },
    { key: 'checked', label: 'Passport', state: checked },
    { key: 'approved', label: allowed && !needsHuman ? 'Auto' : 'You', state: approved },
    { key: 'paid', label: 'Fare', state: fare },
    { key: 'delivered', label: 'Data', state: data },
  ];
}

const REASON_SHORT: Partial<Record<PolicyReasonCode, string>> = {
  agent_unknown: 'No passport',
  agent_revoked: 'Agent revoked',
  agent_expired: 'Passport expired',
  policy_expired: 'Limits expired',
  resource_not_allowed: 'Data not allowed',
  invalid_query: 'Not understood',
  exceeds_per_query_limit: 'Over per-query limit',
  exceeds_daily_limit: 'Over daily limit',
};

export interface Verdict {
  tone: Tone;
  stamp: string;
  /** A few words for a table row. */
  line: string;
  /** A full sentence for the open request. */
  detail: string;
}

export function verdictFor(r: AccessRequest): Verdict {
  const first = r.decision?.reasons[0];
  switch (r.status) {
    case 'awaiting_approval':
      return {
        tone: 'hold',
        stamp: 'Needs you',
        line: 'Above the approval line',
        detail: 'Waiting for your signature. Nothing is paid until you approve.',
      };
    case 'payment_required':
      if (r.lastRefusal) {
        return {
          tone: 'stop',
          stamp: 'Refused',
          line: 'Stopped at the gate',
          detail: `Refused at the gate before payment: ${r.lastRefusal.reason}`,
        };
      }
      return r.approval
        ? {
            tone: 'brand',
            stamp: 'Cleared',
            line: 'Approved, not paid yet',
            detail: 'Approved. The agent pays the fare when it collects the data.',
          }
        : {
            tone: 'brand',
            stamp: 'Cleared',
            line: 'Within limits, not paid',
            detail: 'Within every limit, so no approval was needed. The agent pays when it collects the data.',
          };
    case 'fulfilled': {
      const p = r.payment;
      if (p?.verifiedBy === 'simulated') {
        return {
          tone: 'pass',
          stamp: 'Delivered',
          line: 'Simulated fare',
          detail: 'Delivered on a simulated fare. No chain transaction was made.',
        };
      }
      if (p && !p.settled) {
        return { tone: 'pass', stamp: 'Delivered', line: 'Fare settling', detail: 'Delivered. The fare is settling on Hedera.' };
      }
      return {
        tone: 'pass',
        stamp: 'Delivered',
        line: 'Fare settled',
        detail: 'The fare settled on Hedera and the data was delivered.',
      };
    }
    case 'rejected': {
      if (r.approval?.decision === 'rejected') {
        const by = shortAddress(r.approval.by);
        return { tone: 'stop', stamp: 'Rejected', line: `By ${by}`, detail: `Rejected by ${by}. The agent pays nothing.` };
      }
      const revoked = first?.code === 'agent_revoked';
      return {
        tone: 'stop',
        stamp: 'Refused',
        line: (first ? REASON_SHORT[first.code] : undefined) ?? 'Refused',
        detail: revoked
          ? 'Access denied · agent revoked. Refused before any price was quoted, so the agent got nothing and paid nothing.'
          : `${first?.message ?? 'The passport check failed.'} Refused before any price was quoted.`,
      };
    }
    case 'failed':
      return {
        tone: 'stop',
        stamp: 'Failed',
        line: 'Data retrieval failed',
        detail: `${r.error ?? 'Data retrieval failed.'} Nothing was charged.`,
      };
    default:
      return { tone: 'neutral', stamp: r.status, line: '', detail: '' };
  }
}

const RESOURCE_PHRASE: Record<ResourceKind, string> = {
  'wallet.balances': 'token balances',
  'wallet.transfers': 'token transfers',
  'wallet.activity': 'wallet activity',
  'protocol.positions': 'lending positions',
  'protocol.markets': 'lending market data',
};

/** "30 days of wallet activity for 0x742d…f44e" */
export function describeQuery(q: AccessRequest['query']): string {
  const span = q.lookbackDays === 1 ? 'today’s' : `${q.lookbackDays} days of`;
  const subject = q.resource === 'protocol.markets' ? '' : ` for ${shortAddress(q.address)}`;
  return `${span} ${RESOURCE_PHRASE[q.resource]}${subject}`;
}

/** Why a waiting request needs a person, in the terms of the agent's passport. */
export function approvalReason(r: AccessRequest, agent: AgentWithPolicy | undefined): string {
  const reason = r.decision?.reasons.find((x) => x.code === 'requires_human_approval');
  const cost = String(reason?.detail?.cost ?? usd(r.estimatedCostUsd));
  const threshold = reason?.detail?.threshold;
  const first = threshold
    ? `Costs ${cost}, above this passport’s ${String(threshold)} approval line.`
    : `Costs ${cost}, which needs your approval.`;
  const policy = agent?.policy;
  if (!policy || !r.decision) return first;
  return `${first} Within the ${usd(policy.maxCostPerQueryUsd)} per-query limit, with ${usd(r.decision.remainingTodayUsd)} of ${usd(policy.dailyLimitUsd)} left today.`;
}

/** USDC on Hedera testnet and mainnet. Six decimals, so atomic units are micro-dollars. */
export const USDC_ASSETS = new Set(['0.0.429274', '0.0.456858']);

export function fareAmount(payment: NonNullable<AccessRequest['payment']>): string {
  const units = Number(payment.amount);
  return USDC_ASSETS.has(payment.asset) && Number.isFinite(units)
    ? `${usd(units / 1_000_000)} USDC`
    : `${payment.amount} units`;
}
