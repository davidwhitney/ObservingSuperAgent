import { serve } from '@hono/node-server';
import { loadConfig } from './config/load';
import { buildFromConfig } from './composition/buildFromConfig';
import { createApp } from './api/server';
import { ensureFoundryLocal } from './llm/FoundryLocalLauncher';

async function main(): Promise<void> {
  const config = loadConfig();

  // Bring up Foundry Local if we're configured to use it (no-op otherwise).
  const runtime = await ensureFoundryLocal(config.llm);
  if (runtime.endpoint) config.llm.endpoint = runtime.endpoint;
  if (runtime.model) config.llm.model = runtime.model;

  const system = buildFromConfig(config);
  const app = createApp(system);

  serve({ fetch: app.fetch, port: config.api.port, hostname: config.api.host }, (info) => {
    console.log(`[osa] listening on http://${config.api.host}:${info.port}`);
    console.log('[osa] endpoints: GET /health, POST /dispatch, POST /poll, POST /reconcile, GET /status');
    console.log(
      `[osa] connectors=[${system.connectors.map((c) => c.name).join(', ') || 'none'}] ` +
        `agent=${system.agent.name} llm=${system.llm.name} memory=${config.memory.type}`,
    );
  });

  if (config.polling.intervalMs) {
    console.log(`[osa] background polling every ${config.polling.intervalMs}ms`);
    setInterval(() => {
      system.poller.runPollCycle().catch((err) => console.error('[osa] poll cycle error', err));
    }, config.polling.intervalMs);
  }
}

main().catch((err) => {
  console.error('[osa] failed to start', err);
  process.exitCode = 1;
});
