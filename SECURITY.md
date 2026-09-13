# Security

Faregate is a hackathon prototype of a permission and payment gateway for AI
agents. This document says what it protects, how, and where the edges are.
It is written for someone deciding whether to trust it, so it leads with the
limits.

## Threat model

The thing being protected is a human's money and a human's data budget, against
an agent that is autonomous, possibly buggy, and possibly compromised.

Assumed capabilities of an attacker who controls an agent:

- Send any HTTP request to the gateway, in any order, at any rate.
- Replay, reorder or fabricate request bodies, structured queries and payment
  headers.
- Prompt the model into proposing any structured query.
- Keep a valid, human-approved price quote and try to use it later.

Not in scope:

- Compromise of the gateway host itself.
- Compromise of the human's wallet.
- A malicious facilitator. The facilitator is trusted to verify and settle
  Hedera transactions correctly.
- Denial of service against the gateway.

## What the gateway enforces

**Policy is deterministic and server-side.** `packages/shared/src/policy.ts`
is a pure function of the passport, the capability, the structured query, the
spend ledger and the clock. The language model never produces a decision; it
proposes a query that is re-validated by a rule-based parser, and it narrates
decisions after they are made.

**Money is integer micro-USD.** Every limit comparison is on integers, so a
floating point rounding error cannot let an agent cross a limit.

**Prices are never taken from the caller.** The x402 price for a request is
read from the stored request and recomputed from the query. A caller cannot
name its own price.

**Policy is re-evaluated at every gate.** At submission, before a price is
quoted (`onProtectedRequest`), and again at data release. A passport revoked
between approval and collection is refused at the gate while holding an
approved quote. This is the property the demo exists to show.

**Spend is recorded at collection, not at quote.** An agent cannot exhaust its
own budget, or anyone else's, by requesting prices it never pays. The fare is
reserved when collection starts, so concurrent requests cannot overspend a
limit, and released if the data does not reach the agent. The x402 middleware
does not settle a payment when the gateway answers with an error, so a data
provider outage or a failed settlement charges nothing. One request is
collected by one caller at a time.

**Replay.** Payment nonces are single-use (`GatewayStore.consumeNonce`), and a
fulfilled request cannot be collected twice. Request creation is idempotent on
a caller-supplied key.

**Untrusted structured input.** Any structured query, whether from a raw API
caller or from the model, passes through `parseStructuredQuery`, which drops
unknown fields, validates the address, clamps the lookback window and rejects
unsupported resource kinds.

**Grounded analysis.** Model output that describes retrieved data is checked
against that data. A transaction hash or address that does not appear in the
data is replaced with a visible marker and recorded, never shown as fact.

**Human actions are signed.** Approve, reject, revoke, set-policy and
create-agent carry an EIP-191 signature over a short readable message built in
`packages/shared/src/actions.ts`. `apps/api/src/human-auth.ts` recovers the
signer and accepts the action only if the signer is the claimed wallet, the
message is under ten minutes old, the payload digest matches for actions that
carry one, and the signature has not been used before. The audit trail records
`signed: true` on verified actions.

**Rate limiting.** `apps/api/src/rate-limit.ts` limits request submissions per
passport and per caller, and human actions and explanations per caller,
answering 429 with `Retry-After`. Behind a hosting proxy, set
`FAREGATE_TRUST_PROXY=true` so the caller is the client, not the proxy.

**Memory is bounded.** The request table, the consumed-signature table and
the idempotency table are capped (`apps/api/src/store.ts`). The oldest
finished entries are dropped first, and a request still waiting on a human
or on a payment is never dropped, so a flood of refused submissions can only
shorten the history, not exhaust the host or grow the snapshot without limit.

**Model spend is capped.** The live model sits behind `BudgetedAIProvider`
(`apps/api/src/ai/provider.ts`), a budget on model calls per rolling hour
counted across every caller (`FAREGATE_AI_CALLS_PER_HOUR`, 300 by default,
200 on the hosted gateway). Past it, every interpretation, explanation and
analysis is answered by the rule-based provider and the gateway logs the
switch once. Request submission is open, so this is what puts a ceiling on
the model bill.

**One passport, one spelling.** Agent ids are normalised as ENS names before
they key anything (`apps/api/src/identity/names.ts`), so writing a passport
name in capitals cannot open a second daily budget or a second rate limit.

**The model cannot invent a subject.** A model's proposal must be about an
address the agent's request actually contains. A placeholder zero address, or
an address the request never mentioned, is discarded and the rule-based parser
answers, so a request that names no wallet is refused instead of priced.

**Unknown passports never reach the model.** Identity is resolved before
interpretation. A request from a name with no passport is parsed by the free
rule-based parser and refused, so nobody can spend model credits by inventing
agent names.

**Fail closed on identity.** When ENS is configured, a passport under the
parent name that cannot be resolved because the chain is unreachable is treated
as unknown and denied. A stale local copy is never consulted for it.

**Honest provenance.** Every subsystem reports `live` or `simulated`, and that
mode travels with receipts and data to the API and the dashboard. A live data
provider that fails, fails; it never falls back to simulated data.

## What it does not do

- **No custody.** The gateway holds no user funds and never sends a
  transaction. The agent pays with its own wallet; the human signs messages,
  never transactions.
- **Keys.** The policy engine, the payment gate and every human action work
  without a private key. The system has two keys, both throwaway test keys:
  the agent's Hedera testnet key and the ENS owner's Sepolia key. The ENS key
  never leaves the operator's machine. The agent key lives with the agent: in
  `npm run agent` locally, and on the hosted testnet demo in a demo agent that
  runs beside the gateway (`FAREGATE_DEMO_AGENT`) so a visitor's approval
  completes in one click. That demo agent pays like any agent, through the
  public x402 route from its own account, only for the demo passports and
  within their onchain daily limits, and it refuses to run on any network but
  Hedera testnet.
- **Persistence is a local snapshot file.** Fine for one gateway on one
  machine; not a shared or replicated store.
- **Single tenant, open reads.** The gateway serves one owner. Its read API
  (`GET /requests`, `GET /events`, `GET /agents`) is the owner's dashboard
  view and is not authenticated, so anyone who can reach the gateway can read
  the queue, including data agents have collected. Run it for one owner, or
  put it behind an authenticating proxy. `FAREGATE_CORS_ORIGIN` only decides
  which websites' scripts may read the gateway from a visitor's browser; it
  is not authentication, and the gateway sets no cookies.
- **Signatures prove who acted, not that they were entitled to.** Any wallet
  can create an agent or approve a request; there is no owner check tying an
  agent to the wallet that created it. Adding one is a policy field away.
  With the hosted demo agent on, any visitor's approval makes it pay for that
  request, in test USDC and within the passports' daily limits.
- **Unsigned mode exists.** `FAREGATE_REQUIRE_SIGNED_ACTIONS=false` accepts
  unsigned actions and records them as unsigned. It is for local experiments.
- **Free hosting forgets.** On a free Render instance the snapshot file is
  wiped whenever the service sleeps or redeploys, so the request queue, the
  spend ledger, used signatures and idempotency keys start empty again.
  Daily limits then count from the restart, and a signature captured inside
  its ten-minute window could be replayed after one. Passports are unaffected
  because they live on Sepolia. Acceptable for a testnet demo; not for real
  money, which would need shared persistent state.

## Staying up

- A payment facilitator that is unreachable when the gateway starts pauses
  paid collection (503, nothing charged) instead of stopping the gateway, and
  is checked again every 30 seconds.
- ENS reads fall back through several Sepolia RPCs, so one provider's outage
  does not refuse every agent. If all of them fail, identity still fails
  closed.
- On a free host the gateway visits its own public health check every ten
  minutes, so it is not put to sleep and its queue and ledger survive between
  visitors. A restart by the host still empties them; passports live onchain.
- A failed snapshot write or a stray promise rejection is logged, never fatal.
- Every in-memory table and every list the API returns is bounded.

## Secrets

`.env` is gitignored. `.env.example` documents every variable. RPC URLs that
embed an API key are redacted before they appear in logs or `/health`. The
Graph API key travels as a Bearer header, never in a URL.

## Reporting

This is a hackathon repository. Open an issue.
