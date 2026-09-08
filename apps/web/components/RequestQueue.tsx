'use client';

import { useState } from 'react';

import { RESOURCE_LABELS, type AccessRequest } from '@faregate/shared';

import { api, shortAddress, shortHash, timeAgo, usd } from '@/lib/api';

import { Button, Empty, Kv, Pill, STATUS_LABEL, Section, toneFor } from './ui';

export function RequestQueue({
  requests,
  agentLabels,
  canApprove,
  onApprove,
  busy,
}: {
  requests: AccessRequest[];
  agentLabels: Record<string, string>;
  canApprove: boolean;
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
                  canApprove={canApprove}
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

function Row({
  request,
  agentLabel,
  canApprove,
  onApprove,
  busy,
}: {
  request: AccessRequest;
  agentLabel: string;
  canApprove: boolean;
  onApprove: (id: string, decision: 'approved' | 'rejected') => Promise<void>;
  busy: boolean;
}) {
  const [open, setOpen] = useState(request.status === 'awaiting_approval');
  const [explanation, setExplanation] = useState<string | null>(null);
  const [explaining, setExplaining] = useState(false);
  const tone = toneFor(request.status);
  const waiting = request.status === 'awaiting_approval';

  return (
    <>
      <tr
        className={`cursor-pointer border-b border-rule align-top hover:bg-surface-2/60 ${waiting ? 'bg-hold-fill/40' : ''}`}
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
          <Pill tone={tone}>{STATUS_LABEL[request.status]}</Pill>
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
                disabled={!canApprove || busy}
                title={canApprove ? undefined : 'Connect a wallet to approve'}
                onClick={() => onApprove(request.id, 'approved')}
              >
                Approve
              </Button>
              <Button
                variant="danger"
                disabled={!canApprove || busy}
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
                    <div className="text-[14px]">
                      <Pill tone={request.approval.decision === 'approved' ? 'pass' : 'stop'}>
                        {request.approval.decision}
                      </Pill>{' '}
                      <span className="font-mono text-[12px] text-muted">
                        by {shortAddress(request.approval.by)} · {timeAgo(request.approval.at)}
                      </span>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="flex flex-col gap-4">
                {request.payment ? (
                  <div className="rounded-sm border border-rule bg-surface p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="eyebrow">Payment</span>
                      <Pill tone={request.payment.verifiedBy === 'simulated' ? 'hold' : request.payment.settled ? 'pass' : 'info'}>
                        {request.payment.verifiedBy === 'simulated'
                          ? 'simulated'
                          : request.payment.settled
                            ? 'settled'
                            : 'verified'}
                      </Pill>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                      <Kv label="Amount">
                        {request.payment.amount} <span className="text-muted">units</span>
                      </Kv>
                      <Kv label="Network">{request.payment.network}</Kv>
                      <Kv label="Asset">{request.payment.asset}</Kv>
                      <Kv label="Transaction">
                        <span className="font-mono text-[12px]">{shortHash(request.payment.txHash) || 'pending'}</span>
                      </Kv>
                    </div>
                  </div>
                ) : null}

                {request.result ? (
                  <div className="rounded-sm border border-rule bg-surface p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="eyebrow">Data</span>
                      <Pill tone={request.result.provenance.simulated ? 'hold' : 'pass'}>
                        {request.result.provenance.simulated ? 'simulated' : request.result.provenance.provider}
                      </Pill>
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
