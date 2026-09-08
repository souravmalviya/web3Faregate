'use client';

import type { Health } from '@/lib/api';
import { shortAddress } from '@/lib/api';
import { EXPECTED_CHAIN, type WalletState } from '@/lib/wallet';

import { Button, ModeChip } from './ui';

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
    <div className="sticky top-0 z-20 border-b border-rule bg-surface">
      <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-6 gap-y-2 px-6 py-2.5">
        <div className="flex items-baseline gap-3">
          <span className="display text-[20px] font-bold tracking-[0.1em]">
            Fare<span className="text-brass">gate</span>
          </span>
          <span className="hidden text-[13px] text-muted sm:inline">
            Agents buy onchain data by the query. Humans decide what they may buy.
          </span>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1">
          {health ? (
            <>
              <ModeChip label="payment" mode={health.modes.payment} />
              <ModeChip label="data" mode={health.modes.data} />
              <ModeChip label="ai" mode={health.modes.ai} />
              <ModeChip label="ens" mode={health.modes.ens} />
              <span className="font-mono text-[11px] text-muted">{health.network}</span>
            </>
          ) : (
            <span className="font-mono text-[11px] text-stop">gateway unreachable</span>
          )}

          {wallet.address ? (
            <span className="flex items-center gap-2 border-l border-rule pl-4">
              <span className="font-mono text-[12px] text-ink">{shortAddress(wallet.address)}</span>
              {wrongChain ? (
                <Button variant="danger" onClick={onSwitchChain} title="Wallet is on the wrong network">
                  Switch to {EXPECTED_CHAIN.name}
                </Button>
              ) : (
                <span className="font-mono text-[11px] text-pass">{EXPECTED_CHAIN.name}</span>
              )}
            </span>
          ) : (
            <Button variant="primary" onClick={onConnect} disabled={!wallet.available}>
              {wallet.available ? 'Connect wallet' : 'No wallet found'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
