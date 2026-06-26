import type { WorkTrackingConnector } from '../worktracking/WorkTrackingConnector';
import type { AgentConnector } from '../agents/AgentConnector';
import type { CommunicationAdapter } from '../comms/CommunicationAdapter';
import { AgentMemory } from '../memory/AgentMemory';
import { isReadable } from '../worktracking/ReadableWorkTracking';
import { expectedAnnotationFor, resolveRecord } from './lifecycle';
import type { Annotation, DispatchRecord, DispatchRecordStatus, WorkItem } from '../domain/types';

export interface ReconcilerDeps {
  connectors: WorkTrackingConnector[];
  agent: AgentConnector;
  memory: AgentMemory;
  comms: CommunicationAdapter;
}

export interface ReconcileOptions {
  /** Apply repairs. When false (default) the pass only reports drift. */
  apply?: boolean;
}

export interface ReconcileEntry {
  id: string;
  workItemKey?: string;
  recordedStatus: DispatchRecordStatus;
  derivedStatus: DispatchRecordStatus;
  downstreamDrift: boolean;
  /** Human-readable list of the drift found (empty means in sync). */
  actions: string[];
  /** Whether a repair was written for this record (only when apply=true). */
  applied: boolean;
}

export interface ReconcileSummary {
  apply: boolean;
  scanned: number;
  inSync: number;
  drifted: number;
  repaired: number;
  entries: ReconcileEntry[];
}

/**
 * Iterates every memory record and reconciles it against the live downstream
 * state: it re-derives the correct record status from the agent runs (via the
 * shared {@link resolveRecord}), detects drift between the record and the
 * actual work-tracking item, and — when `apply` — repairs both. Idempotent.
 * Useful during development and to absorb out-of-band edits to the data sources.
 */
export class Reconciler {
  private readonly connectorsByName: Map<string, WorkTrackingConnector>;

  constructor(private readonly deps: ReconcilerDeps) {
    this.connectorsByName = new Map(deps.connectors.map((c) => [c.name, c]));
  }

  async reconcile(options: ReconcileOptions = {}): Promise<ReconcileSummary> {
    const apply = options.apply ?? false;
    const records = await this.deps.memory.all();
    const entries: ReconcileEntry[] = [];
    for (const record of records) {
      entries.push(await this.reconcileRecord(record, apply));
    }
    return {
      apply,
      scanned: records.length,
      inSync: entries.filter((e) => e.actions.length === 0).length,
      drifted: entries.filter((e) => e.actions.length > 0).length,
      repaired: entries.filter((e) => e.applied).length,
      entries,
    };
  }

  private async reconcileRecord(record: DispatchRecord, apply: boolean): Promise<ReconcileEntry> {
    const actions: string[] = [];
    const entry: ReconcileEntry = {
      id: record.id,
      workItemKey: record.workItem.key,
      recordedStatus: record.status,
      derivedStatus: record.status,
      downstreamDrift: false,
      actions,
      applied: false,
    };

    const connector = this.connectorsByName.get(record.connector);
    if (!connector) {
      actions.push(`no connector "${record.connector}" configured`);
      return entry;
    }

    // 1. Re-derive + (optionally) advance the record through the shared resolver.
    const result = await resolveRecord(connector, this.deps, record, apply);
    entry.derivedStatus = result.after;
    if (record.status === 'planned' && record.runs.length === 0) {
      actions.push('planned but never dispatched (stuck)');
    }
    if (result.pendingLink) actions.push('PR opened but not yet linked');
    if (result.statusChanged) actions.push(`status ${result.before} -> ${result.after}`);
    let applied = result.applied;

    // 2. Verify the live work-tracking item matches the (derived) status.
    if (isReadable(connector)) {
      const item = await connector.getItem(record.workItem);
      if (!item) {
        entry.downstreamDrift = true;
        actions.push('work item not found in source');
      } else {
        const expected = expectedAnnotationFor(connector, record.workItem, result.after);
        if (expected && !downstreamMatches(item, expected)) {
          entry.downstreamDrift = true;
          actions.push('downstream tags/column drift');
          // Re-assert only when the status itself didn't change (otherwise the
          // transition above already wrote the correct downstream state).
          if (apply && !result.statusChanged) {
            await connector.AnnotateItem(record.workItem, expected);
            await this.deps.comms.notify({ type: 'info', workItemKey: record.workItem.key, message: 'Re-asserted downstream state.' });
            applied = true;
          }
        }
      }
    }

    entry.applied = applied;
    return entry;
  }
}

function downstreamMatches(item: WorkItem, expected: Annotation): boolean {
  for (const tag of expected.addTags ?? []) if (!item.tags.includes(tag)) return false;
  for (const tag of expected.removeTags ?? []) if (item.tags.includes(tag)) return false;
  if (expected.transitionTo && item.status !== expected.transitionTo) return false;
  return true;
}
