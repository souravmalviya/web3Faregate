'use client';

import { api, shortAddress, timeAgo, usd } from '@/lib/api';

import { useConsole } from '../console/ConsoleProvider';
import { Button, CopyText, SectionHeading } from '../ui';
import { approvalReason, describeQuery } from './model';

/**
 * Requests waiting for a signature. Each is a ticket: what the agent wants and
 * why it needs a person on the left, the fare and the decision on the stub.
 */
export function ApprovalQueue() {
  const { requests, agents, canAct, busy, run, wallet, health, agentLabel } = useConsole();
  const waiting = requests.filter((r) => r.status === 'awaiting_approval');
  if (waiting.length === 0) return null;

  const network = health?.network ?? 'hedera:testnet';

  const decide = (id: string, decision: 'approved' | 'rejected') =>
    run(id, async (sign) => {
      const updated = await api.approve(id, decision, sign);
      return decision === 'approved'
        ? `Approved and signed. The agent may now pay ${usd(updated.estimatedCostUsd)} and collect the data.`
        : 'Rejected and signed. The agent pays nothing.';
    });

  return (
    <section aria-labelledby="needs-signature" className="mb-10">
      <SectionHeading id="needs-signature" title="Needs your signature" meta={`${waiting.length} waiting`} />
      <ul className="mt-3 flex flex-col gap-3">
        {waiting.map((request) => {
          const agent = agents.find((a) => a.id === request.agentId);
          const isBusy = busy === request.id;
          return (
            <li key={request.id} className="flex flex-col border border-rule-strong bg-sheet sm:flex-row">
              <span className="h-[3px] shrink-0 bg-hold sm:h-auto sm:w-[3px]" aria-hidden />

              <div className="min-w-0 flex-1 px-5 py-4">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[13px]">
                  <span className="font-medium text-ink">{agentLabel(request.agentId)}</span>
                  <CopyText value={request.agentId} className="max-w-[280px] font-mono text-[12px] text-muted" />
                  <span className="text-muted">· {timeAgo(request.createdAt)}</span>
                </div>
                <p className="mt-1.5 text-[16px] leading-snug text-ink">Wants {describeQuery(request.query)}.</p>
                <p className="mt-1 line-clamp-2 text-[13px] text-ink-2 [overflow-wrap:anywhere]">
                  Asked: “{request.prompt}”
                </p>
                <p className="mt-3 border-t border-dashed border-rule pt-3 text-[13px] leading-relaxed text-ink-2">
                  {approvalReason(request, agent)}
                </p>
              </div>

              <span className="perforation my-3 hidden sm:block" aria-hidden />

              <div className="flex shrink-0 flex-col gap-3 border-t border-rule px-5 py-4 sm:w-[240px] sm:border-t-0">
                <div>
                  <div className="label">Fare</div>
                  <div className="tnum mt-1 font-mono text-[26px] font-medium leading-none text-ink">
                    {usd(request.estimatedCostUsd)}
                  </div>
                  <div className="mt-1 text-[12px] text-muted">USDC · {network}</div>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="approve"
                    className="flex-1"
                    loading={isBusy}
                    disabled={!canAct}
                    onClick={() => void decide(request.id, 'approved')}
                  >
                    {isBusy ? 'Signing' : 'Approve'}
                  </Button>
                  <Button variant="danger" disabled={!canAct || isBusy} onClick={() => void decide(request.id, 'rejected')}>
                    Reject
                  </Button>
                </div>
                <p className="text-[11.5px] leading-snug text-muted">
                  {canAct && wallet.address
                    ? `Signs a message as ${shortAddress(wallet.address)}. No transaction is sent.`
                    : 'Connect a wallet on Sepolia to sign.'}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
