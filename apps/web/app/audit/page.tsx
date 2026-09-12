'use client';

import type { AuditEvent } from '@faregate/shared';
import { useMemo, useState } from 'react';

import { EVENT_LABEL, describeEvent } from '@/components/audit/events';
import { useConsole } from '@/components/console/ConsoleProvider';
import { Empty, Figure, Figures, INPUT, PageHeader, SkeletonRows, Tabs } from '@/components/ui';
import { clockTime, timeAgo } from '@/lib/api';

type Actor = 'all' | AuditEvent['actor'];

export default function AuditPage() {
  const { events, loaded, agentLabel } = useConsole();
  const [actor, setActor] = useState<Actor>('all');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return events.filter((event) => {
      if (actor !== 'all' && event.actor !== actor) return false;
      if (!needle) return true;
      const haystack = `${EVENT_LABEL[event.type]} ${event.type} ${describeEvent(event)} ${event.agentId ?? ''}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [events, actor, query]);

  const signed = events.filter((e) => (e.detail as { signed?: unknown }).signed === true).length;
  const count = (a: AuditEvent['actor']) => events.filter((e) => e.actor === a).length;

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Append-only record of every request, decision, signature and payment, in the order they happened. The gateway never edits an entry."
      >
        <Figures>
          <Figure label="Entries" value={loaded ? events.length : '…'} detail="most recent 120" />
          <Figure label="Wallet signed" value={loaded ? signed : '…'} detail="human actions" />
        </Figures>
      </PageHeader>

      <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
        <Tabs
          label="Filter by actor"
          value={actor}
          onChange={setActor}
          options={[
            { value: 'all', label: 'Everyone', count: events.length },
            { value: 'human', label: 'People', count: count('human') },
            { value: 'agent', label: 'Agents', count: count('agent') },
            { value: 'system', label: 'Gateway', count: count('system') },
          ]}
        />
        <label className="flex w-full max-w-[300px] flex-col gap-1">
          <span className="sr-only">Search the log</span>
          <input
            type="search"
            className={`${INPUT} h-[34px]`}
            placeholder="Search events, agents or details"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>

      {!loaded ? (
        <SkeletonRows rows={8} />
      ) : events.length === 0 ? (
        <Empty title="Nothing recorded yet">Entries appear as agents ask, you decide, and fares are paid.</Empty>
      ) : filtered.length === 0 ? (
        <Empty title="No entries match">Try a different word, or show everyone.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-left text-[13px]">
            <thead>
              <tr className="border-b border-rule">
                <th className="label w-[128px] py-2 pr-3 font-semibold">Time</th>
                <th className="label w-[84px] py-2 pr-3 font-semibold">Actor</th>
                <th className="label w-[170px] py-2 pr-3 font-semibold">Event</th>
                <th className="label w-[190px] py-2 pr-3 font-semibold">Agent</th>
                <th className="label py-2 pr-3 font-semibold">Detail</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((event) => (
                <tr key={event.id} className="border-b border-rule align-top hover:bg-sheet">
                  <td className="tnum py-2 pr-3 font-mono text-[12px] text-ink-2" title={new Date(event.at).toLocaleString()}>
                    {clockTime(event.at)} <span className="text-muted">{timeAgo(event.at)}</span>
                  </td>
                  <td className="py-2 pr-3 text-ink-2">{event.actor === 'system' ? 'gateway' : event.actor}</td>
                  <td className="py-2 pr-3">
                    <div className="text-ink">{EVENT_LABEL[event.type]}</div>
                    <div className="font-mono text-[11px] text-muted">{event.type}</div>
                  </td>
                  <td className="py-2 pr-3 text-ink-2">{event.agentId ? agentLabel(event.agentId) : ''}</td>
                  <td className="py-2 pr-3 text-ink-2">{describeEvent(event)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
