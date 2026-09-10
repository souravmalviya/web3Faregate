# Demo script

Target length: about 3 minutes 30 seconds. One take, 720p or better, your own
voice, no music. That fits ETHGlobal (2 to 4 minutes), The Graph (2 to 4) and
Hedera (5 or under).

Screen layout: the dashboard on the left two-thirds, a terminal on the right
third. Keep both visible the whole time. Do not switch windows.

## Before you record

1. MetaMask is on **Sepolia** and connected to the dashboard. The top right of
   the dashboard shows your address and Sepolia.
2. Put the demo back to a clean state. In the terminal running the gateway,
   press Ctrl+C, then run:

   ```bash
   npm run ens:restore   # both ENS passports back to active, onchain
   npm run reset         # empty request queue and audit trail
   npm run dev:api       # start the gateway again
   ```

3. The top bar shows **PAYMENT LIVE, DATA LIVE, AI LIVE, ENS LIVE**. If the
   agent account has no test USDC, see "No test USDC" at the bottom first.
4. The terminal on the right is open in the `faregate` folder.

Read the quoted lines out loud. Pause where the audience needs to read.

---

## 0:00 to 0:20  The problem

> AI agents can now work on their own. To be useful they need data, and they
> need to pay for it. Today that means giving them an API key and a card, and
> hoping they stay within limits and stop when you ask.

## 0:20 to 0:45  What Faregate is

Point at the top bar.

> Faregate is the gate between an agent and paid onchain data. Payment is x402
> on Hedera, data is The Graph, identity is ENS, and an AI reads questions and
> writes summaries. All four are live, and the dashboard would say so if any
> of them were simulated.

## 0:45 to 1:10  The agent's passport is an ENS name

Point at the Treasury Research Agent card: the **ENS passport** label and the
limits.

> This agent's passport is an ENS name on Sepolia,
> research.agents.faregate.eth. Its limits are text records on that name: ten
> cents per query, one dollar a day, and anything above two cents needs me.
> The gateway reads them from the chain on every request. Nothing is
> hardcoded.

## 1:10 to 1:40  The agent asks

Terminal:

```bash
npm run agent
```

> This is a separate program speaking x402. It asks, in plain English, for a
> month of activity on a wallet.

The terminal shows the price, $0.036, and `awaiting_approval`.

> The AI turned the question into a query. The gateway priced it at 3.6 cents
> and checked the rules. That is above my two-cent line, so it stopped and
> asked me. The AI suggested; the rules decided.

## 1:40 to 2:10  I approve, the agent pays

Dashboard: the request is at the top. Click **Approve**, then **Sign** in
MetaMask.

> I approve, and my wallet signs it, so there is proof it was me. Now the
> agent pays, not me.

Terminal: `Approved by a human`, then the payment. Dashboard: open the request
and point at the payment card and its HashScan link.

> The agent paid 3.6 cents in USDC on Hedera testnet, and here is the
> transaction on HashScan.

## 2:10 to 2:40  Real data, checked summary

Point at the data and the summary, then scroll to the timeline.

> The data comes live from The Graph: one query, written once on the Messari
> standard, run across Aave, Compound and Spark. The AI summary uses only this
> data, and any address or hash it invents is removed. Every step is on the
> timeline.

## 2:40 to 3:10  I revoke the agent onchain

Terminal:

```bash
npm run ens:revoke -- research.agents.faregate.eth
```

Wait for the `confirmed` line.

> I've changed my mind. I set the passport's status to revoked on the ENS name
> itself. That's a Sepolia transaction from the owner's key. The gateway holds
> no key, so it cannot undo this.

## 3:10 to 3:30  The same agent tries again

Terminal:

```bash
npm run agent
```

The terminal says the gateway refused the request with `agent_revoked`. On the
dashboard the new row reads **Access denied · agent revoked**, and the card
turns red.

> Same agent, same question. The gateway read the chain, saw the revocation,
> and refused. The agent got nothing and paid nothing.

## Close

> Agents act on their own. Humans stay in control of what they buy and what
> they spend. Faregate.

Stop recording.

---

## If something goes wrong

- **No test USDC in the agent account.** Before recording, change
  `FAREGATE_PAY_TO=0.0.10457565` to `FAREGATE_PAY_TO=` in `.env` and restart
  the gateway. The top bar shows PAYMENT SIMULATED. Say "payment is simulated
  in this recording" out loud.
- **MetaMask does not pop up.** Click the MetaMask icon; the request may be
  waiting there. Check that the dashboard shows Sepolia at the top right.
- **The agent stops waiting before you approve.** Run
  `npm run agent -- --wait 300` to give yourself five minutes.
- **The revoke is slow.** Sepolia takes 10 to 30 seconds. Wait for
  `confirmed` before running the agent again.
- **Another take.** Repeat step 2 of "Before you record".
