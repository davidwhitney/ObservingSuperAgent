import type { AgentRunStatus, WorkItemRef } from '../domain/types';

export interface DispatchInput {
  /** "owner/name" repository the agent is expected to have access to. */
  repository: string;
  /** The fully-formed prompt describing the work. */
  prompt: string;
  /** The originating work item, for cross-linking. */
  workItem: WorkItemRef;
}

export interface DispatchResult {
  /** Opaque id used to poll this run later. */
  agentRunId: string;
  issueUrl?: string;
}

/**
 * Adapter for an agent runtime that performs the work and ultimately opens a
 * PR. The default runtime is GitHub Copilot.
 */
export interface AgentConnector {
  readonly name: string;
  dispatch(input: DispatchInput): Promise<DispatchResult>;
  getStatus(agentRunId: string): Promise<AgentRunStatus>;
}
