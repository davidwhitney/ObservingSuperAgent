import type { LlmAdapter, LlmRequest, LlmResponse } from './LlmAdapter';
import type { LlmConfig } from '../config/schema';
import type { McpToolProvider } from '../mcp/McpToolProvider';

export interface FoundryLocalOptions {
  fetchFn?: typeof fetch;
  /** When set, MCP tools are offered to the model and calls are executed. */
  toolProvider?: McpToolProvider;
  /** Max tool-call rounds before giving up (default 6). */
  maxToolRounds?: number;
}

interface OpenAiToolCall {
  id: string;
  function: { name: string; arguments: string };
}

interface OpenAiMessage {
  role: string;
  content?: string | null;
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: OpenAiMessage }>;
}

const TOOL_NAME_SEPARATOR = '__';

/**
 * Runs the planning model on Foundry Local via its OpenAI-compatible chat
 * completions API. `config.endpoint` is the API base (e.g.
 * `http://localhost:5273/v1`); requests go to `${base}/chat/completions`.
 *
 * When an {@link McpToolProvider} is supplied, the MCP servers' tools are offered
 * to the model as OpenAI function tools and a tool-call loop is run so the model
 * can, for example, browse GitHub repositories before producing its plan.
 */
export class FoundryLocalAdapter implements LlmAdapter {
  readonly name = 'foundry-local';
  private readonly fetchFn: typeof fetch;
  private readonly toolProvider?: McpToolProvider;
  private readonly maxToolRounds: number;

  constructor(
    private readonly config: LlmConfig,
    options: FoundryLocalOptions = {},
  ) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.toolProvider = options.toolProvider;
    this.maxToolRounds = options.maxToolRounds ?? 6;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    if (!this.config.endpoint) {
      throw new Error('foundry-local requires llm.endpoint (e.g. http://localhost:5273/v1)');
    }
    const model = request.model ?? this.config.model;
    if (!model) {
      throw new Error('foundry-local requires a model (llm.model or request.model)');
    }

    const useTools = Boolean(this.toolProvider && request.mcpServers?.length);
    const tools = useTools ? await this.buildTools() : [];

    const messages: OpenAiMessage[] = request.messages.map((m) => ({ role: m.role, content: m.content }));

    for (let round = 0; round <= this.maxToolRounds; round++) {
      const message = await this.chat(model, messages, tools);
      const toolCalls = message.tool_calls ?? [];

      if (toolCalls.length === 0 || round === this.maxToolRounds) {
        return { content: message.content ?? '' };
      }

      // Echo the assistant's tool-call turn, then append each tool result.
      messages.push({ role: 'assistant', content: message.content ?? '', tool_calls: toolCalls });
      for (const call of toolCalls) {
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: await this.runTool(call),
        });
      }
    }

    return { content: '' };
  }

  private async buildTools(): Promise<unknown[]> {
    const mcpTools = await this.toolProvider!.listTools();
    return mcpTools.map((tool) => ({
      type: 'function',
      function: {
        name: `${tool.server}${TOOL_NAME_SEPARATOR}${tool.name}`,
        description: tool.description,
        parameters: tool.inputSchema ?? { type: 'object', properties: {} },
      },
    }));
  }

  private async runTool(call: OpenAiToolCall): Promise<string> {
    const [server, ...rest] = call.function.name.split(TOOL_NAME_SEPARATOR);
    const name = rest.join(TOOL_NAME_SEPARATOR);
    let args: unknown = {};
    try {
      args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
    } catch {
      return 'Error: tool arguments were not valid JSON';
    }
    try {
      return await this.toolProvider!.callTool(server ?? '', name, args);
    } catch (err) {
      return `Error calling ${call.function.name}: ${(err as Error).message}`;
    }
  }

  private async chat(model: string, messages: OpenAiMessage[], tools: unknown[]): Promise<OpenAiMessage> {
    const base = this.config.endpoint!.replace(/\/$/, '');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.config.apiKey) headers.Authorization = `Bearer ${this.config.apiKey}`;

    const body: Record<string, unknown> = { model, messages };
    if (tools.length > 0) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }

    const response = await this.fetchFn(`${base}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Foundry Local request failed: ${response.status} ${text}`);
    }

    const data = (await response.json()) as ChatCompletionResponse;
    const message = data.choices?.[0]?.message;
    if (!message) {
      throw new Error('Foundry Local response did not contain a message');
    }
    return message;
  }
}
