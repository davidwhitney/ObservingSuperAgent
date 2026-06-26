import type { McpConfig } from '../config/schema';

/** A resolved reference to an MCP server made available to the planning LLM. */
export interface McpServerRef {
  name: string;
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

/** GitHub's hosted MCP server, attached by default so the LLM can query codebases. */
export const GITHUB_MCP_URL = 'https://api.githubcopilot.com/mcp/';

/**
 * Build the list of MCP servers exposed to the planning LLM: the GitHub MCP
 * server (unless disabled) plus any additional configured servers.
 */
export function buildMcpServers(config: McpConfig): McpServerRef[] {
  const servers: McpServerRef[] = [];

  if (config.github.enabled) {
    servers.push({
      name: 'github',
      url: GITHUB_MCP_URL,
      env: config.github.token ? { GITHUB_TOKEN: config.github.token } : {},
    });
  }

  for (const server of config.servers) {
    servers.push({
      name: server.name,
      url: server.url,
      command: server.command,
      args: server.args,
      env: server.env,
    });
  }

  return servers;
}
