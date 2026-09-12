'use client';

import Link from 'next/link';

import { usd } from '@/lib/api';

import { useConsole } from '../console/ConsoleProvider';
import { Empty, SectionHeading, SkeletonRows, SpendMeter, Stamp } from '../ui';

/** The passports at a glance, beside the requests they govern. */
export function PassportRail() {
  const { agents, loaded } = useConsole();

  return (
    <section aria-labelledby="rail-passports">
      <SectionHeading id="rail-passports" title="Passports">
        <Link href="/passports" className="text-[12.5px] text-brand hover:underline">
          Manage
        </Link>
      </SectionHeading>
      {!loaded ? (
        <SkeletonRows rows={2} />
      ) : agents.length === 0 ? (
        <Empty title="No passports">An agent needs a passport before it can ask for anything.</Empty>
      ) : (
        <ul className="divide-y divide-rule">
          {agents.map((agent) => {
            const policy = agent.policy;
            const revoked = agent.status === 'revoked';
            return (
              <li key={agent.id} className="py-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium text-ink">{agent.label}</span>
                  <Stamp tone={revoked ? 'stop' : agent.status === 'expired' ? 'hold' : 'pass'}>{agent.status}</Stamp>
                </div>
                <div className="truncate font-mono text-[11.5px] text-muted">{agent.id}</div>
                {revoked ? (
                  <p className="mt-1.5 text-[12.5px] text-stop">Every request from this agent is refused at the gate.</p>
                ) : policy ? (
                  <>
                    <p className="tnum mt-1.5 text-[12.5px] text-ink-2">
                      {usd(policy.maxCostPerQueryUsd)} a query · approval above {usd(policy.humanApprovalAboveUsd)}
                    </p>
                    <SpendMeter spent={agent.spentTodayUsd} limit={policy.dailyLimitUsd} />
                  </>
                ) : (
                  <p className="mt-1.5 text-[12.5px] text-ink-2">No limits attached, so it cannot buy anything.</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
