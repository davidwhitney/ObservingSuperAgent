import { describe, it, expect } from 'vitest';
import { loadConfig } from '../../src/config/load';
import { McpClientPool } from '../../src/mcp/McpClientPool';
import { buildMcpServers } from '../../src/mcp/McpConfig';

const config = loadConfig();
const enabled = config.mcp.github.enabled && !!config.mcp.github.token;

describe.skipIf(!enabled)('GitHub MCP integration', () => {
  it('connects and lists tools including assign_copilot_to_issue', async () => {
    const pool = new McpClientPool(buildMcpServers(config.mcp));
    try {
      const tools = await pool.listTools();
      expect(tools.length).toBeGreaterThan(0);
      expect(tools.some((t) => t.server === 'github' && t.name === 'assign_copilot_to_issue')).toBe(true);
    } finally {
      await pool.close();
    }
  });
});
