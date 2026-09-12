'use client';

import { Fragment } from 'react';

import type { Station, StationState } from './model';

const STATE_TEXT: Record<StationState, string> = {
  passed: 'passed',
  auto: 'passed without approval',
  current: 'waiting here',
  stopped: 'stopped here',
  ahead: 'not reached',
};

function Mark({ station }: { station: Station }) {
  switch (station.state) {
    case 'passed':
      return <span className="block h-[9px] w-[9px] rounded-full bg-ink" />;
    case 'auto':
      return <span className="block h-[9px] w-[9px] rounded-full border-2 border-ink bg-sheet" />;
    case 'current':
      return (
        <span
          className={`block h-[11px] w-[11px] rounded-full border-2 ${
            station.key === 'approved' ? 'border-hold bg-hold-tint' : 'border-brand bg-brand-tint'
          }`}
        />
      );
    case 'stopped':
      return <span className="block h-[10px] w-[10px] bg-stop" />;
    default:
      return <span className="block h-[7px] w-[7px] rounded-full border border-rule-strong bg-sheet" />;
  }
}

/**
 * A request's route through the gate, drawn like a transit line. A filled stop
 * has been passed, a ring is where it is waiting, a red square is where it was
 * stopped. The shapes differ as well as the colours.
 */
export function GateTrack({ stations, labelled = false }: { stations: Station[]; labelled?: boolean }) {
  const summary = stations.map((s) => `${s.label} ${STATE_TEXT[s.state]}`).join(', ');
  return (
    <div
      role="img"
      aria-label={summary}
      title={labelled ? undefined : summary}
      className={`flex items-center ${labelled ? 'pb-5' : ''}`}
    >
      {stations.map((station, i) => (
        <Fragment key={station.key}>
          {i > 0 ? (
            <span
              aria-hidden
              className={`h-[2px] ${labelled ? 'w-14 sm:w-20' : 'w-3.5'} ${
                station.state === 'ahead' ? 'bg-rule' : station.state === 'stopped' ? 'bg-stop' : 'bg-ink'
              }`}
            />
          ) : null}
          <span className="relative flex h-3 w-3 items-center justify-center">
            <Mark station={station} />
            {labelled ? (
              <span
                className={`absolute left-1/2 top-4 -translate-x-1/2 whitespace-nowrap text-[11.5px] ${
                  station.state === 'ahead' ? 'text-muted' : station.state === 'stopped' ? 'text-stop' : 'text-ink'
                }`}
              >
                {station.label}
              </span>
            ) : null}
          </span>
        </Fragment>
      ))}
    </div>
  );
}
