import type { WorkTrackingConnector } from '../WorkTrackingConnector';
import type { LifecyclePolicy } from '../LifecyclePolicy';
import type { ReadableWorkTracking } from '../ReadableWorkTracking';
import type { Annotation, WorkItem, WorkItemRef } from '../../domain/types';

export interface InMemoryWorkTrackingOptions {
  name?: string;
  readyTag?: string;
  actingTag?: string;
  completeTag?: string;
  doneTag?: string;
  rejectedTag?: string;
  readyColumns?: string[];
  actingColumn?: string;
  completeColumn?: string;
  doneColumn?: string;
}

/**
 * In-memory {@link WorkTrackingConnector} for component tests and fakes-first
 * wiring. Selects work by ready tag or column, records every annotation, and
 * applies tag/column changes back onto its stored items so the lifecycle is
 * observable end-to-end.
 */
export class InMemoryWorkTrackingConnector
  implements WorkTrackingConnector, LifecyclePolicy, ReadableWorkTracking
{
  readonly name: string;
  readonly annotations: Array<{ ref: WorkItemRef; annotation: Annotation }> = [];
  private readonly items = new Map<string, WorkItem>();
  private readonly readyTag: string;
  private readonly actingTag: string;
  private readonly completeTag: string;
  private readonly doneTag: string | undefined;
  private readonly rejectedTag: string;
  private readonly readyColumns: string[];
  private readonly actingColumn: string | undefined;
  private readonly completeColumn: string | undefined;
  private readonly doneColumn: string;

  constructor(options: InMemoryWorkTrackingOptions = {}) {
    this.name = options.name ?? 'fake-tracker';
    this.readyTag = options.readyTag ?? 'agent-ready';
    this.actingTag = options.actingTag ?? 'agent-acting';
    this.completeTag = options.completeTag ?? 'agent-complete';
    this.doneTag = options.doneTag;
    this.rejectedTag = options.rejectedTag ?? 'reviewer-rejected';
    this.readyColumns = options.readyColumns ?? [];
    this.actingColumn = options.actingColumn;
    this.completeColumn = options.completeColumn;
    this.doneColumn = options.doneColumn ?? 'Done';
  }

  /** Add an item, defaulting connector/tags so tests can pass partial items. */
  seed(item: Partial<WorkItem> & Pick<WorkItem, 'id' | 'projectId' | 'title'>): WorkItem {
    const full: WorkItem = {
      connector: this.name,
      key: item.key ?? item.id,
      url: item.url ?? `https://tracker.test/${item.id}`,
      description: item.description ?? '',
      tags: item.tags ?? [this.readyTag],
      status: item.status ?? 'Ready',
      ...item,
    };
    this.items.set(full.id, full);
    return full;
  }

  get(id: string): WorkItem | undefined {
    return this.items.get(id);
  }

  async getItem(ref: WorkItemRef): Promise<WorkItem | null> {
    return this.items.get(ref.id) ?? null;
  }

  async RetrieveWorkReadyForDispatch(): Promise<WorkItem[]> {
    return [...this.items.values()].filter(
      (item) => item.tags.includes(this.readyTag) || this.readyColumns.includes(item.status),
    );
  }

  async AnnotateItem(ref: WorkItemRef, annotation: Annotation): Promise<void> {
    this.annotations.push({ ref, annotation });
    const item = this.items.get(ref.id);
    if (!item) return;
    const removed = new Set(annotation.removeTags ?? []);
    item.tags = item.tags.filter((tag) => !removed.has(tag));
    for (const tag of annotation.addTags ?? []) {
      if (!item.tags.includes(tag)) item.tags.push(tag);
    }
    if (annotation.transitionTo) item.status = annotation.transitionTo;
  }

  dispatchAnnotationFor(_ref: WorkItemRef): Annotation {
    const annotation: Annotation = {
      removeTags: [this.readyTag],
      addTags: [this.actingTag],
    };
    if (this.actingColumn) annotation.transitionTo = this.actingColumn;
    return annotation;
  }

  completionAnnotationFor(_ref: WorkItemRef): Annotation {
    const annotation: Annotation = {
      removeTags: [this.readyTag, this.actingTag],
      addTags: [this.completeTag],
    };
    if (this.completeColumn) annotation.transitionTo = this.completeColumn;
    return annotation;
  }

  doneAnnotationFor(_ref: WorkItemRef): Annotation {
    return {
      removeTags: [this.readyTag, this.actingTag],
      addTags: this.doneTag ? [this.doneTag] : [],
      transitionTo: this.doneColumn,
    };
  }

  rejectedAnnotationFor(_ref: WorkItemRef): Annotation {
    return {
      removeTags: [this.readyTag, this.actingTag],
      addTags: [this.rejectedTag],
      transitionTo: this.doneColumn,
    };
  }

  /** All comments recorded across annotations, for assertions. */
  comments(): string[] {
    return this.annotations.flatMap((a) => (a.annotation.comment ? [a.annotation.comment] : []));
  }
}
