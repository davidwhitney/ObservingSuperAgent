import type { Annotation } from '../domain/types';

/** The stages an item moves through once it has been selected for dispatch. */
export type LifecycleStage = 'dispatched' | 'completed' | 'done' | 'rejected';

/**
 * The tags and columns that define an item's lifecycle. A single source of
 * truth shared by the JIRA connector (resolved per project) and the in-memory
 * fake. Column fields are ordered candidate lists — the card moves to the first
 * that exists on its board.
 */
export interface LifecycleSettings {
  readyTag: string;
  actingTag: string;
  completeTag: string;
  /** Optional tag applied when the PR is merged. */
  doneTag?: string;
  rejectedTag: string;
  readyColumns: string[];
  actingColumn: string[];
  completeColumn: string[];
  doneColumn: string[];
}

export const DEFAULT_LIFECYCLE_SETTINGS: LifecycleSettings = {
  readyTag: 'agent-ready',
  actingTag: 'agent-acting',
  completeTag: 'agent-complete',
  rejectedTag: 'reviewer-rejected',
  readyColumns: [],
  actingColumn: [],
  completeColumn: [],
  doneColumn: ['Done'],
};

/** Build the annotation to apply when an item enters `stage`. */
export function annotationForStage(settings: LifecycleSettings, stage: LifecycleStage): Annotation {
  switch (stage) {
    case 'dispatched':
      return annotation([settings.readyTag], [settings.actingTag], settings.actingColumn);
    case 'completed':
      return annotation([settings.readyTag, settings.actingTag], [settings.completeTag], settings.completeColumn);
    case 'done':
      // Terminal: drop all in-flight tags; a merged card carries only doneTag (if set).
      return annotation(
        [settings.readyTag, settings.actingTag, settings.completeTag],
        settings.doneTag ? [settings.doneTag] : [],
        settings.doneColumn,
      );
    case 'rejected':
      // Terminal: drop all in-flight tags; a closed card carries only rejectedTag.
      return annotation(
        [settings.readyTag, settings.actingTag, settings.completeTag],
        [settings.rejectedTag],
        settings.doneColumn,
      );
  }
}

function annotation(removeTags: string[], addTags: string[], transitionTo: string[]): Annotation {
  const result: Annotation = { removeTags, addTags };
  if (transitionTo.length > 0) result.transitionTo = transitionTo;
  return result;
}
