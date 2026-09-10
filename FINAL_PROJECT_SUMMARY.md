# Faregate: final project summary

ETHGlobal Online 2026 · Category: Artificial Intelligence · 🛂

---

## 1. Elevator pitch

Faregate is a permission and payment gateway between AI agents and paid
onchain data. An agent gets a capability instead of an API key: what it may
buy, how much per query, how much per day, and the line above which a human
must say yes. It pays per query over x402 on Hedera, gets its data from The
Graph, and can be revoked onchain by its owner at any moment, at which point
it is turned away at the gate even while holding an approved quote.

## 2. Problem

Autonomous agents need onchain data and the ability to pay for it. Today that
means a human hands the agent an API key and a card on file and hopes it stays
inside its remit, does not run up a bill, and stops when asked. Unrestricted
permissions are the failure. There is no gate.

## 3. Solution

```
Agent → Request → Policy → Human approval → Payment → Data → Analysis
                     ↑
             Revocation wins over everything
```

- **Identity** is an ENSv2 subname on Sepolia; the capability lives in the
  name's text records and is read live on every request.
- **Policy** is a pure, deterministic engine on integer micro-USD. The model
  proposes and narrates; it never decides.
- **Payment** is x402 on Hedera testnet in USDC, per query, sub-cent, no
  account and no subscription.
- **Data** is The Graph, through documents written once against the Messari
  standardized schema and fanned out across protocols.
- **Analysis** is a model summary that is grounding-checked against the data
  it was given; a fabricated hash never reaches the human.
- **Revocation** is an onchain act by the owner. The gateway holds no key and
  cannot undo it.
- **Every human action is wallet-signed** and verified server-side, so the
  audit trail says who approved, who revoked and who changed what.

## 4. Architecture

Three processes and one pure library. See `docs/ARCHITECTURE.md` for the full
walk and `README.md` for the Mermaid diagram.

| Piece | Role |
|---|---|
| `packages/shared` | Domain model, pricing, policy engine, signed-action messages. No I/O. 32 tests. |
| `apps/api` | The gateway. Identity → interpreter → policy → x402 gate → data → analysis → audit. |
| `apps/web` | The human's dashboard. Same HTTP API as the agent; no privileged path. |
| `apps/agent` | A real x402 client in its own process. Narrates each step for the demo. |
| `scripts/ens` | Mint and revoke passports with the owner's wallet. Dry-runs by default. |

The paid route re-evaluates policy three times: before quoting a price (the
`onProtectedRequest` hook), when pricing, and at release. Spend is recorded at
collection, not at quote.

## 5. Technology stack

- TypeScript throughout, run directly on Node 24 with type stripping; tsc for
  typecheck and emit.
- Express 4 for the gateway; Next.js 15 with Tailwind 4 for the dashboard.
- `@x402/core`, `@x402/express`, `@x402/hedera`, `@x402/fetch` v2.25 for
  payment. Network `hedera:testnet`, asset USDC `0.0.429274`.
- viem for ENS resolution and wallet reads. ENSv2 `UniversalResolverV2` on
  Sepolia.
- The Graph gateway over HTTPS with Bearer auth.
- OpenRouter chat completions over fetch, with strict JSON-schema structured
  outputs for interpretation. Default model `openai/gpt-4.1-mini`, configurable.
- Zod for input validation. Node's built-in test runner. No database, no
  custom contracts, on purpose.

## 6. Sponsor integrations

| Sponsor | Integration | Status |
|---|---|---|
| Hedera | x402-gated data route, per-query USDC pricing, agent that pays, audit trail | Implemented and tested; live settlement needs a funded testnet account |
| The Graph (AI) | Sole data source; NL interpretation; grounded analysis | Implemented; live query needs a Studio key |
| The Graph (Composability) | One Messari-standard document fanned out across protocols | Implemented and tested |
| ENS | ENSv2 passports, live resolution, onchain revocation, fail closed | Read side implemented; minting needs a funded Sepolia wallet |
| Bazantic | OpenAPI description of the gateway for an agent recipe | Description written; recipe is operator work |

Details, file references and honest confidence: `docs/SPONSOR_MATRIX.md` and
`docs/bounty-evidence.md`.

## 7. Security model

Threat: an autonomous, possibly compromised agent that can send anything to
the gateway. Defences, each traceable to a file:

- Deterministic server-side policy (`packages/shared/src/policy.ts`).
- Wallet-signed human actions, verified server-side (`apps/api/src/human-auth.ts`).
- Per-passport and per-caller rate limits (`apps/api/src/rate-limit.ts`).
- Integer micro-USD; no float drift on limits (`pricing.ts`).
- Prices from the stored request, never the caller (`payment/x402.ts`).
- Policy re-evaluated at quote, payment and release; revocation refused at the
  gate (`payment/x402.ts`, `routes/data.ts`).
- Spend recorded at collection (`routes/data.ts`); unpaid quotes cost nothing.
- Single-use nonces, no double collection, idempotent submission (`store.ts`).
- Untrusted structured input validated and clamped (`query-parser.ts`).
- Model proposals re-validated; model summaries grounding-checked
  (`ai/provider.ts`).
- Identity fails closed when ENS is unreachable (`identity/service.ts`).
- No custody, no keys, no transactions from the gateway.

Limits are stated in `SECURITY.md`: single-machine snapshot persistence, and
signatures prove who acted rather than who was entitled to.

## 8. Demo flow

Scripted at 3:30 in `docs/DEMO_SCRIPT.md`; runbook in `DEMO.md`.

0. Human creates `ResearchBot` from the dashboard, signing with their wallet.
1. Agent asks for 30 days of wallet activity. Gateway interprets, prices at
   $0.036, stops for a human.
2. Human reads the decision and the plain-language explanation, approves.
3. Agent pays 36,000 atomic USDC units, collects data with provenance and a
   grounded summary.
4. Agent asks again, human approves again, then revokes the agent.
5. Agent presents its approved quote. Refused at the gate. Dashboard row and
   audit trail both show it.

## 9. Limitations

- State is a local snapshot file; one gateway, one machine.
- Signatures prove who acted, not that they were entitled to.
- Live x402 settlement and ENS minting are verified against the packages and
  docs, and in simulated mode end to end; running them live is the operator's
  step with funded testnet accounts.
- Graph documents target the Messari lending schema only.
- ENSv2 is beta and its interfaces may change.

## 10. Future roadmap

Signed approvals; HCS anchoring of settled payments; persistence and
multi-tenant passports; liveness-gated spend tiers; streamed settlement for
subscriptions; a Privy organisation-wallet mode for teams.

## 11. Bounty mapping

| Bounty | Requirement met by |
|---|---|
| Hedera AI & Agentic Payments | `GET /data/:id` is x402-gated on `hedera:testnet`; `apps/agent` completes the paid request; README documents setup, architecture, payment flow |
| The Graph, Best AI Use Case (Start Fresh) | Graph is load-bearing; NL interface; reasoning over data; open source; net-new during the event |
| The Graph, Composable/Standardized | Messari-standard documents, multi-protocol fan-out, leverage shown in the response shape |
| ENS, Best Use of ENSv2 | Passports on ENSv2 Sepolia, central to the product, nothing hardcoded, revocation onchain |
| Bazantic recipes | `docs/openapi.yaml` describes the x402 API |

## 12. Judge FAQ

**Why blockchain?** Three reasons, each load-bearing. Sub-cent per-query
payment with no account needs a machine-speed rail (x402 on Hedera). A
revocation the gateway itself cannot undo needs the record to live outside
the gateway (ENS). And the product sells indexed onchain data (The Graph).

**Why not a normal API gateway with API keys?** A key is all-or-nothing and
lives with the agent. A capability is scoped, metered, human-gated above a
threshold, and revocable by the owner without touching the agent.

**Why does an agent need this?** So a human can let it work without giving it
the wallet.

**Why the human approval layer?** Because the interesting spend is the
unusual spend. Cheap, in-scope queries clear alone; anything above the
owner's line waits.

**How do you stop an agent exceeding its limit?** Integer micro-USD checks in
a pure engine, at quote, at payment and at release, against a ledger updated
only on collection.

**How do you know a human approved, and which one?** The approval carries an
EIP-191 signature over a message naming the action and the request id. The
gateway recovers the signer, checks it matches, and consumes the signature.
The audit trail records `signed: true` and the address.

**How do you verify payment?** The x402 facilitator verifies the signed
Hedera transfer before the handler runs and settles it after; the receipt
records the transaction id. In simulated mode the receipt says `simulated`.

**Payment succeeds but retrieval fails?** The request is marked failed, the
agent is told its payment stands, and it is never handed simulated data in
place of the real answer.

**What happens when the agent is revoked?** Its next submission is refused;
an approved quote it already holds is refused at the gate; the audit trail
records both.

**Replay?** Nonces are single-use, a fulfilled request cannot be collected
twice, and submissions are idempotent on a caller key.

**What if the AI hallucinates?** Its query proposal is re-validated by a
rule-based parser, so it cannot widen scope. Its summary is checked against
the data; any hash or address not present is replaced with a marker and
logged.

**What is actually from the chain?** With live providers: the passport and
its records (ENS), the payment (Hedera), the data (The Graph). Every response
carries provenance saying which.

**What is decentralised, what is centralised?** Identity, payment settlement
and data indexing are on decentralised infrastructure. The policy engine and
the spend ledger run in the gateway, which the owner operates. The gateway
holds no keys and no funds.

**Trust assumptions?** The facilitator verifies and settles honestly; the
Graph gateway returns what the subgraph indexed; the owner's wallet is the
owner's.

**What would change for production?** Signed approvals, persisted state,
rate limiting, HCS anchoring, and a hosted facilitator with an SLA.

**If a sponsor service is down?** Identity fails closed for ENS passports.
Data fails loudly. Payment cannot be verified, so no data is released.

## 13. Three-minute pitch

See `docs/DEMO_SCRIPT.md`. The spine: the problem in one breath, the
capability on screen, the agent asking and being stopped, the human deciding,
the payment in atomic USDC, the grounded analysis, and the revocation that
turns away an agent holding a valid quote.

## 14. Thirty-second pitch

AI agents need onchain data and a way to pay for it, and today we hand them
keys and hope. Faregate gives an agent a capability instead: what it may buy,
how much, and when a human has to say yes. It pays per query over x402 on
Hedera, gets its data from The Graph, and its identity is an ENS name its
owner can revoke onchain. Revoke it, and it is turned away at the gate even
holding an approved quote.

## 15. Technical deep dive

Read in this order:

1. `packages/shared/src/policy.ts`, then its tests. This is the authority.
1. `apps/api/src/human-auth.ts` and `packages/shared/src/actions.ts`. Who acted.
2. `apps/api/src/payment/x402.ts`. The three `reevaluate` calls and why the
   hook runs before the price.
3. `apps/api/src/routes/data.ts`. Spend before serve; fail loudly; analysis
   never blocks delivery.
4. `apps/api/src/identity/service.ts`. The fail-closed table.
5. `apps/api/src/ai/provider.ts`. `groundAnalysis`.
6. `apps/api/src/data/provider.ts`. One document, many protocols.
7. `apps/api/src/app.test.ts`. The lifecycle, end to end, on a real port.
