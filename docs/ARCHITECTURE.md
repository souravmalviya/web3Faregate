# Architecture

Faregate is three processes and one pure library.

```
apps/agent  ──HTTP + x402──▶  apps/api (gateway)  ◀──HTTP──  apps/web (dashboard)
                                    │
                        packages/shared (policy, pricing, types)
```

The gateway is the only thing with authority. The agent and the dashboard are
both clients of the same HTTP API, with no privileged path between them and
the policy engine. That is deliberate: if the dashboard could do something the
API cannot, the API would not be the security boundary.

## The gateway

`apps/api/src/app.ts` builds an Express app from injected dependencies, so the
tests boot the real thing on an ephemeral port with a fixed clock.

```
app.ts
├── config.ts          env → AppConfig; each subsystem is live or simulated with a reason
├── store.ts           agents, policies, requests, spend ledger, nonces, audit log; JSON snapshot on disk
├── human-auth.ts      verifies wallet signatures on human actions (signer, validity window, digest, single use)
├── rate-limit.ts      sliding-window limiter: per agent for requests, per caller for human actions
├── query-parser.ts    rule-based prompt → ResourceQuery; validator for untrusted structured queries
├── identity/
│   ├── ens.ts         ENSv2 Sepolia passport resolver (reads only)
│   └── service.ts     ENS-first identity, fail closed under the parent name
├── ai/provider.ts     interpret / explain / analyze; OpenRouter or rule-based; grounding check; hourly call budget
├── data/provider.ts   The Graph (Messari-standard documents, multi-protocol fan-out) or simulated
├── payment/x402.ts    x402 resource server, dynamic per-request price, pre-payment policy hook
└── routes/data.ts     the only route that returns data
```

### Human actions

```
POST /agents                 create a passport with its capability
PUT  /agents/:id/policy      replace a local passport's capability
POST /agents/:id/revoke      the kill switch
POST /requests/:id/approval  approve or reject a waiting request
```

Each carries `by`, `issuedAt` and `signature`. The message the wallet signed
is rebuilt from `packages/shared/src/actions.ts` (the same function the
dashboard used), the signer is recovered with viem's `verifyMessage`, and the
action proceeds only if the signer is `by`, the message is under ten minutes
old, the payload digest matches for policy and agent creation, and the
signature has not been used before. `FAREGATE_REQUIRE_SIGNED_ACTIONS=false`
accepts unsigned envelopes and records them as such.

### Request lifecycle

```
POST /requests
  identity.resolve(agentId)            live ENS read, or local store
  aiProvider.interpret(prompt)         model proposes a structured query
  parseStructuredQuery(proposal)       validator has the final word
  evaluatePolicy(...)                  pure; integer micro-USD
  → rejected | awaiting_approval | payment_required

POST /requests/:id/approval            human, by wallet address
  → payment_required | rejected

GET /data/:id
  [live]  x402 middleware
            onProtectedRequest  → reevaluate()   ← revoked? denied here, no price quoted
            price()             → reevaluate()   ← price from the stored request
            verify with facilitator
  handler
            reevaluate()                        ← defence in depth
            store.recordSpend()                 ← before serving
            dataProvider.fetch()                ← fails loudly, never falls back
            aiProvider.analyze() + grounding    ← never blocks delivery
            → fulfilled, with receipt + provenance + analysis
  [live]  middleware settles, writes PAYMENT-RESPONSE; 'finish' completes the receipt
```

`reevaluate` runs three times on the paid path. Each run resolves identity
live and re-applies the policy against the current spend ledger. The decision
stored at submission is never trusted at payment time, because the world can
change in between: a passport revoked, a policy tightened, a budget consumed.

### Why the policy engine is where it is

`packages/shared/src/policy.ts` has no imports beyond types and pricing. It
takes the agent, the policy, the query, the spend so far and the clock, and
returns a decision with structured reason codes. It is the same code in the
gateway and in the tests, and it can be read in one sitting. Every security
claim in `SECURITY.md` traces to a line in this file or to the three places
that call it.

### Money

All amounts are integer micro-USD (`1_000_000` = $1.00). USDC on Hedera has
six decimals, so a micro-USD price is the atomic USDC amount with no
conversion. Display formatting is the only place a float appears.

### Modes and honesty

Every subsystem reports `live` or `simulated`. The mode is decided once at
startup from the environment, and it travels:

- `/health` lists modes and the reason each simulated one is simulated.
- Every `PaymentReceipt` carries `verifiedBy: facilitator | rpc | simulated`.
- Every `DataProvenance` carries `simulated: boolean` and the source.
- The dashboard shows the four modes in its header readout and stamps every
  receipt and data view as live or simulated.

A live provider that fails throws a `DataProviderError`. The gateway answers
`502`, which stops the x402 middleware from settling, so nothing is charged;
the reserved fare is released and the request is marked `failed`, to be
collected again later. The agent is never handed simulated data in place of
the real answer.

## Identity

An agent id is an ENS name. `EnsPassportResolver` reads `faregate.*` text
records through the ENSv2 Universal Resolver on Sepolia on every call, with no
cache. `EnsIdentityService` decides what to do with the answer:

| ENS answer | Name under the parent | Name outside the parent |
|---|---|---|
| Passport found | use it (and keep a display copy) | use it |
| No passport | **denied** (a local row cannot resurrect it) | local store |
| RPC failure | **denied** (fail closed) | local store, noted |

The two demo agents are named under the passport parent
(`research.agents.faregate.eth`, `trial.agents.faregate.eth`) and resolve
from the local store while ENS is simulated. Setting `ENS_RPC_URL` makes the
chain authoritative for those names, so mint real passports with the same names
first. Until then the gateway refuses both agents, which is fail-closed working
as designed.

## Payment

The x402 integration uses the published packages, not a reimplementation:

- `x402ResourceServer` with `ExactHederaScheme` (server side) from
  `@x402/hedera/exact/server`.
- `HTTPFacilitatorClient` pointed at Blocky402 or the x402.org facilitator.
- `x402HTTPResourceServer.onProtectedRequest` as the policy hook. It runs
  before a price is quoted; returning `{ abort: true }` yields a 403 and the
  agent is never invited to pay.
- A `DynamicPrice` callback that reads the stored request and returns
  `{ asset, amount }` in atomic units.
- On the client, `wrapFetchWithPayment` around fetch with an
  `ExactHederaScheme` signer built from the agent's testnet key.

## Data

`GraphDataProvider` holds one GraphQL document per resource kind, written
against the Messari standardized lending schema. It takes a list of
`{ protocol, url }` targets. A query that names a protocol goes to that one; a
query that does not is fanned out to all of them and answered as
`{ schema, protocols: { aave-v3: ..., compound-v3: ... }, errors? }`.

## AI

`OpenRouterAIProvider` calls OpenRouter's chat completions endpoint.
Interpretation asks for a strict JSON schema with `provider.require_parameters`,
so only providers that honour the schema are used, and the result is checked
with Zod before the rule-based validator sees it. Explanation and analysis are
plain completions. Any failure, including exhausted credits, a content-filter
decline, invalid JSON or a timeout, falls back to `RuleBasedAIProvider`, which
implements the same interface with no model. Both feed `groundAnalysis`, which
strips any `0x` hex token in the summary that does not appear in the serialised
data and records what it removed.

`BudgetedAIProvider` wraps the live provider with a budget on model calls per
rolling hour (`FAREGATE_AI_CALLS_PER_HOUR`), counted across every caller. Past
the budget the rule-based provider answers and the gateway logs it once, so an
open submission endpoint cannot be used to run up a model bill.

## The dashboard

Next.js, client-rendered, polling the gateway every two seconds. It reads the
injected wallet for an address and chain id and never sends a transaction. Its
design system, a paper-and-ink console with stamps for verdicts and a transit
line for each request's route, is documented in `docs/DESIGN.md`.

## The agent

A standalone Node process. It narrates each step because it is what runs
during the demo. `--request <id>` makes it present a quote it already holds,
which is how the revocation moment is shown.

## Persistence

`GatewayStore` keeps everything in memory and, when `FAREGATE_STATE_FILE` is
set (the default is `data/faregate-state.json`), writes an atomic snapshot
shortly after every change and on shutdown. A restart reloads it, so a
revocation survives a restart. The demo passports are seeded only into an
empty store. `npm run reset` deletes the snapshot.

## Observability

Every request has an id, and `GET /requests/:id/events` returns its own
timeline in order: received, evaluated, approval requested, approved (by whom,
signed or not), payment required, payment verified or rejected (with stage),
data retrieved (with provenance), analysis completed (with grounding
warnings), fulfilled or failed. The dashboard renders this under each open
request as its Timeline.

## What is deliberately absent

- No custom smart contracts. Capabilities live in ENSv2's registry and
  resolver; payments settle through x402. Less custody, less attack surface,
  and nothing to audit that a sponsor did not already ship.
- No database. The store is one class so a database is a one-file change.
- No websocket. Two-second polling is boring on purpose.
