import type { WorkTrackingConnector } from '../worktracking/WorkTrackingConnector';
import type { AgentConnector } from '../agents/AgentConnector';
import type { CommunicationAdapter } from '../comms/CommunicationAdapter';
import type { AgentMemory } from '../memory/AgentMemory';
import { hasLifecyclePolicy } from '../worktracking/LifecyclePolicy';
import {
  DEFAULT_LIFECYCLE_SETTINGS,
  annotationForStage,
  type LifecycleStage,
} from '../worktracking/lifecycleAnnotations';
import type {
  AgentRunState,
  Annotation,
  CommEventType,
  DispatchRecord,
  DispatchRecordStatus,
  WorkItemRef,
} from '../domain/types';

/** Lifecycle stages are a subset of the record statuses that carry an annotation. */
const STAGE_FOR_STATUS: Partial<Record<DispatchRecordStatus, LifecycleStage>> = {
  dispatched: 'dispatched',
  completed: 'completed',
  done: 'done',
  rejected: 'rejected',
};

export interface LifecycleDeps {
  agent: AgentConnector;
  memory: AgentMemory;
  comms: CommunicationAdapter;
}

export interface ResolveResult {
  before: DispatchRecordStatus;
  after: DispatchRecordStatus;
  statusChanged: boolean;
  /** A PR is open but its link comment has not been posted yet. */
  pendingLink: boolean;
  /** Whether this pass wrote anything (only possible when apply=true). */
  applied: boolean;
}

/** Derive the record status from its runs' states. Precedence: failed > rejected > done > in-review > dispatched. */
export function deriveRecordStatus(
  states: AgentRunState[],
  runCount: number,
  current: DispatchRecordStatus,
): DispatchRecordStatus {
  if (runCount === 0) return current;
  if (states.some((s) => s === 'failed')) return 'failed';
  if (states.some((s) => s === 'rejected')) return 'rejected';
  if (states.every((s) => s === 'merged')) return 'done';
  if (states.every((s) => s === 'completed' || s === 'merged')) return 'completed';
  return 'dispatched';
}

/** The annotation a connector would apply for a given record status, or undefined if none. */
export function expectedAnnotationFor(
  connector: WorkTrackingConnector,
  ref: WorkItemRef,
  status: DispatchRecordStatus,
): Annotation | undefined {
  const stage = STAGE_FOR_STATUS[status];
  if (!stage) return undefined;
  return hasLifecyclePolicy(connector)
    ? connector.annotationFor(ref, stage)
    : annotationForStage(DEFAULT_LIFECYCLE_SETTINGS, stage);
}

interface Transition {
  annotation?: Annotation;
  comment: string;
  event: CommEventType;
}

function transitionInto(
  connector: WorkTrackingConnector,
  ref: WorkItemRef,
  status: DispatchRecordStatus,
): Transition | undefined {
  switch (status) {
    case 'completed':
      return { annotation: expectedAnnotationFor(connector, ref, status), comment: '✅ Agent work is up for review.', event: 'completed' };
    case 'done':
      return { annotation: expectedAnnotationFor(connector, ref, status), comment: '🎉 PR merged — work done.', event: 'done' };
    case 'rejected':
      return { annotation: expectedAnnotationFor(connector, ref, status), comment: '🚫 PR closed without merging (reviewer rejected).', event: 'rejected' };
    case 'failed':
      return { comment: 'One or more agent runs failed.', event: 'failed' };
    default:
      return undefined;
  }
}

/**
 * The single source of truth for advancing a record: refresh its agent runs,
 * derive the correct status, and — when `apply` — post any pending PR link
 * comment and the work-tracking transition for the new status, persisting the
 * record. With `apply=false` it only reports what would change (no writes).
 */
export async function resolveRecord(
  connector: WorkTrackingConnector,
  deps: LifecycleDeps,
  record: DispatchRecord,
  apply: boolean,
): Promise<ResolveResult> {
  const before = record.status;
  const fresh = await Promise.all(
    record.runs.map(async (run) => ({ run, status: await deps.agent.getStatus(run.agentRunId) })),
  );
  const after = deriveRecordStatus(fresh.map((f) => f.status.state), record.runs.length, before);
  const pendingLink = fresh.some((f) => f.status.prUrl && !f.run.linkAnnounced);
  const statusChanged = after !== before;

  if (!apply) {
    return { before, after, statusChanged, pendingLink, applied: false };
  }

  let applied = false;

  for (const { run, status } of fresh) {
    if (status.issueUrl) run.issueUrl ??= status.issueUrl;
    if (status.prUrl) run.prUrl = status.prUrl;
    run.state = status.state;
    if (run.prUrl && !run.linkAnnounced) {
      await connector.AnnotateItem(record.workItem, { comment: linkComment(run.repository, run.prUrl) });
      run.linkAnnounced = true;
      applied = true;
      await deps.comms.notify({ type: 'linked', workItemKey: record.workItem.key, message: `Linked PR ${run.prUrl} for ${run.repository}` });
    }
  }

  if (statusChanged) {
    record.status = after;
    applied = true;
    const transition = transitionInto(connector, record.workItem, after);
    if (transition) {
      if (transition.annotation) {
        await connector.AnnotateItem(record.workItem, { ...transition.annotation, comment: transition.comment });
      }
      await deps.comms.notify({ type: transition.event, workItemKey: record.workItem.key, message: transition.comment });
    }
  }

  if (applied) await deps.memory.save(record);
  return { before, after, statusChanged, pendingLink: false, applied };
}

export function linkComment(repository: string, prUrl: string): string {
  return `🔗 Agent opened a pull request for ${repository}: ${prUrl}`;
}

/** Index connectors by their name for lookup by record. */
export function connectorsByName(
  connectors: WorkTrackingConnector[],
): Map<string, WorkTrackingConnector> {
  return new Map(connectors.map((c) => [c.name, c]));
}
