import type { LlmAdapter, LlmRequest, LlmResponse } from './LlmAdapter';
import type { LlmConfig } from '../config/schema';
import { NotImplementedError } from '../composition/errors';

/** Runs the planning model via the local GitHub Copilot CLI. Wiring deferred. */
export class GitHubCopilotCliAdapter implements LlmAdapter {
  readonly name = 'github-copilot-cli';
  constructor(private readonly config: LlmConfig) {}
  async complete(_request: LlmRequest): Promise<LlmResponse> {
    throw new NotImplementedError('GitHubCopilotCliAdapter');
  }
}
