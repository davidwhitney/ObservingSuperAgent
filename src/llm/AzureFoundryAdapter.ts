import type { LlmAdapter, LlmRequest, LlmResponse } from './LlmAdapter';
import type { LlmConfig } from '../config/schema';
import { NotImplementedError } from '../composition/errors';

/** Runs the planning model on Azure AI Foundry. Wiring deferred. */
export class AzureFoundryAdapter implements LlmAdapter {
  readonly name = 'azure-foundry';
  constructor(private readonly config: LlmConfig) {}
  async complete(_request: LlmRequest): Promise<LlmResponse> {
    throw new NotImplementedError('AzureFoundryAdapter');
  }
}
