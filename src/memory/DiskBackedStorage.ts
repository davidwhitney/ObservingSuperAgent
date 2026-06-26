import { mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { MemoryStore } from './MemoryStore';

/**
 * Disk-backed {@link MemoryStore} for local development. Each key is stored as
 * a single file under `directory`; the filename is the URL-encoded key so any
 * key is safe on disk. The directory is created lazily on first write.
 */
export class DiskBackedStorage implements MemoryStore {
  private ready: Promise<void> | undefined;

  constructor(private readonly directory: string) {}

  private ensureDir(): Promise<void> {
    return (this.ready ??= mkdir(this.directory, { recursive: true }).then(() => undefined));
  }

  private fileFor(key: string): string {
    return join(this.directory, `${encodeURIComponent(key)}.txt`);
  }

  async read(key: string): Promise<string | null> {
    try {
      return await readFile(this.fileFor(key), 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async write(key: string, value: string): Promise<void> {
    await this.ensureDir();
    await writeFile(this.fileFor(key), value, 'utf8');
  }

  async list(): Promise<string[]> {
    try {
      const files = await readdir(this.directory);
      return files
        .filter((f) => f.endsWith('.txt'))
        .map((f) => decodeURIComponent(f.slice(0, -'.txt'.length)));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.fileFor(key), { force: true });
  }
}
