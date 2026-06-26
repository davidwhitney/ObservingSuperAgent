import { describe, it, expect } from 'vitest';
import { createApp } from '../../src/api/server';
import { buildTestSystem, planResponder } from '../helpers/system';

function appFor(system: ReturnType<typeof buildTestSystem>) {
  return createApp({
    orchestrator: system.orchestrator,
    poller: system.poller,
    reconciler: system.reconciler,
    memory: system.memory,
  });
}

describe('HTTP API', () => {
  it('GET /health returns ok', async () => {
    const app = appFor(buildTestSystem());
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('POST /dispatch runs a cycle and POST /poll + GET /status reflect it', async () => {
    const system = buildTestSystem({ responder: planResponder(['acme/x']) });
    system.tracker.seed({ id: '1', projectId: 'ENG', key: 'ENG-1', title: 'thing', tags: ['agent-ready'] });
    const app = appFor(system);

    const dispatch = await app.request('/dispatch', { method: 'POST' });
    expect(dispatch.status).toBe(200);
    expect(await dispatch.json()).toMatchObject({ considered: 1, dispatched: 1 });

    const status = await app.request('/status');
    const statusBody = (await status.json()) as { count: number; records: Array<{ status: string }> };
    expect(statusBody.count).toBe(1);
    expect(statusBody.records[0]!.status).toBe('dispatched');

    const poll = await app.request('/poll', { method: 'POST' });
    expect(await poll.json()).toMatchObject({ polled: 1 });
  });

  it('POST /reconcile defaults to dry-run; ?apply=true repairs', async () => {
    const system = buildTestSystem({ responder: planResponder(['acme/x']) });
    system.tracker.seed({ id: '1', projectId: 'ENG', key: 'ENG-1', title: 'thing', tags: ['agent-ready'] });
    const app = appFor(system);
    await app.request('/dispatch', { method: 'POST' });

    const record = (await system.memory.all())[0]!;
    system.agent.complete(record.runs[0]!.agentRunId);

    const dry = await app.request('/reconcile', { method: 'POST' });
    expect(await dry.json()).toMatchObject({ apply: false, drifted: 1, repaired: 0 });
    expect((await system.memory.get(record.id))?.status).toBe('dispatched');

    const applied = await app.request('/reconcile?apply=true', { method: 'POST' });
    expect(await applied.json()).toMatchObject({ apply: true, repaired: 1 });
    expect((await system.memory.get(record.id))?.status).toBe('completed');
  });
});
