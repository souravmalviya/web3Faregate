'use client';

import { AnimatePresence, motion } from 'framer-motion';
import {
  Ban,
  Check,
  ChevronDown,
  CircleCheck,
  CircleX,
  Clock,
  Coins,
  Database,
  ExternalLink,
  Inbox,
  ScrollText,
  ShieldAlert,
  Sparkles,
  X,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import { RESOURCE_LABELS, type AccessRequest, type AuditEvent } from '@faregate/shared';

import { api, clockTime, hashscanUrl, shortAddress, shortHash, timeAgo, usd } from '@/lib/api';

import { Badge, Button, Empty, ICON_TONE, Label, STATUS_LABEL, Section, toneFor } from './ui';

/** USDC on Hedera testnet and mainnet. Six decimals, so atomic units are micro-dollars. */
const USDC_ASSETS = new Set(['0.0.429274', '0.0.456858']);

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
      icon={<Inbox className="h-4.5 w-4.5" aria-hidden />}
      title="What agents are asking for"
      description="Each request is checked, approved if needed, paid for, and only then answered."
      aside={
        waiting > 0 ? (
          <Badge tone="hold" dot pulse>
            {waiting} waiting on you
          </Badge>
        ) : (
          <span>{requests.length} total</span>
        )
      }
    >
      {requests.length === 0 ? (
        <Empty icon={<Inbox className="h-6 w-6" aria-hidden />} title="No requests yet">
          Run the demo agent with{' '}
          <code className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[12px] text-zinc-200">npm run agent</code>, or
          send one from the box below.
        </Empty>
      ) : (
        <ul className="flex flex-col gap-3">
          <AnimatePresence initial={false}>
            {requests.map((request) => (
              <RequestCard
                key={request.id}
                request={request}
                agentLabel={agentLabels[request.agentId] ?? request.agentId}
                canAct={canAct}
                network={network}
                onApprove={onApprove}
                busy={busy === request.id}
              />
            ))}
          </AnimatePresence>
        </ul>
      )}
    </Section>
  );
}

/** True when the deterministic engine refused this request because the passport was revoked. */
function deniedForRevocation(request: AccessRequest): boolean {
  return (
    request.status === 'rejected' && (request.decision?.reasons ?? []).some((r) => r.code === 'agent_revoked')
  );
}

// --- progress ---------------------------------------------------------------------

type StepState = 'done' | 'current' | 'blocked' | 'skipped' | 'todo';

interface Step {
  label: string;
  state: StepState;
}

/** Where a request is on its way from question to answer. */
function stepsFor(r: AccessRequest): Step[] {
  const allowed = r.decision?.allowed === true;
  const needsHuman = r.decision?.requiresHumanApproval === true;
  const human = r.approval?.decision;
  const delivered = Boolean(r.result);
  const paid = Boolean(r.payment && (r.payment.settled || r.payment.verifiedBy === 'simulated'));
  const failed = r.status === 'failed';
  const refusedAtGate = Boolean(r.lastRefusal) && !delivered;
  const clearedToPay = allowed && (!needsHuman || human === 'approved');

  const rules: StepState = allowed ? 'done' : r.decision ? 'blocked' : 'todo';

  let approval: StepState = 'todo';
  if (allowed) {
    if (!needsHuman) approval = 'skipped';
    else if (human === 'approved') approval = 'done';
    else if (human === 'rejected') approval = 'blocked';
    else approval = 'current';
  }

  let payment: StepState = 'todo';
  if (paid) payment = 'done';
  else if (clearedToPay) payment = refusedAtGate || failed ? 'blocked' : 'current';

  let data: StepState = 'todo';
  if (delivered) data = 'done';
  else if (failed) data = 'blocked';
  else if (paid) data = 'current';

  return [
    { label: 'Asked', state: 'done' },
    { label: 'Rules', state: rules },
    { label: allowed && !needsHuman ? 'Auto' : 'Approval', state: approval },
    { label: 'Paid', state: payment },
    { label: 'Data', state: data },
  ];
}

const STEP_CLASS: Record<StepState, string> = {
  done: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200',
  current: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
  blocked: 'border-rose-400/30 bg-rose-400/10 text-rose-200',
  skipped: 'border-dashed border-white/15 text-zinc-400',
  todo: 'border-white/[0.06] text-zinc-600',
};

const STEP_HINT: Record<StepState, string> = {
  done: 'done',
  current: 'in progress',
  blocked: 'stopped here',
  skipped: 'not needed',
  todo: 'not reached',
};

function StepIcon({ state }: { state: StepState }) {
  if (state === 'done' || state === 'skipped') return <Check className="h-3 w-3" aria-hidden />;
  if (state === 'blocked') return <X className="h-3 w-3" aria-hidden />;
  if (state === 'current') return <Clock className="h-3 w-3" aria-hidden />;
  return <span className="h-1 w-1 rounded-full bg-current" aria-hidden />;
}

function Stepper({ steps }: { steps: Step[] }) {
  return (
    <ol className="flex flex-wrap items-center gap-1" aria-label="Progress">
      {steps.map((step, i) => (
        <li key={step.label} className="flex items-center gap-1">
          <span
            title={`${step.label}: ${STEP_HINT[step.state]}`}
            className={`inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[11px] font-medium ${STEP_CLASS[step.state]}`}
          >
            <StepIcon state={step.state} />
            {step.label}
          </span>
          {i < steps.length - 1 ? <span className="h-px w-2.5 bg-white/10" aria-hidden /> : null}
        </li>
      ))}
    </ol>
  );
}

// --- card -------------------------------------------------------------------------

function StatusIcon({ request, revokedDenial }: { request: AccessRequest; revokedDenial: boolean }) {
  const tone = revokedDenial ? 'stop' : toneFor(request.status);
  const Icon = revokedDenial
    ? Ban
    : request.status === 'fulfilled'
      ? CircleCheck
      : request.status === 'awaiting_approval'
        ? Clock
        : request.status === 'rejected' || request.status === 'failed'
          ? CircleX
          : Coins;
  return (
    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${ICON_TONE[tone]}`}>
      <Icon className="h-5 w-5" aria-hidden />
    </span>
  );
}

function Notice({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-rose-400/20 bg-rose-500/[0.07] px-3.5 py-2.5 text-[13px] leading-relaxed text-rose-200/90 sm:ml-[52px]">
      <span className="mt-0.5 shrink-0 text-rose-300">{icon}</span>
      <div>{children}</div>
    </div>
  );
}

function RequestCard({
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
  const [open, setOpen] = useState(false);
  const revokedDenial = deniedForRevocation(request);
  const waiting = request.status === 'awaiting_approval';
  const days = request.query.lookbackDays;

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className={`overflow-hidden rounded-2xl border bg-white/[0.03] transition-colors ${
        waiting
          ? 'border-amber-400/35 shadow-[0_12px_40px_-16px_rgba(251,191,36,0.35)]'
          : revokedDenial
            ? 'border-rose-400/30'
            : 'border-white/[0.08] hover:border-white/15'
      }`}
    >
      <div className="flex flex-col gap-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-start gap-3">
          <StatusIcon request={request} revokedDenial={revokedDenial} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-[15px] font-semibold text-white">{agentLabel}</span>
              <span className="truncate font-mono text-[12px] text-zinc-500">{request.agentId}</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] text-zinc-400">
              <span className="text-zinc-200">{RESOURCE_LABELS[request.query.resource]}</span>
              <span aria-hidden>·</span>
              <span>
                {days} {days === 1 ? 'day' : 'days'}
              </span>
              <span aria-hidden>·</span>
              <span className="font-mono text-[12px]">{shortAddress(request.query.address)}</span>
              <span aria-hidden>·</span>
              <span>{timeAgo(request.createdAt)}</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="tnum font-mono text-[17px] font-semibold text-white">{usd(request.estimatedCostUsd)}</div>
              <div className="text-[11px] text-zinc-500">USDC</div>
            </div>
            {revokedDenial ? (
              <Badge tone="stop" dot>
                Access denied · agent revoked
              </Badge>
            ) : (
              <Badge tone={toneFor(request.status)} dot pulse={waiting}>
                {STATUS_LABEL[request.status]}
              </Badge>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 sm:pl-[52px]">
          <Stepper steps={stepsFor(request)} />
          <div className="flex items-center gap-2">
            {waiting ? (
              <>
                <Button
                  variant="approve"
                  size="sm"
                  disabled={!canAct}
                  loading={busy}
                  title={canAct ? 'Signs the approval with your wallet' : 'Connect a wallet on Sepolia to approve'}
                  icon={<Check className="h-4 w-4" aria-hidden />}
                  onClick={() => onApprove(request.id, 'approved')}
                >
                  {busy ? 'Signing…' : 'Approve'}
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={!canAct || busy}
                  title={canAct ? 'Signs the rejection with your wallet' : 'Connect a wallet on Sepolia to reject'}
                  icon={<X className="h-4 w-4" aria-hidden />}
                  onClick={() => onApprove(request.id, 'rejected')}
                >
                  Reject
                </Button>
              </>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
              icon={
                <ChevronDown
                  className={`h-4 w-4 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
                  aria-hidden
                />
              }
            >
              {open ? 'Hide' : 'Details'}
            </Button>
          </div>
        </div>

        {revokedDenial ? (
          <Notice icon={<Ban className="h-4 w-4" aria-hidden />}>
            <span className="font-medium text-rose-100">The owner revoked this passport.</span> The request was refused
            before any price was quoted. The agent got nothing and paid nothing.
          </Notice>
        ) : request.lastRefusal && !request.result ? (
          <Notice icon={<ShieldAlert className="h-4 w-4" aria-hidden />}>
            <span className="font-medium text-rose-100">Refused at the gate.</span> {request.lastRefusal.reason}
          </Notice>
        ) : null}
      </div>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="details"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <RequestDetails request={request} network={network} />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.li>
  );
}

// --- details ----------------------------------------------------------------------

function Panel({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-white">
        <span className="text-violet-300">{icon}</span>
        {title}
      </div>
      {children}
    </div>
  );
}

function RequestDetails({ request, network }: { request: AccessRequest; network: string }) {
  const [explanation, setExplanation] = useState<string | null>(null);
  const [explaining, setExplaining] = useState(false);
  const allowed = request.decision?.allowed === true;

  return (
    <div className="flex flex-col gap-4 border-t border-white/[0.06] bg-black/20 p-4 sm:p-5">
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel icon={<ScrollText className="h-4 w-4" aria-hidden />} title="Decision">
          <Label>Agent asked</Label>
          <p className="mt-1 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[13px] leading-relaxed text-zinc-200">
            “{request.prompt}”
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {(request.decision?.reasons ?? []).map((reason, i) => (
              <li key={i} className="flex gap-2 text-[13px]">
                {allowed ? (
                  <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden />
                ) : (
                  <CircleX className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" aria-hidden />
                )}
                <span className="text-zinc-200">
                  {reason.message}
                  {reason.detail ? (
                    <span className="mt-0.5 block font-mono text-[11px] text-zinc-500">
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
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge tone={request.approval.decision === 'approved' ? 'pass' : 'stop'}>{request.approval.decision}</Badge>
              <Badge tone={request.approval.signed ? 'brand' : 'hold'}>
                {request.approval.signed ? 'wallet signed' : 'unsigned'}
              </Badge>
              <span className="font-mono text-[11.5px] text-zinc-500">
                by {shortAddress(request.approval.by)} · {timeAgo(request.approval.at)}
              </span>
            </div>
          ) : null}
          <div className="mt-3">
            <Button
              variant="quiet"
              size="sm"
              loading={explaining}
              icon={<Sparkles className="h-3.5 w-3.5" aria-hidden />}
              onClick={async () => {
                setExplaining(true);
                try {
                  const out = await api.explain(request.id);
                  setExplanation(out.explanation);
                } catch (err) {
                  setExplanation(err instanceof Error ? err.message : 'Could not explain.');
                } finally {
                  setExplaining(false);
                }
              }}
            >
              {explaining ? 'Explaining…' : 'Explain in plain language'}
            </Button>
            {explanation ? (
              <p className="mt-2 border-l-2 border-violet-400/60 bg-violet-500/[0.06] px-3 py-2 text-[13px] leading-relaxed text-zinc-200">
                {explanation}
              </p>
            ) : null}
          </div>
        </Panel>

        <Panel icon={<Coins className="h-4 w-4" aria-hidden />} title="Payment">
          {request.payment ? (
            <PaymentBody payment={request.payment} network={network} />
          ) : (
            <p className="text-[13px] leading-relaxed text-zinc-400">
              {request.status === 'payment_required'
                ? 'Cleared to pay. The agent pays when it collects the data.'
                : request.status === 'awaiting_approval'
                  ? 'Nothing is paid until you approve.'
                  : 'No payment was made.'}
            </p>
          )}
        </Panel>

        <Panel icon={<Database className="h-4 w-4" aria-hidden />} title="Data and summary">
          {request.result ? (
            <ResultBody result={request.result} />
          ) : request.error ? (
            <p className="text-[13px] leading-relaxed text-rose-300">{request.error}</p>
          ) : (
            <p className="text-[13px] leading-relaxed text-zinc-400">Data is released only after the payment clears.</p>
          )}
        </Panel>
      </div>

      <Timeline requestId={request.id} version={request.updatedAt} />
    </div>
  );
}

function PaymentBody({ payment, network }: { payment: NonNullable<AccessRequest['payment']>; network: string }) {
  const simulated = payment.verifiedBy === 'simulated';
  const net = payment.network || network;
  const txUrl = hashscanUrl(net, 'transaction', payment.txHash);
  const toUrl = hashscanUrl(net, 'account', payment.to);
  const units = Number(payment.amount);
  const amount =
    USDC_ASSETS.has(payment.asset) && Number.isFinite(units) ? `${usd(units / 1_000_000)} USDC` : `${payment.amount} units`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="tnum font-mono text-[20px] font-semibold text-white">{amount}</span>
        <Badge tone={simulated ? 'hold' : payment.settled ? 'pass' : 'info'} dot>
          {simulated ? 'simulated' : payment.settled ? 'settled onchain' : 'settling'}
        </Badge>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12.5px]">
        <dt className="text-zinc-500">Network</dt>
        <dd className="font-mono text-zinc-200">{net}</dd>
        <dt className="text-zinc-500">Token</dt>
        <dd className="font-mono text-zinc-200">{payment.asset}</dd>
        <dt className="text-zinc-500">Paid to</dt>
        <dd className="font-mono text-zinc-200">
          {toUrl ? (
            <a href={toUrl} target="_blank" rel="noreferrer" className="hover:text-white hover:underline">
              {payment.to}
            </a>
          ) : (
            payment.to
          )}
        </dd>
        <dt className="text-zinc-500">Verified by</dt>
        <dd className="text-zinc-200">{payment.verifiedBy === 'facilitator' ? 'x402 facilitator' : payment.verifiedBy}</dd>
      </dl>
      {txUrl ? (
        <a
          href={txUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-400/25 bg-emerald-400/10 px-3 py-2 text-[12.5px] font-medium text-emerald-200 transition-colors hover:bg-emerald-400/20"
        >
          View on HashScan
          <span className="font-mono text-[11.5px] text-emerald-300/80">{shortHash(payment.txHash)}</span>
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </a>
      ) : simulated ? (
        <p className="text-[12px] text-zinc-500">
          No Hedera account is configured, so this receipt is simulated and is not a chain fact.
        </p>
      ) : (
        <p className="text-[12px] text-zinc-500">Waiting for the transaction id.</p>
      )}
    </div>
  );
}

function ResultBody({ result }: { result: NonNullable<AccessRequest['result']> }) {
  const sources = result.provenance.source
    .split(' | ')
    .map((s) => s.split(':')[0] ?? '')
    .filter(Boolean);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={result.provenance.simulated ? 'hold' : 'pass'} dot>
          {result.provenance.simulated ? 'simulated data' : 'live from The Graph'}
        </Badge>
        {result.provenance.simulated
          ? null
          : sources.map((source) => (
              <Badge key={source} tone="neutral">
                {source}
              </Badge>
            ))}
      </div>
      {result.analysis ? (
        <div className="rounded-lg border border-violet-400/20 bg-linear-to-br from-violet-500/[0.08] to-cyan-500/[0.04] p-3">
          <div className="mb-1 flex items-center gap-1.5 text-[11.5px] font-medium text-violet-200">
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            AI summary, checked against the data
          </div>
          <p className="text-[13px] leading-relaxed text-zinc-200">{result.analysis}</p>
        </div>
      ) : result.analysisError ? (
        <p className="text-[12.5px] text-rose-300">Summary unavailable: {result.analysisError}</p>
      ) : null}
      <details className="rounded-lg border border-white/[0.06] bg-black/30">
        <summary className="cursor-pointer select-none px-3 py-2 text-[12px] text-zinc-400 hover:text-zinc-200">
          Raw data
        </summary>
        <pre className="scroll-thin max-h-64 overflow-auto px-3 pb-3 font-mono text-[11px] leading-relaxed text-zinc-300">
          {JSON.stringify(result.data, null, 2)}
        </pre>
      </details>
    </div>
  );
}

/** The request's own audit timeline, fetched when the card is open. */
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

  if (events === null) return <div className="text-[12.5px] text-zinc-500">Loading timeline…</div>;
  if (events.length === 0) return null;

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="mb-3 text-[13px] font-semibold text-white">What happened</div>
      <ol className="flex flex-col gap-2.5 border-l border-white/10 pl-4">
        {events.map((event) => (
          <li key={event.id} className="relative flex flex-wrap items-baseline gap-x-3 text-[12.5px]">
            <span
              className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full border border-violet-300/70 bg-[#0b0c12]"
              aria-hidden
            />
            <span className="font-mono text-[11px] text-zinc-500">{clockTime(event.at)}</span>
            <span className="font-mono text-[12px] text-zinc-200">{event.type}</span>
            <span className="text-zinc-400">{summarise(event)}</span>
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
      return String(d.reason ?? d.stage ?? '');
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
