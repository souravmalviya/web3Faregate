'use client';

import {
  RESOURCE_KINDS,
  RESOURCE_LABELS,
  agentIdFromLabel,
  type Policy,
  type ResourceKind,
} from '@faregate/shared';
import { useMemo, useState, type FormEvent } from 'react';

import type { CreateAgentInput, PolicyInput } from '@/lib/api';

import { Button, Field, INPUT } from '../ui';

const DEFAULT_SCOPE: ResourceKind[] = ['wallet.balances', 'wallet.transfers', 'wallet.activity'];

type LimitField = 'perQuery' | 'approval' | 'daily';

interface LimitErrors {
  form?: string;
  perQuery?: string;
  approval?: string;
  daily?: string;
  scope?: string;
  label?: string;
}

/** Validates the limit fields, marking the field that is wrong rather than the whole form. */
function readPolicy(input: {
  scope: ResourceKind[];
  perQuery: string;
  daily: string;
  approval: string;
  expires: string;
}): { policy: PolicyInput } | { errors: LimitErrors } {
  const errors: LimitErrors = {};
  const num = (field: LimitField, raw: string): number => {
    const n = Number.parseFloat(raw);
    if (!Number.isFinite(n) || n < 0) {
      errors[field] = 'Enter an amount in dollars, like 0.10.';
      return Number.NaN;
    }
    return n;
  };
  const policy: PolicyInput = {
    allowedResources: input.scope,
    maxCostPerQueryUsd: num('perQuery', input.perQuery),
    dailyLimitUsd: num('daily', input.daily),
    humanApprovalAboveUsd: num('approval', input.approval),
    expiresAt: input.expires ? new Date(`${input.expires}T23:59:59Z`).toISOString() : null,
  };
  if (input.scope.length === 0) errors.scope = 'Allow at least one kind of data.';
  if (!errors.perQuery && !errors.daily && policy.maxCostPerQueryUsd > policy.dailyLimitUsd) {
    errors.perQuery = 'Cannot be more than the daily limit.';
  }
  return Object.keys(errors).length > 0 ? { errors } : { policy };
}

function ScopePicker({
  scope,
  onChange,
  error,
}: {
  scope: ResourceKind[];
  onChange: (next: ResourceKind[]) => void;
  error?: string;
}) {
  return (
    <fieldset>
      <legend className="label mb-1.5">Allowed data</legend>
      <div className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
        {RESOURCE_KINDS.map((kind) => {
          const on = scope.includes(kind);
          return (
            <label key={kind} className="flex cursor-pointer items-center gap-2 text-[13.5px] text-ink">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-[var(--brand)]"
                checked={on}
                onChange={() => onChange(on ? scope.filter((k) => k !== kind) : [...scope, kind])}
              />
              {RESOURCE_LABELS[kind]}
            </label>
          );
        })}
      </div>
      {error ? <p className="mt-1 text-[12px] text-stop">{error}</p> : null}
    </fieldset>
  );
}

function LimitInputs({
  values,
  errors,
  onChange,
}: {
  values: Record<LimitField, string>;
  errors: LimitErrors;
  onChange: (field: LimitField, value: string) => void;
}) {
  const fields: Array<{ key: LimitField; label: string; hint: string }> = [
    { key: 'perQuery', label: 'Per query', hint: 'Most one request may cost' },
    { key: 'approval', label: 'Approval above', hint: 'Above this, you sign first' },
    { key: 'daily', label: 'Daily limit', hint: 'Resets at midnight UTC' },
  ];
  return (
    <>
      {fields.map((field) => (
        <Field key={field.key} label={`${field.label} (USD)`} hint={field.hint} error={errors[field.key]}>
          <input
            className={`${INPUT} tnum h-[34px] font-mono`}
            inputMode="decimal"
            aria-invalid={errors[field.key] ? true : undefined}
            value={values[field.key]}
            onChange={(e) => onChange(field.key, e.target.value)}
          />
        </Field>
      ))}
    </>
  );
}

export function CreatePassportForm({
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
  const [limits, setLimits] = useState<Record<LimitField, string>>({ perQuery: '0.10', approval: '0.02', daily: '1.00' });
  const [scope, setScope] = useState<ResourceKind[]>(DEFAULT_SCOPE);
  const [errors, setErrors] = useState<LimitErrors>({});

  const id = useMemo(() => agentIdFromLabel(label, parentName), [label, parentName]);
  const taken = existingIds.includes(id);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const read = readPolicy({ scope, ...limits, expires: '' });
    const next: LimitErrors = 'errors' in read ? { ...read.errors } : {};
    if (label.trim().length < 2) next.label = 'Use at least two characters.';
    else if (taken) next.label = `${id} already exists.`;
    setErrors(next);
    if (Object.keys(next).length > 0 || 'errors' in read) return;
    try {
      await onCreate({ label: label.trim(), id, policy: read.policy });
    } catch (err) {
      setErrors({ form: err instanceof Error ? err.message : 'Could not create the passport.' });
    }
  }

  return (
    <form onSubmit={submit} noValidate className="border border-rule-strong bg-sheet px-5 py-5">
      <h2 className="font-display text-[17px] font-semibold text-ink">New passport</h2>
      <p className="mt-1 max-w-[560px] text-[13px] text-ink-2">
        Your wallet signs the creation, so the passport records you as its owner.
      </p>
      <div className="mt-4 grid gap-x-5 gap-y-4 md:grid-cols-3">
        <Field
          label="Name"
          className="md:col-span-3"
          error={errors.label}
          hint={<span className="font-mono">passport {id}</span>}
        >
          <input
            className={`${INPUT} h-[34px] max-w-[360px]`}
            aria-invalid={errors.label ? true : undefined}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </Field>
        <LimitInputs values={limits} errors={errors} onChange={(field, value) => setLimits((v) => ({ ...v, [field]: value }))} />
        <div className="md:col-span-3">
          <ScopePicker scope={scope} onChange={setScope} error={errors.scope} />
        </div>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" loading={busy}>
          {busy ? 'Waiting for signature' : 'Create and sign'}
        </Button>
        <Button type="button" variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
        {errors.form ? <span className="text-[13px] text-stop">{errors.form}</span> : null}
      </div>
    </form>
  );
}

export function PolicyForm({
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
  const [limits, setLimits] = useState<Record<LimitField, string>>({
    perQuery: String(policy.maxCostPerQueryUsd),
    approval: String(policy.humanApprovalAboveUsd),
    daily: String(policy.dailyLimitUsd),
  });
  const [expires, setExpires] = useState(policy.expiresAt ? policy.expiresAt.slice(0, 10) : '');
  const [scope, setScope] = useState<ResourceKind[]>(policy.allowedResources);
  const [errors, setErrors] = useState<LimitErrors>({});

  async function submit(event: FormEvent) {
    event.preventDefault();
    const read = readPolicy({ scope, ...limits, expires });
    if ('errors' in read) return setErrors(read.errors);
    setErrors({});
    try {
      await onSave(read.policy);
    } catch (err) {
      setErrors({ form: err instanceof Error ? err.message : 'Could not save the limits.' });
    }
  }

  return (
    <form onSubmit={submit} noValidate className="border-t border-rule bg-sheet px-5 py-5">
      <div className="grid gap-x-5 gap-y-4 md:grid-cols-4">
        <LimitInputs values={limits} errors={errors} onChange={(field, value) => setLimits((v) => ({ ...v, [field]: value }))} />
        <Field label="Expires" hint="Leave empty for no expiry">
          <input className={`${INPUT} h-[34px]`} type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
        </Field>
        <div className="md:col-span-4">
          <ScopePicker scope={scope} onChange={setScope} error={errors.scope} />
        </div>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" size="sm" loading={busy}>
          {busy ? 'Waiting for signature' : 'Save and sign'}
        </Button>
        <Button type="button" variant="quiet" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        {errors.form ? <span className="text-[13px] text-stop">{errors.form}</span> : null}
      </div>
    </form>
  );
}
