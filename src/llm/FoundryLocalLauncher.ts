import type { LlmConfig } from '../config/schema';

export interface FoundryRuntime {
  /** OpenAI-compatible base URL the adapter should use (includes /v1). */
  endpoint?: string;
  /** Resolved model id the adapter should request. */
  model?: string;
}

export interface LauncherDeps {
  /** Returns true if an OpenAI-compatible service is reachable at `endpoint`. */
  probe?: (endpoint: string) => Promise<boolean>;
  /** Starts the service + loads the model; returns the bound URL and model id. */
  startService?: (llm: LlmConfig, log: Logger) => Promise<{ url: string; model: string }>;
}

export type Logger = (message: string) => void;

/**
 * Ensure Foundry Local is running when we're configured to use it. If the
 * configured endpoint already answers, do nothing. Otherwise — when autoStart
 * is on — start the service via the Foundry Local SDK, ensure the model is
 * downloaded and loaded, and return the real endpoint/model to use. Any failure
 * (SDK missing, native libs absent, Foundry not installed) degrades gracefully:
 * we log and return nothing, leaving the configured endpoint in place.
 */
export async function ensureFoundryLocal(
  llm: LlmConfig,
  log: Logger = console.log,
  deps: LauncherDeps = {},
): Promise<FoundryRuntime> {
  if (llm.provider !== 'foundry-local') return {};

  const probe = deps.probe ?? defaultProbe;
  if (llm.endpoint && (await probe(llm.endpoint))) {
    log(`[osa] Foundry Local already reachable at ${llm.endpoint}`);
    return {};
  }

  if (!llm.autoStart) {
    log('[osa] Foundry Local is not reachable and llm.autoStart is disabled');
    return {};
  }

  try {
    const start = deps.startService ?? startViaSdk;
    log('[osa] starting Foundry Local…');
    const { url, model } = await start(llm, log);
    const endpoint = `${url.replace(/\/$/, '')}/v1`;
    log(`[osa] Foundry Local ready at ${endpoint} (model ${model})`);
    return { endpoint, model };
  } catch (err) {
    log(`[osa] could not auto-start Foundry Local: ${(err as Error).message}`);
    return {};
  }
}

async function defaultProbe(endpoint: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const res = await fetch(`${endpoint.replace(/\/$/, '')}/models`, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Default starter: drives the Foundry Local SDK (FFI + embedded web service). */
async function startViaSdk(llm: LlmConfig, log: Logger): Promise<{ url: string; model: string }> {
  if (!llm.model) {
    throw new Error('llm.model (a Foundry Local model alias or id) is required to auto-start');
  }
  const { FoundryLocalManager } = await import('foundry-local-sdk');
  const manager = await FoundryLocalManager.createAsync({ appName: 'observing-super-agent' });

  if (!manager.isWebServiceRunning) manager.startWebService();

  const model = await manager.catalog.getModel(llm.model);
  if (!model.isCached) {
    log(`[osa] downloading model ${model.id}…`);
    await model.download();
  }
  await model.load();

  const url = manager.urls[0];
  if (!url) throw new Error('Foundry Local web service did not report a bound URL');
  return { url, model: model.id };
}
