import type { WorkTrackingConnector } from '../WorkTrackingConnector';
import type { LifecyclePolicy } from '../LifecyclePolicy';
import type { ReadableWorkTracking } from '../ReadableWorkTracking';
import type { Annotation, WorkItem, WorkItemRef } from '../../domain/types';
import type { JiraConfig } from '../../config/schema';
import { JiraClient, adfToText, type JiraIssue } from './JiraClient';
import { effectiveConfig, isReady } from '../selection';
import { annotationForStage, type LifecycleStage } from '../lifecycleAnnotations';

/**
 * JIRA work-tracking connector. Selects work via tag ("agent-ready" by default)
 * or column heuristics, honouring opt-in/opt-out scope, project exclusions, and
 * per-project overrides. Implements {@link LifecyclePolicy} so the poller knows
 * how to move completed items.
 */
export class JiraConnector implements WorkTrackingConnector, LifecyclePolicy, ReadableWorkTracking {
  readonly name = 'jira';

  constructor(
    private readonly config: JiraConfig,
    private readonly client: JiraClient,
  ) {}

  async RetrieveWorkReadyForDispatch(): Promise<WorkItem[]> {
    const jql = this.buildJql();
    if (jql === '') return [];
    const issues = await this.client.search(jql);
    return issues.map((issue) => this.toWorkItem(issue)).filter((item) => isReady(this.config, item));
  }

  async AnnotateItem(ref: WorkItemRef, annotation: Annotation): Promise<void> {
    if (annotation.comment) {
      await this.client.addComment(ref.id, annotation.comment);
    }
    const add = annotation.addTags ?? [];
    const remove = annotation.removeTags ?? [];
    if (add.length || remove.length) {
      await this.client.updateLabels(ref.id, add, remove);
    }
    if (annotation.transitionTo?.length) {
      await this.client.transition(ref.id, annotation.transitionTo);
    }
  }

  async getItem(ref: WorkItemRef): Promise<WorkItem | null> {
    const issue = await this.client.getIssue(ref.id);
    return issue ? this.toWorkItem(issue) : null;
  }

  annotationFor(ref: WorkItemRef, stage: LifecycleStage): Annotation {
    return annotationForStage(effectiveConfig(this.config, ref.projectId), stage);
  }

  /** Build the JQL net. Precise per-project clauses for opt-in; global net for opt-out. */
  private buildJql(): string {
    const { config } = this;
    if (config.mode === 'opt-in') {
      const clauses = config.projectIds.map((projectId) => {
        const eff = effectiveConfig(config, projectId);
        return `(project = ${quote(projectId)} AND (${readyClause(eff.readyTag, eff.readyColumns)}))`;
      });
      return clauses.join(' OR ');
    }

    let jql = `(${readyClause(config.defaultConfig.readyTag, config.defaultConfig.readyColumns)})`;
    if (config.excludedProjectIds.length) {
      jql += ` AND project not in (${config.excludedProjectIds.map(quote).join(', ')})`;
    }
    return jql;
  }

  private toWorkItem(issue: JiraIssue): WorkItem {
    const projectId = issue.fields.project?.key ?? issue.fields.project?.id ?? '';
    return {
      connector: this.name,
      projectId,
      id: issue.id,
      key: issue.key,
      url: `${trimSlash(this.config.baseUrl)}/browse/${issue.key}`,
      title: issue.fields.summary ?? '',
      description: adfToText(issue.fields.description),
      tags: issue.fields.labels ?? [],
      status: issue.fields.status?.name ?? '',
    };
  }
}

function readyClause(readyTag: string, readyColumns: string[]): string {
  const parts = [`labels = ${quote(readyTag)}`];
  if (readyColumns.length) parts.push(`status in (${readyColumns.map(quote).join(', ')})`);
  return parts.join(' OR ');
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function trimSlash(value: string): string {
  return value.replace(/\/$/, '');
}
