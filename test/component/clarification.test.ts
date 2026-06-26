import { describe, it, expect } from 'vitest';
import { buildTestSystem } from '../helpers/system';

describe('planner clarification loop', () => {
  it('asks on the ticket, waits for a reply, then dispatches once answered', async () => {
    // Asks the first time it evaluates the item; plans on every later evaluation.
    let answered = false;
    const responder = () => {
      if (answered) return JSON.stringify({ action: 'plan', repositories: ['acme/x'], prompt: 'go' });
      answered = true;
      return JSON.stringify({ action: 'ask', questions: ['Which repository should I change?'] });
    };

    const system = buildTestSystem({ responder });
    system.tracker.seed({ id: '1', projectId: 'ENG', key: 'ENG-1', title: 'vague request', tags: ['agent-ready'] });

    // Cycle 1: planner asks for clarification.
    const c1 = await system.orchestrator.runDispatchCycle();
    expect(c1).toMatchObject({ considered: 1, asked: 1, dispatched: 0 });

    const record = await system.memory.get('fake-tracker:1');
    expect(record?.status).toBe('clarifying');
    expect(record?.clarification?.questions).toEqual(['Which repository should I change?']);
    expect(system.tracker.comments().some((c) => c.includes('clarification'))).toBe(true);
    expect(system.tracker.get('1')!.tags).toContain('agent-ready'); // stays ready, not dispatched
    expect(system.agent.dispatched).toHaveLength(0);
    expect(system.comms.typesSeen()).toContain('asked');

    // Cycle 2: no reply yet -> skipped, and crucially NOT re-asked (no duplicate comment).
    const c2 = await system.orchestrator.runDispatchCycle();
    expect(c2).toMatchObject({ considered: 1, skipped: 1, asked: 0, dispatched: 0 });
    expect(system.tracker.comments().filter((c) => c.includes('clarification'))).toHaveLength(1);

    // A human replies on the ticket.
    system.tracker.addComment('1', 'David', 'Please change acme/x');

    // Cycle 3: re-evaluates with the reply and dispatches.
    const c3 = await system.orchestrator.runDispatchCycle();
    expect(c3).toMatchObject({ considered: 1, dispatched: 1 });
    expect(system.agent.dispatched).toHaveLength(1);
    expect((await system.memory.get('fake-tracker:1'))?.status).toBe('dispatched');
  });
});
