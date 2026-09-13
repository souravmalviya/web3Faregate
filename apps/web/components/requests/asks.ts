/**
 * The sample asks a visitor can send, and what the gate is likely to say about
 * each before it is sent. The gateway decides; this only previews its answer
 * from the passport's limits, so a person can pick an ask knowing what to expect.
 */

import { priceQueryUsd, type ResourceKind } from '@faregate/shared';

import { usd, type AgentWithPolicy } from '@/lib/api';

export const SAMPLE_ADDRESS = '0x742d35Cc6634C0532925a3b844Bc454e4438f44e';

export type AskKey = 'balance' | 'activity' | 'positions';

export interface Ask {
  key: AskKey;
  label: string;
  prompt: string;
  /** How the gateway reads the prompt, so the fare can be shown before sending. */
  resource: ResourceKind;
  lookbackDays: number;
}

export const DEFAULT_ASK: Ask = {
  key: 'balance',
  label: 'Balance today',
  prompt: `What is the token balance of ${SAMPLE_ADDRESS} today?`,
  resource: 'wallet.balances',
  lookbackDays: 1,
};

export const ASKS: readonly Ask[] = [
  DEFAULT_ASK,
  {
    key: 'activity',
    label: 'A month of activity',
    prompt: `Analyze the recent activity of ${SAMPLE_ADDRESS} over the last month`,
    resource: 'wallet.activity',
    lookbackDays: 30,
  },
  {
    key: 'positions',
    label: 'Lending positions',
    prompt: `Show me the lending positions of ${SAMPLE_ADDRESS}`,
    resource: 'protocol.positions',
    // No window is named, so the gateway reads the default month.
    lookbackDays: 30,
  },
];

export function askFare(ask: Ask): number {
  return priceQueryUsd({ resource: ask.resource, address: SAMPLE_ADDRESS, lookbackDays: ask.lookbackDays });
}

export type OutcomeKind = 'clears' | 'needs_you' | 'refused';

export interface Outcome {
  kind: OutcomeKind;
  /** A few words on why, in the passport's terms. */
  reason: string;
}

export function predictOutcome(agent: AgentWithPolicy | undefined, ask: Ask): Outcome {
  const policy = agent?.policy;
  if (!agent || !policy) return { kind: 'refused', reason: 'no limits on this passport' };
  if (agent.status !== 'active') return { kind: 'refused', reason: `passport ${agent.status}` };
  const fare = askFare(ask);
  if (!policy.allowedResources.includes(ask.resource)) return { kind: 'refused', reason: 'not on this passport' };
  if (fare > policy.maxCostPerQueryUsd) return { kind: 'refused', reason: 'over the per-query limit' };
  if (agent.spentTodayUsd + fare > policy.dailyLimitUsd) return { kind: 'refused', reason: 'over the daily limit' };
  if (fare > policy.humanApprovalAboveUsd) {
    return { kind: 'needs_you', reason: `above the ${usd(policy.humanApprovalAboveUsd)} approval line` };
  }
  return { kind: 'clears', reason: 'within every limit' };
}
