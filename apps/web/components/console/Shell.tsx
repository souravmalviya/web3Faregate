'use client';

import { Check, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

import { GATEWAY_IS_LOCAL, GATEWAY_URL, shortAddress } from '@/lib/api';

import { Button, LogoMark, Notice } from '../ui';
import { useConsole } from './ConsoleProvider';

const NAV = [
  { href: '/', label: 'Home' },
  { href: '/requests', label: 'Requests' },
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
  const { requests, health, error, wallet, gatewayState } = useConsole();
  const pathname = usePathname();
  const waiting = requests.filter((r) => r.status === 'awaiting_approval').length;
  // The front page draws its own full-width bands; console pages sit in one column.
  const home = pathname === '/';
  const hasNotice =
    gatewayState === 'waking' || Boolean(error) || Boolean(wallet.error) || Boolean(health && health.notes.length > 0);

  const notices = (
    <>
      {gatewayState === 'waking' ? (
        <div className="mb-6">
          <Notice tone="hold">
            Waking the gateway at <span className="font-mono">{GATEWAY_URL}</span>. It runs on free hosting that
            sleeps after 15 minutes without visitors, and starting takes up to a minute. This page connects by itself.
          </Notice>
        </div>
      ) : error ? (
        <div className="mb-6">
          <GatewayUnreachable />
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
    </>
  );

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-rule bg-sheet">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-8 gap-y-2 px-6 py-2 md:h-14 md:flex-nowrap md:py-0">
          <Link href="/" className="flex items-center gap-2.5" aria-label="Faregate home">
            <LogoMark />
            <span className="font-display text-[21px] font-semibold leading-none text-ink">Faregate</span>
          </Link>

          <nav aria-label="Console" className="flex flex-wrap items-stretch gap-x-6 self-stretch">
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
                  {item.href === '/requests' && waiting > 0 ? (
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

      {home ? (
        <main className="w-full flex-1">
          {hasNotice ? <div className="mx-auto max-w-[1200px] px-6 pt-6">{notices}</div> : null}
          {children}
        </main>
      ) : (
        <main className="mx-auto w-full max-w-[1200px] flex-1 px-6 pb-16 pt-8">
          {notices}
          {children}
        </main>
      )}

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

/**
 * Shown once a gateway has not answered for longer than waking takes. A
 * browser cannot tell a gateway that is down from one that refuses this
 * page's origin, since both are a failed fetch, so a hosted gateway gets both
 * causes and the exact origin to allow.
 */
function GatewayUnreachable() {
  // Read after mount: the page is prerendered, where there is no window.
  const [origin, setOrigin] = useState<string | null>(null);
  useEffect(() => setOrigin(window.location.origin), []);

  if (GATEWAY_IS_LOCAL) {
    return (
      <Notice tone="stop">
        Can&apos;t reach the gateway at <span className="font-mono">{GATEWAY_URL}</span>. Start it with{' '}
        <code className="font-mono">npm run dev:api</code>. Retrying every 2 seconds.
      </Notice>
    );
  }
  return (
    <Notice tone="stop">
      Can&apos;t reach the gateway at <span className="font-mono">{GATEWAY_URL}</span>. If{' '}
      <a href={`${GATEWAY_URL}/health`} target="_blank" rel="noreferrer" className="font-mono underline">
        /health
      </a>{' '}
      opens in a new tab, the gateway is refusing this page: add{' '}
      <code className="font-mono">{origin ?? 'this page’s address'}</code> to{' '}
      <code className="font-mono">FAREGATE_CORS_ORIGIN</code> on the gateway. If it does not open, the gateway is down.
      Retrying every 2 seconds.
    </Notice>
  );
}

function SystemReadout() {
  const { health, loaded, gatewayState } = useConsole();
  if (gatewayState === 'waking') {
    return (
      <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-hold">
        <span className="h-[7px] w-[7px] bg-hold" aria-hidden />
        Waking gateway
      </span>
    );
  }
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

/**
 * The wallet only ever signs messages, which works on any network, so a
 * connected wallet is ready to act whichever network it is on.
 */
function WalletControl() {
  const { wallet, connect, notify } = useConsole();

  if (!wallet.address) {
    return (
      <Button
        size="sm"
        variant="secondary"
        onClick={() =>
          wallet.available
            ? void connect()
            : notify('Sending and approving requests need a browser wallet such as MetaMask. You can look around without one.', 'bad')
        }
      >
        {wallet.available ? 'Connect wallet' : 'No wallet found'}
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-3 border-l border-rule pl-5">
      <div className="text-right leading-tight">
        <div className="font-mono text-[12.5px] text-ink">{shortAddress(wallet.address)}</div>
        <div className="text-[11.5px] text-muted">{wallet.name ?? 'Wallet'} · connected</div>
      </div>
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
