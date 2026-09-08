# Demo script

Target length: 3 minutes 30 seconds. One take, 720p or better, your voice, no
music. This clears ETHGlobal's finalist rule (2 to 4 minutes), The Graph's
(2 to 4), and Hedera's (5 or under) at once.

Screen layout: dashboard on the left two-thirds, a terminal on the right third.
Both are visible the whole time. Do not alt-tab.

Before recording: gateway and dashboard running, terminal in the repo root,
browser wallet connected on Sepolia, both demo passports active, request queue
empty. Say every line out loud; the pauses are where the audience reads.

---

## 0:00 – 0:20  The problem

> Every AI agent that wants onchain data today gets an API key and a card on
> file. Then you hope. You hope it stays inside its remit, you hope it does not
> run up a bill, and you hope it stops when you want it to stop.
>
> Faregate replaces the key with a capability, meters what the agent uses,
> asks a human before anything expensive, and can shut the agent out with one
> action. This is the whole thing in three minutes.

## 0:20 – 0:45  What you are looking at

Point at the top bar.

> This is the human side. Four subsystems, and each one tells you whether it
> is live or simulated. Nothing simulated is ever shown as a chain fact.

Point at the two passports.

> Two agents. Each is an ENS name. Each has a capability set by its owner:
> what it may buy, how much per query, how much per day, and the line above
> which a human has to say yes. The research agent has a real budget. The
> trial agent can buy one cheap thing.

## 0:45 – 1:20  The agent asks

Terminal:

```
npm run agent
```

> This is a separate process. It speaks x402. It is about to ask for thirty
> days of activity on a wallet.

Watch the terminal print the interpreted query, the price, and
`awaiting_approval`.

> The gateway read the ask, turned it into a structured query, priced it at
> three point six cents, checked the capability, and stopped. Three point six
> cents is above this agent's two-cent threshold, so it needs me.

## 1:20 – 1:50  The human decides

Dashboard: the request is at the top with **Awaiting approval**. Click the row
if it is not already open.

> Here is the decision, and here is why. Every reason is a code from a
> deterministic engine. The model can explain it in plain language, but it
> did not make it.

Click **Explain in plain language**. Read one sentence of it. Click
**Approve**.

> Approved. The agent may now pay and collect.

Terminal: the agent notices, pays, and prints the result with
`Data released`, the provenance line, and the amount charged.

> Paid. Thirty-six thousand atomic units of USDC on Hedera testnet, which is
> exactly three point six cents, because six decimals map one to one onto the
> gateway's pricing unit. No exchange rate anywhere.

## 1:50 – 2:25  The data and the analysis

Dashboard: open the fulfilled row. Show the payment card and the data card.

> Provenance says where the data came from. The summary underneath was written
> by a model that was given the data and nothing else, and then checked: any
> transaction hash or address it mentions that is not in the data gets replaced
> with a marker and logged. It cannot invent a chain fact and have it reach
> you.

Scroll to the audit trail briefly.

> Every step is an append-only event.

## 2:25 – 3:10  The revocation

> Now the part that matters. The agent submits again, I approve again, and it
> is holding a valid, human-approved quote.

Terminal:

```
npm run agent -- --wait 60
```

Dashboard: approve the new request. Terminal shows `Approved by a human`, then
`Collect the data`. Before it finishes, or immediately after, do this:

Dashboard: click **Revoke** on the research agent, then **Confirm revoke**.

> Revoked. Now hand the agent its own approved quote and let it try.

Terminal (use the request id printed a moment ago):

```
npm run agent -- --agent research.agents.faregate.eth --request <id>
```

Let it print:

```
✗ Refused at the gate: This agent passport has been revoked by its owner.
  The agent offered to pay and was still turned away.
```

> The quote was valid. The approval was real. The agent was ready to pay. It
> was turned away anyway, because policy is re-checked before a price is ever
> quoted, and revocation wins over everything. On the dashboard the row now
> says so, and the audit trail has it: approved by a human, revoked by a human,
> refused by the gate.

## 3:10 – 3:30  Close

> Agents can request capabilities. Humans keep control over what they access
> and what they spend. The identity is ENS, the payment is x402 on Hedera, the
> data is The Graph, and the decision is never the model's.
>
> Faregate.

Stop recording.

---

## Recovery notes

- If the agent's approval poll times out, re-run with `--wait 120`.
- If you revoke before approving, the second submission is refused at
  submission with `agent_revoked`. That is also a fine ending; say "refused
  before it could even ask".
- If the gateway restarted, the request queue is empty and both passports are
  active again. That is by design, and it is a two-minute reset.
