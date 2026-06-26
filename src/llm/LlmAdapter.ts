import type { McpServerRef } from '../mcp/McpConfig';

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmRequest {
  messages: LlmMessage[];
  /** MCP servers the model may use for extra context (e.g. GitHub). */
  mcpServers?: McpServerRef[];
  model?: string;
  /** Hint that the caller expects a JSON object back. */
  responseFormat?: 'text' | 'json';
}

export interface LlmResponse {
  content: string;
}

/**
 * Abstraction over where the planning model executes. Lets us swap between
 * Azure Foundry, Foundry Local, the GitHub Copilot CLI, or a test fake.
 */
export interface LlmAdapter {
  readonly name: string;
  complete(request: LlmRequest): Promise<LlmResponse>;
}
