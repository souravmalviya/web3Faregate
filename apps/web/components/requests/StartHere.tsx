'use client';

import type { AccessRequest } from '@faregate/shared';
import { useEffect, useState, type ReactNode } from 'react';

import { api, refusedRequest, usd } from '@/lib/api';

import { explainFailure, useConsole } from '../console/ConsoleProvider';
import { Button, INPUT, Stamp, type Tone } from '../ui';
import { ASKS, DEFAULT_ASK, askFare, predictOutcome, type AskKey, type OutcomeKind } from './asks';

const HIDDEN_KEY = 'faregate.start-here.hidden';

const OUTCOME_STAMP: Record<OutcomeKind, { tone: Tone; text: string }> = {
  clears: { tone: 'brand', text: 'Clears' },
  needs_you: { tone: 'hold', text: 'Needs you' },
  refused: { tone: 'stop', text: 'Refused' },
};

/**
 * The first thing on the Requests page: pick an agent, pick what it asks for
 * with the gate's likely answer beside each ask, and send it the way an agent
 * would. Sending needs a connected wallet, so nobody spends the agent's budget
 * anonymously; an agent still collects and pays for a cleared request.
 */
export function StartHere() {
  const { agents, loaded, busy, setBusy, refresh, health, gatewayState, canAct, wallet, connect } = useConsole();
  const [hidden, setHidden] = useState(false);
  const [agentId, setAgentId] = useState('');
  const [askKey, setAskKey] = useState<AskKey>(DEFAULT_ASK.key);
  const [result, setResult] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  useEffect(() => {
    try {
      setHidden(window.localStorage.getItem(HIDDEN_KEY) === '1');
    } catch {
      // Storage can be blocked; the steps then simply stay visible.
    }
  }, []);

  function remember(next: boolean) {
    setHidden(next);
    try {
      if (next) window.localStorage.setItem(HIDDEN_KEY, '1');
      else window.localStorage.removeItem(HIDDEN_KEY);
    } catch {
      // Not remembered this time, which is harmless.
    }
  }

  const selectedId = agentId || agents.find((a) => a.status === 'active')?.id || agents[0]?.id || '';
  const agent = agents.find((a) => a.id === selectedId);
  const ask = ASKS.find((a) => a.key === askKey) ?? DEFAULT_ASK;
  const outcome = predictOutcome(agent, ask);
  const agentPays = Boolean(health?.demoAgent?.passports.includes(selectedId.toLowerCase()));
  const sending = busy === 'submit';

  async function send() {
    if (!selectedId || !canAct) return;
    setResult(null);
    setBusy('submit');
    try {
      const { request } = await api.submit(selectedId, ask.prompt);
      setResult(sentMessage(request, agentPays));
      await refresh();
    } catch (err) {
      const refused = refusedRequest(err);
      if (refused) {
        setResult(sentMessage(refused, agentPays));
        await refresh();
      } else {
        setResult({ tone: 'bad', text: explainFailure(err) });
      }
    } finally {
      setBusy(null);
    }
  }

  if (!loaded || agents.length === 0) return null;

  if (hidden) {
    return (
      <div className="-mt-3 mb-3 flex justify-end">
        <Button variant="quiet" size="sm" onClick={() => remember(false)}>
          Show Start here
        </Button>
      </div>
    );
  }

  return (
    <section
      aria-labelledby="start-here"
      className="mb-8 rounded-[4px] border border-rule-strong bg-sheet shadow-[0_1px_2px_rgba(28,27,24,0.06),0_10px_28px_rgba(28,27,24,0.08)]"
    >
      <div className="flex items-center justify-between gap-3 border-b border-rule px-5 py-2">
        <h2 id="start-here" className="font-display text-[20px] font-semibold text-ink">
          Start here
        </h2>
        <Button variant="quiet" size="sm" onClick={() => remember(true)}>
          Hide
        </Button>
      </div>
      <div className="grid md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.5fr)_minmax(0,0.85fr)] md:divide-x md:divide-rule">
        <Step n={1} title="Choose an agent">
          <select
            aria-label="Agent"
            className={`${INPUT} h-[36px]`}
            value={selectedId}
            onChange={(event) => {
              setAgentId(event.target.value);
              setResult(null);
            }}
          >
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
                {a.status === 'active' ? '' : ` (${a.status})`}
              </option>
            ))}
          </select>
          {agent?.policy ? (
            <p className="text-[12.5px] text-ink-2">
              <span className="tnum font-mono">{usd(agent.policy.maxCostPerQueryUsd)}</span> a query · approval above{' '}
              <span className="tnum font-mono">{usd(agent.policy.humanApprovalAboveUsd)}</span>
            </p>
          ) : null}
        </Step>

        <Step n={2} title="Choose what it asks for">
          <div role="group" aria-label="What the agent asks for" className="flex flex-col gap-1.5">
            {ASKS.map((item) => {
              const stamp = OUTCOME_STAMP[predictOutcome(agent, item).kind];
              const selected = item.key === ask.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    setAskKey(item.key);
                    setResult(null);
                  }}
                  className={`grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 rounded-[3px] border px-2.5 py-1.5 text-left text-[13.5px] text-ink transition-colors ${
                    selected ? 'border-ink bg-white shadow-[inset_3px_0_0_var(--brand)]' : 'border-rule hover:border-ink-2'
                  }`}
                >
                  <span className="truncate">{item.label}</span>
                  <span className="tnum font-mono text-[12.5px] text-ink-2">{usd(askFare(item))}</span>
                  <Stamp tone={stamp.tone}>{stamp.text}</Stamp>
                </button>
              );
            })}
          </div>
        </Step>

        <Step n={3} title="Send it">
          <p className="text-[14px] font-medium leading-snug text-ink">
            {outcomeLine(outcome.kind, outcome.reason, usd(askFare(ask)), agentPays)}
          </p>
          <div>
            {canAct ? (
              <Button
                variant="primary"
                loading={sending}
                disabled={!selectedId || gatewayState !== 'online'}
                onClick={() => void send()}
              >
                {sending ? 'Sending' : 'Send request'}
              </Button>
            ) : (
              <Button variant="primary" disabled={!wallet.available} onClick={() => void connect()}>
                Connect to send
              </Button>
            )}
          </div>
          {canAct ? null : (
            <p className="text-[12.5px] leading-relaxed text-muted">
              {wallet.available
                ? 'Requests are sent only while a wallet is connected.'
                : 'Sending needs a browser wallet such as MetaMask.'}
            </p>
          )}
          {result ? (
            <p role="status" className={`text-[12.5px] leading-relaxed ${result.tone === 'bad' ? 'text-stop' : 'text-ink'}`}>
              {result.text}
            </p>
          ) : null}
        </Step>
      </div>
    </section>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2.5 border-t border-rule px-5 py-4 first:border-t-0 md:border-t-0">
      <div className="flex items-center gap-2 font-display text-[16px] font-semibold text-ink">
        <span
          aria-hidden
          className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-[1.5px] border-ink font-mono text-[12px] font-medium"
        >
          {n}
        </span>
        {title}
      </div>
      {children}
    </div>
  );
}

function outcomeLine(kind: OutcomeKind, reason: string, fare: string, agentPays: boolean): string {
  if (kind === 'clears') {
    return agentPays ? `Clears at ${fare}. The demo agent pays and collects the data.` : `Clears at ${fare}, ${reason}.`;
  }
  if (kind === 'needs_you') return `Costs ${fare}, ${reason}. It waits for your signature.`;
  return `Refused: ${reason}. Nothing is charged.`;
}

function sentMessage(request: AccessRequest, agentPays: boolean): { tone: 'ok' | 'bad'; text: string } {
  const fare = usd(request.estimatedCostUsd);
  switch (request.status) {
    case 'awaiting_approval':
      return { tone: 'ok', text: `Sent. It waits for your signature at ${fare}, under Needs your signature.` };
    case 'payment_required':
      return {
        tone: 'ok',
        text: agentPays
          ? `Sent and cleared at ${fare}. The demo agent is paying now.`
          : `Sent and cleared at ${fare}. Open it in the list for the command that collects it.`,
      };
    case 'rejected':
      return { tone: 'bad', text: `Refused: ${request.decision?.reasons[0]?.message ?? 'the passport check failed.'}` };
    default:
      return { tone: 'ok', text: 'Sent. It is at the top of the list.' };
  }
}
