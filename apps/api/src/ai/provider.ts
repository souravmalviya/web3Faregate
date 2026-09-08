/**
 * The AI layer.
 *
 * The model does three jobs in Faregate and is trusted with none of them:
 *
 *   interpret  turn an agent's free-text ask into a structured query proposal
 *   explain    describe a policy decision in plain language
 *   analyze    summarise data that was already retrieved
 *
 * Every proposal from `interpret` is re-validated by the rule-based parser
 * before the policy engine sees it, so the model cannot widen an agent's scope.
 * `explain` narrates a decision the deterministic engine already made. And
 * `analyze` is grounded by construction: the text is checked against the data
 * it was given, and any transaction hash or address that does not appear in
 * that data is flagged and stripped rather than shown.
 *
 * A rule-based provider implements the same interface so the product works
 * with no API key at all, and the gateway reports which one is in use.
 */

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod/v4';

import {
  RESOURCE_KINDS,
  RESOURCE_LABELS,
  formatUsd,
  usdToMicros,
  type Agent,
  type DataProvenance,
  type PolicyDecision,
  type ResourceQuery,
} from '@faregate/shared';

import { parsePrompt } from '../query-parser.ts';

export interface InterpretResult {
  /** Untrusted proposal. Must be validated by `parseStructuredQuery`. */
  proposal: unknown;
  rationale: string;
  provider: AIProvider['name'];
}

export interface AnalysisResult {
  text: string;
  provider: AIProvider['name'];
  /** Hashes or addresses the model mentioned that were not in the data. */
  groundingWarnings: string[];
}

export interface AIProvider {
  readonly name: 'anthropic' | 'rule-based';
  describe(): string;
  interpret(prompt: string): Promise<InterpretResult>;
  explain(decision: PolicyDecision, query: ResourceQuery | null, agent: Agent | null): Promise<string>;
  analyze(query: ResourceQuery, data: unknown, provenance: DataProvenance): Promise<AnalysisResult>;
}

// --- grounding -----------------------------------------------------------

const HEX_TOKEN_RE = /0x[a-fA-F0-9]{8,64}/g;

/**
 * Checks model text against the data it was asked to describe.
 *
 * Any 0x-prefixed hex token in the text that does not appear in the serialised
 * data is treated as fabricated. It is replaced with a visible marker rather
 * than silently deleted, so a reader can see that something was removed and
 * the audit trail records what it was.
 */
export function groundAnalysis(text: string, data: unknown): { text: string; warnings: string[] } {
  const haystack = JSON.stringify(data ?? '').toLowerCase();
  const warnings: string[] = [];
  const grounded = text.replace(HEX_TOKEN_RE, (token) => {
    if (haystack.includes(token.toLowerCase())) return token;
    warnings.push(token);
    return '[unverified value removed]';
  });
  return { text: grounded, warnings };
}

// --- rule-based ----------------------------------------------------------

/**
 * Deterministic provider used when no model is configured.
 *
 * It is not a lesser mode of the product. The policy engine, pricing, payment
 * and data retrieval are all identical; only the prose is templated.
 */
export class RuleBasedAIProvider implements AIProvider {
  readonly name = 'rule-based' as const;

  describe(): string {
    return 'Rule-based interpreter. No model configured.';
  }

  async interpret(prompt: string): Promise<InterpretResult> {
    const parsed = parsePrompt(prompt);
    return { proposal: parsed.query, rationale: parsed.note, provider: this.name };
  }

  async explain(decision: PolicyDecision, query: ResourceQuery | null, agent: Agent | null): Promise<string> {
    const lines: string[] = [];
    if (agent) lines.push(`Agent ${agent.label} (${agent.id}) is ${agent.status}.`);
    if (query) {
      lines.push(
        `The request needs ${RESOURCE_LABELS[query.resource].toLowerCase()} for ${query.address} over ${query.lookbackDays} day(s), priced at ${formatUsd(usdToMicros(decision.estimatedCostUsd))}.`,
      );
    }
    for (const reason of decision.reasons) lines.push(reason.message);
    if (decision.allowed) {
      lines.push(
        decision.requiresHumanApproval
          ? 'A human must approve before the agent can pay.'
          : 'The agent may pay and collect without further approval.',
      );
    } else {
      lines.push('The agent gets nothing and pays nothing.');
    }
    return lines.join(' ');
  }

  async analyze(query: ResourceQuery, data: unknown, provenance: DataProvenance): Promise<AnalysisResult> {
    const summary = summariseShape(data);
    const prefix = provenance.simulated
      ? 'Simulated data, not sourced from any chain. '
      : `Indexed data from ${provenance.provider}. `;
    return {
      text: `${prefix}${RESOURCE_LABELS[query.resource]} for ${query.address} over ${query.lookbackDays} day(s): ${summary}`,
      provider: this.name,
      groundingWarnings: [],
    };
  }
}

function summariseShape(data: unknown): string {
  if (typeof data !== 'object' || data === null) return 'no structured content returned.';
  const record = data as Record<string, unknown>;
  const parts: string[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (Array.isArray(value)) parts.push(`${value.length} ${key}`);
    else if (typeof value === 'number') parts.push(`${key} ${value}`);
  }
  return parts.length > 0 ? `${parts.join(', ')}.` : 'a single record.';
}

// --- Anthropic -----------------------------------------------------------

const InterpretationSchema = z.object({
  resource: z.enum(RESOURCE_KINDS),
  address: z.string().describe('The 0x-prefixed EVM address the request is about.'),
  lookbackDays: z.number().int().min(1).max(365),
  rationale: z.string().describe('One sentence on why this resource and window were chosen.'),
});

const INTERPRET_SYSTEM = `You translate a request from an AI agent into one structured onchain data query for a metered gateway.

Supported resources:
${RESOURCE_KINDS.map((kind) => `- ${kind}: ${RESOURCE_LABELS[kind]}`).join('\n')}

Rules:
- Pick exactly one resource, the most specific one the request needs.
- The address must be copied exactly from the request. If the request contains no 0x address, use "0x0000000000000000000000000000000000000000" and say so in the rationale.
- lookbackDays is the time window in days. "recent" or unspecified means 30. Never exceed 365.
- Do not invent parameters the request did not ask for.`;

const ANALYZE_SYSTEM = `You summarise onchain data that a metered gateway has already retrieved for an AI agent.

The JSON you are given is the only source of truth. Every number, address, transaction hash and symbol you mention must appear in it verbatim. If the data is empty or thin, say so. Do not speculate about values that are not present, and do not describe the data as real if it is marked simulated.

Write three to six sentences of plain prose for a treasury analyst. No headings, no bullet points.`;

export interface AnthropicProviderOptions {
  apiKey: string;
  model: string;
}

export class AnthropicAIProvider implements AIProvider {
  readonly name = 'anthropic' as const;
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly fallback = new RuleBasedAIProvider();

  constructor(options: AnthropicProviderOptions) {
    this.client = new Anthropic({ apiKey: options.apiKey });
    this.model = options.model;
  }

  describe(): string {
    return `Anthropic ${this.model}. Proposals are re-validated and analyses are grounding-checked.`;
  }

  async interpret(prompt: string): Promise<InterpretResult> {
    try {
      const response = await this.client.messages.parse({
        model: this.model,
        max_tokens: 1024,
        system: INTERPRET_SYSTEM,
        messages: [{ role: 'user', content: prompt }],
        output_config: { format: zodOutputFormat(InterpretationSchema) },
      });

      if (response.stop_reason === 'refusal' || !response.parsed_output) {
        return this.fallback.interpret(prompt);
      }

      const { rationale, ...proposal } = response.parsed_output;
      return { proposal, rationale, provider: this.name };
    } catch (error) {
      logModelError('interpret', error);
      return this.fallback.interpret(prompt);
    }
  }

  async explain(decision: PolicyDecision, query: ResourceQuery | null, agent: Agent | null): Promise<string> {
    const facts = await this.fallback.explain(decision, query, agent);
    try {
      const response = await this.client.beta.messages.create({
        model: this.model,
        max_tokens: 1024,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system:
          'Rewrite the following policy decision as two or three plain sentences for the human who owns this agent. Keep every number and every reason. Add nothing.',
        messages: [{ role: 'user', content: facts }],
      });
      if (response.stop_reason === 'refusal') return facts;
      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('')
        .trim();
      return text.length > 0 ? text : facts;
    } catch (error) {
      logModelError('explain', error);
      return facts;
    }
  }

  async analyze(query: ResourceQuery, data: unknown, provenance: DataProvenance): Promise<AnalysisResult> {
    const serialised = JSON.stringify(data, null, 1);
    // The whole point of a metered query is that the result is small. If it is
    // not, refuse to summarise rather than silently truncating the evidence.
    if (serialised.length > 120_000) {
      const fallback = await this.fallback.analyze(query, data, provenance);
      return { ...fallback, text: `${fallback.text} (Too large to summarise with the model.)` };
    }

    const framing = [
      `Resource: ${query.resource} (${RESOURCE_LABELS[query.resource]})`,
      `Subject: ${query.address}`,
      `Window: ${query.lookbackDays} day(s)`,
      `Provenance: ${provenance.simulated ? 'SIMULATED, not from any chain' : `live from ${provenance.provider}`}`,
      '',
      'Data:',
      serialised,
    ].join('\n');

    try {
      const response = await this.client.beta.messages.create({
        model: this.model,
        max_tokens: 2048,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: ANALYZE_SYSTEM,
        messages: [{ role: 'user', content: framing }],
      });

      if (response.stop_reason === 'refusal') {
        return this.fallback.analyze(query, data, provenance);
      }

      const raw = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('')
        .trim();

      const grounded = groundAnalysis(raw, data);
      return { text: grounded.text, provider: this.name, groundingWarnings: grounded.warnings };
    } catch (error) {
      logModelError('analyze', error);
      return this.fallback.analyze(query, data, provenance);
    }
  }
}

/**
 * Logs model failures by class so an operator can tell a bad key from a rate
 * limit from an outage. Never logs request content.
 */
function logModelError(stage: string, error: unknown): void {
  if (error instanceof Anthropic.AuthenticationError) {
    console.error(`[faregate] ai ${stage}: authentication failed, check ANTHROPIC_API_KEY`);
  } else if (error instanceof Anthropic.RateLimitError) {
    console.error(`[faregate] ai ${stage}: rate limited, falling back to rule-based`);
  } else if (error instanceof Anthropic.APIConnectionError) {
    console.error(`[faregate] ai ${stage}: could not reach the API, falling back to rule-based`);
  } else if (error instanceof Anthropic.APIError) {
    console.error(`[faregate] ai ${stage}: API error ${error.status ?? ''} ${error.name}`);
  } else {
    console.error(`[faregate] ai ${stage}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
