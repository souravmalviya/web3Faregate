'use client';

import { RESOURCE_LABELS } from '@faregate/shared';
import { useState } from 'react';

import { useConsole } from '@/components/console/ConsoleProvider';
import { CreatePassportForm, PolicyForm } from '@/components/passports/PassportForms';
import { Button, CopyText, Empty, PageHeader, SkeletonRows, SpendMeter, Stamp } from '@/components/ui';
import { api, shortAddress, usd, type AgentWithPolicy } from '@/lib/api';

export default function PassportsPage() {
  const { agents, loaded, health, canAct, busy, run } = useConsole();
  const [creating, setCreating] = useState(false);
  const ensLive = health?.modes.ens === 'live';
  const parentName = health?.parentName ?? 'agents.faregate.eth';

  return (
    <>
      <PageHeader
        title="Passports"
        description={
          ensLive
            ? 'Each agent is an ENS name on Sepolia. Its limits are text records on that name, read live on every request, and only the owner can change or revoke them.'
            : 'Each agent’s identity and spending limits. Every change is signed by your wallet.'
        }
      >
        {ensLive ? (
          <div className="text-right">
            <div className="label">Parent name</div>
            <div className="mt-1 font-mono text-[14px] text-ink">{parentName}</div>
          </div>
        ) : (
          <div className="flex flex-col items-end gap-1">
            <Button variant="primary" onClick={() => setCreating((v) => !v)} disabled={!canAct && !creating}>
              {creating ? 'Close' : 'New passport'}
            </Button>
            {!canAct ? <span className="text-[12px] text-muted">Connect a wallet on Sepolia to create one.</span> : null}
          </div>
        )}
      </PageHeader>

      {creating && !ensLive ? (
        <div className="mt-6">
          <CreatePassportForm
            parentName={parentName}
            existingIds={agents.map((a) => a.id)}
            busy={busy === 'create'}
            onCancel={() => setCreating(false)}
            onCreate={(input) =>
              run('create', async (sign) => {
                const out = await api.createAgent(input, sign);
                setCreating(false);
                return `Created ${out.agent.label} as ${out.agent.id}. It can start asking for data.`;
              })
            }
          />
        </div>
      ) : null}

      <div className="mt-6">
        {!loaded ? (
          <SkeletonRows rows={3} />
        ) : agents.length === 0 ? (
          <Empty title="No passports yet">
            {ensLive
              ? 'Register passports under the parent name with npm run ens:setup -- --send.'
              : 'Create one to let an agent ask for data.'}
          </Empty>
        ) : (
          <div className="divide-y divide-rule border-y border-rule">
            {agents.map((agent) => (
              <PassportRow key={agent.id} agent={agent} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function PassportRow({ agent }: { agent: AgentWithPolicy }) {
  const { canAct, busy, run } = useConsole();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const policy = agent.policy;
  const revoked = agent.status === 'revoked';
  const onchain = agent.source === 'ens';
  const isBusy = busy === agent.id;
  const zeroOwner = /^0x0+$/.test(agent.owner);

  return (
    <div className={`relative ${revoked ? 'bg-stop-tint/40' : ''}`}>
      {revoked ? <span className="absolute inset-y-0 left-0 w-[3px] bg-stop" aria-hidden /> : null}

      <div className="grid gap-x-8 gap-y-5 px-5 py-5 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_220px]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-[20px] font-semibold leading-tight text-ink">{agent.label}</h2>
            <Stamp tone={revoked ? 'stop' : agent.status === 'expired' ? 'hold' : 'pass'}>{agent.status}</Stamp>
            <Stamp tone={onchain ? 'brand' : 'neutral'} title={onchain ? 'Read from ENS on Sepolia' : 'Stored by this gateway'}>
              {onchain ? 'ENS' : 'Local'}
            </Stamp>
          </div>
          <CopyText value={agent.id} className="mt-1 max-w-full font-mono text-[12.5px] text-ink-2" />
          {!zeroOwner ? (
            <div className="mt-2 flex items-center gap-1.5 text-[12.5px] text-muted">
              Owner
              <CopyText value={agent.owner} className="font-mono text-ink-2">
                {shortAddress(agent.owner)}
              </CopyText>
            </div>
          ) : null}
          {revoked ? (
            <p className="mt-3 text-[13px] text-stop">Access revoked. Every request from this agent is refused at the gate.</p>
          ) : null}
        </div>

        {policy ? (
          <>
            <dl className="grid grid-cols-[auto_1fr] content-start gap-x-5 gap-y-1.5 text-[13px]">
              <dt className="text-muted">Per query</dt>
              <dd className="tnum font-mono text-ink">{usd(policy.maxCostPerQueryUsd)}</dd>
              <dt className="text-muted">Approval above</dt>
              <dd className="tnum font-mono text-ink">{usd(policy.humanApprovalAboveUsd)}</dd>
              <dt className="text-muted">Daily limit</dt>
              <dd className="tnum font-mono text-ink">{usd(policy.dailyLimitUsd)}</dd>
              <dt className="text-muted">Expires</dt>
              <dd className="text-ink">{policy.expiresAt ? new Date(policy.expiresAt).toLocaleDateString() : 'Never'}</dd>
            </dl>
            <div className="min-w-0">
              <div className="label">Allowed data</div>
              <ul className="mt-1.5 space-y-0.5 text-[13px] text-ink">
                {policy.allowedResources.map((r) => (
                  <li key={r}>{RESOURCE_LABELS[r]}</li>
                ))}
              </ul>
              <SpendMeter spent={agent.spentTodayUsd} limit={policy.dailyLimitUsd} />
            </div>
          </>
        ) : (
          <p className="text-[13px] text-ink-2 md:col-span-2">No limits attached, so this passport cannot buy anything.</p>
        )}

        <div className="flex min-w-0 flex-col items-start gap-2">
          {onchain ? (
            <>
              <div className="label">{revoked ? 'Restore' : 'Revoke onchain'}</div>
              <CopyText
                wrap
                value={revoked ? 'npm run ens:restore' : `npm run ens:revoke -- ${agent.id}`}
                className="max-w-full rounded-[2px] bg-sheet-2 px-2 py-1 font-mono text-[11.5px] text-ink"
              />
              <p className="text-[11.5px] leading-snug text-muted">
                {revoked
                  ? 'Sets the status record back to active with the owner key.'
                  : 'The owner key sets the status record to revoked. The gateway holds no key and cannot undo it.'}
              </p>
            </>
          ) : revoked ? null : (
            <>
              <Button
                variant="secondary"
                size="sm"
                disabled={!canAct}
                onClick={() => setEditing((v) => !v)}
                aria-expanded={editing}
              >
                {editing ? 'Close' : 'Edit limits'}
              </Button>
              {confirming ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="danger"
                    size="sm"
                    loading={isBusy}
                    onClick={() =>
                      void run(agent.id, async (sign) => {
                        await api.revokeAgent(agent.id, sign);
                        setConfirming(false);
                        return `Revoked ${agent.label}. Its next request will be refused at the gate.`;
                      })
                    }
                  >
                    {isBusy ? 'Waiting for signature' : 'Confirm revoke'}
                  </Button>
                  <Button variant="quiet" size="sm" onClick={() => setConfirming(false)}>
                    Keep
                  </Button>
                </div>
              ) : (
                <Button variant="danger" size="sm" disabled={!canAct} onClick={() => setConfirming(true)}>
                  Revoke
                </Button>
              )}
              {!canAct ? <p className="text-[11.5px] text-muted">Connect a wallet on Sepolia to change this passport.</p> : null}
            </>
          )}
        </div>
      </div>

      {editing && policy && !onchain ? (
        <PolicyForm
          policy={policy}
          busy={isBusy}
          onCancel={() => setEditing(false)}
          onSave={(next) =>
            run(agent.id, async (sign) => {
              await api.updatePolicy(agent.id, next, sign);
              setEditing(false);
              return `Limits saved for ${agent.label}.`;
            })
          }
        />
      ) : null}
    </div>
  );
}
