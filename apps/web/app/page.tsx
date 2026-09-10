'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  buildActionMessage,
  type AccessRequest,
  type ActionEnvelope,
  type AuditEvent,
  type HumanAction,
} from '@faregate/shared';

import { ActivityFeed } from '@/components/ActivityFeed';
import { AgentsPanel } from '@/components/AgentsPanel';
import { RequestQueue } from '@/components/RequestQueue';
import { SubmitBox } from '@/components/SubmitBox';
import { TopBar } from '@/components/TopBar';
import {
  GatewayError,
  api,
  type AgentWithPolicy,
  type CreateAgentInput,
  type Health,
  type PolicyInput,
  type Signer,
  usd,
} from '@/lib/api';
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

const POLL_MS = 2000;

/**
 * Polls the gateway. Two seconds is fast enough that an approval or a
 * revocation shows up before a presenter finishes the sentence, and simple
 * enough that there is nothing to go wrong on stage.
 */
function useGateway() {
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
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  return { health, agents, requests, events, error, refresh };
}

function useWallet() {
  const [wallet, setWallet] = useState<WalletState>(EMPTY_WALLET);

  useEffect(() => {
    void readWallet().then(setWallet);
    return onWalletChange(() => void readWallet().then(setWallet));
  }, []);

  return {
    wallet,
    connect: async () => setWallet(await connectWallet()),
    switchChain: async () => setWallet(await switchToExpectedChain()),
  };
}

/** Turns a failure into one sentence a person can act on. */
function explainFailure(err: unknown): string {
  if (err instanceof SignatureDeclined) return err.message;
  if (err instanceof GatewayError) {
    switch (err.code) {
      case 'signature_required':
        return 'The gateway requires a wallet signature for this action. Connect a wallet and try again.';
      case 'bad_signature':
        return 'The wallet signature did not match. Make sure the connected account is the one you meant to act with.';
      case 'signature_expired':
        return 'That signature took too long to reach the gateway. Try again.';
      case 'rate_limited':
        return err.message;
      default:
        return err.message;
    }
  }
  return err instanceof Error ? err.message : 'Something went wrong.';
}

export default function Dashboard() {
  const { health, agents, requests, events, error, refresh } = useGateway();
  const { wallet, connect, switchChain } = useWallet();
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ text: string; tone: 'ok' | 'bad' } | null>(null);

  const agentLabels = useMemo(
    () => Object.fromEntries(agents.map((a) => [a.id, a.label])),
    [agents],
  );
  const parentName = health?.parentName ?? 'agents.faregate.eth';
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

  const run = async (key: string, fn: (sign: Signer) => Promise<string | void>) => {
    if (!signer) {
      setFlash({ text: 'Connect a wallet first. Every human action is signed by it.', tone: 'bad' });
      return;
    }
    setBusy(key);
    try {
      const message = await fn(signer);
      if (message) setFlash({ text: message, tone: 'ok' });
      await refresh();
    } catch (err) {
      setFlash({ text: explainFailure(err), tone: 'bad' });
    } finally {
      setBusy(null);
      setTimeout(() => setFlash(null), 7000);
    }
  };

  return (
    <div className="min-h-screen bg-ground">
      <TopBar health={health} wallet={wallet} onConnect={connect} onSwitchChain={switchChain} />

      <main className="mx-auto flex max-w-[1240px] flex-col gap-10 px-6 pt-8 pb-24">
        {error ? (
          <div className="rounded-sm border border-stop bg-stop-fill px-4 py-3 text-[14px] text-stop">
            {error}. Start the gateway with <code className="font-mono">npm run dev:api</code>.
          </div>
        ) : null}

        {wallet.error ? (
          <div role="alert" className="rounded-sm border border-stop bg-stop-fill px-4 py-3 text-[14px] text-stop">
            {wallet.error}
          </div>
        ) : null}

        {health && health.notes.length > 0 ? (
          <div className="flex flex-col gap-1 rounded-sm border border-rule bg-surface px-4 py-3 text-[13px] text-muted">
            {health.notes.map((note, i) => (
              <div key={i}>{note}</div>
            ))}
          </div>
        ) : null}

        {flash ? (
          <div
            role="status"
            className={`rounded-sm border px-4 py-2.5 text-[14px] ${
              flash.tone === 'ok' ? 'border-brass bg-brass-fill text-ink' : 'border-stop bg-stop-fill text-stop'
            }`}
          >
            {flash.text}
          </div>
        ) : null}

        <RequestQueue
          requests={requests}
          agentLabels={agentLabels}
          canAct={canAct}
          network={health?.network ?? 'hedera:testnet'}
          busy={busy}
          onApprove={(id, decision) =>
            run(id, async (sign) => {
              const updated = await api.approve(id, decision, sign);
              return decision === 'approved'
                ? `Approved and signed. The agent may now pay ${usd(updated.estimatedCostUsd)} and collect.`
                : 'Rejected and signed. The agent pays nothing.';
            })
          }
        />

        <div className="grid gap-10 lg:grid-cols-[1.1fr_1fr]">
          <AgentsPanel
            agents={agents}
            parentName={parentName}
            canAct={canAct}
            busy={busy}
            onCreate={(input: CreateAgentInput) =>
              run('create', async (sign) => {
                const out = await api.createAgent(input, sign);
                return `Created ${out.agent.label} as ${out.agent.id}. It can start asking for data.`;
              })
            }
            onRevoke={(id) =>
              run(id, async (sign) => {
                await api.revokeAgent(id, sign);
                return `Revoked ${agentLabels[id] ?? id}. Its next request will be refused at the gate.`;
              })
            }
            onSavePolicy={(id, policy: PolicyInput) =>
              run(id, async (sign) => {
                await api.updatePolicy(id, policy, sign);
                return `Policy saved for ${agentLabels[id] ?? id}.`;
              })
            }
          />

          <div className="flex flex-col gap-10">
            <SubmitBox
              agents={agents}
              busy={busy === 'submit'}
              onSubmit={async (agentId, prompt) => {
                setBusy('submit');
                try {
                  const out = await api.submit(agentId, prompt);
                  const r = out.request;
                  const message =
                    r.status === 'rejected'
                      ? `Refused: ${r.decision?.reasons[0]?.message ?? 'policy denied'}`
                      : r.status === 'awaiting_approval'
                        ? `Interpreted by ${out.interpretedBy}. ${usd(r.estimatedCostUsd)}, waiting for your approval.`
                        : `Interpreted by ${out.interpretedBy}. ${usd(r.estimatedCostUsd)}, cleared to pay.`;
                  await refresh();
                  return message;
                } catch (err) {
                  // A 403 is the gateway answering, with the request attached.
                  if (err instanceof GatewayError && err.status !== 403) return explainFailure(err);
                  await refresh();
                  return err instanceof Error ? err.message : 'Submission failed.';
                } finally {
                  setBusy(null);
                }
              }}
            />
            <ActivityFeed events={events} />
          </div>
        </div>
      </main>
    </div>
  );
}
