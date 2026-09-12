'use client';

import {
  Activity,
  BadgeDollarSign,
  Ban,
  CircleCheck,
  CircleX,
  Database,
  Hand,
  MessageSquare,
  PackageCheck,
  Receipt,
  Scale,
  ShieldX,
  SlidersHorizontal,
  Sparkles,
  TriangleAlert,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';

import type { AuditEvent, AuditEventType } from '@faregate/shared';

import { shortAddress, shortHash, timeAgo } from '@/lib/api';

import { Card, Empty, ICON_TONE, Section, type Tone } from './ui';

const EVENT_META: Record<AuditEventType, { label: string; tone: Tone; icon: LucideIcon }> = {
  'agent.created': { label: 'Agent created', tone: 'brand', icon: UserPlus },
  'agent.revoked': { label: 'Agent revoked', tone: 'stop', icon: Ban },
  'policy.updated': { label: 'Rules updated', tone: 'brand', icon: SlidersHorizontal },
  'request.received': { label: 'Agent asked', tone: 'neutral', icon: MessageSquare },
  'request.evaluated': { label: 'Rules checked', tone: 'neutral', icon: Scale },
  'request.approval_requested': { label: 'Waiting for you', tone: 'hold', icon: Hand },
  'request.approved': { label: 'Approved', tone: 'pass', icon: CircleCheck },
  'request.rejected': { label: 'Refused', tone: 'stop', icon: CircleX },
  'payment.required': { label: 'Price quoted', tone: 'info', icon: Receipt },
  'payment.verified': { label: 'Payment settled', tone: 'pass', icon: BadgeDollarSign },
  'payment.rejected': { label: 'Refused at the gate', tone: 'stop', icon: ShieldX },
  'data.retrieved': { label: 'Data retrieved', tone: 'pass', icon: Database },
  'analysis.completed': { label: 'AI summary', tone: 'brand', icon: Sparkles },
  'request.fulfilled': { label: 'Delivered', tone: 'pass', icon: PackageCheck },
  'request.failed': { label: 'Failed', tone: 'stop', icon: TriangleAlert },
};

function signedBy(d: Record<string, unknown>): string {
  if (!d.by) return '';
  return `by ${shortAddress(String(d.by))}${d.signed ? ' · wallet signed' : d.signed === false ? ' · unsigned' : ''}`;
}

function describe(event: AuditEvent): string {
  const d = event.detail as Record<string, unknown>;
  switch (event.type) {
    case 'agent.created':
      return `${String(d.label ?? '')} ${signedBy(d)}`;
    case 'agent.revoked':
    case 'policy.updated':
    case 'request.approved':
      return signedBy(d);
    case 'request.received':
      return `“${String(d.prompt ?? '').slice(0, 80)}”`;
    case 'request.evaluated':
      return `${d.allowed ? 'allowed' : 'denied'} · ${(d.reasons as string[] | undefined)?.join(', ') ?? ''}`;
    case 'request.rejected':
      return d.by ? signedBy(d) : ((d.reasons as string[] | undefined)?.join(', ') ?? String(d.reason ?? ''));
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
    default:
      return '';
  }
}

export function ActivityFeed({ events }: { events: AuditEvent[] }) {
  return (
    <Section
      icon={<Activity className="h-4.5 w-4.5" aria-hidden />}
      title="Audit trail"
      description="Every step, recorded in order. Nothing is edited."
      aside={events.length > 0 ? <span>{events.length} events</span> : null}
    >
      {events.length === 0 ? (
        <Empty icon={<Activity className="h-6 w-6" aria-hidden />} title="Nothing has happened yet">
          Events appear here as agents ask, you approve, and payments settle.
        </Empty>
      ) : (
        <Card className="p-2">
          <ol className="scroll-thin flex max-h-[520px] flex-col overflow-y-auto">
            {events.map((event) => {
              const meta = EVENT_META[event.type];
              const Icon = meta.icon;
              return (
                <li
                  key={event.id}
                  title={event.type}
                  className="flex gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-white/[0.03]"
                >
                  <span
                    className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${ICON_TONE[meta.tone]}`}
                  >
                    <Icon className="h-3.5 w-3.5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[13px] font-medium text-zinc-100">{meta.label}</span>
                      <span className="shrink-0 text-[11px] text-zinc-500">{timeAgo(event.at)}</span>
                    </div>
                    <div className="mt-0.5 truncate text-[12.5px] text-zinc-400">
                      <span className="mr-1.5 rounded bg-white/5 px-1.5 py-px font-mono text-[10.5px] text-zinc-400">
                        {event.actor}
                      </span>
                      {describe(event)}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </Card>
      )}
    </Section>
  );
}
