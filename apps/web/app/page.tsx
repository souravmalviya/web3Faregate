import { Check, ExternalLink, X } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';

import {
  ApproveArt,
  AskedArt,
  DataArt,
  FanOutArt,
  FareArt,
  HeroCollage,
  OpenCardArt,
  PassportArt,
  PassportCheckArt,
  ResearchArt,
  TradingArt,
  TreasuryArt,
} from '@/components/home/art';
import { LiveTag } from '@/components/home/LiveTag';
import { TryIt } from '@/components/home/TryIt';
import { GateTrack } from '@/components/requests/GateTrack';
import type { Station } from '@/components/requests/model';
import { Stamp } from '@/components/ui';

export const metadata: Metadata = {
  title: 'Faregate',
};

/* Evidence from real runs on test networks, recorded in docs/bounty-evidence.md. */
const PAID_BY_POLICY = 'https://hashscan.io/testnet/transaction/0.0.7162784%401789280858.204136805';
const PAID_AFTER_APPROVAL = 'https://hashscan.io/testnet/transaction/0.0.7162784%401789280841.504457079';
const PAID_BY_DEMO_AGENT = 'https://hashscan.io/testnet/transaction/0.0.7162784%401789294894.217968101';
const PASSPORT_RECORDS = 'https://sepolia.etherscan.io/tx/0x1bb5f46d0fbeec04e896318a365b58719e224a45d837df2153abc4fd610e055a';
const PASSPORT_REVOKED = 'https://sepolia.etherscan.io/tx/0xffaa246ce42147b33230cfb315da1fa9cee4c7f5ed6b7b5cdf0ac7854d38b25f';
const SOURCE = 'https://github.com/souravmalviya/web3Faregate';

const PRIMARY =
  'inline-flex h-[46px] items-center justify-center rounded-[3px] border border-ink bg-ink px-5 text-[15px] font-medium text-sheet transition-colors hover:bg-[#35332d]';
const SECONDARY =
  'inline-flex h-[46px] items-center justify-center rounded-[3px] border border-rule-strong bg-sheet px-5 text-[15px] font-medium text-ink transition-colors hover:border-ink-2';
const LIFT = 'shadow-[0_1px_2px_rgba(28,27,24,0.06),0_10px_28px_rgba(28,27,24,0.08)]';

const STOPS = [
  { title: 'Asked', text: 'Agent asks in plain English', Art: AskedArt },
  { title: 'Passport', text: 'Limits read from ENS', Art: PassportCheckArt },
  { title: 'You', text: 'You approve the big ones', Art: ApproveArt },
  { title: 'Fare', text: 'Agent pays in USDC', Art: FareArt },
  { title: 'Data', text: 'Live data from The Graph', Art: DataArt },
];

const USES = [
  { title: 'Research agents', text: 'Pay per query, not per seat', Art: ResearchArt },
  { title: 'Treasury bots', text: 'Spend caps a human set', Art: TreasuryArt },
  { title: 'Trading assistants', text: 'Revoked in one transaction', Art: TradingArt },
];

const ROUTE_AUTO: Station[] = [
  { key: 'asked', label: 'Asked', state: 'passed' },
  { key: 'checked', label: 'Passport', state: 'passed' },
  { key: 'approved', label: 'Auto', state: 'auto' },
  { key: 'paid', label: 'Fare', state: 'passed' },
  { key: 'delivered', label: 'Data', state: 'passed' },
];

const ROUTE_WAITING: Station[] = [
  { key: 'asked', label: 'Asked', state: 'passed' },
  { key: 'checked', label: 'Passport', state: 'passed' },
  { key: 'approved', label: 'You', state: 'current' },
  { key: 'paid', label: 'Fare', state: 'ahead' },
  { key: 'delivered', label: 'Data', state: 'ahead' },
];

const ROUTE_REFUSED: Station[] = [
  { key: 'asked', label: 'Asked', state: 'passed' },
  { key: 'checked', label: 'Passport', state: 'stopped' },
  { key: 'approved', label: 'You', state: 'ahead' },
  { key: 'paid', label: 'Fare', state: 'ahead' },
  { key: 'delivered', label: 'Data', state: 'ahead' },
];

const RECORDS = [
  ['faregate.max_per_query_usd', '$0.10'],
  ['faregate.approval_above_usd', '$0.02'],
  ['faregate.daily_limit_usd', '$1.00'],
  ['faregate.scope', 'balances, transfers, activity'],
] as const;

export default function HomePage() {
  return (
    <>
      <section className="mx-auto grid max-w-[1200px] items-center gap-x-14 gap-y-10 px-6 pb-18 pt-14 lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]">
        <div>
          <LiveTag />
          <h1 className="mt-4 font-display text-[length:clamp(42px,5.4vw,66px)] font-semibold leading-[0.95] text-ink [text-wrap:balance]">
            AI agents buy data. You set the rules.
          </h1>
          <p className="mt-5 max-w-[34ch] text-[19px] leading-[1.45] text-ink-2">
            A permission and payment gateway for AI agents that buy onchain data.
          </p>
          <div className="mt-8 flex flex-wrap gap-2.5">
            <a href="#try" className={PRIMARY}>
              Try the demo
            </a>
            <Link href="/requests" className={SECONDARY}>
              Open console
            </Link>
          </div>
          <dl className="mt-10 flex flex-wrap gap-x-8 gap-y-3 border-t border-rule pt-4">
            {[
              ['Payments', 'Hedera x402'],
              ['Data', 'The Graph'],
              ['Identity', 'ENS'],
            ].map(([term, value]) => (
              <div key={term}>
                <dt className="label">{term}</dt>
                <dd className="mt-0.5 text-[14.5px] font-medium text-ink">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
        <HeroCollage />
      </section>

      <Band id="problem" alt label="The problem" title="Don’t hand an agent an open card">
        <div className="grid items-center gap-5 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          <div className="rounded-[8px] bg-sheet-2 px-5 pb-6 pt-4">
            <OpenCardArt />
            <Points good={false} items={['No spending limit', 'No one approves', 'Hard to stop']} />
          </div>
          <div aria-hidden className="text-center font-display text-[15px] font-semibold uppercase tracking-[0.08em] text-muted">
            vs
          </div>
          <div className="rounded-[8px] bg-brand-tint px-5 pb-6 pt-4">
            <PassportArt />
            <Points good items={['$0.10 cap per query', 'You approve above $0.02', 'Revoke onchain, instantly']} />
          </div>
        </div>
      </Band>

      <Band id="how" label="How it works" title="Five stops. Every request.">
        <ol className="relative grid grid-cols-2 gap-x-4 gap-y-9 sm:grid-cols-3 lg:grid-cols-5 lg:before:absolute lg:before:left-[10%] lg:before:right-[10%] lg:before:top-[72px] lg:before:h-[2px] lg:before:bg-ink lg:before:content-['']">
          {STOPS.map(({ title, text, Art }) => (
            <li key={title} className="relative flex flex-col items-center text-center">
              <Art />
              <h3 className="mt-3 font-display text-[21px] font-semibold text-ink">{title}</h3>
              <p className="mt-0.5 text-[14.5px] text-ink-2">{text}</p>
            </li>
          ))}
        </ol>
      </Band>

      <Band id="try" alt label="Try it" title="Pick an ask. Watch the gate.">
        <TryIt />
      </Band>

      <Band id="rules" label="The rules" title="One gate, four answers">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <RuleTicket stamp="Delivered" tone="text-pass" title="Small purchase" value="$0.0102" route={ROUTE_AUTO}>
            <Evidence href={PAID_BY_POLICY}>Paid on HashScan</Evidence>
          </RuleTicket>
          <RuleTicket stamp="Needs you" tone="text-hold" title="Big purchase" value="$0.0360" route={ROUTE_WAITING}>
            <Evidence href={PAID_AFTER_APPROVAL}>Approved, then paid</Evidence>
          </RuleTicket>
          <RuleTicket stamp="Refused" tone="text-stop" title="Not allowed" value="Lending positions" quiet route={ROUTE_REFUSED}>
            <span className="text-muted">Nothing charged</span>
          </RuleTicket>
          <RuleTicket stamp="Refused" tone="text-stop" title="Revoked passport" value="Any request" quiet route={ROUTE_REFUSED}>
            <Evidence href={PASSPORT_REVOKED}>Revoke on Etherscan</Evidence>
          </RuleTicket>
        </div>
      </Band>

      <Band id="proof" alt label="Proof" title="Real transactions on testnet">
        <div className="grid gap-4 lg:grid-cols-3">
          <Receipt label="Payment · Hedera" stamp={<Stamp tone="pass">Success</Stamp>} href={PAID_BY_DEMO_AGENT} link="View on HashScan">
            <div className="tnum font-mono text-[32px] font-medium leading-none text-ink">
              0.036 <span className="text-[14px] text-muted">USDC</span>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-2.5 font-mono text-[13px] text-ink">
              <span>
                <span className="label block">Agent</span>0.0.10455772
              </span>
              <span aria-hidden className="text-muted">
                →
              </span>
              <span>
                <span className="label block">Gateway</span>0.0.10457565
              </span>
            </div>
          </Receipt>
          <Receipt label="Passport · ENS" stamp={<Stamp tone="brand">Sepolia</Stamp>} href={PASSPORT_RECORDS} link="View on Etherscan">
            <div className="font-mono text-[14px] text-ink [overflow-wrap:anywhere]">research.agents.faregate.eth</div>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3.5 gap-y-1.5 font-mono text-[12.5px]">
              {RECORDS.map(([key, value]) => (
                <Fragment key={key}>
                  <dt className="text-muted">{key}</dt>
                  <dd className="text-ink">{value}</dd>
                </Fragment>
              ))}
            </dl>
          </Receipt>
          <Receipt label="Data · The Graph" stamp={<Stamp tone="brand">Messari standard</Stamp>} href={SOURCE} link="View source">
            <FanOutArt />
          </Receipt>
        </div>
      </Band>

      <Band id="uses" label="Built for" title="Teams whose agents buy data">
        <div className="grid gap-4 md:grid-cols-3">
          {USES.map(({ title, text, Art }) => (
            <article key={title} className="overflow-hidden rounded-[8px] border border-rule bg-sheet">
              <Art />
              <div className="px-[18px] pb-[18px] pt-3.5">
                <h3 className="font-display text-[21px] font-semibold text-ink">{title}</h3>
                <p className="mt-0.5 text-[14.5px] text-ink-2">{text}</p>
              </div>
            </article>
          ))}
        </div>
      </Band>

      <section className="border-t border-rule bg-sheet">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-5 px-6 py-14">
          <h2 className="font-display text-[length:clamp(30px,3.6vw,42px)] font-semibold text-ink">
            See it with a real request.
          </h2>
          <div className="flex flex-wrap gap-2.5">
            <a href="#try" className={PRIMARY}>
              Try the demo
            </a>
            <Link href="/requests" className={SECONDARY}>
              Open console
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}

function Band({
  id,
  alt = false,
  label,
  title,
  children,
}: {
  id: string;
  alt?: boolean;
  label: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={alt ? 'border-y border-rule bg-sheet' : undefined}>
      <div className="mx-auto max-w-[1200px] px-6 py-18">
        <div className="mb-9">
          <div className="label">{label}</div>
          <h2 id={`${id}-title`} className="mt-2 font-display text-[length:clamp(30px,3.4vw,40px)] font-semibold leading-none text-ink">
            {title}
          </h2>
        </div>
        {children}
      </div>
    </section>
  );
}

function Points({ good, items }: { good: boolean; items: string[] }) {
  return (
    <ul className="mt-4 flex flex-col gap-2.5 text-[16px] font-medium text-ink">
      {items.map((item) => (
        <li key={item} className="flex items-center gap-2.5">
          <span
            aria-hidden
            className={`inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-white ${good ? 'bg-pass' : 'bg-stop'}`}
          >
            {good ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : <X className="h-3.5 w-3.5" strokeWidth={3} />}
          </span>
          {item}
        </li>
      ))}
    </ul>
  );
}

function Evidence({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-brand hover:underline">
      {children}
      <ExternalLink className="h-3 w-3" aria-hidden />
    </a>
  );
}

function RuleTicket({
  stamp,
  tone,
  title,
  value,
  quiet = false,
  route,
  children,
}: {
  stamp: string;
  tone: string;
  title: string;
  value: string;
  quiet?: boolean;
  route: Station[];
  children: ReactNode;
}) {
  return (
    <article className={`relative flex flex-col overflow-hidden rounded-[4px] border border-rule-strong bg-sheet ${LIFT}`}>
      <span
        className={`absolute right-3 top-4 -rotate-[9deg] rounded-[3px] border-[2.5px] border-current bg-sheet/75 px-2 py-0.5 font-display text-[14px] font-semibold uppercase leading-tight tracking-[0.1em] ${tone}`}
      >
        {stamp}
      </span>
      <div className="flex flex-1 flex-col gap-3 px-[18px] pb-4 pt-[18px]">
        <h3 className="max-w-[58%] font-display text-[20px] font-semibold leading-[1.05] text-ink">{title}</h3>
        <div className={quiet ? 'text-[13px] text-muted' : 'tnum font-mono text-[20px] font-medium leading-none text-ink'}>{value}</div>
        <GateTrack stations={route} />
      </div>
      <div className="min-h-[42px] border-t border-dashed border-rule-strong px-[18px] py-2.5 text-[13px]">{children}</div>
    </article>
  );
}

function Receipt({
  label,
  stamp,
  href,
  link,
  children,
}: {
  label: string;
  stamp: ReactNode;
  href: string;
  link: string;
  children: ReactNode;
}) {
  return (
    <article className={`flex flex-col rounded-[4px] border border-rule-strong bg-sheet ${LIFT}`}>
      <div className="flex items-center justify-between gap-2.5 border-b border-rule px-[18px] py-3">
        <span className="label">{label}</span>
        {stamp}
      </div>
      <div className="flex flex-1 flex-col gap-3.5 p-[18px]">{children}</div>
      <div className="border-t border-dashed border-rule-strong px-[18px] py-3 text-[13.5px]">
        <Evidence href={href}>{link}</Evidence>
      </div>
    </article>
  );
}
