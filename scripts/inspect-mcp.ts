import { loadConfig } from '../src/config/load';
import { McpClientPool } from '../src/mcp/McpClientPool';
import { buildMcpServers } from '../src/mcp/McpConfig';

const config = loadConfig();
const pool = new McpClientPool(buildMcpServers(config.mcp));
const tools = await pool.listTools();

const want = ['create_issue', 'assign_copilot_to_issue', 'get_issue', 'list_pull_requests', 'create_pull_request_with_copilot'];
for (const name of want) {
  const tool = tools.find((t) => t.name === name);
  if (!tool) {
    console.log(`### ${name} — NOT FOUND`);
    continue;
  }
  const schema = tool.inputSchema as { properties?: Record<string, { type?: string }>; required?: string[] };
  const props = schema.properties ?? {};
  console.log(`### ${name}`);
  for (const [key, def] of Object.entries(props)) {
    const required = (schema.required ?? []).includes(key) ? ' (required)' : '';
    console.log(`   ${key}: ${def.type ?? '?'}${required}`);
  }
}
await pool.close();
