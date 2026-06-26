import type { Annotation, WorkItemRef } from '../domain/types';
import type { WorkTrackingConnector } from './WorkTrackingConnector';

/**
 * Optional capability a connector may implement to describe how an item should
 * be moved out of the ready state once its work completes. The poller uses it
 * when present; otherwise it falls back to a generic ready/complete tag swap.
 *
 * Kept separate from the two-method {@link WorkTrackingConnector} contract so
 * the core adapter surface stays minimal.
 */
export interface LifecyclePolicy {
  /** How to mark an item when the agent picks it up (dispatch). */
  dispatchAnnotationFor(ref: WorkItemRef): Annotation;
  /** How to mark an item when the agent's PR is up for review. */
  completionAnnotationFor(ref: WorkItemRef): Annotation;
  /** How to mark an item when the PR is merged. */
  doneAnnotationFor(ref: WorkItemRef): Annotation;
  /** How to mark an item when the PR is closed without merging. */
  rejectedAnnotationFor(ref: WorkItemRef): Annotation;
}

export function hasLifecyclePolicy(
  connector: WorkTrackingConnector,
): connector is WorkTrackingConnector & LifecyclePolicy {
  const c = connector as Partial<LifecyclePolicy>;
  return (
    typeof c.completionAnnotationFor === 'function' &&
    typeof c.dispatchAnnotationFor === 'function' &&
    typeof c.doneAnnotationFor === 'function' &&
    typeof c.rejectedAnnotationFor === 'function'
  );
}

/** The generic acting annotation used when a connector has no policy. */
export const DEFAULT_ACTING: Annotation = {
  removeTags: ['agent-ready'],
  addTags: ['agent-acting'],
};

/** The generic completion (in-review) annotation used when a connector has no policy. */
export const DEFAULT_COMPLETION: Annotation = {
  removeTags: ['agent-ready', 'agent-acting'],
  addTags: ['agent-complete'],
};

/** The generic done (merged) annotation used when a connector has no policy. */
export const DEFAULT_DONE: Annotation = {
  removeTags: ['agent-ready', 'agent-acting'],
  transitionTo: 'Done',
};

/** The generic rejected (closed-unmerged) annotation used when a connector has no policy. */
export const DEFAULT_REJECTED: Annotation = {
  removeTags: ['agent-ready', 'agent-acting'],
  addTags: ['reviewer-rejected'],
  transitionTo: 'Done',
};
