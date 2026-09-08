'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import type { AccessRequest, AuditEvent, Policy } from '@faregate/shared';

import { ActivityFeed } from '@/components/ActivityFeed';
import { AgentsPanel } from '@/components/AgentsPanel';
import { RequestQueue } from '@/components/RequestQueue';
import { SubmitBox } from '@/components/SubmitBox';
import { TopBar } from '@/components/TopBar';
import { api, type AgentWithPolicy, type Health, usd } from '@/lib/api';
import {
  EXPECTED_CHAIN,
  connectWallet,
  onWalletChange,
  readWallet,
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
  const [wallet, setWallet] = useState<WalletState>({ address: null, chainId: null, available: false });

  useEffect(() => {
    void readWallet().then(setWallet);
    return onWalletChange(() => void readWallet().then(setWallet));
  }, []);

  return {
    wallet,
    connect: async () => setWallet(await connectWallet()),
    switchChain: async () => {
      await switchToExpectedChain();
      setWallet(await readWallet());
    },
  };
}

export default function Dashboard() {
  const { health, agents, requests, events, error, refresh } = useGateway();
  const { wallet, connect, switchChain } = useWallet();
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const agentLabels = useMemo(
    () => Object.fromEntries(agents.map((a) => [a.id, a.label])),
    [agents],
  );
  const canApprove = wallet.address !== null && wallet.chainId === EXPECTED_CHAIN.id;

  const run = async (key: string, fn: () => Promise<string | void>) => {
    setBusy(key);
    try {
      const message = await fn();
      if (message) setFlash(message);
      await refresh();
    } catch (err) {
      setFlash(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(null);
      setTimeout(() => setFlash(null), 6000);
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

        {health && health.notes.length > 0 ? (
          <div className="flex flex-col gap-1 rounded-sm border border-rule bg-surface px-4 py-3 text-[13px] text-muted">
            {health.notes.map((note, i) => (
              <div key={i}>{note}</div>
            ))}
          </div>
        ) : null}

        {flash ? (
          <div className="rounded-sm border border-brass bg-brass-fill px-4 py-2.5 text-[14px] text-ink">{flash}</div>
        ) : null}

        <RequestQueue
          requests={requests}
          agentLabels={agentLabels}
          canApprove={canApprove}
          busy={busy}
          onApprove={(id, decision) =>
            run(id, async () => {
              if (!wallet.address) throw new Error('Connect a wallet to approve.');
              const updated = await api.approve(id, wallet.address, decision);
              return decision === 'approved'
                ? `Approved. The agent may now pay ${usd(updated.estimatedCostUsd)} and collect.`
                : 'Rejected. The agent pays nothing.';
            })
          }
        />

        <div className="grid gap-10 lg:grid-cols-[1.1fr_1fr]">
          <AgentsPanel
            agents={agents}
            busy={busy}
            onRevoke={(id) =>
              run(id, async () => {
                await api.revokeAgent(id);
                return `Revoked ${agentLabels[id] ?? id}. Its next request will be refused at the gate.`;
              })
            }
            onSavePolicy={(id, policy: Omit<Policy, 'agentId'>) =>
              run(id, async () => {
                await api.updatePolicy(id, policy);
                return `Policy saved for ${agentLabels[id] ?? id}.`;
              })
            }
          />

          <div className="flex flex-col gap-10">
            <SubmitBox
              agents={agents}
              busy={busy === 'submit'}
              onSubmit={async (agentId, prompt) => {
                let message = '';
                await run('submit', async () => {
                  const out = await api.submit(agentId, prompt);
                  const r = out.request;
                  message =
                    r.status === 'rejected'
                      ? `Refused: ${r.decision?.reasons[0]?.message ?? 'policy denied'}`
                      : r.status === 'awaiting_approval'
                        ? `Interpreted by ${out.interpretedBy}. ${usd(r.estimatedCostUsd)}, waiting for your approval.`
                        : `Interpreted by ${out.interpretedBy}. ${usd(r.estimatedCostUsd)}, cleared to pay.`;
                  return message;
                });
                return message;
              }}
            />
            <ActivityFeed events={events} />
          </div>
        </div>
      </main>
    </div>
  );
}
