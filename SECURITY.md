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
own budget, or anyone else's, by requesting prices it never pays.

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

**Fail closed on identity.** When ENS is configured, a passport under the
parent name that cannot be resolved because the chain is unreachable is treated
as unknown and denied. A stale local copy is never consulted for it.

**Honest provenance.** Every subsystem reports `live` or `simulated`, and that
mode travels with receipts and data to the API and the dashboard. A live data
provider that fails, fails; it never falls back to simulated data.

## What it does not do

- **No custody.** The gateway holds no user funds and never sends a
  transaction. The agent pays with its own wallet; the human signs nothing.
- **No keys in the gateway.** The only private key anywhere in the system is
  the demo agent's throwaway testnet key, read from `.env` by the agent
  process. The gateway never sees it.
- **No persistence.** State is in memory. A restart forgets requests, spend
  and revocations of local passports. ENS passports are unaffected because the
  chain is the record.
- **No authentication on the human endpoints.** Approvals carry a wallet
  address but no signature. In a production build the dashboard would sign
  approvals and the gateway would verify them.
- **Rate limiting** is not implemented.

## Secrets

`.env` is gitignored. `.env.example` documents every variable. RPC URLs that
embed an API key are redacted before they appear in logs or `/health`. The
Graph API key travels as a Bearer header, never in a URL.

## Reporting

This is a hackathon repository. Open an issue.
