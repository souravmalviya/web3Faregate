'use client';

import type { RequestStatus } from '@faregate/shared';
import { LoaderCircle } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

/** Request status to semantic tone. Kept in one place so every surface agrees. */
export type Tone = 'pass' | 'hold' | 'stop' | 'info' | 'neutral' | 'brand';

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

const BADGE_CLASS: Record<Tone, string> = {
  pass: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300',
  hold: 'border-amber-400/25 bg-amber-400/10 text-amber-300',
  stop: 'border-rose-400/25 bg-rose-400/10 text-rose-300',
  info: 'border-sky-400/25 bg-sky-400/10 text-sky-300',
  neutral: 'border-white/10 bg-white/5 text-zinc-300',
  brand: 'border-violet-400/30 bg-violet-400/10 text-violet-200',
};

const DOT_CLASS: Record<Tone, string> = {
  pass: 'bg-emerald-400',
  hold: 'bg-amber-400',
  stop: 'bg-rose-400',
  info: 'bg-sky-400',
  neutral: 'bg-zinc-500',
  brand: 'bg-violet-400',
};

/** Icon tiles: a tinted square that carries a tone. */
export const ICON_TONE: Record<Tone, string> = {
  pass: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300',
  hold: 'border-amber-400/25 bg-amber-400/10 text-amber-300',
  stop: 'border-rose-400/25 bg-rose-400/10 text-rose-300',
  info: 'border-sky-400/25 bg-sky-400/10 text-sky-300',
  neutral: 'border-white/10 bg-white/5 text-zinc-300',
  brand: 'border-violet-400/25 bg-violet-400/10 text-violet-200',
};

export function Badge({
  tone = 'neutral',
  dot = false,
  pulse = false,
  className = '',
  children,
}: {
  tone?: Tone;
  dot?: boolean;
  pulse?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11.5px] font-medium ${BADGE_CLASS[tone]} ${className}`}
    >
      {dot ? (
        <span className="relative flex h-1.5 w-1.5" aria-hidden>
          {pulse ? (
            <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-70 ${DOT_CLASS[tone]}`} />
          ) : null}
          <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${DOT_CLASS[tone]}`} />
        </span>
      ) : null}
      {children}
    </span>
  );
}

/** The older name, kept so existing call sites read the same. */
export const Pill = Badge;

type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'ghost' | 'danger' | 'approve';
type ButtonSize = 'sm' | 'md';

const BUTTON_CLASS: Record<ButtonVariant, string> = {
  primary:
    'bg-linear-to-r from-violet-500 to-cyan-500 text-white shadow-lg shadow-violet-500/25 hover:brightness-110',
  secondary: 'border border-white/10 bg-white/5 text-zinc-100 hover:bg-white/10',
  quiet: 'border border-white/10 bg-white/[0.03] text-zinc-300 hover:bg-white/10 hover:text-white',
  ghost: 'text-zinc-400 hover:bg-white/5 hover:text-white',
  danger: 'border border-rose-400/30 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20',
  approve: 'bg-emerald-500 text-emerald-950 shadow-lg shadow-emerald-500/25 hover:bg-emerald-400',
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[12.5px]',
  md: 'h-10 px-4 text-[13.5px]',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  className = '',
  disabled,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-all duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 ${SIZE_CLASS[size]} ${BUTTON_CLASS[variant]} ${className}`}
    >
      {loading ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

export function Card({ className = '', children }: { className?: string; children: ReactNode }) {
  return (
    <div className={`rounded-2xl border border-white/[0.08] bg-white/[0.03] ${className}`}>
      {children}
    </div>
  );
}

export function Section({
  icon,
  title,
  description,
  aside,
  children,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-3">
          {icon ? (
            <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-violet-300">
              {icon}
            </span>
          ) : null}
          <div>
            <h2 className="text-[17px] font-semibold tracking-tight text-white">{title}</h2>
            {description ? <p className="text-[13px] text-zinc-400">{description}</p> : null}
          </div>
        </div>
        {aside ? <div className="text-[13px] text-zinc-400">{aside}</div> : null}
      </header>
      {children}
    </section>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-zinc-500">{children}</span>;
}

export function Kv({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label>{label}</Label>
      <div className="tnum text-[14px] text-zinc-100">{children}</div>
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-6 py-10 text-center">
      {icon ? <span className="text-zinc-500">{icon}</span> : null}
      {title ? <div className="text-[14px] font-medium text-zinc-200">{title}</div> : null}
      <div className="max-w-md text-[13px] text-zinc-400">{children}</div>
    </div>
  );
}
