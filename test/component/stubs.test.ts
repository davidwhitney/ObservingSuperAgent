import { describe, it, expect } from 'vitest';
import { AzureBlobStorage } from '../../src/memory/AzureBlobStorage';
import { AzureFoundryAdapter } from '../../src/llm/AzureFoundryAdapter';
import { GitHubCopilotCliAdapter } from '../../src/llm/GitHubCopilotCliAdapter';
import { TeamsCommunicationAdapter } from '../../src/comms/TeamsCommunicationAdapter';
import { SlackCommunicationAdapter } from '../../src/comms/SlackCommunicationAdapter';
import { NotImplementedError } from '../../src/composition/errors';

describe('deferred adapters throw NotImplementedError', () => {
  it('AzureBlobStorage', async () => {
    await expect(new AzureBlobStorage({ container: 'c' }).read('k')).rejects.toBeInstanceOf(NotImplementedError);
  });

  it('LLM adapters', async () => {
    const req = { messages: [] };
    await expect(new AzureFoundryAdapter({ provider: 'azure-foundry', autoStart: true }).complete(req)).rejects.toBeInstanceOf(NotImplementedError);
    await expect(new GitHubCopilotCliAdapter({ provider: 'github-copilot-cli', autoStart: true }).complete(req)).rejects.toBeInstanceOf(NotImplementedError);
  });

  it('communication adapters', async () => {
    const event = { type: 'info', message: 'hi' } as const;
    await expect(new TeamsCommunicationAdapter({}).notify(event)).rejects.toBeInstanceOf(NotImplementedError);
    await expect(new SlackCommunicationAdapter({}).notify(event)).rejects.toBeInstanceOf(NotImplementedError);
  });
});
