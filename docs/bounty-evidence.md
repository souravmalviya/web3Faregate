# Bounty evidence

What a judge can run, click or read to verify each claim. Every item below is
reproducible from a clean checkout with `.env.example` copied to `.env`, unless
it says otherwise.

## Common setup

```bash
npm install && cp .env.example .env
npm run build --workspace @faregate/shared
npm test                       # 73 tests
npm run dev:api                # :8402
npm run dev:web                # :3000
```

---

## Hedera: AI & Agentic Payments (x402)

**Claim.** An x402-gated service on Hedera testnet, priced per query in USDC,
consumed by a real agent process that pays for its own data.

**Read.**
- `apps/api/src/payment/x402.ts`, lines defining `createResourceServer`
  (`ExactHederaScheme` from `@x402/hedera/exact/server`,
  `HTTPFacilitatorClient`), `createRoutes` (dynamic per-request price in
  atomic USDC units), and `createHttpResourceServer` (`onProtectedRequest`
  policy hook that aborts before a price is quoted).
- `apps/agent/src/index.ts`, `buildFetch()`: `wrapFetchWithPayment` with an
  `ExactHederaScheme` client signer.
- `package.json` in `apps/api` and `apps/agent`: `@x402/core`, `@x402/express`,
  `@x402/hedera`, `@x402/fetch` at `^2.25.0`.

**Run (simulated payment).**
```bash
npm run agent -- --agent trial.agents.faregate.eth \
  --ask "What is the token balance of 0x742d35Cc6634C0532925a3b844Bc454e4438f44e today?"
```
Expect `payment: simulated receipt`, `charged $0.0102`, and on `/health`
`payment: simulated` with the reason `FAREGATE_PAY_TO is not set`.

**Run (live payment).** Set `FAREGATE_PAY_TO` to a Hedera testnet account
associated with USDC `0.0.429274`, and `HEDERA_ACCOUNT_ID` /
`HEDERA_PRIVATE_KEY` for the agent. The first `GET /data/:id` answers 402 with
requirements; the agent retries with `PAYMENT-SIGNATURE`; the response carries
`PAYMENT-RESPONSE` and the receipt shows the Hedera transaction id on the
dashboard's payment card.

**Tests.** `apps/api/src/app.test.ts`: "spend is recorded at collection, not
at quote", "collecting the same request twice is refused", "revocation
between approval and collection is refused at the gate".

**Extra points.** Pay-per-call metering (`packages/shared/src/pricing.ts`);
on-chain agent identity via ENS (below); append-only payment audit trail
(`GET /events`).

---

## The Graph: Best AI Use Case (Start Fresh)

**Claim.** The Graph is the only data source, the agent asks in natural
language, and the model's summary is grounded against the retrieved data.

**Read.**
- `apps/api/src/data/provider.ts`, `GraphDataProvider.queryOne`: POST to
  `https://gateway.thegraph.com/api/subgraphs/id/<id>` with
  `Authorization: Bearer <GRAPH_API_KEY>`.
- `apps/api/src/ai/provider.ts`, `AnthropicAIProvider.interpret` (structured
  output) and `analyze` + `groundAnalysis`.

**Run (live).** Set `GRAPH_API_KEY` and `GRAPH_SUBGRAPHS=aave-v3=<id>`. Submit
a request from the dashboard; the data card shows provenance `the-graph` and
the raw data panel shows the subgraph response.

**Tests.** `apps/api/src/ai/provider.test.ts` (grounding strips a fabricated
hash and records it), `apps/api/src/data/provider.test.ts` (Bearer header,
never in the URL; fails loudly, never falls back).

**Pool.** Start Fresh. Every line of this repository was written during the
event; commit history begins at the monorepo initialisation.

---

## The Graph: Composable or Standardized Graph Products

**Claim.** One query document, written once against the Messari standardized
schema, runs unchanged across every protocol subgraph configured.

**Read.** `apps/api/src/data/provider.ts`: `DOCUMENTS` (one per resource kind,
Messari entity names), `parseGraphTargets`, and `GraphDataProvider.fetch`
(fan-out keyed by protocol, per-protocol errors surfaced).

**Run.**
```
GRAPH_SUBGRAPHS=aave-v3=<id>,compound-v3=<id>
```
then submit "Show me the lending positions of 0x…". The response data is
`{ schema: "messari-standard", protocols: { "aave-v3": …, "compound-v3": … } }`.

**What became easier.** Adding a protocol is one environment entry; no query
changes. That is the standard's leverage, and it is visible in the response
shape.

**Tests.** `apps/api/src/data/provider.test.ts`: "one document fans out across
every protocol and is keyed by protocol", "a named protocol queries only that
subgraph", "a partial failure is reported per protocol, not hidden".

---

## ENS: Best Use of ENSv2

**Claim.** Agent passports are ENSv2 subnames on Sepolia; capability lives in
text records; resolution is live through `UniversalResolverV2`; revocation is
an onchain act and the gateway fails closed.

**Read.**
- `apps/api/src/identity/ens.ts`: `ENSV2_SEPOLIA_UNIVERSAL_RESOLVER`,
  `TEXT_KEYS`, `EnsPassportResolver.resolve` (no cache, by design).
- `apps/api/src/identity/service.ts`: `EnsIdentityService.resolve`, fail
  closed under the parent name.
- `apps/api/src/app.ts`, `POST /agents/:id/revoke`: refuses ENS passports
  with `409 revoke_onchain`.
- `scripts/ens/passport.ts` and `docs/ens-passports.md`.

**Run.** Set `ENS_RPC_URL` (a public Sepolia RPC works). `/health` reports
`ens: live` and names the resolver. With passports minted under
`agents.faregate.eth` per `docs/ens-passports.md`, the dashboard labels them
`ENS passport`, and `scripts/ens/passport.ts revoke --send` makes the next
agent request fail with `agent_revoked` without any call to the gateway.

**Not hardcoded.** Every value the gateway acts on is read from the chain at
request time. The only constant is the Universal Resolver address from the ENS
deployments page, and it is overridable.

**Status.** Read side implemented and typechecked against viem. Minting on
Sepolia requires a funded wallet, which is the operator's step; the script
dry-runs by default and cites the ENS docs page for each interface it uses.

---

## Bazantic

**Claim.** The gateway is a small x402 API an agent can use from a recipe.

**Read.** `docs/openapi.yaml`.

**Status.** The Bazantic gateway and recipe are created on bazantic.com by the
operator; this repository supplies the API and its description.

---

## Honesty statement

Nothing in this document claims a bounty has been won. Each section states
what is implemented, what is tested, what runs simulated by default, and what
the operator must supply to run it live. `docs/SPONSOR_MATRIX.md` carries the
per-bounty status in the same terms.
