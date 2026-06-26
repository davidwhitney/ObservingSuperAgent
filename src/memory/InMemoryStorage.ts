import type { MemoryStore } from './MemoryStore';

/** A non-durable {@link MemoryStore} used by tests and the fakes-first wiring. */
export class InMemoryStorage implements MemoryStore {
  private readonly data = new Map<string, string>();

  async read(key: string): Promise<string | null> {
    return this.data.get(key) ?? null;
  }

  async write(key: string, value: string): Promise<void> {
    this.data.set(key, value);
  }

  async list(): Promise<string[]> {
    return [...this.data.keys()];
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }
}
