import { describe, it, expect } from 'vitest';
import { buildTestSystem, planResponder } from '../helpers/system';
import { recordIdFor } from '../../src/memory/AgentMemory';

describe('full dispatch → poll → complete lifecycle', () => {
  it('dispatches ready work, links the PR, and moves the item to complete', async () => {
    const system = buildTestSystem({ responder: planResponder(['acme/widgets']) });
    system.tracker.seed({ id: '1', projectId: 'ENG', key: 'ENG-1', title: 'Add a thing', tags: ['agent-ready'] });

    // 1. Dispatch.
    const dispatch = await system.orchestrator.runDispatchCycle();
    expect(dispatch).toMatchObject({ considered: 1, dispatched: 1, skipped: 0, failed: 0 });

    expect(system.agent.dispatched).toHaveLength(1);
    expect(system.agent.dispatched[0]).toMatchObject({ repository: 'acme/widgets', prompt: 'Do the work.' });

    const record = await system.memory.get(recordIdFor({ connector: 'fake-tracker', projectId: 'ENG', id: '1' }));
    expect(record?.status).toBe('dispatched');
    expect(record?.runs).toHaveLength(1);
    expect(system.tracker.comments().some((c) => c.includes('dispatched'))).toBe(true);
    expect(system.comms.typesSeen()).toEqual(['planned', 'dispatched']);

    // Picked up by the agent: ready tag dropped, acting tag applied.
    const afterDispatch = system.tracker.get('1')!;
    expect(afterDispatch.tags).not.toContain('agent-ready');
    expect(afterDispatch.tags).toContain('agent-acting');

    // 2. Agent finishes its work and opens a PR.
    const runId = record!.runs[0]!.agentRunId;
    system.agent.complete(runId, 'https://example.test/pull/42');

    // 3. Poll.
    const poll = await system.poller.runPollCycle();
    expect(poll).toMatchObject({ polled: 1, linked: 1, completed: 1, failed: 0 });

    const item = system.tracker.get('1')!;
    expect(item.tags).not.toContain('agent-ready');
    expect(item.tags).not.toContain('agent-acting');
    expect(item.tags).toContain('agent-complete');

    const finished = await system.memory.get(record!.id);
    expect(finished?.status).toBe('completed');
    expect(finished?.runs[0]?.prUrl).toBe('https://example.test/pull/42');

    expect(system.tracker.comments().some((c) => c.includes('pull request'))).toBe(true);
    expect(system.comms.typesSeen()).toContain('linked');
    expect(system.comms.typesSeen()).toContain('completed');
  });

  it('does not re-dispatch: the item leaves the ready state once picked up', async () => {
    const system = buildTestSystem({ responder: planResponder(['acme/widgets']) });
    system.tracker.seed({ id: '1', projectId: 'ENG', key: 'ENG-1', title: 'Add a thing', tags: ['agent-ready'] });

    await system.orchestrator.runDispatchCycle();
    const second = await system.orchestrator.runDispatchCycle();

    // The acting tag swap removes it from the ready set, so it isn't even retrieved.
    expect(second).toMatchObject({ considered: 0, dispatched: 0 });
    expect(system.agent.dispatched).toHaveLength(1);
  });

  it('still skips an item that is ready again but already in memory', async () => {
    const system = buildTestSystem({ responder: planResponder(['acme/widgets']) });
    system.tracker.seed({ id: '1', projectId: 'ENG', key: 'ENG-1', title: 'Add a thing', tags: ['agent-ready'] });

    await system.orchestrator.runDispatchCycle();
    // Simulate someone re-applying the ready tag.
    await system.tracker.AnnotateItem(
      { connector: 'fake-tracker', projectId: 'ENG', id: '1' },
      { addTags: ['agent-ready'] },
    );

    const second = await system.orchestrator.runDispatchCycle();
    expect(second).toMatchObject({ considered: 1, skipped: 1, dispatched: 0 });
    expect(system.agent.dispatched).toHaveLength(1);
  });
});
