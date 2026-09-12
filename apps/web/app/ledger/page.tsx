'use client';

import { ExternalLink } from 'lucide-react';

import { useConsole } from '@/components/console/ConsoleProvider';
import { USDC_ASSETS, describeQuery, fareAmount } from '@/components/requests/model';
import { CopyText, Empty, Figure, Figures, PageHeader, SkeletonRows, Stamp } from '@/components/ui';
import { hashscanUrl, shortHash, usd } from '@/lib/api';

export default function LedgerPage() {
  const { requests, loaded, agentLabel, health } = useConsole();
  const network = health?.network ?? 'hedera:testnet';

  const entries = requests
    .filter((r) => r.payment)
    .sort((a, b) => (b.payment?.verifiedAt ?? '').localeCompare(a.payment?.verifiedAt ?? ''));
  const settled = entries.filter((r) => r.payment?.settled === true && r.payment.verifiedBy !== 'simulated');
  const totalUsd = settled.reduce(
    (sum, r) => sum + (r.payment && USDC_ASSETS.has(r.payment.asset) ? Number(r.payment.amount) / 1_000_000 : 0),
    0,
  );
  const payTo = entries.find((r) => r.payment?.to)?.payment?.to;

  return (
    <>
      <PageHeader
        title="Ledger"
        description="Every fare collected at the gate. A settled fare is a USDC transfer on Hedera from the agent’s own account to the gateway, verified by the x402 facilitator before any data was released."
      >
        <Figures>
          <Figure label="Settled" value={loaded ? usd(totalUsd) : '…'} detail="USDC" />
          <Figure label="Fares" value={loaded ? settled.length : '…'} detail={network} />
          {payTo ? (
            <Figure label="Paid to" value={<span className="text-[16px]">{payTo}</span>} detail="gateway account" />
          ) : null}
        </Figures>
      </PageHeader>

      <div className="mt-6">
        {!loaded ? (
          <SkeletonRows rows={4} />
        ) : entries.length === 0 ? (
          <Empty title="No fares collected yet">
            A fare appears here when an agent pays for a request it was cleared for. Run{' '}
            <code className="font-mono text-[12.5px] text-ink">npm run agent</code> and approve its request.
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse text-left text-[13.5px]">
              <thead>
                <tr className="border-b border-rule">
                  <th className="label w-[150px] py-2 pr-3 font-semibold">Settled</th>
                  <th className="label py-2 pr-3 font-semibold">Agent</th>
                  <th className="label py-2 pr-3 font-semibold">For</th>
                  <th className="label w-[120px] py-2 pr-4 text-right font-semibold">Fare</th>
                  <th className="label w-[100px] py-2 pr-3 font-semibold">Status</th>
                  <th className="label w-[210px] py-2 pr-3 font-semibold">Transaction</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((request) => {
                  const payment = request.payment;
                  if (!payment) return null;
                  const simulated = payment.verifiedBy === 'simulated';
                  const txUrl = hashscanUrl(payment.network || network, 'transaction', payment.txHash);
                  const at = new Date(payment.verifiedAt);
                  return (
                    <tr key={request.id} className="border-b border-rule align-top hover:bg-sheet">
                      <td className="tnum py-2.5 pr-3 font-mono text-[12px] text-ink-2">
                        {at.toLocaleDateString([], { month: 'short', day: 'numeric' })}{' '}
                        {at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })}
                      </td>
                      <td className="py-2.5 pr-3 text-ink">{agentLabel(request.agentId)}</td>
                      <td className="py-2.5 pr-3 text-ink-2">{describeQuery(request.query)}</td>
                      <td className="tnum py-2.5 pr-4 text-right font-mono text-ink">{fareAmount(payment)}</td>
                      <td className="py-2.5 pr-3">
                        <Stamp tone={simulated ? 'hold' : payment.settled ? 'pass' : 'brand'}>
                          {simulated ? 'Simulated' : payment.settled ? 'Settled' : 'Settling'}
                        </Stamp>
                      </td>
                      <td className="py-2.5 pr-3">
                        {txUrl ? (
                          <span className="inline-flex items-center gap-1">
                            <a
                              href={txUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 font-mono text-[12.5px] text-brand hover:underline"
                            >
                              {shortHash(payment.txHash)}
                              <ExternalLink className="h-3 w-3" aria-hidden />
                              <span className="sr-only">on HashScan</span>
                            </a>
                            <CopyText value={payment.txHash}>
                              <span className="sr-only">Transaction id</span>
                            </CopyText>
                          </span>
                        ) : (
                          <span className="text-[12.5px] text-muted">{simulated ? 'Not a chain transaction' : 'Waiting for the id'}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
