/** A tool exposed by an MCP server, normalised for use by an LLM adapter. */
export interface McpTool {
  /** Name of the server that owns the tool (e.g. "github"). */
  server: string;
  /** Tool name as advertised by the server. */
  name: string;
  description?: string;
  /** JSON Schema for the tool's arguments. */
  inputSchema: unknown;
}

/**
 * Supplies MCP tools to a planning LLM and executes tool calls on its behalf.
 * Implemented for real by {@link McpClientPool}; faked in tests.
 */
export interface McpToolProvider {
  /** List every tool across all connected servers. */
  listTools(): Promise<McpTool[]>;
  /** Invoke a tool and return its textual result. */
  callTool(server: string, name: string, args: unknown): Promise<string>;
  /** Release any underlying connections. */
  close(): Promise<void>;
}
