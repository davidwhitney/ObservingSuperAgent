import type { WorkTrackingConnector } from '../WorkTrackingConnector';
import type { LifecyclePolicy } from '../LifecyclePolicy';
import type { ReadableWorkTracking } from '../ReadableWorkTracking';
import type { Annotation, WorkItem, WorkItemRef } from '../../domain/types';
import {
  DEFAULT_LIFECYCLE_SETTINGS,
  annotationForStage,
  type LifecycleSettings,
  type LifecycleStage,
} from '../lifecycleAnnotations';

export type InMemoryWorkTrackingOptions = Partial<LifecycleSettings> & {
  name?: string;
  /** Columns that exist on this fake's board; transitions pick the first match. */
  boardColumns?: string[];
};

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
  private readonly settings: LifecycleSettings;
  private readonly boardColumns: string[] | undefined;

  constructor(options: InMemoryWorkTrackingOptions = {}) {
    const { name, boardColumns, ...settings } = options;
    this.name = name ?? 'fake-tracker';
    this.boardColumns = boardColumns;
    this.settings = { ...DEFAULT_LIFECYCLE_SETTINGS, ...settings };
  }

  /** Add an item, defaulting connector/tags so tests can pass partial items. */
  seed(item: Partial<WorkItem> & Pick<WorkItem, 'id' | 'projectId' | 'title'>): WorkItem {
    const full: WorkItem = {
      connector: this.name,
      key: item.key ?? item.id,
      url: item.url ?? `https://tracker.test/${item.id}`,
      description: item.description ?? '',
      tags: item.tags ?? [this.settings.readyTag],
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
      (item) =>
        item.tags.includes(this.settings.readyTag) || this.settings.readyColumns.includes(item.status),
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
    if (annotation.transitionTo?.length) {
      const target = this.boardColumns
        ? annotation.transitionTo.find((c) => this.boardColumns!.includes(c))
        : annotation.transitionTo[0];
      if (target) item.status = target;
    }
  }

  annotationFor(_ref: WorkItemRef, stage: LifecycleStage): Annotation {
    return annotationForStage(this.settings, stage);
  }

  /** All comments recorded across annotations, for assertions. */
  comments(): string[] {
    return this.annotations.flatMap((a) => (a.annotation.comment ? [a.annotation.comment] : []));
  }
}
