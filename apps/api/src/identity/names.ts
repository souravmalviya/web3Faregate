/**
 * The one spelling of an agent id the gateway keys everything by.
 *
 * ENS names ignore letter case: `TRIAL.agents.faregate.eth` resolves to the
 * same passport as `trial.agents.faregate.eth`. If the gateway kept whatever
 * spelling an agent sent, each spelling would get its own spend ledger and its
 * own rate limit, and an agent could step around its daily budget by changing
 * the case of its own name. Every id is normalised before it becomes a key.
 */

import { normalize } from 'viem/ens';

export function canonicalAgentId(raw: string): string {
  const trimmed = raw.trim();
  try {
    return normalize(trimmed);
  } catch {
    // Not a valid ENS name, so it resolves to no passport either way. A
    // lowercase key still keeps case variants from counting separately.
    return trimmed.toLowerCase();
  }
}
