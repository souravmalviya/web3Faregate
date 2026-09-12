'use client';

import { Activity, Landmark, Send, Wallet } from 'lucide-react';
import { useState } from 'react';

import type { AgentWithPolicy } from '@/lib/api';

import { Button, Card, Label, Section } from './ui';

const ADDRESS = '0x742d35Cc6634C0532925a3b844Bc454e4438f44e';

const EXAMPLES = [
  { label: 'Activity, last month', icon: Activity, prompt: `Analyze the recent activity of ${ADDRESS} over the last month` },
  { label: 'Balance today', icon: Wallet, prompt: `What is the token balance of ${ADDRESS} today?` },
  { label: 'Lending positions', icon: Landmark, prompt: `Show me the lending positions of ${ADDRESS}` },
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
  const [prompt, setPrompt] = useState(EXAMPLES[0]?.prompt ?? '');
  const [note, setNote] = useState<string | null>(null);
  const selected = agentId || agents[0]?.id || '';

  return (
    <Section
      icon={<Send className="h-4.5 w-4.5" aria-hidden />}
      title="Try it as an agent"
      description="The same request the agent program sends. Nothing is paid from here."
    >
      <Card className="p-4 sm:p-5">
        <form
          className="flex flex-col gap-4"
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
          <label className="flex flex-col gap-1.5">
            <Label>Acting as</Label>
            <select
              className="h-10 rounded-lg border border-white/10 bg-black/30 px-3 text-[13.5px] text-zinc-100 outline-none focus:border-violet-400/60 focus:ring-2 focus:ring-violet-500/20 [&>option]:bg-zinc-900"
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

          <label className="flex flex-col gap-1.5">
            <Label>Ask for data</Label>
            <textarea
              rows={2}
              className="resize-none rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 text-[13.5px] leading-relaxed text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-violet-400/60 focus:ring-2 focus:ring-violet-500/20"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Ask for balances, transfers, activity or positions of a 0x address"
            />
          </label>

          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map(({ label, icon: Icon, prompt: example }) => (
              <button
                key={label}
                type="button"
                onClick={() => setPrompt(example)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] transition-colors ${
                  prompt === example
                    ? 'border-violet-400/40 bg-violet-500/15 text-violet-100'
                    : 'border-white/10 text-zinc-400 hover:border-white/20 hover:text-zinc-200'
                }`}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              variant="primary"
              loading={busy}
              disabled={!selected || prompt.trim().length === 0}
              icon={<Send className="h-4 w-4" aria-hidden />}
            >
              {busy ? 'Submitting…' : 'Submit request'}
            </Button>
            {note ? <span className="text-[13px] text-zinc-300">{note}</span> : null}
          </div>
        </form>
      </Card>
    </Section>
  );
}
