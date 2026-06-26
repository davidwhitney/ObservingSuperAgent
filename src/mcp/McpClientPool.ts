import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { McpServerRef } from './McpConfig';
import type { McpTool, McpToolProvider } from './McpToolProvider';

/**
 * Connects to a set of MCP servers and exposes their tools to a planning LLM.
 * URL servers use the Streamable HTTP transport (with a bearer token from the
 * server's `GITHUB_TOKEN`/`AUTHORIZATION` env); command servers use stdio.
 * Connections are established lazily on first use and reused thereafter.
 */
export class McpClientPool implements McpToolProvider {
  private readonly clients = new Map<string, Client>();
  private connecting: Promise<void> | undefined;

  constructor(private readonly servers: McpServerRef[]) {}

  private connectAll(): Promise<void> {
    return (this.connecting ??= (async () => {
      for (const server of this.servers) {
        const client = new Client({ name: 'observing-super-agent', version: '0.1.0' });
        await client.connect(transportFor(server));
        this.clients.set(server.name, client);
      }
    })());
  }

  async listTools(): Promise<McpTool[]> {
    await this.connectAll();
    const tools: McpTool[] = [];
    for (const [server, client] of this.clients) {
      const result = await client.listTools();
      for (const tool of result.tools) {
        tools.push({
          server,
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        });
      }
    }
    return tools;
  }

  async callTool(server: string, name: string, args: unknown): Promise<string> {
    await this.connectAll();
    const client = this.clients.get(server);
    if (!client) throw new Error(`Unknown MCP server "${server}"`);
    const result = await client.callTool({
      name,
      arguments: (args ?? {}) as Record<string, unknown>,
    });
    return extractText(result);
  }

  async close(): Promise<void> {
    for (const client of this.clients.values()) {
      await client.close().catch(() => undefined);
    }
    this.clients.clear();
    this.connecting = undefined;
  }
}

function transportFor(server: McpServerRef): StreamableHTTPClientTransport | StdioClientTransport {
  if (server.url) {
    const headers: Record<string, string> = {};
    const token = server.env?.GITHUB_TOKEN ?? server.env?.AUTHORIZATION;
    if (token) headers.Authorization = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
    return new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers } });
  }
  if (server.command) {
    return new StdioClientTransport({
      command: server.command,
      args: server.args ?? [],
      env: server.env,
    });
  }
  throw new Error(`MCP server "${server.name}" must define a url or command`);
}

function extractText(result: unknown): string {
  const content = (result as { content?: Array<{ type?: string; text?: string }> }).content ?? [];
  const text = content
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n');
  return text || JSON.stringify(result);
}
