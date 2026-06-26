import { AgentMemory } from '../../src/memory/AgentMemory';
import { InMemoryStorage } from '../../src/memory/InMemoryStorage';
import { InMemoryWorkTrackingConnector } from '../../src/worktracking/fakes/InMemoryWorkTrackingConnector';
import { InMemoryAgentConnector } from '../../src/agents/fakes/InMemoryAgentConnector';
import { FakeLlmAdapter, type FakeResponder } from '../../src/llm/fakes/FakeLlmAdapter';
import { Planner } from '../../src/llm/Planner';
import { RecordingCommunicationAdapter } from '../../src/comms/fakes/RecordingCommunicationAdapter';
import { Orchestrator } from '../../src/orchestrator/Orchestrator';
import { Poller } from '../../src/orchestrator/Poller';
import { Reconciler } from '../../src/orchestrator/Reconciler';
import type { McpServerRef } from '../../src/mcp/McpConfig';

export interface TestSystemOptions {
  tracker?: InMemoryWorkTrackingConnector;
  responder?: FakeResponder;
  mcpServers?: McpServerRef[];
}

/** Wire a complete super-agent on in-memory fakes for component tests. */
export function buildTestSystem(options: TestSystemOptions = {}) {
  const tracker = options.tracker ?? new InMemoryWorkTrackingConnector();
  const agent = new InMemoryAgentConnector();
  const llm = new FakeLlmAdapter(options.responder);
  const planner = new Planner(llm, options.mcpServers ?? []);
  const comms = new RecordingCommunicationAdapter();

  let tick = 0;
  const clock = () => `2026-01-01T00:00:${String(tick++).padStart(2, '0')}.000Z`;
  const memory = new AgentMemory(new InMemoryStorage(), clock);

  const orchestrator = new Orchestrator({ connectors: [tracker], planner, agent, memory, comms });
  const poller = new Poller({ connectors: [tracker], agent, memory, comms });
  const reconciler = new Reconciler({ connectors: [tracker], agent, memory, comms });

  return { tracker, agent, llm, planner, comms, memory, orchestrator, poller, reconciler };
}

/** A responder that returns a valid plan for the given repositories. */
export function planResponder(repositories: string[], prompt = 'Do the work.'): FakeResponder {
  return () => JSON.stringify({ action: 'plan', repositories, prompt, summary: 'test plan' });
}

/** A responder that asks the given clarifying questions instead of planning. */
export function questionsResponder(...questions: string[]): FakeResponder {
  return () => JSON.stringify({ action: 'ask', questions });
}
