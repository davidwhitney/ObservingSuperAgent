import type { MemoryStore } from './MemoryStore';
import type { DispatchRecord, WorkItemRef } from '../domain/types';

const RECORD_PREFIX = 'record:';

/** Stable record id for a work item, used as both the memory key and record id. */
export function recordIdFor(ref: WorkItemRef): string {
  return `${ref.connector}:${ref.id}`;
}

/**
 * Durable history of the items the agent has acted on, layered over a
 * {@link MemoryStore}. Records are persisted as JSON text under `record:<id>`
 * keys so the raw store remains a plain text key/value store.
 */
export class AgentMemory {
  constructor(
    private readonly store: MemoryStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  private keyFor(id: string): string {
    return `${RECORD_PREFIX}${id}`;
  }

  async get(id: string): Promise<DispatchRecord | undefined> {
    const raw = await this.store.read(this.keyFor(id));
    return raw ? (JSON.parse(raw) as DispatchRecord) : undefined;
  }

  async save(record: DispatchRecord): Promise<void> {
    record.updatedAt = this.now();
    await this.store.write(this.keyFor(record.id), JSON.stringify(record, null, 2));
  }

  async all(): Promise<DispatchRecord[]> {
    const keys = await this.store.list();
    const records: DispatchRecord[] = [];
    for (const key of keys) {
      if (!key.startsWith(RECORD_PREFIX)) continue;
      const raw = await this.store.read(key);
      if (raw) records.push(JSON.parse(raw) as DispatchRecord);
    }
    return records;
  }

  async findByWorkItem(ref: WorkItemRef): Promise<DispatchRecord | undefined> {
    return this.get(recordIdFor(ref));
  }

  /** True if we have already planned or dispatched work for this item. */
  async hasActedOn(ref: WorkItemRef): Promise<boolean> {
    return (await this.findByWorkItem(ref)) !== undefined;
  }

  /**
   * Records still in flight — dispatched or up for review — that should be
   * polled. `done`, `rejected` and `failed` are terminal.
   */
  async recordsToPoll(): Promise<DispatchRecord[]> {
    return (await this.all()).filter((r) => r.status === 'dispatched' || r.status === 'completed');
  }

  /** Build (and timestamp) a fresh record without persisting it. */
  newRecord(input: Omit<DispatchRecord, 'createdAt' | 'updatedAt'>): DispatchRecord {
    const stamp = this.now();
    return { ...input, createdAt: stamp, updatedAt: stamp };
  }
}
