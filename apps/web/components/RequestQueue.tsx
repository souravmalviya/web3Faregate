'use client';

import { useEffect, useState } from 'react';

import { RESOURCE_LABELS, type AccessRequest, type AuditEvent } from '@faregate/shared';

import { api, clockTime, hashscanUrl, shortAddress, shortHash, timeAgo, usd } from '@/lib/api';

import { Button, Empty, Kv, Pill, STATUS_LABEL, Section, toneFor } from './ui';

export function RequestQueue({
  requests,
  agentLabels,
  canAct,
  network,
  onApprove,
  busy,
}: {
  requests: AccessRequest[];
  agentLabels: Record<string, string>;
  canAct: boolean;
  network: string;
  onApprove: (id: string, decision: 'approved' | 'rejected') => Promise<void>;
  busy: string | null;
}) {
  const waiting = requests.filter((r) => r.status === 'awaiting_approval').length;

  return (
    <Section
      eyebrow="Request queue"
      title="What agents are asking for"
      aside={waiting > 0 ? `${waiting} waiting on you` : `${requests.length} total`}
    >
      {requests.length === 0 ? (
        <Empty>No requests yet. Run the demo agent, or submit one below.</Empty>
      ) : (
        <div className="overflow-x-auto rounded-sm border border-rule bg-surface">
          <table className="w-full min-w-[820px] border-collapse">
            <thead>
              <tr className="border-b border-rule-strong">
                <Th>When</Th>
                <Th>Agent</Th>
                <Th>Query</Th>
                <Th right>Cost</Th>
                <Th>Status</Th>
                <Th right>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {requests.map((request) => (
                <Row
                  key={request.id}
                  request={request}
                  agentLabel={agentLabels[request.agentId] ?? request.agentId}
                  canAct={canAct}
                  network={network}
                  onApprove={onApprove}
                  busy={busy === request.id}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th className={`eyebrow px-3 py-2 font-medium ${right ? 'text-right' : 'text-left'}`}>{children}</th>
  );
}

/** True when the deterministic engine refused this request because the passport was revoked. */
function deniedForRevocation(request: AccessRequest): boolean {
  return (
    request.status === 'rejected' &&
    (request.decision?.reasons ?? []).some((r) => r.code === 'agent_revoked')
  );
}

function Row({
  request,
  agentLabel,
  canAct,
  network,
  onApprove,
  busy,
}: {
  request: AccessRequest;
  agentLabel: string;
  canAct: boolean;
  network: string;
  onApprove: (id: string, decision: 'approved' | 'rejected') => Promise<void>;
  busy: boolean;
}) {
  const revokedDenial = deniedForRevocation(request);
  const [open, setOpen] = useState(request.status === 'awaiting_approval' || revokedDenial);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [explaining, setExplaining] = useState(false);
  const tone = toneFor(request.status);
  const waiting = request.status === 'awaiting_approval';

  return (
    <>
      <tr
        className={`cursor-pointer border-b border-rule align-top hover:bg-surface-2/60 ${
          waiting ? 'bg-hold-fill/40' : revokedDenial ? 'bg-stop-fill/40' : ''
        }`}
        onClick={() => setOpen((v) => !v)}
      >
        <td className="px-3 py-2.5 font-mono text-[12px] whitespace-nowrap text-muted">
          {timeAgo(request.createdAt)}
        </td>
        <td className="px-3 py-2.5">
          <div className="text-[14px] text-ink">{agentLabel}</div>
          <div className="truncate font-mono text-[11px] text-muted">{request.agentId}</div>
        </td>
        <td className="px-3 py-2.5">
          <div className="text-[14px] text-ink">
            {RESOURCE_LABELS[request.query.resource]}{' '}
            <span className="text-muted">· {request.query.lookbackDays}d</span>
          </div>
          <div className="font-mono text-[11px] text-muted">{shortAddress(request.query.address)}</div>
        </td>
        <td className="tnum px-3 py-2.5 text-right font-mono text-[13px] whitespace-nowrap text-ink">
          {usd(request.estimatedCostUsd)}
        </td>
        <td className="px-3 py-2.5">
          {revokedDenial ? (
            <Pill tone="stop">Access denied · agent revoked</Pill>
          ) : (
            <Pill tone={tone}>{STATUS_LABEL[request.status]}</Pill>
          )}
          {request.lastRefusal ? (
            <div className="mt-1 max-w-[220px] text-[11.5px] leading-snug text-stop">
              Refused at the gate: {request.lastRefusal.reason}
            </div>
          ) : null}
        </td>
        <td className="px-3 py-2.5 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
          {waiting ? (
            <span className="inline-flex gap-1.5">
              <Button
                variant="approve"
                disabled={!canAct || busy}
                title={canAct ? 'Signs the approval with your wallet' : 'Connect a wallet on Sepolia to approve'}
                onClick={() => onApprove(request.id, 'approved')}
              >
                {busy ? 'Signing…' : 'Approve'}
              </Button>
              <Button
                variant="danger"
                disabled={!canAct || busy}
                title={canAct ? 'Signs the rejection with your wallet' : 'Connect a wallet on Sepolia to reject'}
                onClick={() => onApprove(request.id, 'rejected')}
              >
                Reject
              </Button>
            </span>
          ) : (
            <Button variant="quiet" onClick={() => setOpen((v) => !v)}>
              {open ? 'Hide' : 'Details'}
            </Button>
          )}
        </td>
      </tr>

      {open ? (
        <tr className="border-b border-rule bg-surface-2/30">
          <td colSpan={6} className="px-4 py-4">
            {revokedDenial ? (
              <div className="mb-4 rounded-sm border border-stop bg-stop-fill px-4 py-3">
                <div className="display text-[18px] font-bold tracking-[0.06em] text-stop">Access denied · agent revoked</div>
                <p className="mt-1 text-[13.5px] text-ink-2">
                  The owner revoked this passport. The deterministic policy engine refused the request before any
                  price was quoted. The agent got nothing and paid nothing.
                </p>
              </div>
            ) : null}

            <div className="grid gap-5 md:grid-cols-[1.2fr_1fr]">
              <div className="flex flex-col gap-4">
                <div>
                  <div className="eyebrow mb-1">Agent asked</div>
                  <div className="text-[14px] text-ink-2">“{request.prompt}”</div>
                </div>

                <div>
                  <div className="eyebrow mb-1.5">Policy decision</div>
                  <ul className="flex flex-col gap-1">
                    {(request.decision?.reasons ?? []).map((reason, i) => (
                      <li key={i} className="flex gap-2 text-[14px]">
                        <span
                          className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${
                            request.decision?.allowed ? 'bg-pass' : 'bg-stop'
                          }`}
                        />
                        <span>
                          <span className="text-ink">{reason.message}</span>
                          {reason.detail ? (
                            <span className="ml-2 font-mono text-[11.5px] text-muted">
                              {Object.entries(reason.detail)
                                .map(([k, v]) => `${k}=${v}`)
                                .join('  ')}
                            </span>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-2 flex items-center gap-2">
                    <Button
                      variant="quiet"
                      disabled={explaining}
                      onClick={async () => {
                        setExplaining(true);
                        try {
                          const out = await api.explain(request.id);
                          setExplanation(`${out.explanation}  [${out.provider}]`);
                        } catch (err) {
                          setExplanation(err instanceof Error ? err.message : 'Could not explain.');
                        } finally {
                          setExplaining(false);
                        }
                      }}
                    >
                      {explaining ? 'Explaining…' : 'Explain in plain language'}
                    </Button>
                  </div>
                  {explanation ? (
                    <p className="mt-2 border-l-2 border-brass pl-3 text-[14px] text-ink-2">{explanation}</p>
                  ) : null}
                </div>

                {request.approval ? (
                  <div>
                    <div className="eyebrow mb-1">Human decision</div>
                    <div className="flex flex-wrap items-center gap-2 text-[14px]">
                      <Pill tone={request.approval.decision === 'approved' ? 'pass' : 'stop'}>
                        {request.approval.decision}
                      </Pill>
                      <Pill tone={request.approval.signed ? 'pass' : 'hold'}>
                        {request.approval.signed ? 'wallet signed' : 'unsigned'}
                      </Pill>
                      <span className="font-mono text-[12px] text-muted">
                        by {shortAddress(request.approval.by)} · {timeAgo(request.approval.at)}
                      </span>
                    </div>
                  </div>
                ) : null}

                <Timeline requestId={request.id} version={request.updatedAt} />
              </div>

              <div className="flex flex-col gap-4">
                {request.payment ? (
                  <PaymentCard payment={request.payment} network={network} />
                ) : null}

                {request.result ? (
                  <div className="rounded-sm border border-rule bg-surface p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="eyebrow">Data</span>
                      <Pill tone={request.result.provenance.simulated ? 'hold' : 'pass'}>
                        {request.result.provenance.simulated ? 'simulated' : request.result.provenance.provider}
                      </Pill>
                    </div>
                    <div className="mb-2 font-mono text-[11px] text-muted">
                      source {request.result.provenance.source}
                    </div>
                    {request.result.analysis ? (
                      <p className="text-[14px] text-ink-2">{request.result.analysis}</p>
                    ) : request.result.analysisError ? (
                      <p className="text-[13px] text-stop">Analysis unavailable: {request.result.analysisError}</p>
                    ) : null}
                    <details className="mt-2">
                      <summary className="cursor-pointer font-mono text-[11.5px] text-muted">raw data</summary>
                      <pre className="mt-1 max-h-64 overflow-auto rounded-sm bg-surface-2 p-2 font-mono text-[11px] text-ink-2">
                        {JSON.stringify(request.result.data, null, 2)}
                      </pre>
                    </details>
                  </div>
                ) : null}

                {request.error ? (
                  <div className="rounded-sm border border-stop bg-stop-fill p-3 text-[13px] text-stop">{request.error}</div>
                ) : null}
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function PaymentCard({ payment, network }: { payment: NonNullable<AccessRequest['payment']>; network: string }) {
  const simulated = payment.verifiedBy === 'simulated';
  const txUrl = hashscanUrl(payment.network || network, 'transaction', payment.txHash);
  const toUrl = hashscanUrl(payment.network || network, 'account', payment.to);
  return (
    <div className="rounded-sm border border-rule bg-surface p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="eyebrow">Payment</span>
        <Pill tone={simulated ? 'hold' : payment.settled ? 'pass' : 'info'}>
          {simulated ? 'simulated' : payment.settled ? 'settled onchain' : 'verified, settling'}
        </Pill>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        <Kv label="Amount">
          {payment.amount} <span className="text-muted">atomic units</span>
        </Kv>
        <Kv label="Network">{payment.network}</Kv>
        <Kv label="Asset">{payment.asset}</Kv>
        <Kv label="Verified by">{payment.verifiedBy}</Kv>
        <Kv label="Transaction">
          {txUrl ? (
            <a className="font-mono text-[12px] text-info underline" href={txUrl} target="_blank" rel="noreferrer">
              {shortHash(payment.txHash)} ↗
            </a>
          ) : (
            <span className="font-mono text-[12px]">{shortHash(payment.txHash) || 'pending'}</span>
          )}
        </Kv>
        <Kv label="Paid to">
          {toUrl ? (
            <a className="font-mono text-[12px] text-info underline" href={toUrl} target="_blank" rel="noreferrer">
              {payment.to} ↗
            </a>
          ) : (
            <span className="font-mono text-[12px]">{payment.to}</span>
          )}
        </Kv>
      </div>
      {simulated ? (
        <p className="mt-2 text-[12px] text-muted">
          No Hedera account is configured, so this receipt is simulated and is not a chain fact.
        </p>
      ) : null}
    </div>
  );
}

/** The request's own audit timeline, fetched when the row is open. */
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

  if (events === null) return <div className="text-[12.5px] text-muted">Loading timeline…</div>;
  if (events.length === 0) return null;

  return (
    <div>
      <div className="eyebrow mb-1.5">What happened</div>
      <ol className="flex flex-col gap-1 border-l border-rule pl-3">
        {events.map((event) => (
          <li key={event.id} className="flex flex-wrap items-baseline gap-x-2 text-[12.5px]">
            <span className="font-mono text-[11px] text-muted">{clockTime(event.at)}</span>
            <span className="font-mono text-[11.5px] text-ink">{event.type}</span>
            <span className="text-muted">{summarise(event)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function summarise(event: AuditEvent): string {
  const d = event.detail as Record<string, unknown>;
  switch (event.type) {
    case 'request.received':
      return `interpreted by ${String(d.interpretedBy ?? '')}`;
    case 'request.evaluated':
      return `${d.allowed ? 'allowed' : 'denied'}: ${(d.reasons as string[] | undefined)?.join(', ') ?? ''}`;
    case 'request.approved':
    case 'request.rejected':
      return d.by ? `by ${shortAddress(String(d.by))}${d.signed ? ', wallet signed' : ''}` : '';
    case 'payment.verified':
      return d.simulated ? 'simulated receipt' : `${shortHash(String(d.txHash ?? ''))}${d.settled ? ' settled' : ''}`;
    case 'payment.rejected':
      return String(d.reason ?? '');
    case 'data.retrieved':
      return d.simulated ? 'simulated data' : `from ${String(d.provider)}`;
    case 'analysis.completed': {
      const warnings = d.groundingWarnings as string[] | undefined;
      return warnings && warnings.length > 0 ? `${warnings.length} unverified value(s) removed` : 'grounded';
    }
    case 'request.fulfilled':
      return `spent today ${usd(Number(d.spentTodayUsd ?? 0))}`;
    default:
      return '';
  }
}
