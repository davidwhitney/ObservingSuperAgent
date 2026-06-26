import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DiskBackedStorage } from '../../src/memory/DiskBackedStorage';
import { InMemoryStorage } from '../../src/memory/InMemoryStorage';
import { AgentMemory, recordIdFor } from '../../src/memory/AgentMemory';
import type { DispatchRecord } from '../../src/domain/types';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'osa-'));
  dirs.push(dir);
  return dir;
}

describe('DiskBackedStorage', () => {
  it('round-trips values, lists keys, and deletes (with safe key encoding)', async () => {
    const store = new DiskBackedStorage(tmp());

    expect(await store.read('missing')).toBeNull();
    expect(await store.list()).toEqual([]);

    await store.write('record:jira:ENG-1', 'hello');
    await store.write('plain', 'world');

    expect(await store.read('record:jira:ENG-1')).toBe('hello');
    expect((await store.list()).sort()).toEqual(['plain', 'record:jira:ENG-1']);

    await store.delete('plain');
    expect(await store.read('plain')).toBeNull();
    expect(await store.list()).toEqual(['record:jira:ENG-1']);
  });
});

describe('AgentMemory', () => {
  function record(rawId: string, status: DispatchRecord['status']): DispatchRecord {
    const workItem = { connector: 'jira', projectId: 'ENG', id: rawId, key: rawId };
    return {
      id: recordIdFor(workItem),
      connector: 'jira',
      workItem,
      projectId: 'ENG',
      plan: { repositories: ['acme/x'], prompt: 'p' },
      runs: [],
      status,
      createdAt: '',
      updatedAt: '',
    };
  }

  it('persists records and reports acted-on / pollable state', async () => {
    let t = 0;
    const memory = new AgentMemory(new InMemoryStorage(), () => `t${t++}`);

    await memory.save(record('a', 'dispatched'));
    await memory.save(record('b', 'completed'));
    await memory.save(record('c', 'planned'));

    expect((await memory.all()).map((r) => r.id).sort()).toEqual(['jira:a', 'jira:b', 'jira:c']);
    // dispatched + completed (in review) are pollable; completed/done/rejected are not... 'b' is completed -> pollable.
    expect((await memory.recordsToPoll()).map((r) => r.id).sort()).toEqual(['jira:a', 'jira:b']);

    const ref = { connector: 'jira', projectId: 'ENG', id: 'a' };
    expect(recordIdFor(ref)).toBe('jira:a');
    expect(await memory.hasActedOn(ref)).toBe(true);
    expect(await memory.hasActedOn({ connector: 'jira', projectId: 'ENG', id: 'z' })).toBe(false);
  });

  it('stamps createdAt once and updatedAt on every save', async () => {
    let t = 0;
    const memory = new AgentMemory(new InMemoryStorage(), () => `t${t++}`);
    const rec = memory.newRecord({
      id: 'x',
      connector: 'jira',
      workItem: { connector: 'jira', projectId: 'ENG', id: 'x' },
      projectId: 'ENG',
      plan: { repositories: ['acme/x'], prompt: 'p' },
      runs: [],
      status: 'planned',
    });
    expect(rec.createdAt).toBe('t0');

    await memory.save(rec);
    const reloaded = await memory.get('x');
    expect(reloaded?.createdAt).toBe('t0');
    expect(reloaded?.updatedAt).toBe('t1');
  });
});
