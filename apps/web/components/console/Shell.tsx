'use client';

import { Check, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { GATEWAY_URL, shortAddress } from '@/lib/api';
import { EXPECTED_CHAIN } from '@/lib/wallet';

import { Button, LogoMark, Notice } from '../ui';
import { useConsole } from './ConsoleProvider';

const NAV = [
  { href: '/', label: 'Requests' },
  { href: '/passports', label: 'Passports' },
  { href: '/ledger', label: 'Ledger' },
  { href: '/audit', label: 'Audit log' },
] as const;

const SUBSYSTEMS = [
  { key: 'payment', label: 'Pay' },
  { key: 'data', label: 'Data' },
  { key: 'ai', label: 'AI' },
  { key: 'ens', label: 'ENS' },
] as const;

export function Shell({ children }: { children: ReactNode }) {
  const { requests, health, error, wallet } = useConsole();
  const pathname = usePathname();
  const waiting = requests.filter((r) => r.status === 'awaiting_approval').length;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-rule bg-sheet">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-8 gap-y-2 px-6 py-2 md:h-14 md:flex-nowrap md:py-0">
          <Link href="/" className="flex items-center gap-2.5" aria-label="Faregate requests">
            <LogoMark />
            <span className="font-display text-[21px] font-semibold leading-none text-ink">Faregate</span>
          </Link>

          <nav aria-label="Console" className="flex items-stretch gap-6 self-stretch">
            {NAV.map((item) => {
              const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={`relative flex items-center gap-1.5 py-2 text-[14px] transition-colors md:py-0 ${
                    active ? 'font-medium text-ink' : 'text-ink-2 hover:text-ink'
                  }`}
                >
                  {item.label}
                  {item.href === '/' && waiting > 0 ? (
                    <span
                      className="tnum rounded-[2px] bg-hold px-1 font-mono text-[11px] leading-[16px] text-white"
                      title={`${waiting} waiting for your signature`}
                    >
                      {waiting}
                    </span>
                  ) : null}
                  {active ? <span className="absolute inset-x-0 bottom-0 h-[2px] bg-ink" aria-hidden /> : null}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-5">
            <SystemReadout />
            <WalletControl />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1200px] flex-1 px-6 pb-16 pt-8">
        {error ? (
          <div className="mb-6">
            <Notice tone="stop">
              Can&apos;t reach the gateway at <span className="font-mono">{GATEWAY_URL}</span>. Start it with{' '}
              <code className="font-mono">npm run dev:api</code>. Retrying every 2 seconds.
            </Notice>
          </div>
        ) : null}
        {wallet.error ? (
          <div className="mb-6">
            <Notice tone="stop">{wallet.error}</Notice>
          </div>
        ) : null}
        {health && health.notes.length > 0 ? (
          <div className="mb-6">
            <Notice tone="hold">
              {health.notes.map((note, i) => (
                <div key={i}>{note}</div>
              ))}
            </Notice>
          </div>
        ) : null}
        {children}
      </main>

      <footer className="border-t border-rule">
        <div className="mx-auto flex max-w-[1200px] flex-wrap gap-x-6 gap-y-1 px-6 py-4 font-mono text-[11.5px] text-muted">
          <span>gateway {GATEWAY_URL}</span>
          {health ? <span>{health.network}</span> : null}
          {health ? <span>passports under {health.parentName}</span> : null}
          {health ? <span>{health.signedActions ? 'human actions must be signed' : 'unsigned actions accepted'}</span> : null}
        </div>
      </footer>

      <Toast />
    </div>
  );
}

function SystemReadout() {
  const { health, loaded } = useConsole();
  if (!loaded) return <span className="text-[12.5px] text-muted">Connecting</span>;
  if (!health) {
    return (
      <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-stop">
        <span className="h-[7px] w-[7px] bg-stop" aria-hidden />
        Gateway offline
      </span>
    );
  }
  const simulated = SUBSYSTEMS.filter(({ key }) => health.modes[key] !== 'live');
  return (
    <div className="hidden items-center gap-3 lg:flex" aria-label="Gateway subsystems">
      {SUBSYSTEMS.map(({ key, label }) => {
        const live = health.modes[key] === 'live';
        return (
          <span key={key} title={`${label}: ${health.modes[key]}`} className="flex items-center gap-1.5 text-[12.5px] text-ink-2">
            <span className={`h-[7px] w-[7px] ${live ? 'bg-pass' : 'bg-hold'}`} aria-hidden />
            {label}
          </span>
        );
      })}
      <span className={`text-[12.5px] font-medium ${simulated.length > 0 ? 'text-hold' : 'text-pass'}`}>
        {simulated.length > 0 ? `${simulated.map((s) => s.label).join(', ')} simulated` : 'Live'}
      </span>
    </div>
  );
}

function WalletControl() {
  const { wallet, connect, switchChain } = useConsole();

  if (!wallet.address) {
    return (
      <Button size="sm" variant="secondary" onClick={() => void connect()} disabled={!wallet.available}>
        {wallet.available ? 'Connect wallet' : 'No wallet detected'}
      </Button>
    );
  }

  const wrongChain = wallet.chainId !== EXPECTED_CHAIN.id;
  return (
    <div className="flex items-center gap-3 border-l border-rule pl-5">
      <div className="text-right leading-tight">
        <div className="font-mono text-[12.5px] text-ink">{shortAddress(wallet.address)}</div>
        <div className={`text-[11.5px] ${wrongChain ? 'text-stop' : 'text-muted'}`}>
          {wallet.name ?? 'Wallet'} · {wrongChain ? 'wrong network' : EXPECTED_CHAIN.name}
        </div>
      </div>
      {wrongChain ? (
        <Button size="sm" variant="danger" onClick={() => void switchChain()}>
          Switch to {EXPECTED_CHAIN.name}
        </Button>
      ) : null}
    </div>
  );
}

function Toast() {
  const { flash } = useConsole();
  if (!flash) return null;
  return (
    <div
      key={flash.id}
      role="status"
      className={`toast fixed bottom-5 right-5 z-50 flex max-w-[420px] items-start gap-2.5 border border-rule border-l-[3px] bg-sheet py-2.5 pl-3 pr-4 text-[13.5px] leading-relaxed text-ink shadow-[0_6px_24px_rgba(28,27,24,0.12)] ${
        flash.tone === 'ok' ? 'border-l-pass' : 'border-l-stop'
      }`}
    >
      {flash.tone === 'ok' ? (
        <Check className="mt-0.5 h-4 w-4 shrink-0 text-pass" aria-hidden />
      ) : (
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-stop" aria-hidden />
      )}
      <span>{flash.text}</span>
    </div>
  );
}
