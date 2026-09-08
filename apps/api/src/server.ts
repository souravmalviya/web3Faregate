/** Gateway entrypoint. */

import { createApp } from './app.ts';
import { describeModes, loadConfig } from './config.ts';
import { GatewayStore, seedDemoData } from './store.ts';

const config = loadConfig();
const store = new GatewayStore();
seedDemoData(store);

const app = createApp({ config, store });

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
  for (const note of notes) console.log(`[faregate] note: ${note}`);
});
