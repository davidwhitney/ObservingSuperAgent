import { describe, it, expect, vi } from 'vitest';
import { ensureFoundryLocal } from '../../src/llm/FoundryLocalLauncher';
import type { LlmConfig } from '../../src/config/schema';

function llm(overrides: Partial<LlmConfig> = {}): LlmConfig {
  return { provider: 'foundry-local', autoStart: true, endpoint: 'http://localhost:5273/v1', model: 'phi-4', ...overrides };
}

describe('ensureFoundryLocal', () => {
  it('is a no-op for non-foundry providers', async () => {
    const startService = vi.fn();
    const result = await ensureFoundryLocal({ provider: 'fake', autoStart: true }, () => {}, { startService });
    expect(result).toEqual({});
    expect(startService).not.toHaveBeenCalled();
  });

  it('does nothing when the configured endpoint already answers', async () => {
    const startService = vi.fn();
    const result = await ensureFoundryLocal(llm(), () => {}, {
      probe: async () => true,
      startService,
    });
    expect(result).toEqual({});
    expect(startService).not.toHaveBeenCalled();
  });

  it('starts the service and returns the resolved endpoint + model', async () => {
    const result = await ensureFoundryLocal(llm({ endpoint: undefined }), () => {}, {
      probe: async () => false,
      startService: async () => ({ url: 'http://127.0.0.1:54321', model: 'phi-4-cuda-gpu' }),
    });
    expect(result).toEqual({ endpoint: 'http://127.0.0.1:54321/v1', model: 'phi-4-cuda-gpu' });
  });

  it('does not start when autoStart is disabled', async () => {
    const startService = vi.fn();
    const result = await ensureFoundryLocal(llm({ autoStart: false }), () => {}, {
      probe: async () => false,
      startService,
    });
    expect(result).toEqual({});
    expect(startService).not.toHaveBeenCalled();
  });

  it('degrades gracefully when starting throws', async () => {
    const logs: string[] = [];
    const result = await ensureFoundryLocal(llm(), (m) => logs.push(m), {
      probe: async () => false,
      startService: async () => {
        throw new Error('foundry not installed');
      },
    });
    expect(result).toEqual({});
    expect(logs.some((l) => l.includes('could not auto-start'))).toBe(true);
  });
});
