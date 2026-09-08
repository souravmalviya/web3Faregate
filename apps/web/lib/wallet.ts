/**
 * Wallet connection.
 *
 * The human signs approvals with their own wallet address. Faregate never asks
 * for a private key or seed phrase; it asks the injected wallet for the
 * currently selected account and which chain it is on, and nothing more. No
 * transaction is ever sent from the dashboard.
 */

import { createWalletClient, custom, type Address, type EIP1193Provider } from 'viem';
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

export async function readWallet(): Promise<WalletState> {
  if (!walletAvailable()) return { address: null, chainId: null, available: false };
  const client = createWalletClient({ transport: custom(window.ethereum as EIP1193Provider) });
  const [addresses, chainId] = await Promise.all([client.getAddresses(), client.getChainId()]);
  return { address: addresses[0] ?? null, chainId, available: true };
}

export async function connectWallet(): Promise<WalletState> {
  if (!walletAvailable()) return { address: null, chainId: null, available: false };
  const client = createWalletClient({ transport: custom(window.ethereum as EIP1193Provider) });
  const [address] = await client.requestAddresses();
  const chainId = await client.getChainId();
  return { address: address ?? null, chainId, available: true };
}

export async function switchToExpectedChain(): Promise<void> {
  if (!walletAvailable()) return;
  const client = createWalletClient({
    chain: EXPECTED_CHAIN,
    transport: custom(window.ethereum as EIP1193Provider),
  });
  await client.switchChain({ id: EXPECTED_CHAIN.id });
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
