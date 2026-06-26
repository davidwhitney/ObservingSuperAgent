import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, applyEnvOverlay } from '../../src/config/load';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function writeConfig(contents: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'osa-cfg-'));
  dirs.push(dir);
  const path = join(dir, 'config.json');
  writeFileSync(path, JSON.stringify(contents));
  return path;
}

describe('applyEnvOverlay', () => {
  it('maps OSA_ vars onto a nested path, ignoring others, parsing JSON values', () => {
    const out = applyEnvOverlay(
      { api: { port: 1 } },
      { OSA_API__PORT: '2', OSA_NEW__FLAG: 'true', UNRELATED: 'x' } as NodeJS.ProcessEnv,
    );
    expect(out).toEqual({ api: { port: 2 }, NEW: { FLAG: true } });
  });
});

describe('loadConfig', () => {
  it('applies schema defaults to an empty config', () => {
    const config = loadConfig({ configPath: writeConfig({}), env: {} });
    expect(config.memory.type).toBe('disk');
    expect(config.api.port).toBe(8787);
    expect(config.llm.provider).toBe('fake');
    expect(config.comms).toEqual([{ type: 'console' }]);
  });

  it('lets environment variables override file values case-insensitively', () => {
    const path = writeConfig({
      api: { port: 8787 },
      jira: { baseUrl: 'https://placeholder.atlassian.net', apiToken: 'placeholder', projectIds: ['OLD'] },
    });
    const config = loadConfig({
      configPath: path,
      env: {
        OSA_API__PORT: '9090',
        OSA_JIRA__BASEURL: 'https://real.atlassian.net',
        OSA_JIRA__APITOKEN: 'secret',
        OSA_JIRA__PROJECTIDS: '["ENG","OPS"]',
      } as NodeJS.ProcessEnv,
    });

    expect(config.api.port).toBe(9090);
    expect(config.jira?.baseUrl).toBe('https://real.atlassian.net');
    expect(config.jira?.apiToken).toBe('secret');
    expect(config.jira?.projectIds).toEqual(['ENG', 'OPS']);
  });

  it('throws on invalid config', () => {
    const path = writeConfig({ jira: { baseUrl: 'not-a-url' } });
    expect(() => loadConfig({ configPath: path, env: {} })).toThrow();
  });
});
