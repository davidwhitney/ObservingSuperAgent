import { describe, it, expect } from 'vitest';
import { FoundryLocalAdapter } from '../../src/llm/FoundryLocalAdapter';
import { Planner } from '../../src/llm/Planner';
import { fakeFetch } from '../helpers/fakeFetch';
import { FakeMcpToolProvider } from '../../src/mcp/fakes/FakeMcpToolProvider';
import type { WorkItem } from '../../src/domain/types';

/** A fakeFetch that returns a queued response per call. */
function queuedFetch(responses: unknown[]) {
  let i = 0;
  return fakeFetch(() => ({ body: responses[i++] }));
}

function toolCallResponse(name: string, args: string) {
  return { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name, arguments: args } }] } }] };
}

function contentResponse(content: string) {
  return { choices: [{ message: { role: 'assistant', content } }] };
}

const item: WorkItem = {
  connector: 'jira',
  projectId: 'ENG',
  id: '1',
  key: 'ENG-1',
  title: 'Add retries',
  description: 'Add retry logic to the client',
  tags: ['agent-ready'],
  status: 'To Do',
};

describe('FoundryLocalAdapter', () => {
  it('calls the OpenAI-compatible chat completions endpoint and returns content', async () => {
    const { fn, calls } = fakeFetch(() => ({
      body: { choices: [{ message: { content: '{"repositories":["acme/x"],"prompt":"go"}' } }] },
    }));
    const adapter = new FoundryLocalAdapter(
      { provider: 'foundry-local', autoStart: true, endpoint: 'http://localhost:5273/v1/', model: 'phi-4', apiKey: 'k' },
      { fetchFn: fn },
    );

    const result = await adapter.complete({ messages: [{ role: 'user', content: 'hi' }] });

    expect(result.content).toContain('acme/x');
    expect(calls[0]!.url).toBe('http://localhost:5273/v1/chat/completions');
    expect(calls[0]!.body).toMatchObject({ model: 'phi-4', messages: [{ role: 'user', content: 'hi' }] });
  });

  it('drives the Planner end-to-end', async () => {
    const { fn } = fakeFetch(() => ({
      body: { choices: [{ message: { content: 'Plan: {"repositories":["acme/api"],"prompt":"add retries"}' } }] },
    }));
    const adapter = new FoundryLocalAdapter(
      { provider: 'foundry-local', autoStart: true, endpoint: 'http://localhost:5273/v1', model: 'phi-4' },
      { fetchFn: fn },
    );

    const plan = await new Planner(adapter).plan(item);
    expect(plan.repositories).toEqual(['acme/api']);
  });

  it('errors clearly when endpoint or model is missing', async () => {
    await expect(
      new FoundryLocalAdapter({ provider: 'foundry-local', autoStart: true, model: 'm' }).complete({ messages: [] }),
    ).rejects.toThrow(/endpoint/);
    await expect(
      new FoundryLocalAdapter({ provider: 'foundry-local', autoStart: true, endpoint: 'http://x' }).complete({ messages: [] }),
    ).rejects.toThrow(/model/);
  });

  it('runs an MCP tool-call loop before producing the final plan', async () => {
    const provider = new FakeMcpToolProvider([
      { server: 'github', name: 'search_code', inputSchema: { type: 'object' }, handler: () => 'found foo.ts in acme/api' },
    ]);
    const { fn, calls } = queuedFetch([
      toolCallResponse('github__search_code', '{"q":"retry"}'),
      contentResponse('{"repositories":["acme/api"],"prompt":"add retries"}'),
    ]);
    const adapter = new FoundryLocalAdapter(
      { provider: 'foundry-local', autoStart: true, endpoint: 'http://x', model: 'm' },
      { fetchFn: fn, toolProvider: provider },
    );

    const result = await adapter.complete({
      messages: [{ role: 'user', content: 'plan' }],
      mcpServers: [{ name: 'github', url: 'http://mcp' }],
    });

    expect(result.content).toContain('acme/api');
    expect(provider.calls).toEqual([{ server: 'github', name: 'search_code', args: { q: 'retry' } }]);

    const firstBody = calls[0]!.body as { tools: Array<{ function: { name: string } }> };
    expect(firstBody.tools[0]!.function.name).toBe('github__search_code');

    const secondBody = calls[1]!.body as { messages: Array<{ role: string; content: string }> };
    expect(secondBody.messages.some((m) => m.role === 'tool' && m.content.includes('foo.ts'))).toBe(true);
  });

  it('does not offer tools when no MCP servers are on the request', async () => {
    const provider = new FakeMcpToolProvider([
      { server: 'github', name: 'search_code', inputSchema: {}, handler: () => 'x' },
    ]);
    const { fn, calls } = queuedFetch([contentResponse('{"repositories":["acme/api"],"prompt":"p"}')]);
    const adapter = new FoundryLocalAdapter(
      { provider: 'foundry-local', autoStart: true, endpoint: 'http://x', model: 'm' },
      { fetchFn: fn, toolProvider: provider },
    );

    await adapter.complete({ messages: [{ role: 'user', content: 'plan' }] });

    expect((calls[0]!.body as Record<string, unknown>).tools).toBeUndefined();
    expect(provider.calls).toHaveLength(0);
  });

  it('throws on a non-ok response', async () => {
    const { fn } = fakeFetch(() => ({ status: 500, body: { error: 'boom' } }));
    const adapter = new FoundryLocalAdapter(
      { provider: 'foundry-local', autoStart: true, endpoint: 'http://x', model: 'm' },
      { fetchFn: fn },
    );
    await expect(adapter.complete({ messages: [] })).rejects.toThrow(/500/);
  });
});
