# ETHGlobal submission text

Paste-ready text for the ETHGlobal project page. Update the line marked
`[check]` and the links before submitting, so nothing is claimed that did not
happen.

---

## Project name

Faregate

## Emoji

🛂

## Tagline (one line)

Agents buy onchain data by the query. Humans decide what they are allowed to buy.

## Category

Artificial Intelligence

## Short description

Faregate is a permission and payment gateway for AI agents that need paid
onchain data. Instead of an API key and a card on file, an agent gets a
capability: what it may buy, how much per query, how much per day, and the
line above which a human has to say yes. It pays per query over x402 on Hedera
in USDC, gets its data from The Graph, and its identity is an ENS name its
owner can revoke onchain. Revoke it, and the agent is turned away at the gate
even while holding an approved quote.

## Full description

**The problem.** Autonomous agents need onchain data and a way to pay for it.
Today that means handing them an API key and a payment method and hoping they
stay in their remit, do not run up a bill, and stop when asked. There is no
gate between the agent and the spend.

**What Faregate does.** Every request from an agent goes through the same
path:

1. **Identity.** The agent is an ENSv2 subname on Sepolia
   (`research.agents.faregate.eth`). Its limits live in the name's text
   records and are read live on every request through the ENSv2 Universal
   Resolver. Nothing is cached, so an onchain revocation takes effect on the
   very next request. If the chain cannot be reached, the gateway fails
   closed.
2. **Interpretation.** A model reads the agent's plain-English ask and
   proposes a structured query. A rule-based parser re-validates it, so the
   model cannot widen scope.
3. **Policy.** A pure, deterministic engine on integer micro-USD checks scope,
   per-query cost, daily budget and the human-approval line. The model never
   decides.
4. **Human approval.** Above the owner's line, the request waits. The owner
   approves or rejects from the dashboard, and every human action is signed
   by their wallet and verified by the gateway, so the audit trail names who
   did what.
5. **Payment.** The data route is x402-gated on Hedera testnet. The gateway
   answers 402 with the exact price in atomic USDC units, the agent signs the
   transfer, and the facilitator verifies and settles it before any data is
   released. `[check]` A real settlement is recorded on HashScan; if the demo
   ran in simulated payment mode, say so here.
6. **Data.** One query document, written once against the Messari
   standardized lending schema, fans out across Aave v3, Compound v3 and Spark
   on The Graph. Adding a protocol is one environment entry.
7. **Analysis.** The model summarises the data it was given and nothing else.
   Any hash or address in the summary that is not in the data is stripped and
   logged.
8. **Revocation.** The owner sets `faregate.status` to `revoked` on the ENS
   name, a Sepolia transaction signed with the owner's key. The gateway holds no key and cannot undo it.
   The agent's next request, even one carrying an approved quote, is refused
   before a price is quoted.

**What is real.** The dashboard's top bar shows, for each subsystem, whether
it is live or simulated. Nothing simulated is ever shown as a chain fact.

## How it's made

A TypeScript monorepo on Node 24, run directly with type stripping. Four
parts:

- `packages/shared`: the domain model, pricing and the policy engine. Pure
  functions on integer micro-USD, no I/O, tested on their own.
- `apps/api`: the Express gateway. Identity → interpreter → policy → x402 gate
  → data → analysis → audit log. Policy is re-evaluated before quoting a
  price, at payment and at release. Spend is recorded only when data is
  collected.
- `apps/web`: the human's Next.js dashboard. It uses the same HTTP API as the
  agent, with no privileged path. Wallet signing through MetaMask over
  EIP-6963.
- `apps/agent`: a real x402 client in its own process, narrating each step.

**Hedera x402.** `@x402/core`, `@x402/express`, `@x402/hedera` and
`@x402/fetch` v2.25 with the `ExactHederaScheme`, settled through the
Blocky402 facilitator on `hedera:testnet` in USDC `0.0.429274`. Six decimals
map one to one onto the gateway's micro-USD pricing, so there is no exchange
rate anywhere.

**The Graph.** The gateway queries the Messari standardized subgraphs for
Aave v3, Compound v3 and Spark over the Graph gateway with a Studio key. One
document per resource kind, fanned out per protocol, with partial failures
reported per protocol rather than hidden. A conformance test checks the
documents against the Messari lending schema 3.1.0.

**ENSv2.** Passports are subnames under `agents.faregate.eth` on Sepolia,
minted through the ENSv2 beta contracts (VerifiableFactory, UserRegistry,
PermissionedResolver, ETHRegistrar) by a setup script that dry-runs by
default and simulates every call before sending it. The gateway reads text
records through `UniversalResolverV2` with viem.

**AI.** OpenRouter chat completions with strict JSON-schema structured
outputs for interpretation, and a grounding check on every summary. A
rule-based fallback runs when no key is configured.

**Hard parts.** Keeping the model out of the decision path while still using
it for interpretation; making revocation win over an already-approved quote
without a database; wallet discovery when several extensions fight over
`window.ethereum`; and doing all of the ENSv2 setup at zero cost, by paying
the Sepolia registrar in its free MockUSDC.

## Links

- GitHub: https://github.com/souravmalviya/web3Faregate
- Demo video: `[add the link]`
- ENS passport records on Sepolia: https://sepolia.etherscan.io/tx/0x1bb5f46d0fbeec04e896318a365b58719e224a45d837df2153abc4fd610e055a
- ENS resolver on Sepolia: https://sepolia.etherscan.io/address/0xc305b40688D41bf05635Ab6cbc1ec0cb7FF18862
- Hedera payment: `[add the HashScan link for the settled transaction]`

## Sponsor tracks to select

- Hedera: AI & Agentic Payments (x402)
- The Graph: Best AI Use Case (Start Fresh pool)
- The Graph: Composable or Standardized Graph Products
- ENS: Best Use of ENSv2
