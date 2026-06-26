import type { MemoryStore } from './MemoryStore';
import { NotImplementedError } from '../composition/errors';

export interface AzureBlobStorageOptions {
  connectionString?: string;
  container: string;
}

/**
 * Azure blob-backed {@link MemoryStore} for cloud deployment. Declared here as
 * the deployment target; wiring the Azure SDK is deferred, so every method
 * throws {@link NotImplementedError}.
 */
export class AzureBlobStorage implements MemoryStore {
  constructor(private readonly options: AzureBlobStorageOptions) {}

  async read(_key: string): Promise<string | null> {
    throw new NotImplementedError('AzureBlobStorage');
  }

  async write(_key: string, _value: string): Promise<void> {
    throw new NotImplementedError('AzureBlobStorage');
  }

  async list(): Promise<string[]> {
    throw new NotImplementedError('AzureBlobStorage');
  }

  async delete(_key: string): Promise<void> {
    throw new NotImplementedError('AzureBlobStorage');
  }
}
