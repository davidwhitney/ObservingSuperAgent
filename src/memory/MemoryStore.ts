/**
 * A minimal text key/value store. Concrete implementations back this with the
 * local disk, Azure blob storage, or memory. Higher-level structure (the
 * dispatch records) is layered on top by {@link AgentMemory}.
 */
export interface MemoryStore {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  /** List all keys currently held. */
  list(): Promise<string[]>;
  delete(key: string): Promise<void>;
}
