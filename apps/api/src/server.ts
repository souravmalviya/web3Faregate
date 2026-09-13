/** Gateway entrypoint. */

import type { x402HTTPResourceServer } from '@x402/core/server';

import {
  BudgetedAIProvider,
  OpenRouterAIProvider,
  RuleBasedAIProvider,
  type AIProvider,
} from './ai/provider.ts';
import { createApp } from './app.ts';
import { BLOCKY402_MAINNET, BLOCKY402_TESTNET, describeModes, loadConfig } from './config.ts';
import {
  GraphDataProvider,
  SimulatedDataProvider,
  parseGraphTargets,
  type DataProvider,
} from './data/provider.ts';
import { EnsPassportResolver } from './identity/ens.ts';
import { EnsIdentityService, LocalIdentityService, type IdentityService } from './identity/service.ts';
import { createHttpResourceServer } from './payment/x402.ts';
import { GatewayStore, seedDemoData } from './store.ts';

/** How long startup waits for ENS before serving from the seeded copies. */
const STARTUP_ENS_TIMEOUT_MS = 8_000;
/** How long one facilitator check may take. */
const FACILITATOR_TIMEOUT_MS = 15_000;
/** How long to wait before checking an unreachable facilitator again. */
const FACILITATOR_RETRY_MS = 30_000;

// A stray promise rejection is logged, not fatal: on a public gateway one
// failed background call must not take every agent offline. A thrown
// exception still ends the process, because its state can no longer be trusted.
process.on('unhandledRejection', (reason) => {
  console.error('[faregate] unhandled rejection:', reason instanceof Error ? (reason.stack ?? reason.message) : reason);
});

const config = loadConfig();

// State survives restarts when a snapshot file is configured. The demo
// passports are seeded only into an empty store: re-seeding on every start
// would quietly un-revoke an agent the human had revoked before a restart.
const store = new GatewayStore(config.stateFile ? { file: config.stateFile } : {});
const seeded = store.listAgents().length === 0;
if (seeded) seedDemoData(store);

// A live provider is only built when it is actually configured. It never falls
// back to simulated data at query time: a live provider that fails, fails.
const dataProvider: DataProvider =
  config.data.mode === 'live'
    ? new GraphDataProvider({
        targets: parseGraphTargets(config.data.subgraphs),
        apiKey: config.data.graphApiKey,
      })
    : new SimulatedDataProvider();

// The live model sits behind an hourly call budget, so a public gateway cannot
// be made to run up a model bill; past the budget the rule-based provider
// answers and says so.
const aiProvider: AIProvider =
  config.ai.mode === 'live' && config.ai.apiKey
    ? new BudgetedAIProvider(new OpenRouterAIProvider({ apiKey: config.ai.apiKey, model: config.ai.model }), {
        callsPerHour: config.ai.callsPerHour,
      })
    : new RuleBasedAIProvider();

// ENS is the source of truth for passports when it is configured. The two
// seeded demo agents are named under the passport parent, so once ENS is live
// they resolve only if their passports have been minted onchain.
const identity: IdentityService =
  config.ens.mode === 'live' && config.ens.rpcUrls.length > 0
    ? new EnsIdentityService(
        new EnsPassportResolver({
          rpcUrls: config.ens.rpcUrls,
          ...(config.ens.universalResolver
            ? { universalResolverAddress: config.ens.universalResolver as `0x${string}` }
            : {}),
        }),
        store,
        config.ens.parentName,
      )
    : new LocalIdentityService(store);

// The dashboard lists the store's display copies. With ENS live, refresh them
// from the chain before serving, so an onchain passport shows as one from the
// first page load. Decisions never read these copies; every request resolves
// live. A slow RPC delays startup by a few seconds at most.
let ensPassports = 0;
if (identity.mode === 'ens') {
  const refreshed = Promise.all(
    store.listAgents().map(async (agent) => {
      const resolved = await identity.resolve(agent.id);
      if (resolved.source === 'ens') ensPassports += 1;
    }),
  );
  await withTimeout(refreshed, STARTUP_ENS_TIMEOUT_MS).catch(() => {
    console.warn(
      `[faregate] identity ENS did not answer within ${STARTUP_ENS_TIMEOUT_MS / 1000} seconds at startup; every request still resolves live`,
    );
  });
}

// Live payments need the facilitator to confirm it settles `exact` on this
// network. The check runs once the gateway is listening. Until it succeeds,
// /health says so and paid collection answers 503 with nothing charged. A free
// host restarts the gateway whenever it wakes, so a facilitator that is briefly
// unreachable at that moment must not keep the passports, the dashboard and
// every free decision offline too.
const paymentServer: x402HTTPResourceServer | undefined =
  config.payment.mode === 'live' ? createHttpResourceServer({ config, store, identity }) : undefined;
let paymentReady = paymentServer === undefined;

start();
if (paymentServer) checkFacilitator(paymentServer);

function start(): void {
  const app = createApp({
    config,
    store,
    dataProvider,
    aiProvider,
    identity,
    ...(paymentServer ? { paymentServer, paymentReady: () => paymentReady } : {}),
  });

  const server = app.listen(config.port, () => {
    const modes = describeModes(config);
    console.log(`[faregate] gateway listening on http://localhost:${config.port}`);
    console.log(`[faregate] network ${config.payment.network}`);
    for (const [subsystem, mode] of Object.entries(modes)) {
      console.log(`[faregate] ${subsystem.padEnd(8)} ${mode}`);
    }
    const notes = [config.payment.reason, config.data.reason, config.ai.reason, config.ens.reason].filter(
      Boolean,
    );
    console.log(`[faregate] data     ${dataProvider.describe()}`);
    console.log(`[faregate] ai       ${aiProvider.describe()}`);
    console.log(`[faregate] identity ${identity.describe()}`);
    if (identity.mode === 'ens') {
      console.log(`[faregate] identity ${ensPassports} passport(s) read from ENS at startup`);
    }
    console.log(
      `[faregate] state    ${store.describePersistence()}${seeded ? ', seeded the two demo passports' : ', loaded from snapshot'}`,
    );
    console.log(
      `[faregate] actions  ${
        config.requireSignedActions
          ? 'human actions must be signed by the acting wallet'
          : 'UNSIGNED human actions accepted (FAREGATE_REQUIRE_SIGNED_ACTIONS=false)'
      }`,
    );
    // A dashboard on an origin missing here sees the gateway as unreachable,
    // with nothing in this log unless the origins are printed.
    console.log(
      `[faregate] cors     ${
        config.corsOrigins.length > 0
          ? `browser origins ${config.corsOrigins.join(', ')}`
          : 'no browser origin may call this gateway'
      }`,
    );
    for (const { entry, reason } of config.corsIgnored ?? []) {
      console.warn(`[faregate] cors     ignored "${entry}": ${reason}`);
    }
    if (config.corsOrigins.includes('https://example.invalid')) {
      console.warn(
        '[faregate] cors     https://example.invalid is a placeholder. Set FAREGATE_CORS_ORIGIN to the dashboard address, or the hosted dashboard cannot reach this gateway.',
      );
    }
    for (const note of notes) console.log(`[faregate] note: ${note}`);
  });

  // Write any pending snapshot before the process ends, so the last action
  // before Ctrl-C is not the one that gets lost.
  const shutdown = (signal: string): void => {
    console.log(`[faregate] ${signal}, saving state and stopping`);
    try {
      store.flush();
    } catch (error) {
      console.error(
        `[faregate] state snapshot could not be written: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

/** Confirms the facilitator settles on this network, retrying until it does. */
function checkFacilitator(server: x402HTTPResourceServer): void {
  withTimeout(server.initialize(), FACILITATOR_TIMEOUT_MS).then(
    () => {
      paymentReady = true;
      console.log(
        `[faregate] payment  facilitator ${config.payment.facilitatorUrl} supports exact on ${config.payment.network}; paid collection is open`,
      );
    },
    (error: unknown) => {
      const detail = (error instanceof Error ? error.message : String(error))
        .split('\n')
        .map((line) => line.replace(/^[\s-]+/, '').trim())
        .filter(Boolean)
        .pop();
      console.error(
        `[faregate] payment  facilitator check failed (${detail}); paid collection is paused and checked again in ${FACILITATOR_RETRY_MS / 1000} seconds`,
      );
      console.error(
        `[faregate] payment  ${config.payment.facilitatorUrl}/supported must list scheme "exact" on ${config.payment.network}. Blocky402 testnet is ${BLOCKY402_TESTNET} and mainnet is ${BLOCKY402_MAINNET}.`,
      );
      setTimeout(() => checkFacilitator(server), FACILITATOR_RETRY_MS).unref();
    },
  );
}

/** Rejects when `promise` has not settled within `ms`. A late rejection of `promise` is absorbed. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  promise.catch(() => undefined);
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer within ${ms / 1000} seconds`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
