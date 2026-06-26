import type { AgentConnector, DispatchInput, DispatchResult } from '../AgentConnector';
import type { AgentRunStatus } from '../../domain/types';

/**
 * In-memory {@link AgentConnector} for tests and fakes-first wiring. Dispatch
 * records the input and starts the run "in_progress"; tests drive completion
 * via {@link complete} / {@link setStatus}.
 */
export class InMemoryAgentConnector implements AgentConnector {
  readonly name = 'fake-agent';
  readonly dispatched: DispatchInput[] = [];
  private readonly statuses = new Map<string, AgentRunStatus>();
  private counter = 0;

  async dispatch(input: DispatchInput): Promise<DispatchResult> {
    this.counter += 1;
    const agentRunId = `fake-run-${this.counter}`;
    const issueUrl = `https://example.test/${input.repository}/issues/${this.counter}`;
    this.dispatched.push(input);
    this.statuses.set(agentRunId, { agentRunId, state: 'in_progress', issueUrl });
    return { agentRunId, issueUrl };
  }

  async getStatus(agentRunId: string): Promise<AgentRunStatus> {
    return (
      this.statuses.get(agentRunId) ?? {
        agentRunId,
        state: 'failed',
        detail: 'unknown run',
      }
    );
  }

  /** Test helper: mark a run's PR ready for review (state completed). */
  complete(agentRunId: string, prUrl = `https://example.test/pull/${agentRunId}`): void {
    const existing = this.statuses.get(agentRunId);
    this.statuses.set(agentRunId, { ...existing, agentRunId, state: 'completed', prUrl });
  }

  /** Test helper: mark a run's PR merged. */
  markMerged(agentRunId: string, prUrl = `https://example.test/pull/${agentRunId}`): void {
    const existing = this.statuses.get(agentRunId);
    this.statuses.set(agentRunId, { ...existing, agentRunId, state: 'merged', prUrl });
  }

  /** Test helper: mark a run's PR closed without merging. */
  markRejected(agentRunId: string, prUrl = `https://example.test/pull/${agentRunId}`): void {
    const existing = this.statuses.get(agentRunId);
    this.statuses.set(agentRunId, { ...existing, agentRunId, state: 'rejected', prUrl });
  }

  /** Test helper: set an arbitrary status. */
  setStatus(status: AgentRunStatus): void {
    this.statuses.set(status.agentRunId, status);
  }
}
