/** Gateway entrypoint. */

import { createApp } from './app.ts';
import { describeModes, loadConfig } from './config.ts';
import { GraphDataProvider, SimulatedDataProvider, type DataProvider } from './data/provider.ts';
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

const app = createApp({ config, store, dataProvider });

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
  for (const note of notes) console.log(`[faregate] note: ${note}`);
});
