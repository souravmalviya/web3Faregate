'use client';

import { Coins, Database, Fingerprint, ShieldCheck, Sparkles, TriangleAlert, Wallet } from 'lucide-react';

import type { Health } from '@/lib/api';
import { shortAddress } from '@/lib/api';
import { EXPECTED_CHAIN, type WalletState } from '@/lib/wallet';

import { Button } from './ui';

const INTEGRATIONS = [
  { key: 'payment', label: 'Hedera x402', icon: Coins },
  { key: 'data', label: 'The Graph', icon: Database },
  { key: 'ai', label: 'AI', icon: Sparkles },
  { key: 'ens', label: 'ENS', icon: Fingerprint },
] as const;

export function TopBar({
  health,
  wallet,
  onConnect,
  onSwitchChain,
}: {
  health: Health | null;
  wallet: WalletState;
  onConnect: () => void;
  onSwitchChain: () => void;
}) {
  const wrongChain = wallet.address !== null && wallet.chainId !== EXPECTED_CHAIN.id;

  return (
    <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-[#07080d]/70 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1280px] flex-wrap items-center gap-x-6 gap-y-3 px-6 py-3">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-linear-to-br from-violet-500 to-cyan-400 shadow-lg shadow-violet-500/30">
            <ShieldCheck className="h-5 w-5 text-white" aria-hidden />
          </span>
          <div className="leading-tight">
            <div className="text-[16px] font-semibold tracking-tight text-white">Faregate</div>
            <div className="hidden text-[12px] text-zinc-400 sm:block">Permission and payment gateway for AI agents</div>
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {health ? (
            INTEGRATIONS.map(({ key, label, icon: Icon }) => {
              const live = health.modes[key] === 'live';
              return (
                <span
                  key={key}
                  title={live ? `${label} is live` : `${label} is simulated`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[12px] text-zinc-300"
                >
                  <Icon className="h-3.5 w-3.5 text-zinc-400" aria-hidden />
                  {label}
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${live ? 'bg-emerald-400 shadow-[0_0_8px_rgb(52_211_153)]' : 'bg-amber-400'}`}
                    aria-hidden
                  />
                  <span className={`text-[11px] font-medium ${live ? 'text-emerald-300' : 'text-amber-300'}`}>
                    {live ? 'live' : 'simulated'}
                  </span>
                </span>
              );
            })
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-400/30 bg-rose-500/10 px-2.5 py-1 text-[12px] text-rose-200">
              <TriangleAlert className="h-3.5 w-3.5" aria-hidden />
              Gateway unreachable
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {wallet.address ? (
            <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] py-1 pl-1 pr-3">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-linear-to-br from-orange-400 to-amber-500">
                <Wallet className="h-3.5 w-3.5 text-white" aria-hidden />
              </span>
              <div className="leading-tight">
                <div className="font-mono text-[12.5px] text-zinc-100">{shortAddress(wallet.address)}</div>
                <div className={`text-[10.5px] ${wrongChain ? 'text-rose-300' : 'text-zinc-400'}`}>
                  {wallet.name ?? 'Wallet'} · {wrongChain ? 'wrong network' : EXPECTED_CHAIN.name}
                </div>
              </div>
              {wrongChain ? (
                <Button size="sm" variant="danger" onClick={onSwitchChain}>
                  Switch to {EXPECTED_CHAIN.name}
                </Button>
              ) : null}
            </div>
          ) : (
            <Button
              variant="primary"
              onClick={onConnect}
              disabled={!wallet.available}
              icon={<Wallet className="h-4 w-4" aria-hidden />}
            >
              {wallet.available ? 'Connect wallet' : 'No wallet found'}
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
