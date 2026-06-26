import { describe, it, expect } from 'vitest';
import { Planner, parsePlan, PlanningError } from '../../src/llm/Planner';
import { FakeLlmAdapter } from '../../src/llm/fakes/FakeLlmAdapter';
import type { WorkItem } from '../../src/domain/types';

const item: WorkItem = {
  connector: 'jira',
  projectId: 'ENG',
  id: '1',
  key: 'ENG-1',
  title: 'Title',
  description: 'Body',
  tags: ['agent-ready'],
  status: 'To Do',
};

describe('parsePlan', () => {
  it('extracts a JSON plan even with surrounding prose', () => {
    const plan = parsePlan('Here is the plan:\n{"repositories":["a/b"],"prompt":"go"}\nThanks!');
    expect(plan).toEqual({ repositories: ['a/b'], prompt: 'go' });
  });

  it('rejects responses without a valid plan', () => {
    expect(() => parsePlan('no json here')).toThrow(PlanningError);
    expect(() => parsePlan('{"repositories":[],"prompt":"x"}')).toThrow(PlanningError);
    expect(() => parsePlan('{"prompt":"missing repos"}')).toThrow(PlanningError);
  });
});

describe('Planner', () => {
  it('produces a plan and forwards MCP servers and item context to the LLM', async () => {
    const llm = new FakeLlmAdapter();
    const planner = new Planner(llm, [{ name: 'github', url: 'https://mcp' }]);

    const plan = await planner.plan(item);

    expect(plan.repositories).toEqual(['octo-org/sample-repo']);
    expect(llm.requests[0]?.mcpServers?.[0]?.name).toBe('github');
    expect(llm.requests[0]?.messages.at(-1)?.content).toContain('ENG-1');
  });

  it('tells the model the owner and to verify repos via tools (never invent)', async () => {
    const llm = new FakeLlmAdapter();
    const planner = new Planner(llm, [{ name: 'github', url: 'https://mcp' }], { githubOwner: 'davidwhitney' });

    await planner.plan(item);
    const system = llm.requests[0]!.messages[0]!.content;

    expect(system).toContain('davidwhitney');
    expect(system).toMatch(/tools/i);
    expect(system).toMatch(/never invent|verif/i);
  });

  it('omits tool instructions when no GitHub MCP server is configured', async () => {
    const llm = new FakeLlmAdapter();
    await new Planner(llm, [], { githubOwner: 'davidwhitney' }).plan(item);
    const system = llm.requests[0]!.messages[0]!.content;

    expect(system).toContain('davidwhitney');
    expect(system).not.toMatch(/MUST use them/);
  });
});
