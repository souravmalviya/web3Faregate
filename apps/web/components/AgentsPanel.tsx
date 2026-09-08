'use client';

import { useState } from 'react';

import { RESOURCE_KINDS, RESOURCE_LABELS, type Policy, type ResourceKind } from '@faregate/shared';

import { type AgentWithPolicy, usd } from '@/lib/api';

import { Button, Empty, Kv, Pill, Section } from './ui';

export function AgentsPanel({
  agents,
  onRevoke,
  onSavePolicy,
  busy,
}: {
  agents: AgentWithPolicy[];
  onRevoke: (id: string) => Promise<void>;
  onSavePolicy: (id: string, policy: Omit<Policy, 'agentId'>) => Promise<void>;
  busy: string | null;
}) {
  return (
    <Section
      eyebrow="Agent access"
      title="Passports"
      aside={`${agents.length} passport${agents.length === 1 ? '' : 's'}`}
    >
      {agents.length === 0 ? (
        <Empty>No passports yet. The gateway seeds two demo agents on start.</Empty>
      ) : (
        <div className="flex flex-col gap-3">
          {agents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              onRevoke={onRevoke}
              onSavePolicy={onSavePolicy}
              busy={busy === agent.id}
            />
          ))}
        </div>
      )}
    </Section>
  );
}

function AgentCard({
  agent,
  onRevoke,
  onSavePolicy,
  busy,
}: {
  agent: AgentWithPolicy;
  onRevoke: (id: string) => Promise<void>;
  onSavePolicy: (id: string, policy: Omit<Policy, 'agentId'>) => Promise<void>;
  busy: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  const policy = agent.policy;
  const dailyLimit = policy?.dailyLimitUsd ?? 0;
  const spentPct = dailyLimit > 0 ? Math.min(100, (agent.spentTodayUsd / dailyLimit) * 100) : 0;
  const revoked = agent.status === 'revoked';

  return (
    <article
      className={`rounded-sm border bg-surface ${revoked ? 'border-stop' : 'border-rule'}`}
    >
      <div className="flex flex-wrap items-start gap-4 px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="display text-[19px] font-semibold">{agent.label}</h3>
            <Pill tone={revoked ? 'stop' : agent.status === 'expired' ? 'hold' : 'pass'}>
              {agent.status}
            </Pill>
            <Pill tone={agent.source === 'ens' ? 'info' : 'neutral'}>
              {agent.source === 'ens' ? 'ENS passport' : 'local passport'}
            </Pill>
          </div>
          <div className="mt-0.5 truncate font-mono text-[12.5px] text-muted">{agent.id}</div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="quiet" onClick={() => setEditing((v) => !v)} disabled={revoked}>
            {editing ? 'Close' : 'Edit policy'}
          </Button>
          {revoked ? null : confirming ? (
            <>
              <Button
                variant="danger"
                disabled={busy}
                onClick={async () => {
                  await onRevoke(agent.id);
                  setConfirming(false);
                }}
              >
                {busy ? 'Revoking…' : 'Confirm revoke'}
              </Button>
              <Button variant="quiet" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button variant="danger" onClick={() => setConfirming(true)}>
              Revoke
            </Button>
          )}
        </div>
      </div>

      {policy ? (
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-rule px-5 py-4 md:grid-cols-4">
          <Kv label="Per query">{usd(policy.maxCostPerQueryUsd)}</Kv>
          <Kv label="Approval above">{usd(policy.humanApprovalAboveUsd)}</Kv>
          <Kv label="Daily limit">{usd(policy.dailyLimitUsd)}</Kv>
          <Kv label="Expires">{policy.expiresAt ? new Date(policy.expiresAt).toLocaleDateString() : 'never'}</Kv>
          <div className="col-span-2 md:col-span-4">
            <div className="eyebrow mb-1.5">Scope</div>
            <div className="flex flex-wrap gap-1.5">
              {policy.allowedResources.map((r) => (
                <Pill key={r} tone="neutral">
                  {RESOURCE_LABELS[r]}
                </Pill>
              ))}
            </div>
          </div>
          <div className="col-span-2 md:col-span-4">
            <div className="mb-1 flex items-baseline justify-between">
              <span className="eyebrow">Spent today</span>
              <span className="tnum font-mono text-[12px] text-ink">
                {usd(agent.spentTodayUsd)} <span className="text-muted">of {usd(dailyLimit)}</span>
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
              <div
                className={`h-full transition-[width] ${spentPct >= 90 ? 'bg-stop' : 'bg-brass'}`}
                style={{ width: `${spentPct}%` }}
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="border-t border-rule px-5 py-3 text-[13px] text-muted">
          No capability attached. This passport cannot buy anything.
        </div>
      )}

      {editing && policy ? (
        <PolicyForm
          policy={policy}
          busy={busy}
          onCancel={() => setEditing(false)}
          onSave={async (next) => {
            await onSavePolicy(agent.id, next);
            setEditing(false);
          }}
        />
      ) : null}
    </article>
  );
}

function PolicyForm({
  policy,
  busy,
  onSave,
  onCancel,
}: {
  policy: Policy;
  busy: boolean;
  onSave: (next: Omit<Policy, 'agentId'>) => Promise<void>;
  onCancel: () => void;
}) {
  const [scope, setScope] = useState<ResourceKind[]>(policy.allowedResources);
  const [perQuery, setPerQuery] = useState(String(policy.maxCostPerQueryUsd));
  const [daily, setDaily] = useState(String(policy.dailyLimitUsd));
  const [approval, setApproval] = useState(String(policy.humanApprovalAboveUsd));
  const [expires, setExpires] = useState(policy.expiresAt ? policy.expiresAt.slice(0, 10) : '');
  const [error, setError] = useState<string | null>(null);

  const num = (v: string) => {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) && n >= 0 ? n : Number.NaN;
  };

  return (
    <form
      className="grid grid-cols-2 gap-x-6 gap-y-4 border-t border-rule bg-surface-2/40 px-5 py-4 md:grid-cols-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        const next = {
          allowedResources: scope,
          maxCostPerQueryUsd: num(perQuery),
          dailyLimitUsd: num(daily),
          humanApprovalAboveUsd: num(approval),
          expiresAt: expires ? new Date(`${expires}T23:59:59Z`).toISOString() : null,
        };
        if (scope.length === 0) return setError('Pick at least one resource.');
        if ([next.maxCostPerQueryUsd, next.dailyLimitUsd, next.humanApprovalAboveUsd].some(Number.isNaN)) {
          return setError('Limits must be non-negative numbers.');
        }
        try {
          await onSave(next);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Could not save.');
        }
      }}
    >
      <Field label="Per query (USD)">
        <input className={INPUT} inputMode="decimal" value={perQuery} onChange={(e) => setPerQuery(e.target.value)} />
      </Field>
      <Field label="Approval above (USD)">
        <input className={INPUT} inputMode="decimal" value={approval} onChange={(e) => setApproval(e.target.value)} />
      </Field>
      <Field label="Daily limit (USD)">
        <input className={INPUT} inputMode="decimal" value={daily} onChange={(e) => setDaily(e.target.value)} />
      </Field>
      <Field label="Expires">
        <input className={INPUT} type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
      </Field>
      <div className="col-span-2 md:col-span-4">
        <div className="eyebrow mb-1.5">Scope</div>
        <div className="flex flex-wrap gap-2">
          {RESOURCE_KINDS.map((kind) => {
            const on = scope.includes(kind);
            return (
              <label
                key={kind}
                className={`cursor-pointer select-none rounded-sm border px-2.5 py-1 text-[13px] ${
                  on ? 'border-brass bg-brass-fill text-ink' : 'border-rule text-muted'
                }`}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={on}
                  onChange={() =>
                    setScope((s) => (on ? s.filter((k) => k !== kind) : [...s, kind]))
                  }
                />
                {RESOURCE_LABELS[kind]}
              </label>
            );
          })}
        </div>
      </div>
      <div className="col-span-2 flex items-center gap-2 md:col-span-4">
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save policy'}
        </Button>
        <Button type="button" variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
        {error ? <span className="text-[13px] text-stop">{error}</span> : null}
      </div>
    </form>
  );
}

const INPUT =
  'w-full rounded-sm border border-rule-strong bg-surface px-2.5 py-1.5 font-mono text-[13px] text-ink tnum';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="eyebrow">{label}</span>
      {children}
    </label>
  );
}
