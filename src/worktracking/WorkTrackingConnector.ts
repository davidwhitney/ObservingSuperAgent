import type { WorkItem, WorkItemRef, Annotation } from '../domain/types';

/**
 * Adapter for a work-tracking tool (JIRA, etc.). Intentionally two methods:
 * one to pull work that is ready for dispatch, one to write back to an item.
 */
export interface WorkTrackingConnector {
  /** Stable name of this connector, e.g. "jira". */
  readonly name: string;

  /** Retrieve the work items currently eligible for dispatch. */
  RetrieveWorkReadyForDispatch(): Promise<WorkItem[]>;

  /** Leave commentary and/or apply lifecycle changes (tags, transitions) on an item. */
  AnnotateItem(ref: WorkItemRef, annotation: Annotation): Promise<void>;
}
