/**
 * Wallet connection and signing.
 *
 * The human proves every action with their own wallet: approving a request,
 * revoking a passport, changing a capability or creating an agent asks the
 * wallet to sign a short readable message, which the gateway verifies. That is
 * the only thing the wallet is ever asked to do. Faregate never asks for a
 * private key or seed phrase, and no transaction is ever sent from the
 * dashboard.
 */

import {
  createWalletClient,
  custom,
  type Address,
  type EIP1193Provider,
  type Hex,
} from 'viem';
import { sepolia } from 'viem/chains';

export const EXPECTED_CHAIN = sepolia;

export interface WalletState {
  address: Address | null;
  chainId: number | null;
  /** True when a provider exists but the user has not connected. */
  available: boolean;
}

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

export function walletAvailable(): boolean {
  return typeof window !== 'undefined' && Boolean(window.ethereum);
}

function client() {
  return createWalletClient({ transport: custom(window.ethereum as EIP1193Provider) });
}

export async function readWallet(): Promise<WalletState> {
  if (!walletAvailable()) return { address: null, chainId: null, available: false };
  const [addresses, chainId] = await Promise.all([client().getAddresses(), client().getChainId()]);
  return { address: addresses[0] ?? null, chainId, available: true };
}

export async function connectWallet(): Promise<WalletState> {
  if (!walletAvailable()) return { address: null, chainId: null, available: false };
  const [address] = await client().requestAddresses();
  const chainId = await client().getChainId();
  return { address: address ?? null, chainId, available: true };
}

export async function switchToExpectedChain(): Promise<void> {
  if (!walletAvailable()) return;
  const switching = createWalletClient({
    chain: EXPECTED_CHAIN,
    transport: custom(window.ethereum as EIP1193Provider),
  });
  await switching.switchChain({ id: EXPECTED_CHAIN.id });
}

/** Thrown when the human declines to sign in the wallet. Not an error to alarm about. */
export class SignatureDeclined extends Error {
  constructor() {
    super('Signature declined in the wallet. Nothing was changed.');
    this.name = 'SignatureDeclined';
  }
}

/**
 * Asks the wallet for an EIP-191 personal signature over `message`.
 *
 * The wallet shows the message text, so the human reads exactly what they
 * authorise before signing.
 */
export async function signActionMessage(address: Address, message: string): Promise<Hex> {
  if (!walletAvailable()) throw new Error('No wallet is available to sign with.');
  try {
    return await client().signMessage({ account: address, message });
  } catch (error) {
    const code = (error as { code?: number; cause?: { code?: number } }).code
      ?? (error as { cause?: { code?: number } }).cause?.code;
    const text = error instanceof Error ? error.message : String(error);
    if (code === 4001 || /rejected|denied|declined/i.test(text)) throw new SignatureDeclined();
    throw error;
  }
}

export function onWalletChange(handler: () => void): () => void {
  if (!walletAvailable()) return () => {};
  const provider = window.ethereum as EIP1193Provider;
  provider.on('accountsChanged', handler);
  provider.on('chainChanged', handler);
  return () => {
    provider.removeListener('accountsChanged', handler);
    provider.removeListener('chainChanged', handler);
  };
}
