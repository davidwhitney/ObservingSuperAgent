import { describe, it, expect } from 'vitest';
import { buildTestSystem, planResponder } from '../helpers/system';
import { InMemoryWorkTrackingConnector } from '../../src/worktracking/fakes/InMemoryWorkTrackingConnector';

describe('orchestrator dispatch cycle', () => {
  it('dispatches one agent run per planned repository', async () => {
    const system = buildTestSystem({ responder: planResponder(['acme/api', 'acme/web']) });
    system.tracker.seed({ id: '7', projectId: 'ENG', key: 'ENG-7', title: 'Cross-repo change', tags: ['agent-ready'] });

    const summary = await system.orchestrator.runDispatchCycle();

    expect(summary.dispatched).toBe(1);
    expect(system.agent.dispatched.map((d) => d.repository)).toEqual(['acme/api', 'acme/web']);
  });

  it('only selects items matching the ready tag or column', async () => {
    const tracker = new InMemoryWorkTrackingConnector({ readyColumns: ['Ready for Agent'] });
    tracker.seed({ id: 'a', projectId: 'ENG', title: 'tagged', tags: ['agent-ready'] });
    tracker.seed({ id: 'b', projectId: 'ENG', title: 'column', tags: [], status: 'Ready for Agent' });
    tracker.seed({ id: 'c', projectId: 'ENG', title: 'neither', tags: ['backlog'], status: 'To Do' });
    const system = buildTestSystem({ tracker, responder: planResponder(['acme/x']) });

    const summary = await system.orchestrator.runDispatchCycle();

    expect(summary.considered).toBe(2);
    expect(summary.dispatched).toBe(2);
  });

  it('records a failure and notifies when planning produces invalid output', async () => {
    const system = buildTestSystem({ responder: () => 'sorry, I cannot help with that' });
    system.tracker.seed({ id: '9', projectId: 'ENG', key: 'ENG-9', title: 'Bad plan', tags: ['agent-ready'] });

    const summary = await system.orchestrator.runDispatchCycle();

    expect(summary).toMatchObject({ considered: 1, dispatched: 0, failed: 1 });
    expect(system.agent.dispatched).toHaveLength(0);
    expect(system.comms.typesSeen()).toContain('failed');
  });

  it('passes the configured MCP servers to the planning LLM', async () => {
    const system = buildTestSystem({
      responder: planResponder(['acme/x']),
      mcpServers: [{ name: 'github', url: 'https://api.githubcopilot.com/mcp/' }],
    });
    system.tracker.seed({ id: '1', projectId: 'ENG', title: 'thing', tags: ['agent-ready'] });

    await system.orchestrator.runDispatchCycle();

    expect(system.llm.requests[0]?.mcpServers?.map((s) => s.name)).toContain('github');
  });
});
