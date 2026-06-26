import type { Annotation, WorkItemRef } from '../domain/types';
import type { WorkTrackingConnector } from './WorkTrackingConnector';
import type { LifecycleStage } from './lifecycleAnnotations';

/**
 * Optional capability a connector may implement to describe how an item should
 * be moved through its lifecycle stages (picked up, in review, merged, closed).
 * The orchestrator/poller use it when present; otherwise they fall back to
 * {@link DEFAULT_LIFECYCLE_SETTINGS}. Kept separate from the two-method
 * {@link WorkTrackingConnector} contract so the core surface stays minimal.
 */
export interface LifecyclePolicy {
  annotationFor(ref: WorkItemRef, stage: LifecycleStage): Annotation;
}

export function hasLifecyclePolicy(
  connector: WorkTrackingConnector,
): connector is WorkTrackingConnector & LifecyclePolicy {
  return typeof (connector as Partial<LifecyclePolicy>).annotationFor === 'function';
}
