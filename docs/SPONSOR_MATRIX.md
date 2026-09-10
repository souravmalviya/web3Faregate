# Sponsor matrix

Every sponsor integration in Faregate, in the statuses ETHGlobal judges can
verify. Nothing is marked further along than the evidence supports.

Statuses: `NOT PURSUED`, `TARGET`, `IMPLEMENTED`, `TESTED`, `DEMONSTRATED`,
`SUBMISSION READY`.

A bounty is never marked "won". The most this document says is that Faregate
is designed to satisfy the published requirements, and it points at the code
and the evidence so a judge can check.

## Summary

| Sponsor | Bounty | Requirement | Faregate feature | Actual implementation | Tested | Demo evidence | Status |
|---|---:|---|---|---|---|---|---|
| Hedera | $6,000 | Live x402-gated service on Hedera settled via Blocky402; an agent completes a real paid request; README; video of 5 min or less | `GET /data/:id` is x402-gated, priced per query in USDC; `apps/agent` pays | `@x402/core`, `@x402/express`, `@x402/hedera` v2.25; gateway account `0.0.10457565`; facilitator `api.testnet.blocky402.com` checked at startup | Gate, policy re-check, spend ledger, replay: `apps/api/src/app.test.ts` | Live `402` with `PAYMENT-REQUIRED` verified 2026-09-10; settlement pending faucet USDC for the agent account | IMPLEMENTED, TESTED |
| The Graph | $5,000 | Graph as load-bearing data; live Studio data; meaningful reasoning or NL interface; open source; video 2 to 4 min; Start Fresh pool | Sole data source; NL interpretation; grounded analysis | `apps/api/src/data/provider.ts`, `apps/api/src/ai/provider.ts`; Bearer-auth gateway queries | Grounding and provider tests | Live run 2026-09-10: NL ask, OpenRouter interpretation, Graph data from Aave, Compound and Spark, grounded summary | DEMONSTRATED |
| The Graph | $5,000 | Standardized subgraphs: one query across many protocols; show what the standard made easier | Messari-standard documents, multi-protocol fan-out | `GRAPH_SUBGRAPHS` targets; `GraphDataProvider.fetch` fan-out keyed by protocol | 10 fan-out tests including schema conformance to Messari lending 3.1.0 | All five documents live against three protocols with no schema errors, 2026-09-10 | DEMONSTRATED |
| ENS | $4,500 | Built on ENSv2 Sepolia; central; functional, nothing hardcoded; video or live demo | Passports as ENSv2 subnames; capability in text records; live resolution; onchain revocation; fail closed | `apps/api/src/identity/*`, `scripts/ens/passport.ts` | Resolver typechecked against viem; identity service behaviour covered through the app tests | Needs a funded Sepolia wallet to mint passports | IMPLEMENTED |
| Bazantic | $2,000 | Create a gateway and recipe on bazantic.com for the project's API | The gateway is a small documented x402 API | `docs/openapi.yaml` | n/a | Operator work on bazantic.com | TARGET |
| World, Privy, Arc, Ledger, 1inch, Uniswap, Chainlink | | | | | | | NOT PURSUED |

---

## Hedera

**Bounty:** AI & Agentic Payments on Hedera ($6,000, up to 3 teams at $2,000)

**Official requirement.** Host a live x402-gated service on Hedera testnet or
mainnet, settled through the Blocky402 facilitator. Build a platform or agent
that consumes that service and completes at least one real paid request end to
end. Public repo with README covering setup, architecture and the payment
flow. Demo video of five minutes or less showing the paid request executing.

**Required technology.** x402 on Hedera. The published `@x402/core`,
`@x402/express`, `@x402/hedera` and `@x402/fetch` packages (v2.25) implement
the protocol; `hedera:testnet` is the CAIP-2 network id; USDC is HTS token
`0.0.429274` on testnet.

**Faregate feature.** The paid data route `GET /data/:requestId` is the x402
gated service. Its price is per query, computed by the gateway and quoted in
USDC atomic units. The demo agent (`apps/agent`) is the consumer: it receives
the 402, signs a Hedera transfer, and retries with the payment header.

**Where in the code.**
- `apps/api/src/payment/x402.ts` builds the resource server with
  `ExactHederaScheme`, registers `onProtectedRequest` (policy re-check before
  a price is quoted), and quotes a dynamic per-request price.
- `apps/api/src/routes/data.ts` releases data only after verification and
  records spend before serving.
- `apps/agent/src/index.ts` wraps fetch with `wrapFetchWithPayment` and an
  `ExactHederaScheme` client signer.
- `apps/api/src/config.ts` defaults the fare asset to testnet USDC because its
  six decimals map 1:1 to the gateway's micro-USD unit, so no exchange rate is
  invented.

**Extra points claimed.**
- Pay-per-call metering rather than a flat charge: price is
  `base(resource) + lookbackDays * surcharge`, deterministic and auditable.
- On-chain agent identity: agent passports are ENS names (see ENS below).
- Payment audit trail: every payment stage is an append-only audit event.

**Implementation status.** `IMPLEMENTED` against the real packages. `TESTED`
in simulated mode (the gate, the policy re-check and the spend ledger are
covered by `apps/api/src/app.test.ts`). Live settlement against the facilitator
requires a Hedera testnet account with a USDC association, which the operator
supplies in `.env` as `FAREGATE_PAY_TO`; the demo agent needs
`HEDERA_ACCOUNT_ID` and `HEDERA_PRIVATE_KEY`.

Verified 2026-09-10 against Blocky402 testnet: with a gateway account set,
`GET /data/:id` answers `402` with a `PAYMENT-REQUIRED` header offering
`exact` on `hedera:testnet`, USDC `0.0.429274`, the per-query amount in atomic
units, `payTo` the gateway account, and Blocky402's fee payer `0.0.7162784`.
A settled payment from the demo agent is the remaining step.

**Facilitator.** Blocky402 runs Hedera testnet at
`https://api.testnet.blocky402.com` and mainnet at `https://api.blocky402.com`,
and each host's `/supported` lists only its own network. Faregate defaults to
the Blocky402 host for the configured network and checks `/supported` before
the gateway listens, refusing to start if the facilitator cannot settle
`exact` on that network. The x402.org facilitator also supports
`hedera:testnet`, and Hedera's reference PoC uses it for testnet, but this
bounty requires Blocky402.

**Demo evidence.** Demo agent output showing the paid request, the receipt
with transaction id, and the dashboard's payment card.

**Submission requirement.** README architecture and payment flow, video under
five minutes, state the bounty explicitly.

**Official documentation.** https://hedera.com/blog/hedera-and-the-x402-payment-standard/ ,
https://github.com/hedera-dev/x402-inference-pay-per-request-poc ,
https://blocky402.com/

**Confidence.** High on protocol correctness (real packages, verified against
their type definitions). Medium on live settlement until run with a funded
testnet account.

---

## The Graph

### Best AI Use Case with The Graph (Start Fresh) ($5,000, 3 places)

**Official requirement.** Use The Graph as a load-bearing source of blockchain
data. Consume live data from a Graph provider (Subgraph Studio API key). Do
meaningful work with the data: reasoning, decisions, automation or a natural
language interface, not just printing a raw result. Open source with a README.
Public repo and a two to four minute video. Select the Start Fresh pool.

**Faregate feature.** The Graph is the only data source the gateway sells. An
agent's natural-language ask is interpreted into a structured query, priced,
authorised, paid for, fetched from a subgraph, and then analysed by a model
whose output is grounding-checked against the data.

**Where in the code.**
- `apps/api/src/data/provider.ts`, `GraphDataProvider`: POSTs GraphQL to the
  Graph gateway with a Bearer API key (kept out of the URL), fails loudly on
  schema mismatch, never falls back to simulated data.
- `apps/api/src/ai/provider.ts`: interpretation with a validated structured
  output, and analysis with a grounding check that strips any hash or address
  not present in the retrieved data.

**Implementation status.** `IMPLEMENTED`. Live query requires `GRAPH_API_KEY`
and a subgraph id or URL. The GraphQL documents target the Messari standard
schema; the operator pins a subgraph that publishes it (`.env.example` ships Messari's registry ids for Aave v3, Compound v3 and Spark on Ethereum).

**Demo evidence.** A fulfilled request in the dashboard with provenance
`the-graph`, the raw data panel, and the grounded analysis.

**Verified live 2026-09-10.** Through the gateway, an agent's plain-English
request was interpreted by OpenRouter (`openai/gpt-4.1-mini`) into
`wallet.activity` over 30 days, held for human approval at $0.036, released
with data from The Graph (`provenance: the-graph`, not simulated) across Aave
v3, Compound v3 and Spark, and summarised by the model with the grounding
check applied. A second request, which the model mapped to
`protocol.positions`, was refused by the deterministic policy because that
resource is outside the agent's scope: the model cannot widen what an agent
may buy.

**Confidence.** High.

### Best Use of Composable or Standardized Graph Products ($5,000, 3 places)

**Official requirement.** Build on standardized subgraphs (one shared schema
across every protocol of a type) to run a single query across many protocols,
or compose two or more Graph products. Consume live data. Make the standards
leverage clear: show what became easier because a shared schema was used.

**Faregate feature.** Every query document in `GraphDataProvider` is written
once against the Messari standardized lending schema. The same
`protocol.positions` and `protocol.markets` documents run unchanged against any
protocol that publishes the standard, which is what lets an agent ask about
"lending positions" without the gateway knowing which protocol it is.

**Implementation status.** `IMPLEMENTED` and `TESTED`. `GraphDataProvider`
takes any number of `protocol=subgraph` targets (`GRAPH_SUBGRAPHS`), runs the
same standardized document against all of them, and returns the answer keyed
by protocol with per-protocol errors reported rather than hidden. An agent
that names a protocol gets that one only. Ten tests in
`apps/api/src/data/provider.test.ts` cover fan-out, single-protocol routing,
partial failure, total failure, and Bearer-header auth.

**What the standard made easier.** Zero per-protocol code. Adding a protocol
is one entry in an environment variable, and every existing query works
against it on the next request.

**Verified live 2026-09-10.** All five query documents returned data from the
Aave v3, Compound v3 and Spark subgraphs listed in `.env.example`, with no
schema errors, and a markets query fanned out to all three in about 0.7
seconds.

**Confidence.** High.

**Official documentation.** https://thegraph.com/docs/en/subgraphs/existing-subgraphs/standard-subgraphs/ ,
https://thegraph.com/docs/en/subgraphs/querying/managing-api-keys/

---

## ENS

**Bounty:** Best Use of ENSv2 ($4,500, four places)

**Official requirement.** Built on ENSv2 on Sepolia. ENSv2 features central to
the product, not cosmetic. Functional demo with no hardcoded values. Video or
live demo, open source.

**Faregate feature.** An agent's passport is an ENS subname. Its capability
lives in the name's text records (`faregate.status`, `faregate.scope`,
`faregate.daily_limit_usd`, and so on). The gateway resolves the passport live
through the ENSv2 Universal Resolver on every request and fails closed if the
chain is unreachable. Revocation is an onchain act: the owner sets
`faregate.status` to `revoked` or unregisters the subname, and the agent is
refused at its next request.

**Where in the code.**
- `apps/api/src/identity/ens.ts`: resolver against ENSv2 Sepolia
  (`UniversalResolverV2` at `0x4a1817d13e9cf196f471725176355c1234b63c70`, from
  the ENS deployments page).
- `apps/api/src/identity/service.ts`: ENS-first identity with fail-closed
  behaviour for names under the passport parent.
- `POST /agents/:id/revoke` refuses to revoke an ENS passport locally and
  tells the human to do it onchain.

**Implementation status.** `IMPLEMENTED` on the read side. Registering
`faregate.eth` on Sepolia, deploying a `UserRegistry` for `agents.faregate.eth`
and minting the demo passports requires a funded Sepolia wallet, which the
operator supplies. Until then passports resolve from the local store and the
dashboard says so.

**Confidence.** Medium. ENSv2 contracts are beta and the docs say they may
change.

**Official documentation.** https://docs.ens.domains/ensv2/permissioned-registry ,
https://docs.ens.domains/ensv2/tutorial-contract-developers ,
https://docs.ens.domains/learn/deployments

---

## Bazantic

**Bounties:** Best Recipe using sponsor APIs ($1,000); Agentify a new API
($1,000)

**Official requirement.** Create an account, create an x402/MPP gateway for
the project's API in Bazantic, create a recipe that uses two services in one
flow, record it, and provide the Bazantic username.

**Faregate feature.** The gateway API is already an x402 service with a small,
documented surface (`POST /requests`, `GET /data/:id`). That is exactly what a
Bazantic gateway wraps.

**Implementation status.** `TARGET`. This is dashboard work on bazantic.com
done by the operator, plus an OpenAPI description of the gateway which is
planned.

**Confidence.** Medium.

---

## World

**Bounty:** Selfie Check ($3,500)

**Faregate feature (planned).** A liveness-verified owner unlocks a higher
spend tier for their agents.

**Implementation status.** `NOT PURSUED` in this build window. Listed for
honesty because it appeared in early planning.

---

## Privy, Arc, Ledger, 1inch, Uniswap, Chainlink

`NOT PURSUED`. Each would be a legitimate fit for Faregate (Privy for
organisation wallets and quorum approvals, Ledger for device-confirmed
approvals, Chainlink CRE for confidential policy evaluation), and each was
judged to cost more of the two-day window than it would return.
