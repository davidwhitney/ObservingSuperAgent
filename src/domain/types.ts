/**
 * Core domain types shared across every layer. These deliberately avoid any
 * dependency on concrete adapters so the orchestrator can be exercised purely
 * against in-memory fakes.
 */

/** Minimal identity of a work-tracking item, sufficient to annotate it later. */
export interface WorkItemRef {
  /** Name of the connector that owns the item, e.g. "jira". */
  connector: string;
  /** Project the item belongs to (used for exclusions and per-project config). */
  projectId: string;
  /** Stable internal id of the item. */
  id: string;
  /** Human-facing key, e.g. "ENG-123". */
  key?: string;
  /** Canonical URL to the item, if known. */
  url?: string;
}

/** A unit of work retrieved from a work-tracking tool. */
export interface WorkItem extends WorkItemRef {
  title: string;
  description: string;
  /** Labels / tags applied to the item. */
  tags: string[];
  /** Current column / status name. */
  status: string;
}

/**
 * A mutation to apply to a work item. Carries free-text commentary and/or
 * structured lifecycle changes so the connector contract stays at two methods
 * (RetrieveWorkReadyForDispatch + AnnotateItem) while still supporting the
 * tag/column moves required on completion.
 */
export interface Annotation {
  comment?: string;
  addTags?: string[];
  removeTags?: string[];
  /** Target column / status to transition the item to. */
  transitionTo?: string;
}

/** Output of the planning step: which repos to change and the prompt to drive the agent. */
export interface DispatchPlan {
  repositories: string[];
  prompt: string;
  /** Short human summary of the plan, used in commentary / notifications. */
  summary?: string;
}

/**
 * Lifecycle of a single agent run, tracking the PR it produces:
 * `completed` means "ready for review" (not yet merged); `merged`/`rejected`
 * are the post-review outcomes.
 */
export type AgentRunState =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'merged'
  | 'rejected'
  | 'failed';

/** Status of a single dispatched agent run, returned by an AgentConnector. */
export interface AgentRunStatus {
  agentRunId: string;
  state: AgentRunState;
  /** URL of the PR the agent opened, once available. */
  prUrl?: string;
  /** URL of the issue / task created to drive the agent. */
  issueUrl?: string;
  detail?: string;
}

/**
 * Status of a dispatch record. `completed` = the agent's PR is up for review
 * (still polled); `done` = merged; `rejected` = closed without merging.
 */
export type DispatchRecordStatus =
  | 'planned'
  | 'dispatched'
  | 'completed'
  | 'done'
  | 'rejected'
  | 'failed';

/** One agent dispatch (a single repository) within a dispatch record. */
export interface DispatchRun {
  repository: string;
  agentConnector: string;
  agentRunId: string;
  state: AgentRunState;
  prUrl?: string;
  issueUrl?: string;
  /** Whether we have already posted the ticket<->work link comment. */
  linkAnnounced: boolean;
}

/**
 * The agent's durable memory of one work item it has acted on. Persisted as
 * text (JSON) via a MemoryStore so progress survives restarts and can be
 * monitored / polled later.
 */
export interface DispatchRecord {
  id: string;
  connector: string;
  workItem: WorkItemRef;
  projectId: string;
  plan: DispatchPlan;
  runs: DispatchRun[];
  status: DispatchRecordStatus;
  createdAt: string;
  updatedAt: string;
}

export type CommEventType =
  | 'planned'
  | 'dispatched'
  | 'linked'
  | 'completed'
  | 'done'
  | 'rejected'
  | 'failed'
  | 'info';

/** A notification emitted to communication adapters. */
export interface CommEvent {
  type: CommEventType;
  message: string;
  workItemKey?: string;
  data?: Record<string, unknown>;
}
