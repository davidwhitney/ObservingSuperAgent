import { z } from 'zod';

/** Per-project overrides for the JIRA selection / lifecycle heuristics. */
const jiraProjectConfig = z.object({
  readyTag: z.string().optional(),
  actingTag: z.string().optional(),
  completeTag: z.string().optional(),
  doneTag: z.string().optional(),
  rejectedTag: z.string().optional(),
  readyColumns: z.array(z.string()).optional(),
  actingColumn: z.string().optional(),
  completeColumn: z.string().optional(),
  doneColumn: z.string().optional(),
});

const jiraConfig = z.object({
  baseUrl: z.string().url(),
  /** Basic-auth email (paired with apiToken) for JIRA Cloud. */
  email: z.string().optional(),
  apiToken: z.string().optional(),
  /** opt-in only queries the configured projectIds; opt-out queries all but exclusions. */
  mode: z.enum(['opt-in', 'opt-out']).default('opt-in'),
  projectIds: z.array(z.string()).default([]),
  excludedProjectIds: z.array(z.string()).default([]),
  readyTag: z.string().default('agent-ready'),
  /** Tag applied (and ready tag removed) when the agent picks the item up. */
  actingTag: z.string().default('agent-acting'),
  /** Tag applied when the agent's PR is up for review. */
  completeTag: z.string().default('agent-complete'),
  /** Optional tag applied when the PR is merged. */
  doneTag: z.string().optional(),
  /** Tag applied when the PR is closed without merging. */
  rejectedTag: z.string().default('reviewer-rejected'),
  /** Column / status names that also mark an item as ready. */
  readyColumns: z.array(z.string()).default([]),
  /** Optional column to move the item to when the agent picks it up. */
  actingColumn: z.string().optional(),
  /** Optional column to move the item to when the work is up for review. */
  completeColumn: z.string().optional(),
  /** Column to move the item to when the PR is merged or closed. */
  doneColumn: z.string().default('Done'),
  /** Per-project overrides keyed by project id. */
  projectConfig: z.record(z.string(), jiraProjectConfig).default({}),
});

const memoryConfig = z.object({
  type: z.enum(['disk', 'azure', 'memory']).default('disk'),
  directory: z.string().default('.osa-memory'),
  azure: z
    .object({
      connectionString: z.string().optional(),
      container: z.string().default('osa-memory'),
    })
    .optional(),
});

const llmConfig = z.object({
  provider: z
    .enum(['azure-foundry', 'foundry-local', 'github-copilot-cli', 'fake'])
    .default('fake'),
  model: z.string().optional(),
  endpoint: z.string().optional(),
  apiKey: z.string().optional(),
  /** For foundry-local: start the service + load the model on boot if not reachable. */
  autoStart: z.boolean().default(true),
});

const mcpServer = z.object({
  name: z.string(),
  /** URL for a remote (SSE/HTTP) MCP server. */
  url: z.string().optional(),
  /** Command for a stdio MCP server. */
  command: z.string().optional(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).default({}),
});

const mcpConfig = z.object({
  github: z
    .object({
      enabled: z.boolean().default(true),
      token: z.string().optional(),
    })
    .default({ enabled: true }),
  servers: z.array(mcpServer).default([]),
});

const agentConfig = z.object({
  provider: z.enum(['github-copilot', 'fake']).default('fake'),
  github: z
    .object({
      token: z.string().optional(),
      owner: z.string().optional(),
      /** Login that GitHub Copilot's coding agent is assigned under. */
      assignee: z.string().default('copilot'),
    })
    .default({ assignee: 'copilot' }),
});

const commConfig = z.discriminatedUnion('type', [
  z.object({ type: z.literal('console') }),
  z.object({ type: z.literal('teams'), webhookUrl: z.string().optional(), channel: z.string().optional() }),
  z.object({ type: z.literal('slack'), webhookUrl: z.string().optional(), channel: z.string().optional() }),
]);

const apiConfig = z.object({
  host: z.string().default('0.0.0.0'),
  port: z.coerce.number().int().positive().default(8787),
});

const pollingConfig = z.object({
  /** If set, index.ts runs a background poll timer at this interval. */
  intervalMs: z.coerce.number().int().positive().optional(),
});

export const configSchema = z.object({
  jira: jiraConfig.optional(),
  memory: memoryConfig.default({ type: 'disk', directory: '.osa-memory' }),
  llm: llmConfig.default({ provider: 'fake' }),
  mcp: mcpConfig.default({ github: { enabled: true }, servers: [] }),
  agent: agentConfig.default({ provider: 'fake', github: { assignee: 'copilot' } }),
  comms: z.array(commConfig).default([{ type: 'console' }]),
  api: apiConfig.default({ host: '0.0.0.0', port: 8787 }),
  polling: pollingConfig.default({}),
});

export type Config = z.infer<typeof configSchema>;
export type JiraConfig = z.infer<typeof jiraConfig>;
export type JiraProjectConfig = z.infer<typeof jiraProjectConfig>;
export type MemoryConfig = z.infer<typeof memoryConfig>;
export type LlmConfig = z.infer<typeof llmConfig>;
export type McpConfig = z.infer<typeof mcpConfig>;
export type AgentConfig = z.infer<typeof agentConfig>;
export type CommConfig = z.infer<typeof commConfig>;
