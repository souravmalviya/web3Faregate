'use client';

import type { AccessRequest } from '@faregate/shared';
import { ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';

import { api, hashscanUrl, refusedRequest, usd } from '@/lib/api';

import { explainFailure, useConsole } from '../console/ConsoleProvider';
import { GateTrack } from '../requests/GateTrack';
import { ASKS, askFare, type Ask, type AskKey } from '../requests/asks';
import { describeQuery, stationsFor, verdictFor, type Station } from '../requests/model';
import { Stamp, type Tone } from '../ui';

/** The passport the front page asks as, when the gateway has it. */
const PREFERRED_AGENT = 'research.agents.faregate.eth';

const EDGE: Record<Tone, string> = {
  pass: 'bg-pass',
  hold: 'bg-hold',
  stop: 'bg-stop',
  brand: 'bg-brand',
  neutral: 'bg-rule-strong',
};

interface TicketView {
  /** Changes when the verdict changes, so the stamp lands again. */
  key: string;
  agent: string;
  note: string;
  want: string;
  stations: Station[];
  detail: string;
  fare: string;
  tone: Tone;
  stamp: string;
  action: ReactNode;
}

function PaymentLink({ href }: { href: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[13px] text-brand hover:underline">
      Payment on HashScan
      <ExternalLink className="h-3 w-3" aria-hidden />
    </a>
  );
}

/** Shown until the gateway answers: a request that really ran, with its real payment. */
const EXAMPLE: TicketView = {
  key: 'example',
  agent: 'Treasury Research Agent',
  note: 'example',
  want: 'Wants today’s token balances for 0x742d…f44e',
  stations: [
    { key: 'asked', label: 'Asked', state: 'passed' },
    { key: 'checked', label: 'Passport', state: 'passed' },
    { key: 'approved', label: 'Auto', state: 'auto' },
    { key: 'paid', label: 'Fare', state: 'passed' },
    { key: 'delivered', label: 'Data', state: 'passed' },
  ],
  detail: 'The fare settled on Hedera and the data was delivered.',
  fare: '$0.0102',
  tone: 'pass',
  stamp: 'Delivered',
  action: <PaymentLink href="https://hashscan.io/testnet/transaction/0.0.7162784%401789280858.204136805" />,
};

function toView(request: AccessRequest, note: string, agent: string, network: string, autoCollect: boolean): TicketView {
  const verdict = verdictFor(request, { autoCollect });
  const payment = request.payment;
  const txUrl =
    payment?.settled && payment.verifiedBy !== 'simulated'
      ? hashscanUrl(payment.network || network, 'transaction', payment.txHash)
      : null;
  return {
    key: `${request.id}-${verdict.stamp}`,
    agent,
    note,
    want: `Wants ${describeQuery(request.query)}`,
    stations: stationsFor(request),
    detail: verdict.detail,
    fare: request.status === 'rejected' ? 'none' : usd(request.estimatedCostUsd),
    tone: verdict.tone,
    stamp: verdict.stamp,
    action: txUrl ? (
      <PaymentLink href={txUrl} />
    ) : request.status === 'awaiting_approval' ? (
      <Link
        href="/requests"
        className="inline-flex h-[30px] items-center justify-center rounded-[3px] border border-pass bg-pass px-3 text-[13px] font-medium text-white transition-colors hover:bg-[#175637]"
      >
        Approve in Requests
      </Link>
    ) : null,
  };
}

/**
 * A real request, sent to the gateway the way an agent sends one, then
 * followed along the gate track as the console's polling brings it back.
 */
export function TryIt() {
  const { agents, requests, health, gatewayState, refresh, agentLabel } = useConsole();
  const [sent, setSent] = useState<AccessRequest | null>(null);
  const [sending, setSending] = useState<AskKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  const agent =
    agents.find((a) => a.id === PREFERRED_AGENT && a.status === 'active') ?? agents.find((a) => a.status === 'active');
  const network = health?.network ?? 'hedera:testnet';
  const ready = gatewayState === 'online' && agent !== undefined;
  const autoCollect = (agentId: string) => Boolean(health?.demoAgent?.passports.includes(agentId.toLowerCase()));

  const mine = sent ? (requests.find((r) => r.id === sent.id) ?? sent) : null;
  const latest = requests.find(
    (r) => r.status === 'fulfilled' && r.payment?.settled === true && r.payment.verifiedBy !== 'simulated',
  );
  const view = mine
    ? toView(mine, 'your request', agentLabel(mine.agentId), network, autoCollect(mine.agentId))
    : latest
      ? toView(latest, 'latest delivered request', agentLabel(latest.agentId), network, autoCollect(latest.agentId))
      : EXAMPLE;

  async function send(ask: Ask) {
    if (!agent) return;
    setError(null);
    setSending(ask.key);
    try {
      const { request } = await api.submit(agent.id, ask.prompt);
      setSent(request);
    } catch (err) {
      const refused = refusedRequest(err);
      if (refused) setSent(refused);
      else setError(explainFailure(err));
    } finally {
      setSending(null);
      void refresh();
    }
  }

  const status =
    gatewayState === 'waking'
      ? 'The gateway is waking up, which takes up to a minute.'
      : gatewayState === 'offline'
        ? 'The gateway cannot be reached right now.'
        : gatewayState === 'connecting'
          ? 'Connecting to the gateway.'
          : agent
            ? `Sent as ${agent.label}, the way an agent sends it.`
            : 'No active passport to send as.';

  return (
    <div className="grid items-start gap-7 lg:grid-cols-[280px_minmax(0,1fr)]">
      <div className="flex flex-col gap-2">
        <div role="group" aria-label="What the agent asks for" className="flex flex-col gap-2">
          {ASKS.map((ask) => {
            const chosen = mine?.prompt === ask.prompt;
            return (
              <button
                key={ask.key}
                type="button"
                disabled={!ready || sending !== null}
                aria-pressed={chosen}
                onClick={() => void send(ask)}
                className={`flex items-center justify-between gap-3 rounded-[4px] border bg-sheet px-3.5 py-3 text-left text-[15px] text-ink transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                  chosen ? 'border-ink shadow-[inset_3px_0_0_var(--brand)]' : 'border-rule-strong hover:border-ink-2'
                }`}
              >
                <span className="font-medium">{sending === ask.key ? 'Sending' : ask.label}</span>
                <span className="tnum font-mono text-[13.5px] text-ink-2">{usd(askFare(ask))}</span>
              </button>
            );
          })}
        </div>
        <p className="text-[12.5px] leading-snug text-muted">{status}</p>
        {error ? (
          <p role="alert" className="text-[12.5px] leading-snug text-stop">
            {error}
          </p>
        ) : null}
      </div>

      <div
        aria-live="polite"
        className="flex flex-col overflow-hidden rounded-[4px] border border-rule-strong bg-sheet shadow-[0_1px_2px_rgba(28,27,24,0.06),0_10px_28px_rgba(28,27,24,0.08)] sm:flex-row"
      >
        <span className={`h-1 shrink-0 transition-colors sm:h-auto sm:w-1 ${EDGE[view.tone]}`} aria-hidden />
        <div className="min-w-0 flex-1 px-5 py-4">
          <div className="text-[13px] text-muted">
            <span className="font-medium text-ink">{view.agent}</span> · {view.note}
          </div>
          <p className="mt-1.5 text-[17px] leading-snug text-ink">{view.want}</p>
          <div className="mt-5 px-2">
            <GateTrack stations={view.stations} labelled />
          </div>
          <p className="border-t border-dashed border-rule pt-3 text-[14px] font-medium leading-snug text-ink">{view.detail}</p>
        </div>
        <span className="perforation my-3 hidden sm:block" aria-hidden />
        <div className="flex shrink-0 flex-col items-start gap-2.5 border-t border-rule px-5 py-4 sm:w-[210px] sm:border-t-0">
          <div>
            <div className="label">Fare</div>
            <div className="tnum mt-1 font-mono text-[26px] font-medium leading-none text-ink">{view.fare}</div>
            <div className="mt-1 text-[12px] text-muted">USDC · {network}</div>
          </div>
          <span key={view.key} className="land">
            <Stamp tone={view.tone}>{view.stamp}</Stamp>
          </span>
          {view.action}
        </div>
      </div>
    </div>
  );
}
