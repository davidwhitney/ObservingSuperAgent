import { Hono } from 'hono';
import type { Orchestrator } from '../orchestrator/Orchestrator';
import type { Poller } from '../orchestrator/Poller';
import type { Reconciler } from '../orchestrator/Reconciler';
import type { AgentMemory } from '../memory/AgentMemory';

export interface ApiDeps {
  orchestrator: Orchestrator;
  poller: Poller;
  reconciler: Reconciler;
  memory: AgentMemory;
}

/**
 * Build the hono app exposing the super-agent's control surface. Returned as an
 * app (not a running server) so tests can drive it via `app.request(...)`.
 */
export function createApp(deps: ApiDeps): Hono {
  const app = new Hono();

  app.get('/health', (c) => c.json({ status: 'ok' }));

  app.post('/dispatch', async (c) => {
    const summary = await deps.orchestrator.runDispatchCycle();
    return c.json(summary);
  });

  app.post('/poll', async (c) => {
    const summary = await deps.poller.runPollCycle();
    return c.json(summary);
  });

  // Verification / cleanup pass. Dry-run by default; ?apply=true to repair.
  app.post('/reconcile', async (c) => {
    const apply = c.req.query('apply') === 'true';
    const summary = await deps.reconciler.reconcile({ apply });
    return c.json(summary);
  });

  app.get('/status', async (c) => {
    const records = await deps.memory.all();
    return c.json({ count: records.length, records });
  });

  return app;
}
