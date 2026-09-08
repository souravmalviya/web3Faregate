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
├── store.ts           in-memory agents, policies, requests, spend ledger, nonces, audit log
├── query-parser.ts    rule-based prompt → ResourceQuery; validator for untrusted structured queries
├── identity/
│   ├── ens.ts         ENSv2 Sepolia passport resolver (reads only)
│   └── service.ts     ENS-first identity, fail closed under the parent name
├── ai/provider.ts     interpret / explain / analyze; Anthropic or rule-based; grounding check
├── data/provider.ts   The Graph (Messari-standard documents, multi-protocol fan-out) or simulated
├── payment/x402.ts    x402 resource server, dynamic per-request price, pre-payment policy hook
└── routes/data.ts     the only route that returns data
```

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
- The dashboard renders mode chips on the top bar and a pill on every receipt
  and data card.

A live provider that fails throws a `DataProviderError`; the request is marked
`failed` and the agent is told its payment stands. It is never handed
simulated data in place of the real answer it paid for.

## Identity

An agent id is an ENS name. `EnsPassportResolver` reads `faregate.*` text
records through the ENSv2 Universal Resolver on Sepolia on every call, with no
cache. `EnsIdentityService` decides what to do with the answer:

| ENS answer | Name under the parent | Name outside the parent |
|---|---|---|
| Passport found | use it (and keep a display copy) | use it |
| No passport | **denied** (a local row cannot resurrect it) | local store |
| RPC failure | **denied** (fail closed) | local store, noted |

The two demo agents live outside the parent namespace by default so the demo
runs without any chain access; with `ENS_RPC_URL` set, real passports under
`agents.faregate.eth` take precedence and the local ones keep working.

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

`AnthropicAIProvider` uses `messages.parse` with a Zod output format for
interpretation and `beta.messages.create` with server-side refusal fallbacks
for explanation and analysis. `RuleBasedAIProvider` implements the same
interface with no model. Both feed `groundAnalysis`, which strips any `0x` hex
token in the summary that does not appear in the serialised data and records
what it removed.

## The dashboard

Next.js, client-rendered, polling the gateway every two seconds. It reads the
injected wallet for an address and chain id and never sends a transaction. It
is styled with the same tokens as the project's plan page and CLI so the three
surfaces read as one product.

## The agent

A standalone Node process. It narrates each step because it is what runs
during the demo. `--request <id>` makes it present a quote it already holds,
which is how the revocation moment is shown.

## What is deliberately absent

- No custom smart contracts. Capabilities live in ENSv2's registry and
  resolver; payments settle through x402. Less custody, less attack surface,
  and nothing to audit that a sponsor did not already ship.
- No database. The store is one class so a database is a one-file change.
- No websocket. Two-second polling is boring on purpose.
