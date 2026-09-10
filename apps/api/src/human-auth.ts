/**
 * Verification of signed human actions.
 *
 * A human action arrives with `by`, `issuedAt` and `signature`. The gateway
 * rebuilds the exact message the dashboard asked the wallet to sign, recovers
 * the signer, and accepts the action only if the signer is `by`. That turns
 * "an address in a JSON body" into "this wallet did this", which is the
 * difference between a claim and a proof.
 *
 * Signatures are bound to one action on one subject (and to the payload, for
 * actions that carry one), expire after a few minutes, and can be used once.
 */

import { createHash } from 'node:crypto';
import { verifyMessage } from 'viem';
import { z } from 'zod';

import {
  ACTION_MAX_AGE_MS,
  buildActionMessage,
  type Address,
  type HumanAction,
} from '@faregate/shared';

import { HttpError } from './errors.ts';
import { isAddress } from './query-parser.ts';
import type { GatewayStore } from './store.ts';

export const actionEnvelopeSchema = z.object({
  by: z.string().refine(isAddress, 'must be a 0x-prefixed EVM address'),
  issuedAt: z.string().datetime().optional(),
  signature: z
    .string()
    .regex(/^0x[0-9a-fA-F]{130}$/, 'must be a 65-byte hex signature')
    .optional(),
});

export type ActionEnvelopeInput = z.infer<typeof actionEnvelopeSchema>;

export interface AuthorizedAction {
  by: Address;
  /** True when a valid wallet signature proved the actor. */
  signed: boolean;
}

export interface AuthorizeInput {
  action: HumanAction;
  subject: string;
  digest?: string;
  envelope: ActionEnvelopeInput;
  requireSignature: boolean;
  store: GatewayStore;
  now: Date;
}

/**
 * Checks an action envelope and returns who acted.
 *
 * Throws an HttpError the route can pass straight to the client. Errors say
 * what was wrong with the envelope, never anything about other state.
 */
export async function authorizeHumanAction(input: AuthorizeInput): Promise<AuthorizedAction> {
  const { envelope, requireSignature, store, now } = input;
  const by = envelope.by as Address;

  if (!envelope.signature) {
    if (requireSignature) {
      throw new HttpError(
        401,
        'signature_required',
        'This action must be signed by the acting wallet. Connect a wallet in the dashboard and sign the prompt.',
      );
    }
    return { by, signed: false };
  }

  if (!envelope.issuedAt) {
    throw new HttpError(400, 'invalid_signature', 'A signed action must carry issuedAt.');
  }
  const issued = Date.parse(envelope.issuedAt);
  const age = now.getTime() - issued;
  if (Number.isNaN(issued) || Math.abs(age) > ACTION_MAX_AGE_MS) {
    throw new HttpError(
      401,
      'signature_expired',
      `Signed actions are valid for ${ACTION_MAX_AGE_MS / 60_000} minutes. Sign again.`,
    );
  }

  const message = buildActionMessage({
    action: input.action,
    subject: input.subject,
    issuedAt: envelope.issuedAt,
    ...(input.digest ? { digest: input.digest } : {}),
  });

  let valid = false;
  try {
    valid = await verifyMessage({
      address: by,
      message,
      signature: envelope.signature as `0x${string}`,
    });
  } catch {
    valid = false;
  }
  if (!valid) {
    throw new HttpError(
      401,
      'bad_signature',
      'The signature does not match the acting wallet for this exact action.',
    );
  }

  // A signature is a bearer token for one action. Consuming it here means a
  // captured envelope cannot be replayed, even inside the validity window.
  const nonce = `sig:${createHash('sha256').update(envelope.signature.toLowerCase()).digest('hex')}`;
  if (!store.consumeNonce(nonce)) {
    throw new HttpError(409, 'signature_replayed', 'This signature has already been used.');
  }

  return { by, signed: true };
}
