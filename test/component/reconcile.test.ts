import { describe, it, expect } from 'vitest';
import { buildTestSystem, planResponder } from '../helpers/system';

/** Seed + dispatch one item, returning the system and its record. */
async function dispatched() {
  const system = buildTestSystem({ responder: planResponder(['acme/x']) });
  system.tracker.seed({ id: '1', projectId: 'ENG', key: 'ENG-1', title: 'thing', tags: ['agent-ready'] });
  await system.orchestrator.runDispatchCycle();
  const record = (await system.memory.all())[0]!;
  return { system, record };
}

describe('Reconciler', () => {
  it('reports an in-sync record with no actions', async () => {
    const { system } = await dispatched();
    const summary = await system.reconciler.reconcile(); // dry-run

    expect(summary).toMatchObject({ apply: false, scanned: 1, inSync: 1, drifted: 0, repaired: 0 });
    expect(summary.entries[0]!.actions).toEqual([]);
  });

  it('detects an agent that finished out of band without changing anything (dry-run)', async () => {
    const { system, record } = await dispatched();
    system.agent.complete(record.runs[0]!.agentRunId, 'https://example.test/pull/1');

    const dry = await system.reconciler.reconcile();

    expect(dry.drifted).toBe(1);
    expect(dry.repaired).toBe(0);
    expect(dry.entries[0]).toMatchObject({ recordedStatus: 'dispatched', derivedStatus: 'completed', applied: false });
    // Nothing was written.
    expect((await system.memory.get(record.id))?.status).toBe('dispatched');
    expect(system.tracker.get('1')!.tags).toContain('agent-acting');
  });

  it('repairs the record and the work item when apply=true', async () => {
    const { system, record } = await dispatched();
    system.agent.complete(record.runs[0]!.agentRunId, 'https://example.test/pull/1');

    const applied = await system.reconciler.reconcile({ apply: true });

    expect(applied).toMatchObject({ apply: true, repaired: 1 });
    expect((await system.memory.get(record.id))?.status).toBe('completed');
    const item = system.tracker.get('1')!;
    expect(item.tags).toContain('agent-complete');
    expect(item.tags).not.toContain('agent-acting');
    expect(system.comms.typesSeen()).toContain('completed');

    // Idempotent: a second pass finds nothing to do.
    const second = await system.reconciler.reconcile({ apply: true });
    expect(second).toMatchObject({ drifted: 0, repaired: 0, inSync: 1 });
  });

  it('re-asserts downstream state edited out of band (tag removed by a human)', async () => {
    const { system, record } = await dispatched();
    system.agent.complete(record.runs[0]!.agentRunId);
    await system.reconciler.reconcile({ apply: true }); // -> completed, agent-complete

    // A human deletes the complete tag.
    const item = system.tracker.get('1')!;
    item.tags = item.tags.filter((t) => t !== 'agent-complete');

    const dry = await system.reconciler.reconcile();
    expect(dry.entries[0]!.downstreamDrift).toBe(true);

    await system.reconciler.reconcile({ apply: true });
    expect(system.tracker.get('1')!.tags).toContain('agent-complete');
  });

  it('flags a record whose agent run failed', async () => {
    const { system, record } = await dispatched();
    system.agent.setStatus({ agentRunId: record.runs[0]!.agentRunId, state: 'failed' });

    const summary = await system.reconciler.reconcile({ apply: true });
    expect(summary.entries[0]!.derivedStatus).toBe('failed');
    expect((await system.memory.get(record.id))?.status).toBe('failed');
  });
});
