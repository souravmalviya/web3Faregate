/**
 * Signed human actions.
 *
 * Approving a request, revoking a passport and changing a capability are the
 * three things a human does that move money or change what an agent may do.
 * Each is authorised by a wallet signature over a short, readable message, so
 * the gateway can prove who acted rather than trusting an address in a JSON
 * body.
 *
 * The message text is built here, in the package both the dashboard and the
 * gateway import, so the two sides can never drift apart. It is plain text a
 * wallet shows the human before signing, and it says in words that signing
 * sends no transaction.
 */

import type { Address } from './domain.ts';

export const HUMAN_ACTIONS = [
  'approve-request',
  'reject-request',
  'revoke-agent',
  'set-policy',
  'create-agent',
] as const;

export type HumanAction = (typeof HUMAN_ACTIONS)[number];

export function isHumanAction(value: unknown): value is HumanAction {
  return typeof value === 'string' && (HUMAN_ACTIONS as readonly string[]).includes(value);
}

/** What a human sends alongside an action so the gateway can verify it. */
export interface ActionEnvelope {
  /** The wallet that acted. */
  by: Address;
  /** ISO 8601 time the message was built. Bounds how long a signature is usable. */
  issuedAt: string;
  /** EIP-191 personal signature over `buildActionMessage(...)`. */
  signature: `0x${string}`;
}

export interface ActionMessageInput {
  action: HumanAction;
  /** The request id or agent id the action is about. */
  subject: string;
  issuedAt: string;
  /**
   * Hex digest of the action's payload, for actions that carry one (a policy,
   * a new agent). Binds the signature to the exact content that was sent.
   */
  digest?: string;
}

/** Signatures older than this, or dated further than this into the future, are refused. */
export const ACTION_MAX_AGE_MS = 10 * 60 * 1000;

/**
 * The exact text a human signs. Deterministic: the same inputs always produce
 * the same message, on both sides of the wire.
 */
export function buildActionMessage(input: ActionMessageInput): string {
  return [
    'Faregate action',
    `action: ${input.action}`,
    `subject: ${input.subject}`,
    `digest: ${input.digest ?? '-'}`,
    `issued: ${input.issuedAt}`,
    '',
    'Signing authorises exactly this action on your Faregate gateway. It sends no transaction and spends nothing.',
  ].join('\n');
}

/**
 * Serialises a value with sorted object keys, so the same content always
 * produces the same bytes regardless of the order fields were assembled in.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const inner = (value as Record<string, unknown>)[key];
      if (inner !== undefined) out[key] = sortKeys(inner);
    }
    return out;
  }
  return value;
}

/**
 * SHA-256 of the canonical JSON, as lowercase hex. Uses Web Crypto, which both
 * browsers and Node provide, so the dashboard and the gateway compute it the
 * same way.
 */
export async function canonicalDigest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
