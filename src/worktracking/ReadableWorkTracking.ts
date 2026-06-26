import type { WorkItem, WorkItemRef } from '../domain/types';
import type { WorkTrackingConnector } from './WorkTrackingConnector';

/**
 * Optional capability: read a single work item by reference. Used by the
 * reconciler to detect drift between a recorded item and its live downstream
 * state. Kept separate from the core two-method connector contract.
 */
export interface ReadableWorkTracking {
  getItem(ref: WorkItemRef): Promise<WorkItem | null>;
}

export function isReadable(
  connector: WorkTrackingConnector,
): connector is WorkTrackingConnector & ReadableWorkTracking {
  return typeof (connector as Partial<ReadableWorkTracking>).getItem === 'function';
}
