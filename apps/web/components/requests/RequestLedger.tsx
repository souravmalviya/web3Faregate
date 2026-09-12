'use client';

import { RESOURCE_LABELS, type AccessRequest, type AuditEvent } from '@faregate/shared';
import { Check, ChevronRight, ExternalLink, X } from 'lucide-react';
import { Fragment, useEffect, useState, type ReactNode } from 'react';

import { api, clockTime, hashscanUrl, shortAddress, shortHash, usd } from '@/lib/api';

import { EVENT_LABEL, describeEvent } from '../audit/events';
import { useConsole } from '../console/ConsoleProvider';
import { Button, CopyText, Empty, SectionHeading, Stamp, Tabs } from '../ui';
import { GateTrack } from './GateTrack';
import { fareAmount, stationsFor, verdictFor } from './model';

type Filter = 'all' | 'waiting' | 'cleared' | 'delivered' | 'refused';

const MATCH: Record<Filter, (r: AccessRequest) => boolean> = {
  all: () => true,
  waiting: (r) => r.status === 'awaiting_approval',
  cleared: (r) => r.status === 'payment_required' && !r.lastRefusal,
  delivered: (r) => r.status === 'fulfilled',
  refused: (r) =>
    r.status === 'rejected' || r.status === 'failed' || (r.status === 'payment_required' && Boolean(r.lastRefusal)),
};

const EMPTY_FILTER: Record<Filter, string> = {
  all: 'No requests.',
  waiting: 'Nothing is waiting for your signature.',
  cleared: 'No cleared requests are waiting to be paid.',
  delivered: 'Nothing has been delivered yet.',
  refused: 'Nothing has been refused.',
};

export function RequestLedger() {
  const { requests, health, agentLabel } = useConsole();
  const [filter, setFilter] = useState<Filter>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const network = health?.network ?? 'hedera:testnet';
  const rows = requests.filter(MATCH[filter]);
  const count = (f: Filter) => requests.filter(MATCH[f]).length;

  return (
    <section aria-labelledby="all-requests">
      <SectionHeading id="all-requests" title="All requests" meta="newest first" />
      <div className="mt-3">
        <Tabs
          label="Filter requests"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All', count: requests.length },
            { value: 'waiting', label: 'Needs you', count: count('waiting') },
            { value: 'cleared', label: 'Cleared', count: count('cleared') },
            { value: 'delivered', label: 'Delivered', count: count('delivered') },
            { value: 'refused', label: 'Refused', count: count('refused') },
          ]}
        />
      </div>

      {requests.length === 0 ? (
        <Empty title="No requests yet">
          Agents send requests to the gateway on their own. Run{' '}
          <code className="font-mono text-[12.5px] text-ink">npm run agent</code>, or send a test request from the panel
          on the right.
        </Empty>
      ) : rows.length === 0 ? (
        <Empty title={EMPTY_FILTER[filter]} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] table-fixed border-collapse text-left text-[13.5px]">
            <thead>
              <tr className="border-b border-rule">
                <th className="label w-[76px] py-2 pr-3 font-semibold">Time</th>
                <th className="label py-2 pr-3 font-semibold">Request</th>
                <th className="label w-[112px] py-2 pr-3 font-semibold">Route</th>
                <th className="label w-[80px] py-2 pr-4 text-right font-semibold">Fare</th>
                <th className="label w-[232px] py-2 pr-3 font-semibold">Status</th>
                <th className="w-8 py-2">
                  <span className="sr-only">Details</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((request) => (
                <LedgerRow
                  key={request.id}
                  request={request}
                  agentLabel={agentLabel(request.agentId)}
                  network={network}
                  open={openId === request.id}
                  onToggle={() => setOpenId((id) => (id === request.id ? null : request.id))}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function LedgerRow({
  request,
  agentLabel,
  network,
  open,
  onToggle,
}: {
  request: AccessRequest;
  agentLabel: string;
  network: string;
  open: boolean;
  onToggle: () => void;
}) {
  const verdict = verdictFor(request);
  const days = request.query.lookbackDays;
  const arrived = Date.now() - Date.parse(request.createdAt) < 6000;

  return (
    <>
      <tr
        onClick={onToggle}
        className={`cursor-pointer border-b border-rule align-middle transition-colors hover:bg-sheet ${
          open ? 'bg-sheet' : ''
        } ${arrived ? 'arrive' : ''}`}
      >
        <td
          className="tnum whitespace-nowrap py-2.5 pr-3 font-mono text-[12px] text-muted"
          title={new Date(request.createdAt).toLocaleString()}
        >
          {clockTime(request.createdAt)}
        </td>
        <td className="py-2.5 pr-3">
          <div className="truncate text-ink">{agentLabel}</div>
          <div className="truncate text-[12.5px] text-muted" title={request.query.address}>
            {RESOURCE_LABELS[request.query.resource]} · {days} {days === 1 ? 'day' : 'days'}
          </div>
        </td>
        <td className="py-2.5 pr-3">
          <GateTrack stations={stationsFor(request)} />
        </td>
        <td className="tnum py-2.5 pr-4 text-right font-mono text-[13px] text-ink">{usd(request.estimatedCostUsd)}</td>
        <td className="py-2.5 pr-3">
          <div className="flex min-w-0 items-center gap-2">
            <Stamp tone={verdict.tone}>{verdict.stamp}</Stamp>
            <span className="min-w-0 truncate text-[12.5px] text-ink-2" title={verdict.line}>
              {verdict.line}
            </span>
          </div>
        </td>
        <td className="py-2.5 text-right">
          <button
            type="button"
            aria-expanded={open}
            aria-label={open ? 'Hide details' : 'Show details'}
            onClick={(event) => {
              event.stopPropagation();
              onToggle();
            }}
            className="rounded-[2px] p-1 text-muted hover:bg-sheet-2 hover:text-ink"
          >
            <ChevronRight className={`h-4 w-4 transition-transform duration-150 ${open ? 'rotate-90' : ''}`} aria-hidden />
          </button>
        </td>
      </tr>
      {open ? (
        <tr className="border-b border-rule bg-sheet">
          <td colSpan={6} className="p-0">
            <RequestDetail request={request} network={network} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function Column({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-w-0 px-5 py-4 [overflow-wrap:anywhere]">
      <div className="label mb-2">{title}</div>
      {children}
    </div>
  );
}

function RequestDetail({ request, network }: { request: AccessRequest; network: string }) {
  const verdict = verdictFor(request);
  return (
    <div className="border-t border-rule">
      <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-2 px-5 pt-4">
        <GateTrack stations={stationsFor(request)} labelled />
        <p className="max-w-[440px] pb-5 text-[13px] leading-snug text-ink-2">{verdict.detail}</p>
      </div>
      <div className="grid border-t border-rule md:grid-cols-[1.15fr_1fr_1.15fr] md:divide-x md:divide-rule">
        <Column title="Decision">
          <DecisionBody request={request} />
        </Column>
        <Column title="Fare">
          <PaymentBody request={request} network={network} />
        </Column>
        <Column title="Data">
          <DataBody request={request} />
        </Column>
      </div>
      <Timeline requestId={request.id} version={request.updatedAt} />
    </div>
  );
}

function DecisionBody({ request }: { request: AccessRequest }) {
  const [explanation, setExplanation] = useState<string | null>(null);
  const [explaining, setExplaining] = useState(false);
  const allowed = request.decision?.allowed === true;
  const days = request.query.lookbackDays;

  return (
    <>
      <blockquote className="border-l-2 border-rule-strong pl-3 text-[13.5px] leading-relaxed text-ink">
        {request.prompt}
      </blockquote>
      <p className="mt-2 text-[12.5px] text-ink-2">
        Read as {RESOURCE_LABELS[request.query.resource].toLowerCase()} over {days} {days === 1 ? 'day' : 'days'} for{' '}
        <span className="font-mono">{shortAddress(request.query.address)}</span>.
      </p>
      <ul className="mt-3 space-y-1.5">
        {(request.decision?.reasons ?? []).map((reason, i) => (
          <li key={i} className="flex gap-2 text-[13px] text-ink">
            {allowed ? (
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-pass" aria-label="Passed" />
            ) : (
              <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-stop" aria-label="Failed" />
            )}
            <span>
              {reason.message}
              {reason.detail ? (
                <span className="block font-mono text-[11.5px] text-muted">
                  {Object.entries(reason.detail)
                    .map(([k, v]) => `${k} ${v}`)
                    .join(' · ')}
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      {request.approval ? (
        <p className="mt-3 text-[12.5px] text-ink-2">
          {request.approval.decision === 'approved' ? 'Approved' : 'Rejected'} by{' '}
          <span className="font-mono">{shortAddress(request.approval.by)}</span>
          {request.approval.signed ? ', wallet signed' : ', unsigned'} at {clockTime(request.approval.at)}.
        </p>
      ) : null}
      <div className="mt-3">
        <Button
          variant="quiet"
          size="sm"
          loading={explaining}
          className="-ml-2.5"
          onClick={async () => {
            setExplaining(true);
            try {
              const out = await api.explain(request.id);
              setExplanation(out.explanation);
            } catch (err) {
              setExplanation(err instanceof Error ? err.message : 'Could not explain this decision.');
            } finally {
              setExplaining(false);
            }
          }}
        >
          {explaining ? 'Explaining' : 'Explain in plain language'}
        </Button>
        {explanation ? <p className="mt-1 text-[13px] leading-relaxed text-ink">{explanation}</p> : null}
      </div>
    </>
  );
}

function PaymentBody({ request, network }: { request: AccessRequest; network: string }) {
  const payment = request.payment;
  if (!payment) {
    const note =
      request.status === 'awaiting_approval'
        ? 'No fare is paid until you approve.'
        : request.status === 'payment_required'
          ? request.lastRefusal
            ? 'Refused at the gate before payment. Nothing was paid.'
            : 'Cleared. The agent pays when it collects the data.'
          : request.status === 'failed'
            ? 'Data retrieval failed, so the fare was not settled.'
            : 'Refused before a price was quoted. Nothing was paid.';
    return <p className="text-[13px] leading-relaxed text-ink-2">{note}</p>;
  }

  const simulated = payment.verifiedBy === 'simulated';
  const net = payment.network || network;
  const txUrl = hashscanUrl(net, 'transaction', payment.txHash);
  const toUrl = hashscanUrl(net, 'account', payment.to);

  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="tnum font-mono text-[20px] font-medium text-ink">{fareAmount(payment)}</span>
        <Stamp tone={simulated ? 'hold' : payment.settled ? 'pass' : 'brand'}>
          {simulated ? 'Simulated' : payment.settled ? 'Settled' : 'Settling'}
        </Stamp>
      </div>
      <dl className="mt-3 grid grid-cols-[88px_minmax(0,1fr)] gap-y-1.5 text-[12.5px]">
        <dt className="text-muted">Network</dt>
        <dd className="font-mono text-ink">{net}</dd>
        <dt className="text-muted">Token</dt>
        <dd className="font-mono text-ink">{payment.asset}</dd>
        {payment.from ? (
          <>
            <dt className="text-muted">Paid by</dt>
            <dd>
              <CopyText value={payment.from} className="font-mono text-ink" />
            </dd>
          </>
        ) : null}
        <dt className="text-muted">Paid to</dt>
        <dd className="font-mono text-ink">
          {toUrl ? (
            <a href={toUrl} target="_blank" rel="noreferrer" className="hover:text-brand hover:underline">
              {payment.to}
            </a>
          ) : (
            payment.to
          )}
        </dd>
        <dt className="text-muted">Verified by</dt>
        <dd className="text-ink">{payment.verifiedBy === 'facilitator' ? 'x402 facilitator' : payment.verifiedBy}</dd>
        <dt className="text-muted">Transaction</dt>
        <dd className="min-w-0">
          {txUrl ? (
            <a
              href={txUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-mono text-brand hover:underline"
            >
              {shortHash(payment.txHash)}
              <ExternalLink className="h-3 w-3" aria-hidden />
              <span className="sr-only">on HashScan</span>
            </a>
          ) : (
            <span className="text-muted">{simulated ? 'Not a chain transaction' : 'Waiting for the id'}</span>
          )}
        </dd>
      </dl>
      {txUrl ? <p className="mt-2 text-[11.5px] text-muted">Opens the transfer on HashScan.</p> : null}
    </>
  );
}

function DataBody({ request }: { request: AccessRequest }) {
  const result = request.result;
  if (!result) {
    return (
      <p className={`text-[13px] leading-relaxed ${request.error ? 'text-stop' : 'text-ink-2'}`}>
        {request.error ?? 'Released only after the fare is paid.'}
      </p>
    );
  }

  const sources = result.provenance.source
    .split(' | ')
    .map((s) => s.split(':')[0] ?? '')
    .filter(Boolean);

  return (
    <>
      <p className="text-[12.5px] text-ink-2">
        {result.provenance.simulated ? 'Simulated data, not from any chain.' : `The Graph · ${sources.join(', ')}`}
      </p>
      {result.analysis ? (
        <>
          <p className="mt-2 text-[13.5px] leading-relaxed text-ink">{result.analysis}</p>
          <p className="mt-1 text-[11.5px] text-muted">
            Summary written by the model from this data. Addresses or hashes not found in the data are removed.
          </p>
        </>
      ) : result.analysisError ? (
        <p className="mt-2 text-[12.5px] text-stop">Summary unavailable: {result.analysisError}</p>
      ) : null}
      <details className="mt-3">
        <summary className="cursor-pointer text-[12.5px] text-brand hover:underline">Raw response</summary>
        <pre className="mt-2 max-h-64 overflow-auto border border-rule bg-paper p-3 font-mono text-[11.5px] leading-relaxed text-ink-2">
          {JSON.stringify(result.data, null, 2)}
        </pre>
      </details>
    </>
  );
}

function Timeline({ requestId, version }: { requestId: string; version: string }) {
  const [events, setEvents] = useState<AuditEvent[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .requestEvents(requestId)
      .then((list) => {
        if (!cancelled) setEvents(list);
      })
      .catch(() => {
        if (!cancelled) setEvents([]);
      });
    return () => {
      cancelled = true;
    };
  }, [requestId, version]);

  return (
    <div className="border-t border-rule px-5 py-4">
      <div className="label mb-2">Timeline</div>
      {events === null ? (
        <p className="text-[12.5px] text-muted">Loading the record for this request</p>
      ) : events.length === 0 ? (
        <p className="text-[12.5px] text-muted">No events recorded.</p>
      ) : (
        <div className="grid grid-cols-[72px_150px_minmax(0,1fr)] gap-x-4 gap-y-1 text-[12.5px]">
          {events.map((event) => (
            <Fragment key={event.id}>
              <span className="tnum font-mono text-muted">{clockTime(event.at)}</span>
              <span className="text-ink">{EVENT_LABEL[event.type]}</span>
              <span className="truncate text-ink-2" title={describeEvent(event)}>
                {describeEvent(event)}
              </span>
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
