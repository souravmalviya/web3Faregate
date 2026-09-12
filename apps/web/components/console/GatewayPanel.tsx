'use client';

import { SectionHeading } from '../ui';
import { useConsole } from './ConsoleProvider';

/** What the gateway is connected to, in the gateway's own words. */
export function GatewayPanel() {
  const { health } = useConsole();
  if (!health) return null;

  const rows: Array<{ name: string; mode: string; text: string }> = [
    { name: 'Payments', mode: health.modes.payment, text: `x402 on ${health.network}, paid in USDC` },
    { name: 'Data', mode: health.modes.data, text: health.providers.data },
    { name: 'Model', mode: health.modes.ai, text: health.providers.ai },
    { name: 'Identity', mode: health.modes.ens, text: health.providers.identity },
  ];

  return (
    <section aria-labelledby="gateway-status">
      <SectionHeading id="gateway-status" title="Gateway" />
      <dl className="divide-y divide-rule">
        {rows.map((row) => {
          const live = row.mode === 'live';
          return (
            <div key={row.name} className="py-2.5">
              <dt className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-medium text-ink">{row.name}</span>
                <span className={`flex items-center gap-1.5 text-[12px] ${live ? 'text-pass' : 'text-hold'}`}>
                  <span className={`h-[7px] w-[7px] ${live ? 'bg-pass' : 'bg-hold'}`} aria-hidden />
                  {row.mode}
                </span>
              </dt>
              <dd className="mt-0.5 line-clamp-3 text-[12px] leading-snug text-muted" title={row.text}>
                {row.text}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
