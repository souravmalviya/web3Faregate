'use client';

import { useConsole } from '@/components/console/ConsoleProvider';
import { GatewayPanel } from '@/components/console/GatewayPanel';
import { PassportRail } from '@/components/passports/PassportRail';
import { ApprovalQueue } from '@/components/requests/ApprovalQueue';
import { RequestLedger } from '@/components/requests/RequestLedger';
import { TestRequestPanel } from '@/components/requests/TestRequestPanel';
import { Figure, Figures, PageHeader, SkeletonRows } from '@/components/ui';
import { usd } from '@/lib/api';

export default function RequestsPage() {
  const { loaded, requests, agents } = useConsole();

  const waiting = requests.filter((r) => r.status === 'awaiting_approval').length;
  const spent = agents.reduce((sum, a) => sum + a.spentTodayUsd, 0);
  const limit = agents.reduce((sum, a) => sum + (a.status === 'active' ? (a.policy?.dailyLimitUsd ?? 0) : 0), 0);
  const settled = requests.filter((r) => r.payment?.settled === true && r.payment.verifiedBy !== 'simulated').length;
  const refused = requests.filter(
    (r) => r.status === 'rejected' || r.status === 'failed' || (r.status === 'payment_required' && Boolean(r.lastRefusal)),
  ).length;

  return (
    <>
      <PageHeader
        title="Requests"
        description="Data requests from your agents. Each is checked against the agent’s passport, waits for you above its approval line, and is paid for before any data is released."
      >
        <Figures>
          <Figure label="Needs you" value={loaded ? waiting : '…'} tone={waiting > 0 ? 'hold' : undefined} />
          <Figure label="Spent today" value={loaded ? usd(spent) : '…'} detail={`of ${usd(limit)} in daily limits`} />
          <Figure label="Settled fares" value={loaded ? settled : '…'} detail="on Hedera" />
          <Figure label="Refused" value={loaded ? refused : '…'} />
        </Figures>
      </PageHeader>

      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          {loaded ? (
            <>
              <ApprovalQueue />
              <RequestLedger />
            </>
          ) : (
            <SkeletonRows rows={6} />
          )}
        </div>
        <aside className="flex flex-col gap-9">
          <PassportRail />
          <TestRequestPanel />
          <GatewayPanel />
        </aside>
      </div>
    </>
  );
}
