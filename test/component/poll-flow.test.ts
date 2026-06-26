import { describe, it, expect } from 'vitest';
import { buildTestSystem, planResponder } from '../helpers/system';

async function dispatchOne() {
  const system = buildTestSystem({ responder: planResponder(['acme/x']) });
  system.tracker.seed({ id: '1', projectId: 'ENG', key: 'ENG-1', title: 'thing', tags: ['agent-ready'] });
  await system.orchestrator.runDispatchCycle();
  const record = (await system.memory.all())[0]!;
  return { system, record };
}

describe('poller poll cycle', () => {
  it('does nothing when there is no dispatched work', async () => {
    const system = buildTestSystem();
    const summary = await system.poller.runPollCycle();
    expect(summary).toMatchObject({ polled: 0, linked: 0, completed: 0 });
  });

  it('keeps a record dispatched while the run is still in progress', async () => {
    const { system, record } = await dispatchOne();

    const summary = await system.poller.runPollCycle();

    expect(summary).toMatchObject({ polled: 1, completed: 0 });
    expect((await system.memory.get(record.id))?.status).toBe('dispatched');
    // No PR yet -> no completion, item is in the acting state (not complete).
    expect(system.tracker.get('1')!.tags).toContain('agent-acting');
    expect(system.tracker.get('1')!.tags).not.toContain('agent-complete');
  });

  it('posts the PR link comment only once across cycles', async () => {
    const { system, record } = await dispatchOne();
    system.agent.complete(record.runs[0]!.agentRunId, 'https://example.test/pull/1');

    await system.poller.runPollCycle();
    await system.poller.runPollCycle();

    const linkComments = system.tracker.comments().filter((c) => c.includes('pull request'));
    expect(linkComments).toHaveLength(1);
    expect(system.comms.typesSeen().filter((t) => t === 'linked')).toHaveLength(1);
  });

  it('moves to done (Done column) when the PR is merged', async () => {
    const { system, record } = await dispatchOne();
    const runId = record.runs[0]!.agentRunId;

    system.agent.complete(runId); // ready for review
    await system.poller.runPollCycle(); // -> completed (in review)
    expect((await system.memory.get(record.id))?.status).toBe('completed');

    system.agent.markMerged(runId);
    const summary = await system.poller.runPollCycle();

    expect(summary).toMatchObject({ done: 1, rejected: 0 });
    expect((await system.memory.get(record.id))?.status).toBe('done');
    const item = system.tracker.get('1')!;
    expect(item.status).toBe('Done');
    expect(item.tags).not.toContain('agent-acting');
  });

  it('rejects (Done column + reviewer-rejected tag) when the PR is closed unmerged', async () => {
    const { system, record } = await dispatchOne();
    system.agent.markRejected(record.runs[0]!.agentRunId);

    const summary = await system.poller.runPollCycle();

    expect(summary).toMatchObject({ rejected: 1, done: 0 });
    expect((await system.memory.get(record.id))?.status).toBe('rejected');
    const item = system.tracker.get('1')!;
    expect(item.status).toBe('Done');
    expect(item.tags).toContain('reviewer-rejected');
  });

  it('keeps polling an in-review record until it resolves', async () => {
    const { system, record } = await dispatchOne();
    system.agent.complete(record.runs[0]!.agentRunId);
    await system.poller.runPollCycle(); // -> completed (non-terminal)

    // Still pollable, so a later merge is picked up.
    const pollable = await system.memory.recordsToPoll();
    expect(pollable.map((r) => r.id)).toContain(record.id);
  });

  it('marks the record failed when an agent run fails', async () => {
    const { system, record } = await dispatchOne();
    system.agent.setStatus({ agentRunId: record.runs[0]!.agentRunId, state: 'failed', detail: 'boom' });

    const summary = await system.poller.runPollCycle();

    expect(summary.failed).toBe(1);
    expect((await system.memory.get(record.id))?.status).toBe('failed');
    expect(system.tracker.get('1')!.tags).not.toContain('agent-complete'); // not completed
    expect(system.tracker.get('1')!.tags).toContain('agent-acting'); // left in the acting state
  });
});
