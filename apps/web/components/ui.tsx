'use client';

import type { RequestStatus } from '@faregate/shared';
import type { ReactNode } from 'react';

/** Request status to semantic tone. Kept in one place so every surface agrees. */
export type Tone = 'pass' | 'hold' | 'stop' | 'info' | 'neutral';

export function toneFor(status: RequestStatus): Tone {
  switch (status) {
    case 'fulfilled':
    case 'paid':
      return 'pass';
    case 'awaiting_approval':
    case 'pending':
      return 'hold';
    case 'rejected':
    case 'failed':
      return 'stop';
    case 'approved':
    case 'payment_required':
      return 'info';
    default:
      return 'neutral';
  }
}

export const STATUS_LABEL: Record<RequestStatus, string> = {
  pending: 'Pending',
  awaiting_approval: 'Awaiting approval',
  approved: 'Approved',
  rejected: 'Rejected',
  payment_required: 'Payment required',
  paid: 'Paid',
  fulfilled: 'Fulfilled',
  failed: 'Failed',
};

const TONE_CLASS: Record<Tone, string> = {
  pass: 'bg-pass-fill text-pass',
  hold: 'bg-hold-fill text-hold',
  stop: 'bg-stop-fill text-stop',
  info: 'bg-info-fill text-info',
  neutral: 'bg-surface-2 text-muted',
};

export function Pill({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.08em] whitespace-nowrap ${TONE_CLASS[tone]}`}
    >
      {children}
    </span>
  );
}

export function ModeChip({ label, mode }: { label: string; mode: 'live' | 'simulated' }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted">
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${mode === 'live' ? 'bg-pass' : 'bg-hold'}`}
        aria-hidden
      />
      {label}
      <span className={mode === 'live' ? 'text-pass' : 'text-hold'}>{mode}</span>
    </span>
  );
}

type ButtonVariant = 'primary' | 'quiet' | 'danger' | 'approve';

const BUTTON_CLASS: Record<ButtonVariant, string> = {
  primary: 'bg-ink text-ground hover:opacity-90',
  quiet: 'border border-rule-strong text-ink-2 hover:bg-surface-2',
  danger: 'border border-stop text-stop hover:bg-stop-fill',
  approve: 'bg-pass text-white hover:opacity-90',
};

export function Button({
  variant = 'quiet',
  children,
  className = '',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      {...rest}
      className={`inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 font-display text-[13px] uppercase tracking-[0.08em] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${BUTTON_CLASS[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Section({
  eyebrow,
  title,
  aside,
  children,
}: {
  eyebrow: string;
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <header className="flex items-baseline justify-between gap-4 border-t-2 border-ink pt-3">
        <div>
          <div className="eyebrow">{eyebrow}</div>
          <h2 className="display text-[24px] font-semibold">{title}</h2>
        </div>
        {aside ? <div className="text-right text-[13px] text-muted">{aside}</div> : null}
      </header>
      {children}
    </section>
  );
}

export function Kv({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="eyebrow">{label}</div>
      <div className="tnum text-[14px] text-ink">{children}</div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-sm border border-dashed border-rule-strong px-4 py-8 text-center text-[14px] text-muted">
      {children}
    </div>
  );
}
