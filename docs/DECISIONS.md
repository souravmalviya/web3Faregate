# Decisions

Why Faregate is built the way it is. Each entry states the choice, the
alternatives that were considered, and what would make us revisit it.

## 1. The policy engine is a pure function, and the model never decides

**Choice.** `packages/shared/src/policy.ts` decides every access and spend
question from the passport, the capability, the structured query, the spend
ledger and the clock. It performs no I/O and calls no model.

**Alternatives.** Let the language model evaluate policy from a prompt. Faster
to build, and it reads well in a demo, but a decision that can be argued with
in natural language is not a security control. Prompt injection alone rules it
out for anything that moves money.

**Revisit if.** Never for the decision itself. The model's role can grow
(better interpretation, richer explanations) without touching this.

## 2. Money is integer micro-USD

**Choice.** Every price and limit is an integer number of micro-USD.
`1_000_000` is $1.00. Floats appear only at the display edge.

**Alternatives.** JavaScript numbers in USD. Simpler to read, and wrong in the
exact place it matters: `0.1 + 0.2 > 0.3` would let an agent cross a limit by
a rounding error.

**Why USDC.** USDC on Hedera has six decimals, so a micro-USD price is the
atomic USDC amount with no conversion and no invented exchange rate. Charging
in HBAR would need a price oracle.

## 3. Payment settles through x402 on Hedera with the published packages

**Choice.** `@x402/core`, `@x402/express` and `@x402/hedera` on the gateway,
`@x402/fetch` in the agent. The gateway answers `402`, the agent signs a
Hedera transfer, the Blocky402 facilitator verifies and settles.

**Alternatives.** Hand-rolled payment headers, or a custom escrow contract.
Both would have been more code to audit and would not have counted as x402.

**Facilitator.** Blocky402 serves Hedera testnet from
`api.testnet.blocky402.com` and mainnet from `api.blocky402.com`; each host's
`/supported` lists only its own network. The gateway picks the host for the
configured network and refuses to start if `/supported` does not list `exact`
on that network, rather than reporting payments as live and failing later.

## 4. Policy is re-evaluated before a price is quoted, and again at release

**Choice.** `onProtectedRequest` re-runs the policy before the x402 middleware
quotes a price; the data route re-runs it before releasing data. The decision
stored at submission is never trusted at payment time.

**Why.** The world changes between quote and payment: a passport is revoked, a
policy is tightened, a budget is consumed. The demo's key moment, an agent
refused while holding an approved quote, depends on this.

## 5. Spend is recorded at collection, not at quote

**Choice.** The ledger moves only when data is released after a verified
payment.

**Alternatives.** Reserve budget at quote time. That lets an agent exhaust its
own budget, or another agent's shared budget, by asking for prices it never
pays.

## 6. Agent identity is an ENS name, resolved live, failing closed

**Choice.** A passport is an ENSv2 subname on Sepolia; its capability lives in
the name's text records; the gateway resolves it on every request with no
cache. When ENS is configured and the chain is unreachable, a passport under
the parent name is treated as unknown and denied.

**Alternatives.** Cache resolutions for speed. A cache would let a passport
revoked onchain keep working until the cache expired, which is the exact
failure the onchain passport exists to prevent. Latency is a few hundred
milliseconds per request, which the product can afford.

**Local passports.** Without `ENS_RPC_URL`, passports live in the gateway
store under the same names, so a local passport can later be replaced by an
onchain one without renaming anything.

## 7. Human actions are wallet-signed, verified server-side

**Choice.** Approve, reject, revoke, set-policy and create-agent carry an
EIP-191 signature over a short readable message built in `packages/shared`
(so the dashboard and the gateway can never drift). The gateway recovers the
signer, checks it matches `by`, enforces a ten-minute validity window, binds
payload-carrying actions to a content digest, and consumes each signature
once.

**Alternatives.** Trust the `by` address in the body (what the first version
did) or a session cookie. Neither proves who acted, and "who approved this
spend" is the audit question a judge will ask.

**Escape hatch.** `FAREGATE_REQUIRE_SIGNED_ACTIONS=false` accepts unsigned
actions for local API experiments; the audit trail records them as unsigned.

## 8. State is in memory with a JSON snapshot, not a database

**Choice.** `GatewayStore` keeps everything in memory and writes an atomic
snapshot after every change. A restart reloads it; a revoked passport stays
revoked across restarts; `npm run reset` clears it.

**Alternatives.** Postgres or SQLite. Either adds setup friction to a demo
and changes nothing about the architecture, since the store is one class.

**Revisit if.** More than one gateway instance, or state that must outlive
the machine.

## 9. No custom smart contracts

**Choice.** Faregate deploys nothing. Capabilities live in ENSv2's registry
and resolver; payments settle through x402; the gateway holds no funds and
never sends a transaction.

**Alternatives.** An escrow or capability contract. It would add custody,
attack surface and an audit burden, and nothing the demo needs.

## 10. The AI layer runs through OpenRouter

**Choice.** Plain chat completions over fetch, with strict JSON-schema
structured outputs for interpretation and `provider.require_parameters` so
only providers that honour the schema are routed to. Default model
`openai/gpt-4.1-mini`.

**Why.** The operator has credits there, and the abstraction is a single
class; swapping providers is a one-file change. Every failure falls back to
the rule-based provider, so the product works with no model at all.

## 11. Analysis is grounding-checked

**Choice.** Any `0x` hex token in a model summary that appears neither in the
retrieved data nor among the gateway-supplied values (the subject address) is
replaced with a visible marker and recorded in the audit trail.

**Why.** A model that invents a transaction hash in a treasury summary is
worse than one that says nothing. Visible removal keeps the reader informed
and the log honest.

## 12. The dashboard polls every two seconds

**Choice.** No websocket. A two-second poll makes an approval or a revocation
visible before a presenter finishes the sentence, and there is nothing to
reconnect on stage.

## 13. Every subsystem has a simulated mode, and says so

**Choice.** Payment, data, AI and identity each report `live` or
`simulated`. The mode travels with receipts and provenance to the API and the
dashboard. A live provider that fails, fails; it never falls back to
simulated output.

**Why.** The alternative, silently substituting fake data when a real
integration breaks, is the one thing a judge must never be able to catch.
