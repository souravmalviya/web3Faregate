'use client';

import { useState } from 'react';

import type { AgentWithPolicy } from '@/lib/api';

import { Button, Section } from './ui';

const EXAMPLES = [
  'Analyze the recent activity of 0x742d35Cc6634C0532925a3b844Bc454e4438f44e over the last month',
  'What is the token balance of 0x742d35Cc6634C0532925a3b844Bc454e4438f44e today?',
  'Show me the lending positions of 0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
];

export function SubmitBox({
  agents,
  onSubmit,
  busy,
}: {
  agents: AgentWithPolicy[];
  onSubmit: (agentId: string, prompt: string) => Promise<string>;
  busy: boolean;
}) {
  const [agentId, setAgentId] = useState(agents[0]?.id ?? '');
  const [prompt, setPrompt] = useState(EXAMPLES[0] ?? '');
  const [note, setNote] = useState<string | null>(null);
  const selected = agentId || agents[0]?.id || '';

  return (
    <Section eyebrow="Agent side" title="Send a request as an agent" aside="the same call the CLI agent makes">
      <form
        className="flex flex-col gap-3 rounded-sm border border-rule bg-surface p-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setNote(null);
          try {
            setNote(await onSubmit(selected, prompt));
          } catch (err) {
            setNote(err instanceof Error ? err.message : 'Submission failed.');
          }
        }}
      >
        <div className="grid gap-3 md:grid-cols-[260px_1fr]">
          <label className="flex flex-col gap-1">
            <span className="eyebrow">Acting as</span>
            <select
              className="rounded-sm border border-rule-strong bg-surface px-2.5 py-1.5 font-mono text-[13px] text-ink"
              value={selected}
              onChange={(e) => setAgentId(e.target.value)}
            >
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label} · {a.status}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="eyebrow">Ask</span>
            <input
              className="rounded-sm border border-rule-strong bg-surface px-2.5 py-1.5 text-[14px] text-ink"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Ask for balances, transfers, activity or positions of a 0x address"
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="primary" disabled={busy || !selected || prompt.trim().length === 0}>
            {busy ? 'Submitting…' : 'Submit request'}
          </Button>
          {EXAMPLES.map((example, i) => (
            <button
              key={i}
              type="button"
              className="rounded-sm border border-rule px-2 py-1 text-[12px] text-muted hover:bg-surface-2"
              onClick={() => setPrompt(example)}
            >
              example {i + 1}
            </button>
          ))}
          {note ? <span className="ml-auto text-[13px] text-ink-2">{note}</span> : null}
        </div>
      </form>
    </Section>
  );
}
