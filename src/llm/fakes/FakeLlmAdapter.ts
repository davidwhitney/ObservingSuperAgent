import type { LlmAdapter, LlmRequest, LlmResponse } from '../LlmAdapter';

export type FakeResponder = (request: LlmRequest) => string;

/**
 * Deterministic {@link LlmAdapter} for tests and local fakes-first wiring.
 * Records every request and returns whatever the responder produces (default:
 * a valid JSON dispatch plan). Also exposes the MCP servers it was handed so
 * tests can assert the GitHub MCP server was attached.
 */
export class FakeLlmAdapter implements LlmAdapter {
  readonly name = 'fake';
  readonly requests: LlmRequest[] = [];

  constructor(private readonly responder: FakeResponder = defaultResponder) {}

  async complete(request: LlmRequest): Promise<LlmResponse> {
    this.requests.push(request);
    return { content: this.responder(request) };
  }
}

const defaultResponder: FakeResponder = () =>
  JSON.stringify({
    repositories: ['octo-org/sample-repo'],
    prompt: 'Implement the requested change and open a pull request.',
    summary: 'Single-repo change.',
  });
