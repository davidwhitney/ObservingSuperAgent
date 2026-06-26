import { describe, it, expect } from 'vitest';
import { Planner, parseOutcome, PlanningError } from '../../src/llm/Planner';
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
  comments: [],
};

describe('parseOutcome', () => {
  it('extracts a JSON plan even with surrounding prose', () => {
    const outcome = parseOutcome('Here is the plan:\n{"repositories":["a/b"],"prompt":"go"}\nThanks!');
    expect(outcome).toEqual({ kind: 'plan', plan: { repositories: ['a/b'], prompt: 'go' } });
  });

  it('parses a clarification request', () => {
    const outcome = parseOutcome('{"action":"ask","questions":["Which repo?","What is the acceptance criteria?"]}');
    expect(outcome).toEqual({ kind: 'questions', questions: ['Which repo?', 'What is the acceptance criteria?'] });
  });

  it('rejects responses without a valid plan or questions', () => {
    expect(() => parseOutcome('no json here')).toThrow(PlanningError);
    expect(() => parseOutcome('{"repositories":[],"prompt":"x"}')).toThrow(PlanningError);
    expect(() => parseOutcome('{"prompt":"missing repos"}')).toThrow(PlanningError);
  });
});

describe('Planner', () => {
  it('produces a plan and forwards MCP servers + the conversation to the LLM', async () => {
    const llm = new FakeLlmAdapter();
    const planner = new Planner(llm, [{ name: 'github', url: 'https://mcp' }]);

    const withComments: WorkItem = { ...item, comments: [{ author: 'alice', body: 'use the api repo', createdAt: '' }] };
    const outcome = await planner.plan(withComments);

    expect(outcome).toEqual({ kind: 'plan', plan: { repositories: ['octo-org/sample-repo'], prompt: 'Implement the requested change and open a pull request.', summary: 'Single-repo change.' } });
    expect(llm.requests[0]?.mcpServers?.[0]?.name).toBe('github');
    const userMsg = llm.requests[0]!.messages.at(-1)!.content;
    expect(userMsg).toContain('ENG-1');
    expect(userMsg).toContain('alice: use the api repo'); // comment thread is included
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
