import type { JiraConfig } from '../config/schema';
import type { Annotation, WorkItem, WorkItemRef } from '../domain/types';

/** The selection / lifecycle config in effect for a given project. */
export interface EffectiveConfig {
  readyTag: string;
  actingTag: string;
  completeTag: string;
  doneTag?: string;
  rejectedTag: string;
  readyColumns: string[];
  actingColumn?: string;
  completeColumn?: string;
  doneColumn: string;
}

/** Resolve the effective config for a project, applying per-project overrides. */
export function effectiveConfig(jira: JiraConfig, projectId: string): EffectiveConfig {
  const override = jira.projectConfig[projectId];
  return {
    readyTag: override?.readyTag ?? jira.readyTag,
    actingTag: override?.actingTag ?? jira.actingTag,
    completeTag: override?.completeTag ?? jira.completeTag,
    doneTag: override?.doneTag ?? jira.doneTag,
    rejectedTag: override?.rejectedTag ?? jira.rejectedTag,
    readyColumns: override?.readyColumns ?? jira.readyColumns,
    actingColumn: override?.actingColumn ?? jira.actingColumn,
    completeColumn: override?.completeColumn ?? jira.completeColumn,
    doneColumn: override?.doneColumn ?? jira.doneColumn,
  };
}

/** Whether a project is in scope given opt-in / opt-out mode and exclusions. */
export function isProjectInScope(jira: JiraConfig, projectId: string): boolean {
  if (jira.excludedProjectIds.includes(projectId)) return false;
  if (jira.mode === 'opt-in') return jira.projectIds.includes(projectId);
  return true;
}

/** Whether an item is ready for dispatch (in scope and matching tag or column). */
export function isReady(jira: JiraConfig, item: WorkItem): boolean {
  if (!isProjectInScope(jira, item.projectId)) return false;
  const config = effectiveConfig(jira, item.projectId);
  const byTag = item.tags.includes(config.readyTag);
  const byColumn = config.readyColumns.includes(item.status);
  return byTag || byColumn;
}

/**
 * The annotation applied when the agent picks the item up: drop the ready tag,
 * add the acting tag, and move the card to the acting column if one is set.
 */
export function actingAnnotation(jira: JiraConfig, ref: Pick<WorkItemRef, 'projectId'>): Annotation {
  const config = effectiveConfig(jira, ref.projectId);
  const annotation: Annotation = {
    removeTags: [config.readyTag],
    addTags: [config.actingTag],
  };
  if (config.actingColumn) annotation.transitionTo = config.actingColumn;
  return annotation;
}

/**
 * The annotation that moves an item out of the in-flight state on completion:
 * drop the ready and acting tags, add the complete tag, and transition the card
 * if a completion column is configured.
 */
export function completionAnnotation(jira: JiraConfig, ref: Pick<WorkItemRef, 'projectId'>): Annotation {
  const config = effectiveConfig(jira, ref.projectId);
  const annotation: Annotation = {
    removeTags: [config.readyTag, config.actingTag],
    addTags: [config.completeTag],
  };
  if (config.completeColumn) annotation.transitionTo = config.completeColumn;
  return annotation;
}

/**
 * The annotation applied when the agent's PR is merged: move the card to the
 * done column, dropping the in-flight ready/acting tags. Adds the optional
 * done tag if configured.
 */
export function doneAnnotation(jira: JiraConfig, ref: Pick<WorkItemRef, 'projectId'>): Annotation {
  const config = effectiveConfig(jira, ref.projectId);
  return {
    removeTags: [config.readyTag, config.actingTag],
    addTags: config.doneTag ? [config.doneTag] : [],
    transitionTo: config.doneColumn,
  };
}

/**
 * The annotation applied when the PR is closed without merging: move to the
 * done column and tag it (default `reviewer-rejected`).
 */
export function rejectedAnnotation(jira: JiraConfig, ref: Pick<WorkItemRef, 'projectId'>): Annotation {
  const config = effectiveConfig(jira, ref.projectId);
  return {
    removeTags: [config.readyTag, config.actingTag],
    addTags: [config.rejectedTag],
    transitionTo: config.doneColumn,
  };
}
