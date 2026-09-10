/** Gateway entrypoint. */

import { OpenRouterAIProvider, RuleBasedAIProvider, type AIProvider } from './ai/provider.ts';
import type { x402HTTPResourceServer } from '@x402/core/server';

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

const config = loadConfig();
const store = new GatewayStore();
seedDemoData(store);

// A live provider is only built when it is actually configured. It never falls
// back to simulated data at query time: a live provider that fails, fails.
const dataProvider: DataProvider =
  config.data.mode === 'live'
    ? new GraphDataProvider({
        targets: parseGraphTargets(config.data.subgraphs),
        apiKey: config.data.graphApiKey,
      })
    : new SimulatedDataProvider();

const aiProvider: AIProvider =
  config.ai.mode === 'live' && config.ai.apiKey
    ? new OpenRouterAIProvider({ apiKey: config.ai.apiKey, model: config.ai.model })
    : new RuleBasedAIProvider();

// ENS is the source of truth for passports when it is configured. The two
// seeded demo agents are named under the passport parent, so once ENS is live
// they resolve only if their passports have been minted onchain.
const identity: IdentityService =
  config.ens.mode === 'live' && config.ens.rpcUrl
    ? new EnsIdentityService(
        new EnsPassportResolver({
          rpcUrl: config.ens.rpcUrl,
          ...(config.ens.universalResolver
            ? { universalResolverAddress: config.ens.universalResolver as `0x${string}` }
            : {}),
        }),
        store,
        config.ens.parentName,
      )
    : new LocalIdentityService(store);

// In live payment mode, confirm the facilitator can settle on this network
// before accepting a single request. Starting anyway would leave /health
// reporting payments as live while every paid request failed.
let paymentServer: x402HTTPResourceServer | undefined;
let ready = true;
if (config.payment.mode === 'live') {
  paymentServer = createHttpResourceServer({ config, store, identity });
  try {
    await paymentServer.initialize();
  } catch (error) {
    ready = false;
    const detail = (error instanceof Error ? error.message : String(error))
      .split('\n')
      .map((line) => line.replace(/^[\s-]+/, '').trim())
      .filter(Boolean)
      .pop();
    console.error('[faregate] payment facilitator check failed, not starting');
    console.error(`[faregate]   facilitator  ${config.payment.facilitatorUrl}`);
    console.error(`[faregate]   network      ${config.payment.network}`);
    console.error(`[faregate]   reason       ${detail}`);
    console.error(
      `[faregate] ${config.payment.facilitatorUrl}/supported must list scheme "exact" on ${config.payment.network}.`,
    );
    console.error(
      `[faregate] Blocky402 testnet is ${BLOCKY402_TESTNET} and mainnet is ${BLOCKY402_MAINNET}. Fix X402_FACILITATOR_URL, or unset FAREGATE_PAY_TO to run with simulated payments.`,
    );
    // Set the exit code and let the process wind down, rather than calling
    // process.exit() while the facilitator request's socket is still closing,
    // which trips a libuv assertion on Windows.
    process.exitCode = 1;
  }
}

if (ready) start();

function start(): void {
  const app = createApp({
    config,
    store,
    dataProvider,
    aiProvider,
    identity,
    ...(paymentServer ? { paymentServer } : {}),
  });

  app.listen(config.port, () => {
    const modes = describeModes(config);
    console.log(`[faregate] gateway listening on http://localhost:${config.port}`);
    console.log(`[faregate] network ${config.payment.network}`);
    if (paymentServer) {
      console.log(
        `[faregate] payment  facilitator ${config.payment.facilitatorUrl} supports exact on ${config.payment.network}`,
      );
    }
    for (const [subsystem, mode] of Object.entries(modes)) {
      console.log(`[faregate] ${subsystem.padEnd(8)} ${mode}`);
    }
    const notes = [config.payment.reason, config.data.reason, config.ai.reason, config.ens.reason].filter(
      Boolean,
    );
    console.log(`[faregate] data     ${dataProvider.describe()}`);
    console.log(`[faregate] ai       ${aiProvider.describe()}`);
    console.log(`[faregate] identity ${identity.describe()}`);
    for (const note of notes) console.log(`[faregate] note: ${note}`);
  });
}
