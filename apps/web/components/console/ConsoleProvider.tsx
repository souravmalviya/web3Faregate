'use client';

import {
  buildActionMessage,
  type AccessRequest,
  type ActionEnvelope,
  type AuditEvent,
  type HumanAction,
} from '@faregate/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { GatewayError, api, type AgentWithPolicy, type Health, type Signer } from '@/lib/api';
import {
  EMPTY_WALLET,
  EXPECTED_CHAIN,
  SignatureDeclined,
  connectWallet,
  onWalletChange,
  readWallet,
  signActionMessage,
  switchToExpectedChain,
  type WalletState,
} from '@/lib/wallet';

/**
 * Two seconds is fast enough that an approval or a revocation shows up before a
 * presenter finishes the sentence, and slow enough to be no load at all.
 */
const POLL_MS = 2000;

export interface Flash {
  id: number;
  text: string;
  tone: 'ok' | 'bad';
}

export interface ConsoleState {
  /** False until the first poll has answered, so pages show a loading state instead of an empty one. */
  loaded: boolean;
  health: Health | null;
  agents: AgentWithPolicy[];
  requests: AccessRequest[];
  events: AuditEvent[];
  error: string | null;
  refresh: () => Promise<void>;
  wallet: WalletState;
  connect: () => Promise<void>;
  switchChain: () => Promise<void>;
  /** A wallet is connected on the expected chain, so signed actions are possible. */
  canAct: boolean;
  busy: string | null;
  setBusy: (key: string | null) => void;
  /** Runs a signed human action, reports the outcome and refreshes. */
  run: (key: string, fn: (sign: Signer) => Promise<string | void>) => Promise<void>;
  flash: Flash | null;
  notify: (text: string, tone: Flash['tone']) => void;
  agentLabel: (id: string) => string;
}

const ConsoleContext = createContext<ConsoleState | null>(null);

export function useConsole(): ConsoleState {
  const value = useContext(ConsoleContext);
  if (!value) throw new Error('useConsole must be used inside ConsoleProvider.');
  return value;
}

/** Turns a failure into one sentence a person can act on. */
export function explainFailure(err: unknown): string {
  if (err instanceof SignatureDeclined) return err.message;
  if (err instanceof GatewayError) {
    switch (err.code) {
      case 'signature_required':
        return 'The gateway requires a wallet signature for this action. Connect a wallet and try again.';
      case 'bad_signature':
        return 'The wallet signature did not match. Make sure the connected account is the one you meant to act with.';
      case 'signature_expired':
        return 'That signature took too long to reach the gateway. Try again.';
      default:
        return err.message;
    }
  }
  return err instanceof Error ? err.message : 'Something went wrong.';
}

export function ConsoleProvider({ children }: { children: ReactNode }) {
  const [loaded, setLoaded] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [agents, setAgents] = useState<AgentWithPolicy[]>([]);
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [h, a, r, e] = await Promise.all([api.health(), api.agents(), api.requests(), api.events(120)]);
      setHealth(h);
      setAgents(a);
      setRequests(r);
      setEvents(e);
      setError(null);
    } catch (err) {
      setHealth(null);
      setError(err instanceof Error ? err.message : 'Gateway unreachable.');
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const [wallet, setWallet] = useState<WalletState>(EMPTY_WALLET);

  useEffect(() => {
    void readWallet().then(setWallet);
    return onWalletChange(() => void readWallet().then(setWallet));
  }, []);

  const connect = useCallback(async () => setWallet(await connectWallet()), []);
  const switchChain = useCallback(async () => setWallet(await switchToExpectedChain()), []);

  const [flash, setFlash] = useState<Flash | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((text: string, tone: Flash['tone']) => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
    setFlash({ id: Date.now(), text, tone });
    flashTimer.current = setTimeout(() => setFlash(null), 6500);
  }, []);

  const [busy, setBusy] = useState<string | null>(null);
  const canAct = wallet.address !== null && wallet.chainId === EXPECTED_CHAIN.id;

  // Every human action goes through here: the wallet shows the exact message
  // and signs it, and the gateway verifies the signature before acting.
  const signer = useMemo<Signer | null>(() => {
    const address = wallet.address;
    if (!address) return null;
    return async (action: HumanAction, subject: string, digest?: string): Promise<ActionEnvelope> => {
      const issuedAt = new Date().toISOString();
      const message = buildActionMessage({ action, subject, issuedAt, ...(digest ? { digest } : {}) });
      const signature = await signActionMessage(address, message);
      return { by: address, issuedAt, signature };
    };
  }, [wallet.address]);

  const run = useCallback(
    async (key: string, fn: (sign: Signer) => Promise<string | void>) => {
      if (!signer) {
        notify('Connect a wallet first. Every human action is signed by it.', 'bad');
        return;
      }
      setBusy(key);
      try {
        const message = await fn(signer);
        if (message) notify(message, 'ok');
        await refresh();
      } catch (err) {
        notify(explainFailure(err), 'bad');
      } finally {
        setBusy(null);
      }
    },
    [signer, notify, refresh],
  );

  const labels = useMemo(() => new Map(agents.map((a) => [a.id, a.label])), [agents]);
  const agentLabel = useCallback((id: string) => labels.get(id) ?? id, [labels]);

  const value = useMemo<ConsoleState>(
    () => ({
      loaded,
      health,
      agents,
      requests,
      events,
      error,
      refresh,
      wallet,
      connect,
      switchChain,
      canAct,
      busy,
      setBusy,
      run,
      flash,
      notify,
      agentLabel,
    }),
    [loaded, health, agents, requests, events, error, refresh, wallet, connect, switchChain, canAct, busy, run, flash, notify, agentLabel],
  );

  return <ConsoleContext.Provider value={value}>{children}</ConsoleContext.Provider>;
}
