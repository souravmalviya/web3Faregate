'use client';

import { motion } from 'framer-motion';
import { Ban, Clock, Coins, ShieldCheck, type LucideIcon } from 'lucide-react';

import type { AccessRequest } from '@faregate/shared';

import { type AgentWithPolicy, usd } from '@/lib/api';

import { ICON_TONE, type Tone } from './ui';

interface Stat {
  label: string;
  value: string;
  hint: string;
  icon: LucideIcon;
  tone: Tone;
  highlight?: boolean;
}

/** The four numbers a human glances at first. */
export function StatsBar({ requests, agents }: { requests: AccessRequest[]; agents: AgentWithPolicy[] }) {
  const waiting = requests.filter((r) => r.status === 'awaiting_approval').length;
  const spent = agents.reduce((sum, a) => sum + a.spentTodayUsd, 0);
  const limit = agents.reduce((sum, a) => sum + (a.status === 'active' ? (a.policy?.dailyLimitUsd ?? 0) : 0), 0);
  const paidOnchain = requests.filter((r) => r.payment?.settled === true && r.payment.verifiedBy !== 'simulated').length;
  const refused = requests.filter((r) => r.status === 'rejected' || (Boolean(r.lastRefusal) && !r.result)).length;

  const stats: Stat[] = [
    {
      label: 'Waiting on you',
      value: String(waiting),
      hint: waiting > 0 ? 'Approve or reject below' : 'Nothing to approve',
      icon: Clock,
      tone: waiting > 0 ? 'hold' : 'neutral',
      highlight: waiting > 0,
    },
    { label: 'Spent today', value: usd(spent), hint: `of ${usd(limit)} in daily limits`, icon: Coins, tone: 'brand' },
    { label: 'Paid onchain', value: String(paidOnchain), hint: 'Settled in USDC on Hedera', icon: ShieldCheck, tone: 'pass' },
    { label: 'Refused', value: String(refused), hint: 'Got nothing, paid nothing', icon: Ban, tone: 'stop' },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {stats.map((stat, i) => (
        <motion.div
          key={stat.label}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: i * 0.05 }}
          className={`rounded-2xl border bg-white/[0.03] p-4 transition-colors ${
            stat.highlight ? 'border-amber-400/35 shadow-[0_12px_40px_-16px_rgba(251,191,36,0.35)]' : 'border-white/[0.08]'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[12.5px] text-zinc-400">{stat.label}</span>
            <span className={`flex h-8 w-8 items-center justify-center rounded-lg border ${ICON_TONE[stat.tone]}`}>
              <stat.icon className="h-4 w-4" aria-hidden />
            </span>
          </div>
          <div className="tnum mt-2 font-mono text-[26px] font-semibold tracking-tight text-white">{stat.value}</div>
          <div className="mt-0.5 text-[12px] text-zinc-500">{stat.hint}</div>
        </motion.div>
      ))}
    </div>
  );
}
