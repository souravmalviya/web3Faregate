/** Plain names and one-line descriptions for audit events, shared by every view. */

import type { AuditEvent, AuditEventType } from '@faregate/shared';

import { shortAddress, shortHash, usd } from '@/lib/api';

export const EVENT_LABEL: Record<AuditEventType, string> = {
  'agent.created': 'Passport created',
  'agent.revoked': 'Passport revoked',
  'policy.updated': 'Limits changed',
  'request.received': 'Request received',
  'request.evaluated': 'Passport checked',
  'request.approval_requested': 'Sent for approval',
  'request.approved': 'Approved',
  'request.rejected': 'Refused',
  'payment.required': 'Fare quoted',
  'payment.verified': 'Fare paid',
  'payment.rejected': 'Refused at the gate',
  'data.retrieved': 'Data retrieved',
  'analysis.completed': 'Summary written',
  'request.fulfilled': 'Delivered',
  'request.failed': 'Failed',
};

function signedBy(d: Record<string, unknown>): string {
  if (!d.by) return '';
  const signature = d.signed ? ', wallet signed' : d.signed === false ? ', unsigned' : '';
  return `By ${shortAddress(String(d.by))}${signature}`;
}

/** Policy reason codes read as words: `requires_human_approval` becomes "requires human approval". */
function codes(value: unknown): string {
  return Array.isArray(value) ? value.map((code) => String(code).replaceAll('_', ' ')).join(', ') : '';
}

const INTERPRETER: Record<string, string> = {
  openrouter: 'Read by the model',
  'rule-based': 'Read by the rule-based parser',
  structured: 'Structured query',
};

export function describeEvent(event: AuditEvent): string {
  const d = event.detail as Record<string, unknown>;
  switch (event.type) {
    case 'agent.created':
      return [String(d.label ?? ''), signedBy(d)].filter(Boolean).join('. ');
    case 'agent.revoked':
    case 'policy.updated':
    case 'request.approved':
      return signedBy(d);
    case 'request.received':
      return `${INTERPRETER[String(d.interpretedBy)] ?? 'Received'}: “${String(d.prompt ?? '').slice(0, 90)}”`;
    case 'request.evaluated':
      return `${d.allowed ? 'Allowed' : 'Denied'}: ${codes(d.reasons)}`;
    case 'request.approval_requested':
      return 'Cost is above the passport’s approval line';
    case 'request.rejected':
      return d.by ? signedBy(d) : codes(d.reasons);
    case 'payment.required':
      return `${usd(Number(d.amountMicros ?? 0) / 1_000_000)} in ${String(d.asset)} on ${String(d.network)}`;
    case 'payment.verified':
      return d.simulated ? 'Simulated receipt' : `${shortHash(String(d.txHash ?? ''))}${d.settled ? ', settled' : ''}`;
    case 'payment.rejected':
      return `${String(d.reason ?? '')}${d.stage ? ` (${String(d.stage)})` : ''}`;
    case 'data.retrieved':
      return d.simulated ? 'Simulated data' : `From ${String(d.provider)}`;
    case 'analysis.completed': {
      const warnings = d.groundingWarnings as string[] | undefined;
      return warnings && warnings.length > 0
        ? `${warnings.length} unverified value(s) removed`
        : 'Checked against the data';
    }
    case 'request.fulfilled':
      return `Spent today ${usd(Number(d.spentTodayUsd ?? 0))}`;
    case 'request.failed':
      return String(d.message ?? d.code ?? '');
    default:
      return '';
  }
}
