/**
 * Shared helpers for the Hedera operator scripts.
 *
 * Nothing here talks to the gateway. Keys are read from .env at the repository
 * root and are never printed.
 */

import { config as loadDotenv } from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PrivateKey } from '@hiero-ledger/sdk';
import { HEDERA_TESTNET_MIRROR_NODE_URL } from '@x402/hedera';

export const ENV_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env');

export const ACCOUNT_RE = /^0\.0\.\d+$/;

export function loadEnv(): void {
  loadDotenv({ path: ENV_PATH });
}

export function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

export function fail(message: string, code = 2): never {
  console.error(message);
  process.exit(code);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Accepts the HEX or the DER encoding of a key, since the Hedera portal shows
 * both. A raw ECDSA key is 64 hex characters; DER-encoded keys are longer and
 * start with an ASN.1 SEQUENCE.
 */
export function parseHederaKey(raw: string): PrivateKey {
  const text = raw.trim().replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]+$/.test(text)) throw new Error('key is not hex');
  if (text.length > 64 && /^30/.test(text)) return PrivateKey.fromStringDer(text);
  if (text.length === 64) return PrivateKey.fromStringECDSA(text);
  throw new Error(`unexpected key length ${text.length}`);
}

/**
 * Writes values into .env in place, appending any keys that are missing, and
 * mirrors them into process.env. Values are never logged.
 */
export function setEnvValues(values: Record<string, string>): void {
  const original = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const lines = original.length > 0 ? original.split(/\r?\n/) : [];
  const trailingNewline = lines.length > 0 && lines[lines.length - 1] === '';
  if (trailingNewline) lines.pop();

  for (const [key, value] of Object.entries(values)) {
    const index = lines.findIndex((line) => line.startsWith(`${key}=`));
    if (index >= 0) lines[index] = `${key}=${value}`;
    else lines.push(`${key}=${value}`);
    process.env[key] = value;
  }

  if (trailingNewline) lines.push('');
  fs.writeFileSync(ENV_PATH, lines.join(eol), { mode: 0o600 });
}

export interface MirrorAccount {
  account: string;
  deleted: boolean;
  max_automatic_token_associations: number;
  balance?: { balance: number };
  key?: { _type: string; key: string } | null;
}

/** GET against the public testnet mirror node. 404 resolves to null. */
export async function mirror<T>(pathname: string): Promise<T | null> {
  const response = await fetch(`${HEDERA_TESTNET_MIRROR_NODE_URL}${pathname}`, {
    headers: { accept: 'application/json' },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`mirror node returned HTTP ${response.status} for ${pathname}`);
  return (await response.json()) as T;
}

/** Whether a private key belongs to an account, given the public key the mirror node reports for it. */
export function keyMatches(key: PrivateKey, onChainPublicKey: string | undefined): boolean {
  return (
    onChainPublicKey !== undefined &&
    onChainPublicKey.toLowerCase() === key.publicKey.toStringRaw().toLowerCase()
  );
}
