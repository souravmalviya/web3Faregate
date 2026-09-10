# ENS passports

An agent's identity in Faregate is an ENS name, and its capability lives in
that name's text records. This is what turns revocation into an onchain act:
the owner changes a record with their own wallet, and the gateway refuses the
agent at its next request.

The gateway only ever **reads** ENS. It resolves passports live through the
ENSv2 Universal Resolver on Sepolia on every request, never caches them, and
fails closed if the chain cannot be reached. Writing records is the human's
job, with the human's wallet.

## Text records

All keys are namespaced under `faregate.`:

| Key | Value |
|---|---|
| `faregate.status` | `active` or `revoked` |
| `faregate.label` | Human-readable name shown in the dashboard |
| `faregate.scope` | Comma-separated resource kinds, e.g. `wallet.balances,wallet.activity` |
| `faregate.max_per_query_usd` | Decimal string |
| `faregate.daily_limit_usd` | Decimal string |
| `faregate.approval_above_usd` | Decimal string |
| `faregate.expires_at` | ISO 8601 timestamp, or empty for no expiry |

A name with no `faregate.status` record is not a passport, even if it is a
perfectly good ENS name. That rule stops a stranger's name being used as an
agent identity by accident. A passport with no limit records gets a budget of
zero.

## Sepolia contracts (ENSv2 beta)

From the ENS deployments page, https://docs.ens.domains/learn/deployments :

| Contract | Address |
|---|---|
| RootRegistry | `0x8115186e8f2e0b0281e86ab91f0f48ba90364354` |
| ETHRegistry | `0xbdc85dd5b15d7ecb354cd7cb6f2c50b4f2c4f0e2` |
| ETHRegistrar | `0xa88553f454b77203b0d036a05c894d555eaaa2cc` |
| UniversalResolverV2 | `0x4a1817d13e9cf196f471725176355c1234b63c70` |
| VerifiableFactory | `0x10dc6333cdfe1fcef624c6e0a8221b91804cd7ef` |
| UserRegistryImpl | `0x624a25d67b59d587752ebec8dded8827dae52050` |
| PublicResolverV2 | `0xe7b9a25607e02da8145e4eb1836ca539e53f11f7` |
| PermissionedResolverImpl | `0x9eae5c2730a7dd16bdd1dee6421a1b91e3b0365e` |

The gateway uses `UniversalResolverV2` by default; override with
`ENS_UNIVERSAL_RESOLVER` if ENS redeploys.

## Setting up the names

One command does the whole setup on Sepolia, at no real cost:

```bash
npm run ens:setup -- --owner 0xYourTestAccount   # dry run: checks and simulates, sends nothing
npm run ens:setup -- --send                      # with ENS_OWNER_PRIVATE_KEY in .env
```

What it needs:

- A **fresh test account**, for example a new MetaMask account. Its key goes in
  `.env` as `ENS_OWNER_PRIVATE_KEY`, so it must never hold real funds.
- About **0.005 Sepolia ETH** for gas, free from a faucet such as
  https://ethglobal.com/faucet. The registration fee is charged in MockUSDC,
  which anyone can mint for free, and the script mints it.

What it does, skipping anything already done:

1. Deploys one **PermissionedResolver** through the VerifiableFactory. It holds
   every passport record, and the owner can change any of them.
2. Deploys a **UserRegistry** for `faregate.eth` and another for
   `agents.faregate.eth`.
3. Mints and approves **MockUSDC**, then **registers `faregate.eth`** through
   the ETHRegistrar (commit, wait 60 seconds, register), with the first
   registry as its subregistry.
4. Registers **`agents.faregate.eth`** in that registry, pointing at the second.
5. Sets **parent pointers** so explorers can show the full names.
6. Registers the demo passports (`research`, `trial`) and writes their
   `faregate.*` records and address, one multicall per passport.
7. Reads every passport back through the Universal Resolver, as the gateway
   will.

Every transaction is simulated first and is not sent if the simulation fails,
and the script refuses to run against any chain but Sepolia. Addresses are
saved in `data/ens-setup.json`, so an interrupted run carries on where it
stopped. The full setup is about 14 transactions.

## Minting a passport

With the UserRegistry and resolver in place:

```bash
# 1. Register the subname (dry run first, then --send)
node scripts/ens/passport.ts register \
  --registry <UserRegistry proxy> --label research \
  --owner <your address> --resolver <PermissionedResolver proxy>

# 2. Write the capability records
node scripts/ens/passport.ts records \
  --name research.agents.faregate.eth --resolver <PermissionedResolver proxy> \
  --status active --label "Treasury Research Agent" \
  --scope wallet.balances,wallet.transfers,wallet.activity \
  --per-query 0.10 --daily 1.00 --approval-above 0.02 --send
```

Both commands default to a dry run that prints the exact calldata. Add `--send`
with `ENS_OWNER_PRIVATE_KEY` in `.env` to broadcast. Use a throwaway Sepolia
key only.

## Revoking a passport

```bash
node scripts/ens/passport.ts revoke \
  --name research.agents.faregate.eth --resolver <PermissionedResolver proxy> --send
```

This sets `faregate.status` to `revoked`. The gateway's `POST /agents/:id/revoke`
deliberately refuses to do this for an ENS passport and tells the human to run
this instead, because the gateway does not hold a key and should not.

Unregistering the subname entirely also revokes: the name stops resolving, the
passport is unknown, and the agent is refused.

## Turning it on in the gateway

```
ENS_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
FAREGATE_PARENT_NAME=agents.faregate.eth
```

Reads are free, so a public RPC works. Once set, `/health` reports
`ens: live`, and the dashboard labels resolved passports `ENS passport`.

Mint the demo passports before setting `ENS_RPC_URL`. The seeded demo agents
are named under `agents.faregate.eth`, so once ENS is live the chain is the
only authority for them, and a name with no passport is refused.

## Caveat

ENSv2 is beta on Sepolia and the ENS documentation says the interfaces may
change before mainnet. The script cites the page each interface came from, and
dry-runs by default for that reason.
