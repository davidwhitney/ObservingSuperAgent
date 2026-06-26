import type { McpTool, McpToolProvider } from '../McpToolProvider';

export interface FakeToolDef extends McpTool {
  /** Handler returning the tool's textual result. */
  handler: (args: unknown) => string;
}

/** In-memory {@link McpToolProvider} for tests; records every tool call. */
export class FakeMcpToolProvider implements McpToolProvider {
  readonly calls: Array<{ server: string; name: string; args: unknown }> = [];
  closed = false;

  constructor(private readonly tools: FakeToolDef[]) {}

  async listTools(): Promise<McpTool[]> {
    return this.tools.map(({ server, name, description, inputSchema }) => ({
      server,
      name,
      description,
      inputSchema,
    }));
  }

  async callTool(server: string, name: string, args: unknown): Promise<string> {
    this.calls.push({ server, name, args });
    const tool = this.tools.find((t) => t.server === server && t.name === name);
    if (!tool) throw new Error(`No fake tool ${server}/${name}`);
    return tool.handler(args);
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}
