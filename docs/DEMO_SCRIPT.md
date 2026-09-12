# Demo video script

Runs **3:35**, hard stop at **3:55**. ETHGlobal and The Graph allow 2 to 4
minutes, Hedera 5 or under. One take, recorded at 1080p, your own voice, no
music.

Every scene is written as three kinds of line:

- **DO**: what you click or type. Words in quotes are the exact label on screen.
- **SEE**: what should appear. If it does not, check
  [If something goes wrong](#if-something-goes-wrong).
- **SAY**: what you say out loud. **[pause 2 s]** means stop talking and let
  the screen speak.

Screen layout for the whole video: Chrome on the left two-thirds of the
screen, the terminal on the right third. Both stay visible; never switch
windows.

## Before you record

About ten minutes, all off camera.

1. **Recorder.** OBS Studio (free) or the Windows Snipping Tool's video mode.
   Whole screen, 1920 x 1080, 30 fps, microphone on. Turn on Do not disturb so
   no notification pops up.
2. **Layout.** Snap Chrome to the left two-thirds and Windows Terminal to the
   right third. Chrome zoom 100%. If the "Pay · Data · AI · ENS" readout at the
   top right of the dashboard is missing, the window is too narrow: zoom Chrome
   out (Ctrl and minus) until it shows.
3. **Stop old servers.** Press Ctrl+C in any terminal running Faregate. If
   Claude started them from the app, ask Claude to stop them.
4. **Passports active.** In a terminal in the `faregate` folder run
   `npm run ens:restore` and wait for `Done.` It sends nothing when both
   passports are already active.
5. **Empty request list.** Run `npm run reset`. You see
   `gateway state cleared`.
6. **Gateway**, terminal 1, off camera: `npm run dev:api`. Wait for
   `payment live`, `data live`, `ai live`, `ens live` and
   `2 passport(s) read from ENS at startup`.
7. **Dashboard**, terminal 2, off camera: `npm run dev:web`. Wait for `Ready`,
   then open http://localhost:3000 in Chrome.
8. **Wallet.** Unlock MetaMask. Tip: switch to a new, empty MetaMask account
   for the video, so your main wallet address is not recorded. Signing needs
   no funds.
9. **Connect.** Click "Connect wallet" at the top right of the dashboard and
   approve in MetaMask. If "Switch to Sepolia" appears, click it and approve.
   The top right now shows your short address and `MetaMask · Sepolia`.
10. **HashScan banner.** Open https://hashscan.io in a new tab, click "REJECT"
    on the cookie banner, and close the tab. Otherwise the banner covers the
    payment on camera.
11. **Camera terminal.** Open Windows Terminal in the `faregate` folder, make
    the text bigger (Ctrl and plus, about size 16), type `cls` and press Enter.
12. **Start state.** The dashboard shows the green "Live" readout, "No
    requests yet", and both passports "ACTIVE" on the right.

Balances on 13 September 2026: the agent holds 19.95 test USDC (a take spends
0.036) and the ENS owner holds 0.047 Sepolia ETH (`ens:restore` needs at least
0.005). Enough for many takes.

Optional: rehearse once without recording, then repeat steps 3 to 12.

## Running order

| Scene | Starts | What the viewer sees |
|---|---|---|
| 1 | 0:00 | The problem |
| 2 | 0:20 | Four live systems |
| 3 | 0:35 | The agent's ENS passport |
| 4 | 0:55 | The agent asks and is stopped for approval |
| 5 | 1:25 | You approve with a wallet signature |
| 6 | 1:45 | The agent pays on Hedera and gets live Graph data |
| 7 | 2:35 | You revoke the passport onchain |
| 8 | 3:05 | The same agent is refused |
| 9 | 3:25 | Close |

---

## Scene 1. The problem (0:00 to 0:20)

**DO** Start recording on the "Requests" page. Rest the mouse on an empty part
of the page and click nothing.

**SEE** The title "Requests" and four figures: "NEEDS YOU 0", "SPENT TODAY
$0.00", "SETTLED FARES 0", "REFUSED 0". Under "All requests": "No requests
yet".

**SAY**
> AI agents can now work on their own. To be useful, they need data, and they
> need to pay for it. Today that means handing an agent an API key and a card,
> and hoping it stays within limits and stops when you ask. Faregate is the fix.

**[pause 1 s]**

## Scene 2. Four live systems (0:20 to 0:35)

**DO** Move the mouse slowly along the readout at the top right: "Pay",
"Data", "AI", "ENS", then the green word "Live". Rest it there.

**SEE** Four green squares and "Live".

**SAY**
> Faregate is a gate between an agent and paid onchain data. Payment runs on
> Hedera with x402. Data comes from The Graph. Identity is ENS. And an AI reads
> what the agent asks for. All four are live right now.

## Scene 3. The agent's passport (0:35 to 0:55)

**DO** Click "Passports" in the top menu.

**SEE** The title "Passports", "PARENT NAME agents.faregate.eth" on the right,
and two rows. The first is "Treasury Research Agent" with the stamps "ACTIVE"
and "ENS".

**DO** Move the mouse down the first row's limits: "Per query $0.10",
"Approval above $0.02", "Daily limit $1.00".

**SAY**
> Every agent carries a passport. This one is an ENS name on Sepolia: research
> dot agents dot faregate dot eth. Its limits are text records on that name:
> ten cents a query, one dollar a day, and anything above two cents needs my
> approval. The gateway reads them from the chain on every request.

**[pause 1 s]**

## Scene 4. The agent asks (0:55 to 1:25)

**DO** Click "Requests" in the top menu. Click inside the terminal, type
`npm run agent` and press Enter. Start speaking as you press it.

**SAY**
> This is the agent, a separate program. It asks in plain English for a month
> of activity on a wallet.

**SEE** In the terminal, within about 5 seconds:

```
2. Submit the request
   interpreted   wallet.activity over 30 day(s)
   price         $0.036
   status        awaiting_approval

3. Wait for a human to approve
   ! Approve it in the dashboard. ...
```

**[pause 3 s]**

**SEE** In the browser: an amber "1" beside "Requests" in the menu, and a new
section "Needs your signature" holding a ticket: "Treasury Research Agent",
"Wants 30 days of wallet activity for 0x742d…f44e.", and on its right "FARE
$0.0360".

**DO** Point the mouse at the sentence under the dashed line: "Costs $0.0360,
above this passport's $0.02 approval line."

**SAY**
> The AI turned that into a structured query. The gateway priced it at three
> point six cents and checked the passport. That is above my two cent line, so
> it stopped and asked me. The AI suggests. The rules decide.

## Scene 5. You approve (1:25 to 1:45)

**DO** Click the green "Approve" button on the ticket.

**SEE** The button changes to "Signing" and MetaMask opens a signature
request. The message starts `Faregate action` and `action: approve-request`,
and ends `It sends no transaction and spends nothing.`

**SAY**
> I approve, and my wallet signs it, so there is proof it was me. It is a
> signature, not a transaction. Nothing is spent.

**[pause 1 s]** so viewers can read the message.

**DO** In MetaMask, click "Confirm". Older MetaMask versions call it "Sign".

**SEE** MetaMask closes. A note at the bottom right of the dashboard says
"Approved and signed. The agent may now pay $0.0360 and collect the data." The
ticket and the amber "1" disappear.

## Scene 6. Paid and delivered (1:45 to 2:35)

**DO** Look at the terminal while the agent works.

**SAY**
> Now the agent pays, not me. It pays the fare in USDC on Hedera testnet over
> x402, and the data is released only after the payment is verified.

**SEE** In the terminal, within 10 to 20 seconds. Raw data scrolls past
afterwards; ignore it.

```
   ✓ Approved by a human.

4. Collect the data, paying the fare if one is charged
   ✓ Data released.
   provenance    live indexed chain data
   charged       $0.036
   hashscan      https://hashscan.io/testnet/transaction/...
```

**DO** In the browser, under "All requests", watch the top row until its stamp
says "DELIVERED" and the text beside it says "Fare settled". Click the row.

**SEE** The row opens. Across the top, five filled stops, "Asked", "Passport",
"You", "Fare", "Data", and the sentence "The fare settled on Hedera and the
data was delivered." Below, three columns: "DECISION", "FARE", "DATA".

**DO** In the "FARE" column, point at "$0.0360 USDC" and the green "SETTLED"
stamp. Then click the blue link beside "Transaction". It starts `0.0.716278…`
and has a small arrow.

**SEE** HashScan opens in a new tab: the transaction marked "SUCCESS", "TYPE
CRYPTO TRANSFER", and under "Token Transfers" `0.0.10455772 -0.036000 USDC`
and `0.0.10457565 0.036000 USDC`.

**DO** Point at the two token transfer lines.

**SAY**
> Here is that payment on HashScan. Three point six cents in USDC, from the
> agent's account to the gateway.

**[pause 2 s]**

**DO** Press Ctrl+W to close HashScan; you are back on the open request. Point
at the "DATA" column: "The Graph · aave-v3, compound-v3, spark-lend", then the
summary paragraph under it.

**SAY**
> And here is what it bought: live data from The Graph. One query, written once
> on the Messari standard, runs across Aave, Compound and Spark. The AI summary
> uses only this data, and anything it makes up is removed.

## Scene 7. Revoke onchain (2:35 to 3:05)

**DO** Click "Passports" in the top menu. On the "Treasury Research Agent" row,
look at the far right, under "REVOKE ONCHAIN". Hover over the grey box
`npm run ens:revoke -- research.agents.faregate.eth`; a small copy icon appears
at its end. Click the icon.

**SEE** The copy icon turns into a tick.

**DO** Click inside the terminal, press Ctrl+V, then Enter.

**SAY**
> Now I change my mind. I revoke this agent on the ENS name itself. That is a
> Sepolia transaction signed with the owner's key. The gateway holds no key, so
> it cannot undo it.

**SEE** In the terminal:

```
Sending 1 call(s) on Sepolia

  setText(research.agents.faregate.eth, faregate.status, "revoked")  <- the gateway refuses this agent at its next request
  to:   0xc305b40688D41bf05635Ab6cbc1ec0cb7FF18862
  data: 0x...
  tx:   https://sepolia.etherscan.io/tx/0x...
```

then, after 10 to 30 seconds, `confirmed in block ...`.

**SAY** while you wait:
> Nothing is cached. The next time this agent knocks, the gateway reads its
> passport straight from the chain.

**DO** When `confirmed` appears, wait 5 more seconds before the next scene.

**SEE** The Passports page still says "ACTIVE". That is correct: the gateway
reads the chain only when an agent asks.

## Scene 8. The same agent is refused (3:05 to 3:25)

**DO** In the terminal, type `npm run agent` and press Enter.

**SEE** In the terminal:

```
   status        rejected
   reason        agent_revoked: This agent passport has been revoked by its owner.
   ✗ The gateway refused this request. The agent gets nothing and pays nothing.
```

In the browser, within 2 seconds, the "Treasury Research Agent" row gets a red
edge, the stamps "REVOKED" and "ENS", and the line "Access revoked. Every
request from this agent is refused at the gate."

**SAY**
> Same agent, same question. The gateway read the chain, saw the revocation,
> and refused. The agent got nothing, and it paid nothing.

**DO** Click "Requests" in the top menu.

**SEE** The top row's route stops at a red square, stamped "REFUSED" with
"Agent revoked". The row below it still says "DELIVERED".

**[pause 2 s]**

## Scene 9. Close (3:25 to 3:35)

**DO** Stay on the Requests page. Keep the mouse still.

**SAY**
> Agents act on their own. Humans stay in control of what they buy and what
> they spend. This is Faregate.

**[pause 2 s]**, then stop recording.

---

## After recording

1. Put the passport back: `npm run ens:restore`, and wait for `Done.`
2. For another take: press Ctrl+C in the gateway terminal, run
   `npm run reset`, start `npm run dev:api` again, and refresh Chrome.

## If something goes wrong

| What you see | What to do |
|---|---|
| The agent prints `No decision within 120s.` | You took longer than two minutes to approve. Start another take and run the agent as `npm run agent -- --wait 300`. |
| MetaMask does not open after "Approve" | Click the fox icon in Chrome's toolbar. The request is waiting there. |
| "Approve" is greyed out, with "Connect a wallet on Sepolia to sign." | Use "Connect wallet" or "Switch to Sepolia" at the top right. |
| After the revoke, the agent is not refused and shows `awaiting_approval` | The chain node was a few seconds behind. Do not approve it. Wait 10 seconds, run `npm run agent` again, and cut the first try when editing. Nothing is paid without approval. |
| A row says "FAILED" | The Graph or the payment facilitator had a hiccup. Nothing was charged. Start another take. |
| Part of the readout is amber and says simulated | The gateway is missing a setting in `.env`. Stop and fix it before recording. |
| HashScan says the transaction was not found | The explorer can be a few seconds behind. Refresh the tab once. |
| The dashboard says it can't reach the gateway | The gateway terminal stopped. Start `npm run dev:api` again. |
