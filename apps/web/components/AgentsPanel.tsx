'use client';

import { useMemo, useState } from 'react';

import {
  RESOURCE_KINDS,
  RESOURCE_LABELS,
  agentIdFromLabel,
  type Policy,
  type ResourceKind,
} from '@faregate/shared';

import { type AgentWithPolicy, type CreateAgentInput, type PolicyInput, usd } from '@/lib/api';

import { Button, Empty, Kv, Pill, Section } from './ui';

export function AgentsPanel({
  agents,
  parentName,
  ensLive,
  canAct,
  onCreate,
  onRevoke,
  onSavePolicy,
  busy,
}: {
  agents: AgentWithPolicy[];
  parentName: string;
  /** When ENS is live, passports under the parent are created onchain, not here. */
  ensLive: boolean;
  canAct: boolean;
  onCreate: (input: CreateAgentInput) => Promise<void>;
  onRevoke: (id: string) => Promise<void>;
  onSavePolicy: (id: string, policy: PolicyInput) => Promise<void>;
  busy: string | null;
}) {
  const [creating, setCreating] = useState(false);

  return (
    <Section
      eyebrow="Agent access"
      title="Passports"
      aside={
        ensLive ? (
          <span className="max-w-[280px] text-right text-[12.5px] text-muted">
            Passports are ENS names on Sepolia. Their limits live in the name&apos;s records.
          </span>
        ) : (
          <Button
            variant={creating ? 'quiet' : 'primary'}
            onClick={() => setCreating((v) => !v)}
            disabled={!canAct && !creating}
            title={canAct ? undefined : 'Connect a wallet on Sepolia to create an agent'}
          >
            {creating ? 'Close' : 'New agent'}
          </Button>
        )
      }
    >
      {creating && !ensLive ? (
        <CreateAgentForm
          parentName={parentName}
          existingIds={agents.map((a) => a.id)}
          busy={busy === 'create'}
          onCancel={() => setCreating(false)}
          onCreate={async (input) => {
            await onCreate(input);
            setCreating(false);
          }}
        />
      ) : null}

      {agents.length === 0 ? (
        <Empty>No passports yet. Create one, or restart the gateway to seed the two demo agents.</Empty>
      ) : (
        <div className="flex flex-col gap-3">
          {agents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              canAct={canAct}
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

// --- create -------------------------------------------------------------------

const DEFAULT_SCOPE: ResourceKind[] = ['wallet.balances', 'wallet.transfers', 'wallet.activity'];

/**
 * Creates a passport with its capability in one signed action.
 *
 * The defaults are chosen so the first request in the demo stops for a human:
 * a 30-day activity query costs $0.036, which is above the $0.02 approval
 * threshold and inside the $0.10 per-query and $1.00 daily limits.
 */
function CreateAgentForm({
  parentName,
  existingIds,
  busy,
  onCreate,
  onCancel,
}: {
  parentName: string;
  existingIds: string[];
  busy: boolean;
  onCreate: (input: CreateAgentInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState('ResearchBot');
  const [perQuery, setPerQuery] = useState('0.10');
  const [approval, setApproval] = useState('0.02');
  const [daily, setDaily] = useState('1.00');
  const [scope, setScope] = useState<ResourceKind[]>(DEFAULT_SCOPE);
  const [error, setError] = useState<string | null>(null);

  const id = useMemo(() => agentIdFromLabel(label, parentName), [label, parentName]);
  const taken = existingIds.includes(id);

  return (
    <form
      className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-sm border border-brass bg-surface px-5 py-4 md:grid-cols-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        const policy = readPolicy({ scope, perQuery, daily, approval, expires: '' });
        if (typeof policy === 'string') return setError(policy);
        if (label.trim().length < 2) return setError('Give the agent a name of at least two characters.');
        if (taken) return setError(`${id} already exists. Pick another name.`);
        try {
          await onCreate({ label: label.trim(), id, policy });
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Could not create the agent.');
        }
      }}
    >
      <div className="col-span-2 md:col-span-4">
        <div className="eyebrow mb-1">New agent</div>
        <p className="text-[13.5px] text-muted">
          The agent gets a passport and a capability. Your wallet signs the creation, so the passport records you as
          its owner.
        </p>
      </div>
      <Field label="Name" wide>
        <input className={INPUT} value={label} onChange={(e) => setLabel(e.target.value)} autoFocus />
        <span className={`mt-1 font-mono text-[11.5px] ${taken ? 'text-stop' : 'text-muted'}`}>
          passport {id}
          {taken ? ' (taken)' : ''}
        </span>
      </Field>
      <Field label="Per query (USD)">
        <input className={INPUT} inputMode="decimal" value={perQuery} onChange={(e) => setPerQuery(e.target.value)} />
      </Field>
      <Field label="Approval above (USD)">
        <input className={INPUT} inputMode="decimal" value={approval} onChange={(e) => setApproval(e.target.value)} />
      </Field>
      <Field label="Daily limit (USD)">
        <input className={INPUT} inputMode="decimal" value={daily} onChange={(e) => setDaily(e.target.value)} />
      </Field>
      <div className="col-span-2 md:col-span-4">
        <div className="eyebrow mb-1.5">Scope</div>
        <ScopePicker scope={scope} onChange={setScope} />
      </div>
      <div className="col-span-2 flex flex-wrap items-center gap-2 md:col-span-4">
        <Button type="submit" variant="primary" disabled={busy || taken}>
          {busy ? 'Waiting for signature…' : 'Create and sign'}
        </Button>
        <Button type="button" variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
        {error ? <span className="text-[13px] text-stop">{error}</span> : null}
      </div>
    </form>
  );
}

// --- card -------------------------------------------------------------------------

function AgentCard({
  agent,
  canAct,
  onRevoke,
  onSavePolicy,
  busy,
}: {
  agent: AgentWithPolicy;
  canAct: boolean;
  onRevoke: (id: string) => Promise<void>;
  onSavePolicy: (id: string, policy: PolicyInput) => Promise<void>;
  busy: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  const policy = agent.policy;
  const dailyLimit = policy?.dailyLimitUsd ?? 0;
  const spentPct = dailyLimit > 0 ? Math.min(100, (agent.spentTodayUsd / dailyLimit) * 100) : 0;
  const revoked = agent.status === 'revoked';
  const onchain = agent.source === 'ens';
  const lockTitle = canAct ? undefined : 'Connect a wallet on Sepolia to act';

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
            <Pill tone={onchain ? 'info' : 'neutral'}>{onchain ? 'ENS passport' : 'local passport'}</Pill>
          </div>
          <div className="mt-0.5 truncate font-mono text-[12.5px] text-muted">{agent.id}</div>
        </div>

        <div className="flex items-center gap-2">
          {onchain ? (
            <span
              className="text-[12.5px] text-muted"
              title={`This passport lives onchain. Revoke it from a terminal: npm run ens:revoke -- ${agent.id}`}
            >
              managed onchain
            </span>
          ) : (
            <>
              <Button
                variant="quiet"
                onClick={() => setEditing((v) => !v)}
                disabled={revoked || !canAct}
                title={lockTitle}
              >
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
                    {busy ? 'Waiting for signature…' : 'Confirm revoke'}
                  </Button>
                  <Button variant="quiet" onClick={() => setConfirming(false)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <Button variant="danger" onClick={() => setConfirming(true)} disabled={!canAct} title={lockTitle}>
                  Revoke
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {revoked ? (
        <div className="border-t border-stop bg-stop-fill px-5 py-2.5 font-mono text-[11.5px] uppercase tracking-[0.1em] text-stop">
          Access revoked. Every further request from this agent is refused at the gate.
        </div>
      ) : null}

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

// --- policy editing -----------------------------------------------------------

function PolicyForm({
  policy,
  busy,
  onSave,
  onCancel,
}: {
  policy: Policy;
  busy: boolean;
  onSave: (next: PolicyInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [scope, setScope] = useState<ResourceKind[]>(policy.allowedResources);
  const [perQuery, setPerQuery] = useState(String(policy.maxCostPerQueryUsd));
  const [daily, setDaily] = useState(String(policy.dailyLimitUsd));
  const [approval, setApproval] = useState(String(policy.humanApprovalAboveUsd));
  const [expires, setExpires] = useState(policy.expiresAt ? policy.expiresAt.slice(0, 10) : '');
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="grid grid-cols-2 gap-x-6 gap-y-4 border-t border-rule bg-surface-2/40 px-5 py-4 md:grid-cols-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        const next = readPolicy({ scope, perQuery, daily, approval, expires });
        if (typeof next === 'string') return setError(next);
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
        <ScopePicker scope={scope} onChange={setScope} />
      </div>
      <div className="col-span-2 flex items-center gap-2 md:col-span-4">
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'Waiting for signature…' : 'Save and sign'}
        </Button>
        <Button type="button" variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
        {error ? <span className="text-[13px] text-stop">{error}</span> : null}
      </div>
    </form>
  );
}

/** Validates the form fields into a policy, or returns the problem as text. */
function readPolicy(input: {
  scope: ResourceKind[];
  perQuery: string;
  daily: string;
  approval: string;
  expires: string;
}): PolicyInput | string {
  const num = (v: string) => {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) && n >= 0 ? n : Number.NaN;
  };
  const next: PolicyInput = {
    allowedResources: input.scope,
    maxCostPerQueryUsd: num(input.perQuery),
    dailyLimitUsd: num(input.daily),
    humanApprovalAboveUsd: num(input.approval),
    expiresAt: input.expires ? new Date(`${input.expires}T23:59:59Z`).toISOString() : null,
  };
  if (input.scope.length === 0) return 'Pick at least one resource.';
  if ([next.maxCostPerQueryUsd, next.dailyLimitUsd, next.humanApprovalAboveUsd].some(Number.isNaN)) {
    return 'Limits must be non-negative numbers.';
  }
  if (next.maxCostPerQueryUsd > next.dailyLimitUsd) {
    return 'The per-query limit cannot exceed the daily limit.';
  }
  return next;
}

function ScopePicker({ scope, onChange }: { scope: ResourceKind[]; onChange: (next: ResourceKind[]) => void }) {
  return (
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
              onChange={() => onChange(on ? scope.filter((k) => k !== kind) : [...scope, kind])}
            />
            {RESOURCE_LABELS[kind]}
          </label>
        );
      })}
    </div>
  );
}

const INPUT =
  'w-full rounded-sm border border-rule-strong bg-surface px-2.5 py-1.5 font-mono text-[13px] text-ink tnum';

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <label className={`flex flex-col gap-1 ${wide ? 'col-span-2 md:col-span-4' : ''}`}>
      <span className="eyebrow">{label}</span>
      {children}
    </label>
  );
}
