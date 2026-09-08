/** Gateway entrypoint. */

import { AnthropicAIProvider, RuleBasedAIProvider, type AIProvider } from './ai/provider.ts';
import { createApp } from './app.ts';
import { describeModes, loadConfig } from './config.ts';
import { GraphDataProvider, SimulatedDataProvider, type DataProvider } from './data/provider.ts';
import { EnsPassportResolver } from './identity/ens.ts';
import { EnsIdentityService, LocalIdentityService, type IdentityService } from './identity/service.ts';
import { GatewayStore, seedDemoData } from './store.ts';

const config = loadConfig();
const store = new GatewayStore();
seedDemoData(store);

// A live provider is only built when it is actually configured. It never falls
// back to simulated data at query time: a live provider that fails, fails.
const dataProvider: DataProvider =
  config.data.mode === 'live'
    ? new GraphDataProvider({
        subgraphUrl: config.data.subgraphUrl,
        subgraphId: process.env.GRAPH_SUBGRAPH_ID,
        apiKey: config.data.graphApiKey,
      })
    : new SimulatedDataProvider();

const aiProvider: AIProvider =
  config.ai.mode === 'live' && config.ai.apiKey
    ? new AnthropicAIProvider({ apiKey: config.ai.apiKey, model: config.ai.model })
    : new RuleBasedAIProvider();

// ENS is the source of truth for passports when it is configured. The local
// store still seeds the two demo agents, which live outside the passport
// namespace and resolve locally.
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

const app = createApp({ config, store, dataProvider, aiProvider, identity });

app.listen(config.port, () => {
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
  for (const note of notes) console.log(`[faregate] note: ${note}`);
});
