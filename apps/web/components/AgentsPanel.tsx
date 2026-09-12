'use client';

import { motion } from 'framer-motion';
import { BadgeCheck, Ban, Bot, KeyRound, Plus, ShieldCheck, X } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';

import {
  RESOURCE_KINDS,
  RESOURCE_LABELS,
  agentIdFromLabel,
  type Policy,
  type ResourceKind,
} from '@faregate/shared';

import { type AgentWithPolicy, type CreateAgentInput, type PolicyInput, usd } from '@/lib/api';

import { Badge, Button, Empty, Label, Section } from './ui';

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
      icon={<Bot className="h-4.5 w-4.5" aria-hidden />}
      title="Agent passports"
      description={
        ensLive
          ? 'Each agent is an ENS name on Sepolia. Its limits live in the name’s records.'
          : 'Each agent gets a passport with spending limits you control.'
      }
      aside={
        ensLive ? null : (
          <Button
            variant={creating ? 'quiet' : 'primary'}
            size="sm"
            icon={creating ? <X className="h-4 w-4" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
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
        <Empty icon={<Bot className="h-6 w-6" aria-hidden />} title="No passports yet">
          Create one, or restart the gateway to seed the two demo agents.
        </Empty>
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
      className="grid grid-cols-2 gap-x-4 gap-y-4 rounded-2xl border border-violet-400/25 bg-violet-500/[0.04] p-5 md:grid-cols-3"
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
      <div className="col-span-2 md:col-span-3">
        <div className="text-[14px] font-semibold text-white">New agent</div>
        <p className="mt-0.5 text-[13px] text-zinc-400">
          The agent gets a passport and spending limits. Your wallet signs the creation, so the passport records you
          as its owner.
        </p>
      </div>
      <Field label="Name" wide>
        <input className={INPUT} value={label} onChange={(e) => setLabel(e.target.value)} autoFocus />
        <span className={`mt-1 font-mono text-[11.5px] ${taken ? 'text-rose-300' : 'text-zinc-500'}`}>
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
      <div className="col-span-2 md:col-span-3">
        <Label>Allowed data</Label>
        <div className="mt-2">
          <ScopePicker scope={scope} onChange={setScope} />
        </div>
      </div>
      <div className="col-span-2 flex flex-wrap items-center gap-2 md:col-span-3">
        <Button type="submit" variant="primary" loading={busy} disabled={taken}>
          {busy ? 'Waiting for signature…' : 'Create and sign'}
        </Button>
        <Button type="button" variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
        {error ? <span className="text-[13px] text-rose-300">{error}</span> : null}
      </div>
    </form>
  );
}

// --- card ---------------------------------------------------------------------

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
  const expired = agent.status === 'expired';
  const onchain = agent.source === 'ens';
  const lockTitle = canAct ? undefined : 'Connect a wallet on Sepolia to act';

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className={`relative overflow-hidden rounded-2xl border bg-white/[0.03] ${
        revoked ? 'border-rose-400/35' : 'border-white/[0.08]'
      }`}
    >
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 h-px ${
          revoked ? 'bg-rose-400/70' : 'bg-linear-to-r from-transparent via-violet-400/70 to-transparent'
        }`}
        aria-hidden
      />

      <div className="flex flex-wrap items-start gap-3 p-5">
        <span
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${
            revoked
              ? 'border-rose-400/30 bg-rose-500/10 text-rose-300'
              : 'border-violet-400/25 bg-linear-to-br from-violet-500/20 to-cyan-500/10 text-violet-100'
          }`}
        >
          {revoked ? <Ban className="h-5 w-5" aria-hidden /> : <Bot className="h-5 w-5" aria-hidden />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[15.5px] font-semibold text-white">{agent.label}</h3>
            <Badge tone={revoked ? 'stop' : expired ? 'hold' : 'pass'} dot>
              {agent.status}
            </Badge>
            {onchain ? (
              <Badge tone="info">
                <BadgeCheck className="h-3 w-3" aria-hidden />
                ENS passport
              </Badge>
            ) : (
              <Badge tone="neutral">
                <KeyRound className="h-3 w-3" aria-hidden />
                local passport
              </Badge>
            )}
          </div>
          <div className="mt-1 truncate font-mono text-[12.5px] text-zinc-400">{agent.id}</div>
        </div>

        {onchain ? null : (
          <div className="flex items-center gap-2">
            <Button
              variant="quiet"
              size="sm"
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
                  size="sm"
                  loading={busy}
                  onClick={async () => {
                    await onRevoke(agent.id);
                    setConfirming(false);
                  }}
                >
                  {busy ? 'Waiting for signature…' : 'Confirm revoke'}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button variant="danger" size="sm" onClick={() => setConfirming(true)} disabled={!canAct} title={lockTitle}>
                Revoke
              </Button>
            )}
          </div>
        )}
      </div>

      {revoked ? (
        <div className="flex items-center gap-2 border-y border-rose-400/20 bg-rose-500/[0.08] px-5 py-2.5 text-[12.5px] font-medium text-rose-200">
          <Ban className="h-4 w-4 shrink-0" aria-hidden />
          Access revoked. Every further request from this agent is refused at the gate.
        </div>
      ) : null}

      {policy ? (
        <div className="flex flex-col gap-4 border-t border-white/[0.06] p-5">
          <div className="grid grid-cols-3 gap-2">
            <LimitTile label="Per query">{usd(policy.maxCostPerQueryUsd)}</LimitTile>
            <LimitTile label="Approval above">{usd(policy.humanApprovalAboveUsd)}</LimitTile>
            <LimitTile label="Daily limit">{usd(policy.dailyLimitUsd)}</LimitTile>
          </div>

          <div>
            <Label>Allowed data</Label>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {policy.allowedResources.map((r) => (
                <Badge key={r} tone="neutral">
                  {RESOURCE_LABELS[r]}
                </Badge>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex items-baseline justify-between">
              <Label>Spent today</Label>
              <span className="tnum font-mono text-[12.5px] text-zinc-100">
                {usd(agent.spentTodayUsd)} <span className="text-zinc-500">of {usd(dailyLimit)}</span>
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.06]">
              <motion.div
                className={`h-full rounded-full ${spentPct >= 90 ? 'bg-rose-400' : 'bg-linear-to-r from-violet-500 to-cyan-400'}`}
                initial={false}
                animate={{ width: `${agent.spentTodayUsd > 0 ? Math.max(spentPct, 2) : 0}%` }}
                transition={{ duration: 0.6, ease: 'easeOut' }}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-zinc-500">
            <span>Expires {policy.expiresAt ? new Date(policy.expiresAt).toLocaleDateString() : 'never'}</span>
            {onchain ? (
              <span
                className="inline-flex items-center gap-1.5"
                title={`Revoke from a terminal: npm run ens:revoke -- ${agent.id}`}
              >
                <ShieldCheck className="h-3.5 w-3.5 text-sky-300" aria-hidden />
                Rules stored onchain, changed only by the owner
              </span>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="border-t border-white/[0.06] px-5 py-3 text-[13px] text-zinc-400">
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
    </motion.article>
  );
}

function LimitTile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
      <div className="text-[11px] text-zinc-500">{label}</div>
      <div className="tnum mt-0.5 font-mono text-[15px] font-semibold text-white">{children}</div>
    </div>
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
      className="grid grid-cols-2 gap-x-4 gap-y-4 border-t border-white/[0.06] bg-black/20 p-5 md:grid-cols-4"
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
        <Label>Allowed data</Label>
        <div className="mt-2">
          <ScopePicker scope={scope} onChange={setScope} />
        </div>
      </div>
      <div className="col-span-2 flex items-center gap-2 md:col-span-4">
        <Button type="submit" variant="primary" size="sm" loading={busy}>
          {busy ? 'Waiting for signature…' : 'Save and sign'}
        </Button>
        <Button type="button" variant="quiet" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        {error ? <span className="text-[13px] text-rose-300">{error}</span> : null}
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
            className={`cursor-pointer select-none rounded-full border px-3 py-1 text-[12.5px] transition-colors ${
              on
                ? 'border-violet-400/40 bg-violet-500/15 text-violet-100'
                : 'border-white/10 text-zinc-400 hover:border-white/20 hover:text-zinc-200'
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
  'tnum w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 font-mono text-[13px] text-zinc-100 outline-none [color-scheme:dark] focus:border-violet-400/60 focus:ring-2 focus:ring-violet-500/20';

function Field({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <label className={`flex flex-col gap-1.5 ${wide ? 'col-span-2 md:col-span-3' : ''}`}>
      <Label>{label}</Label>
      {children}
    </label>
  );
}
