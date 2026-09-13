# Deploying Faregate, free

Two hosted services and one thing that stays on your machine.

| Piece | Where | Cost |
|---|---|---|
| Gateway (`apps/api`) | Render, free instance | $0, no card |
| Dashboard (`apps/web`) | Vercel, Hobby plan | $0, no card |
| Demo agent (`apps/agent`) | Your machine | Testnet USDC only |

Everything stays on test networks: Hedera testnet USDC for fares, Sepolia for
ENS. No real money moves anywhere, and neither host is given a key that could
move any.

The gateway gets two spend-limited API keys (The Graph, OpenRouter), the
public id of the Hedera account that receives fares, and, for one-click
approvals, the agent's throwaway Hedera testnet key (step 4). The ENS owner
key and the gateway account's key never leave your machine.

## What free means here

- A free Render instance sleeps after 15 minutes without traffic and takes up
  to a minute to wake, and sleeping empties the request queue and the ledger.
  So the gateway visits its own public `/health` every ten minutes, using the
  `RENDER_EXTERNAL_URL` Render sets, and `/health` shows `keepAwake` with the
  last answer. The **Keep the gateway awake** GitHub workflow pings it too, as
  a backup: GitHub can delay scheduled runs by hours, so it is not the only
  guard. If the gateway does sleep, the dashboard says it is waking and
  connects by itself.
- Render gives 750 free instance hours a month, enough for one service to run
  all month. If other free Render services share your workspace, set
  `FAREGATE_KEEP_AWAKE_URL=off` on the gateway and disable the workflow in the
  **Actions** tab so they keep their hours.
- The disk is wiped on every deploy and every wake. The request queue, spend
  ledger and used signatures start empty; the passports come from Sepolia and
  are unaffected. `SECURITY.md` says what that means.
- ENS is read through two public Sepolia RPCs (`ENS_RPC_URL` in
  `render.yaml`), so one provider's outage does not refuse every agent.
- Vercel Hobby is free for personal projects. The dashboard builds in about
  two minutes.

## Before you start

1. Push `main` to GitHub. Both hosts deploy from the repository.
2. Have these four values from your local `.env` ready to paste:
   `FAREGATE_PAY_TO`, `GRAPH_API_KEY`, `GRAPH_SUBGRAPHS`, `OPENROUTER_API_KEY`.
   Nothing else from `.env` goes to a host.
3. Wise: put a spending limit on the OpenRouter key and the Graph key in
   their own dashboards. The gateway also caps itself at 200 model calls an
   hour (`FAREGATE_AI_CALLS_PER_HOUR` in `render.yaml`) and 12 requests a
   minute per agent.

## 1. Gateway on Render

1. Sign in at https://render.com with GitHub. Keep the free Hobby workspace;
   it asks for no card.
2. **New** → **Blueprint**. Connect the `web3Faregate` repository. Render
   reads `render.yaml` and asks for the five values marked `sync: false`:

   | Variable | Value |
   |---|---|
   | `FAREGATE_CORS_ORIGIN` | A placeholder for now, `https://example.invalid`. Step 3 sets the real one; until then the hosted dashboard cannot reach the gateway. |
   | `FAREGATE_PAY_TO` | `0.0.10457565`, the gateway's Hedera testnet account |
   | `GRAPH_API_KEY` | from `.env` |
   | `GRAPH_SUBGRAPHS` | from `.env`, the whole `aave-v3=...,compound-v3=...,spark-lend=...` line |
   | `OPENROUTER_API_KEY` | from `.env` |

3. **Apply**. The first build takes three to five minutes. The log shows
   `gateway listening`, then `payment live`, `data live`, `ai live`,
   `ens live`, and a moment later `paid collection is open`.
4. Copy the service URL, `https://faregate-gateway-xxxx.onrender.com`, and open
   `<that url>/health`. Every mode says `live` and `notes` is empty.

If Blocky402's testnet host is unreachable when the gateway starts, the
gateway starts anyway: `/health` carries a note, paid collection answers 503
and charges nothing, and the gateway checks again every 30 seconds until the
log says `paid collection is open`.

## 2. Dashboard on Vercel

1. Sign in at https://vercel.com with GitHub. **Add New** → **Project**, import
   `web3Faregate`.
2. **Root Directory**: click **Edit** and choose `apps/web`. The framework
   shows as Next.js. Leave the install and build commands as detected;
   `apps/web/vercel.json` supplies them, installing from the repository root
   so the shared package is found. Keep **Include source files outside of
   the Root Directory** on (it is by default).
3. **Environment Variables**: add `NEXT_PUBLIC_FAREGATE_GATEWAY_URL` with the
   Render URL from step 1, no trailing slash.
4. **Deploy**. About two minutes.
5. Open the project's **Settings** → **Domains** and copy the production
   domain, for example `https://web3-faregate.vercel.app`. Use that one, not
   the long address of a single deployment, which changes on every push.

## 3. Connect the two

Until this step the hosted dashboard says it can't reach the gateway, even
though `/health` opens in a tab: the gateway only answers browser pages on the
origins in `FAREGATE_CORS_ORIGIN`, and it still holds the placeholder.

1. In Render, open the service → **Environment** → edit
   `FAREGATE_CORS_ORIGIN`. Put the production domain, `https://` included,
   and keep localhost if you also run the dashboard locally:
   `https://web3-faregate.vercel.app,http://localhost:3000`. A trailing slash
   is fine. To also allow Vercel's per-deployment addresses, add a pattern in
   which `*` stands for one part of the name:
   `https://web3-faregate-*-your-team.vercel.app`.
2. Save. Render redeploys in about two minutes, and its log now has a line
   `[faregate] cors     browser origins ...` listing what is allowed.
3. Reload the Vercel page. The header readout shows Pay, Data, AI and ENS in
   green with **Live**, and the rail lists the two ENS passports.

## 4. One-click approvals on the live site

With the demo agent on, approving a request on the dashboard is the only step:
an agent running beside the gateway pays the fare from its own testnet account
and collects the data within a few seconds.

1. In Render, open the service → **Environment**, and add two variables with
   the values from your local `.env`: `HEDERA_ACCOUNT_ID` and
   `HEDERA_PRIVATE_KEY`. `render.yaml` already sets `FAREGATE_DEMO_AGENT=true`.
2. Save. After the redeploy, the log shows
   `[faregate] agent    demo agent 0.0.… collects cleared requests for …`, and
   the dashboard's Gateway panel lists an Agent row.
3. Send a request from Start here on the Requests page and approve it. Within a few seconds
   the row turns Delivered, with a HashScan link.

This puts a throwaway testnet key on the host, on purpose. It holds test USDC
only, the demo agent refuses any network but Hedera testnet, and the passports'
onchain daily limits cap what it can spend at $1.05 a day. Set
`FAREGATE_DEMO_AGENT=false` to turn it off. Leave it off while running
`npm run e2e:live` against the hosted gateway, or the demo agent collects the
test's requests before the test's own agent can.

## 5. The agent, from your machine

In `.env`:

```
FAREGATE_GATEWAY_URL=https://faregate-gateway-xxxx.onrender.com
```

Then `npm run agent` works exactly as it does locally: the request appears on
the hosted dashboard, you approve it with MetaMask, the agent pays testnet
USDC and prints the HashScan link. Put it back to `http://localhost:8402` for
local work.

## What a visitor can do on the live dashboard

- Read everything: passports, requests, payments, data and the audit log.
- Connect a wallet, then send a request as either agent from **Start here** on
  the Requests page, or from **Try it** on the front page. Without a connected
  wallet the dashboard sends nothing, so nobody spends the agent's budget
  anonymously. Agents still call the gateway directly with their passports.
- Approve or reject with their own wallet, on any network: the dashboard only
  asks the wallet to sign a message. Signatures prove who acted, not that they
  were entitled to; the gateway is single-tenant and its read API is open, as
  `SECURITY.md` states. Whoever approves, only your agent can pay, and it pays
  testnet USDC.
- See an approved request paid and delivered, when the demo agent is on (step
  4): it pays in test USDC from the agent's own account.
- Not revoke: with ENS live, revocation is an onchain change by the owner
  key, also on your machine.

## Checks before sharing the link

```bash
curl https://faregate-gateway-xxxx.onrender.com/health
```

`modes` all `live`, `notes` empty, `signedActions` true. Then load the
dashboard, open Requests, connect a wallet, send "A month of activity" from
Start here and approve it. With the demo agent on it is paid and delivered
within seconds; without it, run the agent from your machine to collect it.

## If the dashboard can't reach the gateway

Open `https://<service>.onrender.com/health` in a new tab.

- **It takes up to a minute, then answers.** The free instance was asleep.
  The dashboard catches up on its own within two seconds.
- **It answers at once, but the dashboard still can't reach it.** The gateway
  is refusing the dashboard's origin. The red notice names the exact address;
  add it to `FAREGATE_CORS_ORIGIN` in Render (step 3). The Render log's
  `cors` line shows what is allowed now, and warns while the placeholder
  `https://example.invalid` is still set.
- **It never answers.** Check the Render log for a failed start.

## Updating

Push to `main`. Both hosts redeploy on their own. A Render deploy wipes the
snapshot file, which is the same as `npm run reset`.

## Any other host

The gateway is one long-running Node 24 process with a writable working
directory. Build with
`npm ci --include=dev --workspace @faregate/shared --workspace @faregate/api && npm run build --workspace @faregate/shared`,
start with `node apps/api/src/server.ts`, and set the same environment
variables as `render.yaml`. It binds to `PORT` when the host sets one.
