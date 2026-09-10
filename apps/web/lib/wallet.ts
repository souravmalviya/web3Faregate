/**
 * Wallet connection and signing.
 *
 * The human proves every action with their own wallet: approving a request,
 * revoking a passport, changing a capability or creating an agent asks the
 * wallet to sign a short readable message, which the gateway verifies. That is
 * the only thing the wallet is ever asked to do. Faregate never asks for a
 * private key or seed phrase, and no transaction is ever sent from the
 * dashboard.
 *
 * Wallet selection uses EIP-6963. When more than one wallet extension is
 * installed they compete for `window.ethereum`, and some wrap it in their own
 * chooser that fails in ways a page cannot recover from. With EIP-6963 each
 * wallet announces itself on a window event instead, and the dashboard picks
 * MetaMask by its reverse-DNS id when it is present. `window.ethereum` is used
 * only when no wallet announces itself.
 */

import { createWalletClient, custom, type Address, type EIP1193Provider, type Hex } from 'viem';
import { sepolia } from 'viem/chains';

export const EXPECTED_CHAIN = sepolia;

export interface WalletState {
  address: Address | null;
  chainId: number | null;
  /** True when some wallet is installed, connected or not. */
  available: boolean;
  /** The wallet in use, as it named itself. */
  name: string | null;
  /** A problem talking to the wallet, in words a person can act on. */
  error: string | null;
}

export const EMPTY_WALLET: WalletState = {
  address: null,
  chainId: null,
  available: false,
  name: null,
  error: null,
};

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

// --- EIP-6963 discovery ------------------------------------------------------

interface ProviderInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

export interface AnnouncedWallet {
  info: ProviderInfo;
  provider: EIP1193Provider;
}

/** Wallets picked first, in this order, when several are installed. */
const PREFERRED_RDNS = ['io.metamask', 'io.metamask.flask'];

const announced = new Map<string, AnnouncedWallet>();
let discovering = false;

function startDiscovery(): void {
  if (typeof window === 'undefined' || discovering) return;
  discovering = true;
  window.addEventListener('eip6963:announceProvider', (event: Event) => {
    const detail = (event as CustomEvent<AnnouncedWallet>).detail;
    if (detail?.info?.uuid && detail.provider) announced.set(detail.info.uuid, detail);
  });
  window.dispatchEvent(new Event('eip6963:requestProvider'));
}

// Listen from the moment this module loads, so no announcement is missed
// between page load and the first wallet call.
startDiscovery();

/**
 * Picks the wallet to use: a preferred wallet if one announced itself,
 * otherwise the first to announce.
 */
export function pickWallet(wallets: AnnouncedWallet[]): AnnouncedWallet | null {
  for (const rdns of PREFERRED_RDNS) {
    const match = wallets.find((wallet) => wallet.info.rdns === rdns);
    if (match) return match;
  }
  return wallets[0] ?? null;
}

interface ChosenWallet {
  name: string;
  provider: EIP1193Provider;
}

async function chooseWallet(): Promise<ChosenWallet | null> {
  if (typeof window === 'undefined') return null;
  startDiscovery();
  // Extensions answer the discovery request straight away; allow a moment for
  // one that injects late.
  if (announced.size === 0) await new Promise((resolve) => setTimeout(resolve, 300));
  const pick = pickWallet([...announced.values()]);
  if (pick) return { name: pick.info.name, provider: pick.provider };
  if (window.ethereum) return { name: 'Browser wallet', provider: window.ethereum };
  return null;
}

/**
 * A client on the chosen wallet. Retries are off: viem retries failed calls by
 * default, and silently retrying a wallet request delays the error the human
 * needs to see and can reopen the wallet's popup.
 */
function clientFor(provider: EIP1193Provider) {
  return createWalletClient({ transport: custom(provider, { retryCount: 0 }) });
}

function errorCode(error: unknown): number | undefined {
  const direct = (error as { code?: unknown }).code;
  if (typeof direct === 'number') return direct;
  const nested = (error as { cause?: { code?: unknown } }).cause?.code;
  return typeof nested === 'number' ? nested : undefined;
}

function isUserRejection(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return errorCode(error) === 4001 || /user rejected|rejected the request|denied|declined/i.test(text);
}

/** Turns an EIP-1193 failure into one sentence a person can act on. */
function describeWalletError(error: unknown, walletName: string): string {
  if (isUserRejection(error)) return `The request was declined in ${walletName}. Nothing was changed.`;
  const code = errorCode(error);
  if (code === -32002) return `${walletName} already has a request open. Open the extension to finish or cancel it.`;
  if (code === 4100) return `${walletName} has not authorised this site yet. Click Connect wallet.`;
  const text = ((error instanceof Error ? error.message : String(error)).split('\n')[0] ?? '').replace(/[.\s]+$/, '');
  return `${walletName} returned an error: ${text}. If several wallet extensions are installed, try disabling the others for this site.`;
}

// --- public API ---------------------------------------------------------------

/** Reads the connected account and chain without prompting. Never throws. */
export async function readWallet(): Promise<WalletState> {
  const wallet = await chooseWallet();
  if (!wallet) return EMPTY_WALLET;
  try {
    const client = clientFor(wallet.provider);
    const [addresses, chainId] = await Promise.all([client.getAddresses(), client.getChainId()]);
    return { address: addresses[0] ?? null, chainId, available: true, name: wallet.name, error: null };
  } catch (error) {
    return {
      address: null,
      chainId: null,
      available: true,
      name: wallet.name,
      error: describeWalletError(error, wallet.name),
    };
  }
}

/** Asks the wallet to connect this site. Never throws; failures come back in `error`. */
export async function connectWallet(): Promise<WalletState> {
  const wallet = await chooseWallet();
  if (!wallet) return { ...EMPTY_WALLET, error: 'No wallet extension was found in this browser.' };
  try {
    const client = clientFor(wallet.provider);
    const [address] = await client.requestAddresses();
    const chainId = await client.getChainId();
    return { address: address ?? null, chainId, available: true, name: wallet.name, error: null };
  } catch (error) {
    return {
      address: null,
      chainId: null,
      available: true,
      name: wallet.name,
      error: describeWalletError(error, wallet.name),
    };
  }
}

/** Asks the wallet to switch to the expected chain. Never throws. */
export async function switchToExpectedChain(): Promise<WalletState> {
  const wallet = await chooseWallet();
  if (!wallet) return EMPTY_WALLET;
  try {
    await createWalletClient({ chain: EXPECTED_CHAIN, transport: custom(wallet.provider, { retryCount: 0 }) }).switchChain({
      id: EXPECTED_CHAIN.id,
    });
  } catch (error) {
    const state = await readWallet();
    return { ...state, error: describeWalletError(error, wallet.name) };
  }
  return readWallet();
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
  const wallet = await chooseWallet();
  if (!wallet) throw new Error('No wallet is available to sign with.');
  try {
    return await clientFor(wallet.provider).signMessage({ account: address, message });
  } catch (error) {
    if (isUserRejection(error)) throw new SignatureDeclined();
    throw new Error(describeWalletError(error, wallet.name));
  }
}

/**
 * Calls `handler` when the account or chain changes, or when a wallet
 * announces itself after the page loaded. Returns an unsubscribe function.
 */
export function onWalletChange(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  let current: EIP1193Provider | null = null;
  let active = true;

  const attach = async (): Promise<void> => {
    const wallet = await chooseWallet();
    if (!active || !wallet || wallet.provider === current) return;
    current?.removeListener('accountsChanged', handler);
    current?.removeListener('chainChanged', handler);
    current = wallet.provider;
    current.on('accountsChanged', handler);
    current.on('chainChanged', handler);
  };

  // Deferred so the discovery listener, registered first, has recorded the
  // new wallet before it is chosen.
  const onAnnounce = (): void => {
    setTimeout(() => {
      void attach().then(() => {
        if (active) handler();
      });
    }, 0);
  };

  window.addEventListener('eip6963:announceProvider', onAnnounce);
  void attach();

  return () => {
    active = false;
    window.removeEventListener('eip6963:announceProvider', onAnnounce);
    current?.removeListener('accountsChanged', handler);
    current?.removeListener('chainChanged', handler);
  };
}
