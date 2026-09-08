# Demo runbook

How to run Faregate from a clean checkout to the revocation moment, what you
should see at each step, and what to do when you do not.

## Prerequisites

- Node 20 or newer. Built on Node 24.
- A browser with an injected wallet (MetaMask or similar) on **Sepolia**, for
  approving in the dashboard. Approvals record the wallet's address; no
  transaction is sent and no funds are needed.
- Nothing else. Every external subsystem is optional and simulates itself.

## Network and assets

| Subsystem | Network | Asset |
|---|---|---|
| Payment | Hedera testnet (`hedera:testnet`) | USDC, HTS token `0.0.429274` |
| Identity | Ethereum Sepolia | ENSv2 beta |
| Data | The Graph gateway | Subgraphs on the Messari standard schema |

Never point any of this at mainnet for a demo.

## Environment

```bash
cp .env.example .env
```

Leave it as-is for a fully simulated demo. To go live, fill in one subsystem
at a time and watch `GET /health` flip it from `simulated` to `live`.

| To make live | Set |
|---|---|
| Payment (gateway side) | `FAREGATE_PAY_TO=0.0.xxxxx` (a Hedera testnet account associated with USDC `0.0.429274`), `X402_FACILITATOR_URL` |
| Payment (agent side) | `HEDERA_ACCOUNT_ID`, `HEDERA_PRIVATE_KEY` (throwaway testnet key, ECDSA) |
| Data | `GRAPH_API_KEY`, `GRAPH_SUBGRAPHS=aave-v3=<id>,compound-v3=<id>` |
| AI | `ANTHROPIC_API_KEY` |
| Identity | `ENS_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com` |

## Install and start

```bash
npm install
npm run build --workspace @faregate/shared
npm run dev:api     # terminal 1, gateway on :8402
npm run dev:web     # terminal 2, dashboard on :3000
```

Expected in terminal 1:

```
[faregate] gateway listening on http://localhost:8402
[faregate] network hedera:testnet
[faregate] payment  simulated
[faregate] data     simulated
[faregate] ai       simulated
[faregate] ens      simulated
```

Expected at http://localhost:3000: the Faregate top bar with four mode chips,
a notes panel explaining each simulated subsystem, an empty request queue, and
two passports: **Treasury Research Agent** and **Trial Scout Agent**.

## The flow

### 1. An agent asks

```bash
npm run agent
```

Expected: the agent prints the gateway modes, submits the default ask (30 days
of activity on `0x742d…f44e`), and reports

```
interpreted   wallet.activity over 30 day(s)
price         $0.036
status        awaiting_approval
```

then waits, printing the curl command that would approve it.

### 2. A human approves

Dashboard: the request appears at the top with **Awaiting approval** and the
policy reason. Connect the wallet if not already, then **Approve**.

Expected in the agent terminal within two seconds:

```
✓ Approved by a human.
✓ Data released.
provenance    SIMULATED — not a chain fact       (or: live indexed chain data)
charged       $0.036
payment       simulated receipt                  (or: a Hedera transaction id)
```

### 3. Revoke and retry

Dashboard: **Revoke** on the research agent, then **Confirm revoke**. The pill
turns red.

```bash
npm run agent
```

Expected: refused at submission with `agent_revoked`.

For the sharper version, submit and approve first, then revoke, then hand the
agent its own approved quote:

```bash
npm run agent -- --agent research.agents.faregate.eth --request <id from step 1>
```

Expected:

```
✗ Refused at the gate: This agent passport has been revoked by its owner.
  The agent offered to pay and was still turned away.
```

The dashboard row shows **Refused at the gate** under its status, and the audit
trail reads `request.approved` → `agent.revoked` → `payment.rejected`.

### 4. Reset

Restart the gateway. State is in memory, so both passports are active again
and the queue is empty.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Dashboard says "gateway unreachable" | Gateway not running or on another port | `npm run dev:api`; check `PORT` in `.env` matches `NEXT_PUBLIC_FAREGATE_GATEWAY_URL` |
| Approve button is disabled | No wallet connected, or wrong chain | Connect; switch to Sepolia when prompted |
| Agent prints `Gateway is not reachable` | Same as above | Set `FAREGATE_GATEWAY_URL` if the gateway is not on `:8402` |
| Agent waits forever | Nobody approved | Approve in the dashboard, or run the printed curl |
| `payment: simulated` although `FAREGATE_PAY_TO` is set | `.env` not at the repo root | The gateway loads `.env` from the repository root only |
| `data: simulated` although a key is set | `GRAPH_SUBGRAPHS` missing | Both the key and at least one subgraph are needed |
| Data request returns `502 schema_mismatch` | The pinned subgraph does not publish the Messari standard schema | Point `GRAPH_SUBGRAPHS` at one that does |
| `ens: live` but an agent is `agent_unknown` | The name has no `faregate.status` record, or it is under the parent and the RPC failed (fail closed) | See `docs/ens-passports.md` |
| Port 3000 shows a different app | Another dev server is on the port | Stop it; Faregate's dashboard is `@faregate/web` |
