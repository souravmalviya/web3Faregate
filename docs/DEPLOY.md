# Deploying Faregate

Two services: the gateway (Express, `apps/api`) and the dashboard (Next.js,
`apps/web`). The demo agent stays on your own machine, because it holds the
only key that can spend anything.

The gateway holds no private keys. It gets the Graph and OpenRouter API keys
(spend-limited, revocable) and the public Hedera account id that receives
fares. The agent's Hedera key and the ENS owner key never leave your machine.

## 1. Gateway on Render (free)

1. Sign in at https://render.com with GitHub.
2. **New** → **Blueprint**, pick the `web3Faregate` repository. Render reads
   `render.yaml` and asks for the values marked `sync: false`:

   | Variable | Value |
   |---|---|
   | `FAREGATE_CORS_ORIGIN` | your dashboard URL from step 2, for example `https://faregate.vercel.app`. Put a placeholder for now and edit it after step 2. |
   | `FAREGATE_PAY_TO` | the gateway's Hedera testnet account, `0.0.10457565` |
   | `GRAPH_API_KEY` | your Graph Studio key |
   | `GRAPH_SUBGRAPHS` | the value from `.env` |
   | `OPENROUTER_API_KEY` | your OpenRouter key |

3. **Apply**. The first build takes a few minutes. When it is live, open
   `https://<service>.onrender.com/health`: every mode should say `live`.

Notes:
- The free plan sleeps after 15 minutes without traffic and takes about a
  minute to wake. Open `/health` a minute before a demo.
- State is a file on the instance and is reset on every deploy. With ENS live
  the passports come from Sepolia, so nothing important is lost.
- Never add `HEDERA_PRIVATE_KEY`, `ENS_OWNER_PRIVATE_KEY` or
  `FAREGATE_PAY_TO_PRIVATE_KEY` to Render. The gateway does not read them.

## 2. Dashboard on Vercel (free)

1. Sign in at https://vercel.com with GitHub. **Add New** → **Project**, import
   `web3Faregate`.
2. **Root Directory**: `apps/web`. Framework is detected as Next.js.
3. **Environment variables**: `NEXT_PUBLIC_FAREGATE_GATEWAY_URL` = the Render
   URL from step 1, with no trailing slash.
4. **Deploy**. The build compiles `packages/shared` first (the `prebuild`
   script), then the dashboard.
5. Go back to Render, set `FAREGATE_CORS_ORIGIN` to the Vercel URL, and let it
   redeploy.

Open the Vercel URL: the top bar shows four live modes and the two ENS
passports.

## 3. The agent, from your machine

In `.env`, point the agent at the hosted gateway:

```
FAREGATE_GATEWAY_URL=https://<service>.onrender.com
```

Then `npm run agent` works exactly as it does locally, and the hosted dashboard
shows the request for approval.

## What a visitor can do on the live dashboard

- Read everything: passports, requests, payments, data and the audit trail.
- Submit a request as either agent from the **Send a request** box.
- Approve or reject with their own wallet on Sepolia. Signatures prove who
  acted, not that they were entitled to; the gateway is single-tenant and its
  read API is open, as `SECURITY.md` states.
- Not collect data: that needs the agent and its Hedera key, which stay with
  you.
- Not revoke: with ENS live, revocation is an onchain change by the owner key.

## Checks before sharing the link

```bash
curl https://<service>.onrender.com/health
```

`modes` all `live`, `notes` empty. Then load the dashboard, connect MetaMask,
and confirm the top bar shows your address and Sepolia.
