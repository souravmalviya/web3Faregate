'use client';

import { useState, type FormEvent } from 'react';

import { GatewayError, api, usd } from '@/lib/api';

import { explainFailure, useConsole } from '../console/ConsoleProvider';
import { Button, Field, INPUT, SectionHeading } from '../ui';

const ADDRESS = '0x742d35Cc6634C0532925a3b844Bc454e4438f44e';

const EXAMPLES = [
  { label: 'Month of activity', prompt: `Analyze the recent activity of ${ADDRESS} over the last month` },
  { label: 'Balance today', prompt: `What is the token balance of ${ADDRESS} today?` },
  { label: 'Lending positions', prompt: `Show me the lending positions of ${ADDRESS}` },
];

/** Sends the same request an agent would. It never pays: collecting data is the agent's job. */
export function TestRequestPanel() {
  const { agents, busy, setBusy, refresh } = useConsole();
  const [agentId, setAgentId] = useState('');
  const [prompt, setPrompt] = useState(EXAMPLES[0]?.prompt ?? '');
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const selected = agentId || agents[0]?.id || '';
  const sending = busy === 'submit';

  async function submit(event: FormEvent) {
    event.preventDefault();
    setOutcome(null);
    if (!selected) return setError('Choose an agent first.');
    if (prompt.trim().length === 0) return setError('Write what the agent is asking for.');
    if (!/0x[a-fA-F0-9]{40}/.test(prompt)) return setError('Include the 0x address the request is about.');
    setError(null);
    setBusy('submit');
    try {
      const out = await api.submit(selected, prompt);
      const r = out.request;
      setOutcome(
        r.status === 'awaiting_approval'
          ? `Waiting for your signature: ${usd(r.estimatedCostUsd)}. It is at the top of the list.`
          : r.status === 'payment_required'
            ? `Cleared by the passport at ${usd(r.estimatedCostUsd)}. The agent pays when it collects.`
            : `Refused: ${r.decision?.reasons[0]?.message ?? 'the passport check failed'}`,
      );
      await refresh();
    } catch (err) {
      // A 403 is the gateway refusing the request, which is recorded like any other.
      if (err instanceof GatewayError && err.status === 403) {
        setOutcome('Refused by the passport check. The request is in the list with the reason.');
        await refresh();
      } else {
        setError(explainFailure(err));
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby="test-request">
      <SectionHeading id="test-request" title="Send a test request" />
      <form onSubmit={submit} noValidate className="mt-3 flex flex-col gap-3">
        <Field label="Agent">
          <select className={`${INPUT} h-[34px]`} value={selected} onChange={(e) => setAgentId(e.target.value)}>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.label}
                {agent.status === 'active' ? '' : ` (${agent.status})`}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Request" error={error}>
          <textarea
            rows={3}
            aria-invalid={error ? true : undefined}
            className={`${INPUT} resize-y py-2 leading-relaxed`}
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value);
              setError(null);
            }}
          />
        </Field>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12.5px]">
          <span className="text-muted">Try</span>
          {EXAMPLES.map((example) => (
            <button
              key={example.label}
              type="button"
              onClick={() => {
                setPrompt(example.prompt);
                setError(null);
              }}
              className={`text-brand hover:underline ${prompt === example.prompt ? 'underline' : ''}`}
            >
              {example.label}
            </button>
          ))}
        </div>
        <div>
          <Button type="submit" variant="primary" loading={sending}>
            {sending ? 'Sending' : 'Send request'}
          </Button>
        </div>
        {outcome ? <p className="text-[12.5px] leading-relaxed text-ink">{outcome}</p> : null}
        <p className="text-[11.5px] leading-snug text-muted">
          Creates the request only. Nothing is paid until an agent collects the data with its own wallet.
        </p>
      </form>
    </section>
  );
}
