import type { JiraConfig } from '../config/schema';
import type { WorkItem } from '../domain/types';
import type { LifecycleSettings } from './lifecycleAnnotations';

/** Resolve the lifecycle settings for a project: defaultConfig overlaid with any per-project override. */
export function effectiveConfig(jira: JiraConfig, projectId: string): LifecycleSettings {
  const base = jira.defaultConfig;
  const override = jira.projectConfig[projectId];
  if (!override) return base;
  return {
    readyTag: override.readyTag ?? base.readyTag,
    actingTag: override.actingTag ?? base.actingTag,
    completeTag: override.completeTag ?? base.completeTag,
    doneTag: override.doneTag ?? base.doneTag,
    rejectedTag: override.rejectedTag ?? base.rejectedTag,
    readyColumns: override.readyColumns ?? base.readyColumns,
    actingColumn: override.actingColumn ?? base.actingColumn,
    completeColumn: override.completeColumn ?? base.completeColumn,
    doneColumn: override.doneColumn ?? base.doneColumn,
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
