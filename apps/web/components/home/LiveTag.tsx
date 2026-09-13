'use client';

import type { ReactNode } from 'react';

import { useConsole } from '../console/ConsoleProvider';

/** Says live only while every part of the gateway is live, so nothing simulated reads as real. */
export function LiveTag() {
  const { health, gatewayState } = useConsole();

  if (!health) {
    if (gatewayState === 'waking') return <Tag tone="text-hold" dot="bg-hold">Waking the gateway</Tag>;
    if (gatewayState === 'offline') return <Tag tone="text-stop" dot="bg-stop">Gateway offline</Tag>;
    return <Tag tone="text-muted" dot="bg-rule-strong">Connecting</Tag>;
  }

  const live = Object.values(health.modes).every((mode) => mode === 'live');
  if (!live) return <Tag tone="text-hold" dot="bg-hold">Some parts simulated</Tag>;
  return (
    <Tag tone="text-pass" dot="bg-pass">
      Live on {health.network === 'hedera:mainnet' ? 'mainnet' : 'testnet'}
    </Tag>
  );
}

function Tag({ tone, dot, children }: { tone: string; dot: string; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-2 text-[13px] font-medium ${tone}`}>
      <span className={`h-2 w-2 ${dot}`} aria-hidden />
      {children}
    </span>
  );
}
