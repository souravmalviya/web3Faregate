/**
 * The Faregate policy engine.
 *
 * This module is the security authority for the whole product. It is pure,
 * synchronous and deterministic: the same inputs always produce the same
 * decision, and no network call, clock read or model output happens inside it.
 *
 * The language model in Faregate proposes a structured query and explains a
 * decision in prose. It never makes one. Everything that determines whether an
 * agent gets data, and how much it may spend, is decided here.
 */

import type {
  Agent,
  Policy,
  PolicyDecision,
  PolicyReason,
  ResourceQuery,
} from './domain.ts';
import {
  microsToUsd,
  priceQueryMicros,
  usdToMicros,
  formatUsd,
} from './pricing.ts';

export interface PolicyEvaluationInput {
  /** Resolved agent passport, or null when the passport did not resolve. */
  agent: Agent | null;
  /** Capability attached to that passport, or null when none was found. */
  policy: Policy | null;
  /** Structured query, or null when the request could not be parsed. */
  query: ResourceQuery | null;
  /** Micro-USD already spent by this agent in the current UTC day. */
  spentTodayMicros: number;
  /** Injected so evaluation is reproducible in tests. */
  now: Date;
}

function reason(
  code: PolicyReason['code'],
  message: string,
  detail?: Record<string, string | number>,
): PolicyReason {
  return detail ? { code, message, detail } : { code, message };
}

function deny(
  reasons: PolicyReason[],
  costMicros: number,
  spentTodayMicros: number,
  dailyLimitMicros: number,
  now: Date,
): PolicyDecision {
  return {
    allowed: false,
    requiresHumanApproval: false,
    reasons,
    estimatedCostUsd: microsToUsd(costMicros),
    spentTodayUsd: microsToUsd(spentTodayMicros),
    remainingTodayUsd: microsToUsd(Math.max(0, dailyLimitMicros - spentTodayMicros)),
    evaluatedAt: now.toISOString(),
  };
}

function isExpired(expiresAt: string | null, now: Date): boolean {
  if (!expiresAt) return false;
  const ts = Date.parse(expiresAt);
  if (Number.isNaN(ts)) return false;
  return ts <= now.getTime();
}

/**
 * Evaluates one request against one capability.
 *
 * Checks run in a fixed order and the first failing check denies the request.
 * The order matters for the audit trail: a revoked agent is reported as
 * revoked, not as over its spending limit.
 */
export function evaluatePolicy(input: PolicyEvaluationInput): PolicyDecision {
  const { agent, policy, query, now } = input;
  const spentTodayMicros = Math.max(0, Math.floor(input.spentTodayMicros));
  const costMicros = query ? priceQueryMicros(query) : 0;
  const dailyLimitMicros = policy ? usdToMicros(policy.dailyLimitUsd) : 0;

  // 1. The passport must resolve.
  if (!agent) {
    return deny(
      [reason('agent_unknown', 'No passport resolved for this agent identifier.')],
      costMicros,
      spentTodayMicros,
      dailyLimitMicros,
      now,
    );
  }

  // 2. The passport must not be revoked. This is the demo's kill switch and
  //    it is checked before anything about cost or data.
  if (agent.status === 'revoked') {
    return deny(
      [
        reason('agent_revoked', 'This agent passport has been revoked by its owner.', {
          agentId: agent.id,
        }),
      ],
      costMicros,
      spentTodayMicros,
      dailyLimitMicros,
      now,
    );
  }

  // 3. The passport must not have expired.
  if (agent.status === 'expired' || isExpired(agent.expiresAt, now)) {
    return deny(
      [
        reason('agent_expired', 'This agent passport has expired.', {
          agentId: agent.id,
          expiresAt: agent.expiresAt ?? 'unknown',
        }),
      ],
      costMicros,
      spentTodayMicros,
      dailyLimitMicros,
      now,
    );
  }

  // 4. A capability must exist for the passport.
  if (!policy) {
    return deny(
      [
        reason('agent_unknown', 'No capability is attached to this passport.', {
          agentId: agent.id,
        }),
      ],
      costMicros,
      spentTodayMicros,
      dailyLimitMicros,
      now,
    );
  }

  // 5. The capability must not have expired.
  if (isExpired(policy.expiresAt, now)) {
    return deny(
      [
        reason('policy_expired', 'The capability attached to this passport has expired.', {
          expiresAt: policy.expiresAt ?? 'unknown',
        }),
      ],
      costMicros,
      spentTodayMicros,
      dailyLimitMicros,
      now,
    );
  }

  // 6. The request must have parsed into a structured query.
  if (!query) {
    return deny(
      [
        reason(
          'invalid_query',
          'The request could not be resolved to a supported data query.',
        ),
      ],
      costMicros,
      spentTodayMicros,
      dailyLimitMicros,
      now,
    );
  }

  // 7. The requested resource must be inside the granted scope.
  if (!policy.allowedResources.includes(query.resource)) {
    return deny(
      [
        reason('resource_not_allowed', 'This resource is outside the agent’s granted scope.', {
          requested: query.resource,
          allowed: policy.allowedResources.join(', '),
        }),
      ],
      costMicros,
      spentTodayMicros,
      dailyLimitMicros,
      now,
    );
  }

  // 8. The query must be within the per-query ceiling.
  const perQueryLimitMicros = usdToMicros(policy.maxCostPerQueryUsd);
  if (costMicros > perQueryLimitMicros) {
    return deny(
      [
        reason('exceeds_per_query_limit', 'This query costs more than the per-query limit.', {
          cost: formatUsd(costMicros),
          limit: formatUsd(perQueryLimitMicros),
        }),
      ],
      costMicros,
      spentTodayMicros,
      dailyLimitMicros,
      now,
    );
  }

  // 9. The query must fit inside what is left of today's budget.
  if (spentTodayMicros + costMicros > dailyLimitMicros) {
    return deny(
      [
        reason('exceeds_daily_limit', 'This query would exceed the daily spending limit.', {
          cost: formatUsd(costMicros),
          spentToday: formatUsd(spentTodayMicros),
          dailyLimit: formatUsd(dailyLimitMicros),
        }),
      ],
      costMicros,
      spentTodayMicros,
      dailyLimitMicros,
      now,
    );
  }

  // 10. Inside the limits. Decide whether a human still has to sign off.
  const approvalThresholdMicros = usdToMicros(policy.humanApprovalAboveUsd);
  const requiresHumanApproval = costMicros > approvalThresholdMicros;

  const reasons: PolicyReason[] = requiresHumanApproval
    ? [
        reason('requires_human_approval', 'Cost is above the automatic approval threshold.', {
          cost: formatUsd(costMicros),
          threshold: formatUsd(approvalThresholdMicros),
        }),
      ]
    : [
        reason('within_limits', 'Request is within every configured limit.', {
          cost: formatUsd(costMicros),
          remainingToday: formatUsd(dailyLimitMicros - spentTodayMicros - costMicros),
        }),
      ];

  return {
    allowed: true,
    requiresHumanApproval,
    reasons,
    estimatedCostUsd: microsToUsd(costMicros),
    spentTodayUsd: microsToUsd(spentTodayMicros),
    remainingTodayUsd: microsToUsd(Math.max(0, dailyLimitMicros - spentTodayMicros)),
    evaluatedAt: now.toISOString(),
  };
}
