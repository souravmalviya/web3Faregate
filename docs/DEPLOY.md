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

The gateway gets two spend-limited API keys (The Graph, OpenRouter) and the
public id of the Hedera account that receives fares. The agent's Hedera key,
the gateway account's key and the ENS owner key never leave your machine.

## What free means here

- A free Render instance sleeps after 15 minutes without traffic and takes up
  to a minute to wake. The dashboard polls every two seconds, so while a
  dashboard tab is open the gateway stays awake. Open `/health` a minute
  before a demo.
- Its disk is wiped on every deploy and every wake. The request queue, spend
  ledger and used signatures start empty; the passports come from Sepolia and
  are unaffected. `SECURITY.md` says what that means.
- 750 free instance hours a month: one service, running all month.
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
   | `FAREGATE_CORS_ORIGIN` | A placeholder for now, `https://example.invalid`. Step 3 sets the real one. |
   | `FAREGATE_PAY_TO` | `0.0.10457565`, the gateway's Hedera testnet account |
   | `GRAPH_API_KEY` | from `.env` |
   | `GRAPH_SUBGRAPHS` | from `.env`, the whole `aave-v3=...,compound-v3=...,spark-lend=...` line |
   | `OPENROUTER_API_KEY` | from `.env` |

3. **Apply**. The first build takes three to five minutes. The log ends with
   `gateway listening`, then `payment live`, `data live`, `ai live`,
   `ens live`.
4. Copy the service URL, `https://faregate-gateway-xxxx.onrender.com`, and open
   `<that url>/health`. Every mode says `live` and `notes` is empty.

If the deploy fails with `payment facilitator check failed`, Blocky402's
testnet host was unreachable at that moment. **Manual Deploy** → **Deploy
latest commit** to try again.

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
5. Copy the dashboard URL, `https://web3-faregate-xxxx.vercel.app`.

## 3. Connect the two

1. In Render, open the service → **Environment** → set
   `FAREGATE_CORS_ORIGIN` to the Vercel URL, exactly as shown, no trailing
   slash. To keep the local dashboard working too, give both,
   comma-separated: `https://web3-faregate-xxxx.vercel.app,http://localhost:3000`.
2. **Save changes**. Render redeploys, about two minutes.
3. Open the Vercel URL. The header readout shows Pay, Data, AI and ENS in
   green with **Live**, and the rail lists the two ENS passports.

## 4. The agent, from your machine

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
- Send a request as either agent from **Send a test request**.
- Approve or reject with their own wallet on Sepolia. Signatures prove who
  acted, not that they were entitled to; the gateway is single-tenant and its
  read API is open, as `SECURITY.md` states. Whoever approves, only your
  agent can pay, and it pays testnet USDC.
- Not collect data: that needs the agent and its Hedera key, which stay with
  you.
- Not revoke: with ENS live, revocation is an onchain change by the owner
  key, also on your machine.

## Checks before sharing the link

```bash
curl https://faregate-gateway-xxxx.onrender.com/health
```

`modes` all `live`, `notes` empty, `signedActions` true. Then load the
dashboard, connect MetaMask on Sepolia, send a test request from the panel,
approve it, and run the agent from your machine to collect it.

## Updating

Push to `main`. Both hosts redeploy on their own. A Render deploy wipes the
snapshot file, which is the same as `npm run reset`.

## Any other host

The gateway is one long-running Node 24 process with a writable working
directory. Build with
`npm ci --include=dev --workspace @faregate/shared --workspace @faregate/api && npm run build --workspace @faregate/shared`,
start with `node apps/api/src/server.ts`, and set the same environment
variables as `render.yaml`. It binds to `PORT` when the host sets one.
