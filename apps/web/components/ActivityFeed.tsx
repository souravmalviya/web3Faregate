'use client';

import type { AuditEvent, AuditEventType } from '@faregate/shared';

import { shortHash, timeAgo } from '@/lib/api';

import { Empty, Pill, Section, type Tone } from './ui';

const EVENT_TONE: Record<AuditEventType, Tone> = {
  'agent.created': 'info',
  'agent.revoked': 'stop',
  'policy.updated': 'info',
  'request.received': 'neutral',
  'request.evaluated': 'neutral',
  'request.approval_requested': 'hold',
  'request.approved': 'pass',
  'request.rejected': 'stop',
  'payment.required': 'info',
  'payment.verified': 'pass',
  'payment.rejected': 'stop',
  'data.retrieved': 'pass',
  'analysis.completed': 'neutral',
  'request.fulfilled': 'pass',
  'request.failed': 'stop',
};

function describe(event: AuditEvent): string {
  const d = event.detail as Record<string, unknown>;
  switch (event.type) {
    case 'request.received':
      return `“${String(d.prompt ?? '').slice(0, 80)}”`;
    case 'request.evaluated':
      return `${d.allowed ? 'allowed' : 'denied'} · ${(d.reasons as string[] | undefined)?.join(', ') ?? ''}`;
    case 'request.rejected':
      return (d.reasons as string[] | undefined)?.join(', ') ?? String(d.reason ?? '');
    case 'payment.required':
      return `${String(d.amountMicros)} units of ${String(d.asset)} on ${String(d.network)}`;
    case 'payment.verified':
      return d.simulated ? 'simulated receipt' : `${shortHash(String(d.txHash ?? ''))} ${d.settled ? 'settled' : 'verified'}`;
    case 'payment.rejected':
      return `${String(d.stage ?? '')}: ${String(d.reason ?? '')}`;
    case 'data.retrieved':
      return d.simulated ? 'simulated data' : `from ${String(d.provider)}`;
    case 'analysis.completed': {
      const warnings = d.groundingWarnings as string[] | undefined;
      return warnings && warnings.length > 0
        ? `${String(d.provider)} · ${warnings.length} unverified value(s) removed`
        : `${String(d.provider)} · grounded`;
    }
    case 'request.fulfilled':
      return `spent today $${Number(d.spentTodayUsd ?? 0).toFixed(4)}`;
    case 'request.approved':
    case 'policy.updated':
    case 'agent.revoked':
    default:
      return '';
  }
}

export function ActivityFeed({ events }: { events: AuditEvent[] }) {
  return (
    <Section eyebrow="Activity" title="Audit trail" aside="append-only">
      {events.length === 0 ? (
        <Empty>Nothing has happened yet.</Empty>
      ) : (
        <ol className="flex max-h-[560px] flex-col overflow-y-auto rounded-sm border border-rule bg-surface">
          {events.map((event) => (
            <li key={event.id} className="flex items-start gap-3 border-b border-rule px-4 py-2.5 last:border-b-0">
              <span className="w-[62px] shrink-0 pt-0.5 font-mono text-[11px] text-muted">{timeAgo(event.at)}</span>
              <span className="w-[178px] shrink-0">
                <Pill tone={EVENT_TONE[event.type]}>{event.type}</Pill>
              </span>
              <span className="min-w-0 flex-1 text-[13px] text-ink-2">
                <span className="mr-2 font-mono text-[11px] text-muted">{event.actor}</span>
                {describe(event)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}
