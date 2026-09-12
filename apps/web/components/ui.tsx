'use client';

import { Check, Copy, LoaderCircle } from 'lucide-react';
import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react';

/*
 * Console primitives. The reasoning behind each is in docs/DESIGN.md: paper and
 * ink, one stamp-blue accent, and green, amber and red kept for verdicts.
 */

export type Tone = 'pass' | 'hold' | 'stop' | 'brand' | 'neutral';

const STAMP_TONE: Record<Tone, string> = {
  pass: 'border-pass/40 bg-pass-tint text-pass',
  hold: 'border-hold/40 bg-hold-tint text-hold',
  stop: 'border-stop/40 bg-stop-tint text-stop',
  brand: 'border-brand/35 bg-brand-tint text-brand-ink',
  neutral: 'border-rule-strong bg-sheet text-ink-2',
};

/** A verdict: square, bordered and uppercase, like a stamp on a ticket. */
export function Stamp({ tone = 'neutral', title, children }: { tone?: Tone; title?: string; children: ReactNode }) {
  return (
    <span
      title={title}
      className={`inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-[2px] border px-1.5 font-display text-[11.5px] font-semibold uppercase leading-none tracking-[0.06em] ${STAMP_TONE[tone]}`}
    >
      {children}
    </span>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'approve' | 'danger' | 'quiet';
type ButtonSize = 'sm' | 'md';

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: 'border border-ink bg-ink text-sheet hover:bg-[#35332d]',
  secondary: 'border border-rule-strong bg-sheet text-ink hover:border-ink-2',
  approve: 'border border-pass bg-pass text-white hover:bg-[#175637]',
  danger: 'border border-stop/60 bg-sheet text-stop hover:border-stop hover:bg-stop hover:text-white',
  quiet: 'border border-transparent text-ink-2 hover:bg-sheet-2 hover:text-ink',
};

const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-[12.5px]',
  md: 'h-[34px] px-3.5 text-[13.5px]',
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
      aria-busy={loading || undefined}
      className={`inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[3px] font-medium transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-45 ${BUTTON_SIZE[size]} ${BUTTON_VARIANT[variant]} ${className}`}
    >
      {loading ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

/** Two gate posts and the arm between them. */
export function LogoMark({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} aria-hidden>
      <rect x="2" y="2" width="3" height="16" fill="var(--ink)" />
      <rect x="15" y="2" width="3" height="16" fill="var(--ink)" />
      <rect x="5" y="8.5" width="10" height="3" fill="var(--brand)" />
    </svg>
  );
}

export function PageHeader({
  title,
  description,
  children,
}: {
  title: string;
  description: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-5 border-b-2 border-ink pb-5">
      <div className="max-w-[580px]">
        <h1 className="font-display text-[30px] font-semibold leading-none text-ink">{title}</h1>
        <p className="mt-2.5 text-[14px] leading-relaxed text-ink-2">{description}</p>
      </div>
      {children}
    </div>
  );
}

export function Figures({ children }: { children: ReactNode }) {
  // A two-by-two grid on narrow screens, a single ruled row from `sm` up.
  return <dl className="grid grid-cols-2 gap-y-4 sm:flex sm:divide-x sm:divide-rule">{children}</dl>;
}

export function Figure({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  tone?: 'hold' | 'stop';
}) {
  const color = tone === 'hold' ? 'text-hold' : tone === 'stop' ? 'text-stop' : 'text-ink';
  return (
    <div className="sm:px-5 sm:first:pl-0 sm:last:pr-0">
      <dt className="label">{label}</dt>
      <dd className={`tnum mt-1.5 font-mono text-[22px] font-medium leading-none ${color}`}>{value}</dd>
      {detail ? <dd className="mt-1.5 text-[12px] text-muted">{detail}</dd> : null}
    </div>
  );
}

export function SectionHeading({
  id,
  title,
  meta,
  children,
}: {
  id?: string;
  title: string;
  meta?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-rule pb-2">
      <h2 id={id} className="font-display text-[17px] font-semibold text-ink">
        {title}
        {meta ? <span className="ml-2 font-sans text-[12.5px] font-normal text-muted">{meta}</span> : null}
      </h2>
      {children}
    </div>
  );
}

const NOTICE_TONE: Record<'stop' | 'hold' | 'brand', string> = {
  stop: 'border-l-stop bg-stop-tint',
  hold: 'border-l-hold bg-hold-tint',
  brand: 'border-l-brand bg-brand-tint',
};

export function Notice({ tone, children }: { tone: 'stop' | 'hold' | 'brand'; children: ReactNode }) {
  return (
    <div
      role={tone === 'stop' ? 'alert' : undefined}
      className={`border-l-[3px] px-4 py-2.5 text-[13.5px] leading-relaxed text-ink ${NOTICE_TONE[tone]}`}
    >
      {children}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="py-8">
      <p className="text-[14px] font-medium text-ink">{title}</p>
      {children ? <p className="mt-1 max-w-[540px] text-[13.5px] leading-relaxed text-ink-2">{children}</p> : null}
    </div>
  );
}

export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading" className="divide-y divide-rule">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 py-3.5">
          <span className="h-3 w-14 animate-pulse bg-sheet-2" />
          <span className="h-3 w-32 animate-pulse bg-sheet-2" />
          <span className="h-3 flex-1 animate-pulse bg-sheet-2" />
          <span className="h-3 w-16 animate-pulse bg-sheet-2" />
        </div>
      ))}
    </div>
  );
}

/** A value with a copy control that appears on hover or keyboard focus. */
export function CopyText({
  value,
  children,
  className = '',
  wrap = false,
}: {
  value: string;
  children?: ReactNode;
  className?: string;
  wrap?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <span className={`group inline-flex min-w-0 items-center gap-1 ${className}`}>
      <span className={wrap ? 'break-words' : 'truncate'}>{children ?? value}</span>
      <button
        type="button"
        onClick={async (event) => {
          event.stopPropagation();
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            // Clipboard access can be refused; the value is still selectable.
          }
        }}
        aria-label={copied ? 'Copied' : `Copy ${value}`}
        title={copied ? 'Copied' : 'Copy'}
        className="shrink-0 rounded-[2px] p-0.5 text-muted opacity-0 transition-opacity hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
      >
        {copied ? <Check className="h-3 w-3" aria-hidden /> : <Copy className="h-3 w-3" aria-hidden />}
      </button>
    </span>
  );
}

export function SpendMeter({ spent, limit }: { spent: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, (spent / limit) * 100) : 0;
  const width = spent > 0 ? Math.max(pct, 1.5) : 0;
  return (
    <div className="mt-2">
      <div className="h-1 w-full bg-sheet-2">
        <div className={`h-full ${pct >= 90 ? 'bg-stop' : 'bg-ink'}`} style={{ width: `${width}%` }} />
      </div>
      <div className="tnum mt-1 font-mono text-[11.5px] text-muted">
        {formatMoney(spent)} of {formatMoney(limit)} today
      </div>
    </div>
  );
}

function formatMoney(value: number): string {
  const cents = Math.round(value * 100);
  return Math.abs(value * 100 - cents) < 1e-9 ? `$${value.toFixed(2)}` : `$${value.toFixed(4)}`;
}

export function Tabs<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: Array<{ value: T; label: string; count?: number }>;
  value: T;
  onChange: (next: T) => void;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap items-center gap-x-5 border-b border-rule">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={`-mb-px flex items-center gap-1.5 border-b-2 pb-2 pt-1 text-[13.5px] transition-colors ${
              active ? 'border-ink font-medium text-ink' : 'border-transparent text-ink-2 hover:text-ink'
            }`}
          >
            {option.label}
            {option.count !== undefined ? (
              <span className="tnum font-mono text-[11.5px] text-muted">{option.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export const INPUT =
  'w-full rounded-[3px] border border-rule-strong bg-sheet px-2.5 text-[13.5px] text-ink placeholder:text-muted focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/15 aria-[invalid=true]:border-stop';

export function Field({
  label,
  hint,
  error,
  className = '',
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={`flex flex-col gap-1 ${className}`}>
      <span className="label">{label}</span>
      {children}
      {error ? (
        <span className="text-[12px] text-stop">{error}</span>
      ) : hint ? (
        <span className="text-[12px] text-muted">{hint}</span>
      ) : null}
    </label>
  );
}
