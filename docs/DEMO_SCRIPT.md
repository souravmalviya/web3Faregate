# Demo script

Target length: 3 minutes 30 seconds. One take, 720p or better, your voice, no
music. This clears ETHGlobal's finalist rule (2 to 4 minutes), The Graph's
(2 to 4) and Hedera's (5 or under) at once.

Screen layout: dashboard on the left two-thirds, a terminal on the right third.
Both visible the whole time. Do not alt-tab.

Before recording: gateway and dashboard running, terminal in the repo root,
browser wallet connected on Sepolia, `npm run reset` done and the gateway
restarted so the queue is empty and only the two seeded passports exist.

Say every line out loud; the pauses are where the audience reads.

---

## 0:00 – 0:20  The problem

> AI agents are becoming autonomous. To do anything useful onchain they need
> data and a way to pay for it, and today that means handing them an API key
> and a card. Then you hope: that they stay in their remit, don't run up a
> bill, and stop when you want them to stop.

## 0:20 – 0:40  What Faregate is

Point at the top bar.

> Faregate is the control and payment layer between a human and their agents.
> Four subsystems, each telling you whether it is live or simulated. Nothing
> simulated is ever shown as a chain fact.

## 0:40 – 1:10  Create the agent

Click **New agent**. Leave the defaults: `ResearchBot`, $0.10 per query,
approval above $0.02, $1.00 per day, three wallet resources.

> I'm creating an agent. Not a key: a capability. What it may buy, how much
> per query, how much per day, and the line above which I have to say yes.

Click **Create and sign**. The wallet pops up.

> My wallet signs the creation. The gateway verifies the signature, so the
> passport records me as its owner. No transaction, nothing spent.

Sign. The card appears with its passport name.

## 1:10 – 1:50  The agent asks

Terminal:

```
npm run agent -- --agent researchbot.agents.faregate.eth
```

> This is a separate process speaking x402. It asks for thirty days of
> activity on a wallet.

The terminal prints the interpreted query, the price and `awaiting_approval`.

> The gateway had the model read the ask and propose a structured query, then
> re-validated it, priced it at three point six cents, and ran a deterministic
> policy. Three point six is above my two-cent line, so it stopped for me. The
> model suggested; it did not decide.

## 1:50 – 2:20  The human decides, and pays nothing

Dashboard: the request is at the top. Click **Explain in plain language**,
read one sentence. Click **Approve**. Sign in the wallet.

> Approved, and signed. Now the agent pays, not me.

Terminal: `Approved by a human`, then the payment.

> The gateway answered 402. The agent signed a USDC transfer on Hedera
> testnet for exactly thirty-six thousand atomic units, which is three point
> six cents, and the facilitator settled it. Six decimals map one to one onto
> the gateway's pricing unit. No exchange rate anywhere.

Dashboard: open the row. Point at the payment card and the HashScan link.

## 2:20 – 2:50  Real data, grounded analysis

Point at the data card.

> Live data from The Graph: one query, written once against the Messari
> standard schema, fanned out across Aave, Compound and Spark. The summary
> underneath was written by a model that was given this data and nothing
> else, and then checked: any hash or address it mentions that is not in the
> data is removed and logged.

Scroll to the timeline under the request.

> Every step is an event. This is what happened to this request.

## 2:50 – 3:20  Revoke

Dashboard: **Revoke** on ResearchBot, **Confirm revoke**, sign.

> I've changed my mind. One signed action.

The card turns red: *Access revoked*.

## 3:20 – 3:40  The same agent tries again

Terminal:

```
npm run agent -- --agent researchbot.agents.faregate.eth
```

It prints:

```
✗ The gateway refused this request. The agent gets nothing and pays nothing.
  reason  agent_revoked
```

Dashboard: the new row reads **Access denied · agent revoked**.

> Same agent, same request. Refused by the deterministic policy before any
> price was quoted. The agent got nothing and paid nothing. And if it had
> been holding an approved quote from before, the gate would have refused
> that too.

## Close

> Agents act on their own. Humans keep control of what they access and what
> they spend. Identity is ENS, payment is x402 on Hedera, data is The Graph,
> and the decision is never the model's. Faregate.

Stop recording.

---

## Recovery notes

- **Wallet does not pop up.** The dashboard needs an injected wallet on
  Sepolia. Reconnect from the top bar; if it still fails, set
  `FAREGATE_REQUIRE_SIGNED_ACTIONS=false` in `.env`, restart the gateway, and
  say "unsigned for the demo"; the audit trail will show it.
- **Approval poll times out.** Re-run the agent with `--wait 120`.
- **Payment simulated.** The agent has no `HEDERA_ACCOUNT_ID`, or the gateway
  has no `FAREGATE_PAY_TO`. The receipt says `simulated`; say so out loud
  rather than hiding it.
- **Wrong approval threshold.** A 30-day activity query costs $0.036. The
  threshold must be below that (the default is $0.02) or the request clears
  without you.
- **Reset between takes.** `npm run reset`, then restart the gateway. State
  is a snapshot file; restarting alone keeps everything, including the
  revocation.
