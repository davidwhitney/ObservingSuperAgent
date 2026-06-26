import { z } from 'zod';

/** A column setting: a single name or an ordered list of candidates. Normalised to a list. */
const columnList = z
  .union([z.string(), z.array(z.string())])
  .transform((value) => (Array.isArray(value) ? value : [value]));

/**
 * Board lifecycle config: the tags/columns that drive selection and the stage
 * transitions. Used both as `defaultConfig` (board-level, with defaults filled
 * in) and — via `.partial()` — as each `projectConfig` override. Column fields
 * accept a single name or a list; the card moves to the first candidate that
 * exists on its board.
 */
const boardConfig = z.object({
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
  readyColumns: columnList.default([]),
  /** Column(s) to move the item to when the agent picks it up. */
  actingColumn: columnList.default([]),
  /** Column(s) to move the item to when the work is up for review. */
  completeColumn: columnList.default([]),
  /** Column(s) to move the item to when the PR is merged or closed. */
  doneColumn: columnList.default(['Done']),
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
  /** Board-level lifecycle config (same shape as a projectConfig entry). */
  defaultConfig: boardConfig.default({}),
  /** Per-project overrides keyed by project id; each overrides defaultConfig. */
  projectConfig: z.record(z.string(), boardConfig.partial()).default({}),
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
export type BoardConfig = z.infer<typeof boardConfig>;
export type MemoryConfig = z.infer<typeof memoryConfig>;
export type LlmConfig = z.infer<typeof llmConfig>;
export type McpConfig = z.infer<typeof mcpConfig>;
export type AgentConfig = z.infer<typeof agentConfig>;
export type CommConfig = z.infer<typeof commConfig>;
