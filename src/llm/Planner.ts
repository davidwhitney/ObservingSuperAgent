import { z } from 'zod';
import type { LlmAdapter } from './LlmAdapter';
import type { McpServerRef } from '../mcp/McpConfig';
import type { DispatchPlan, WorkItem } from '../domain/types';

const planSchema = z.object({
  repositories: z.array(z.string().min(1)).min(1),
  prompt: z.string().min(1),
  summary: z.string().optional(),
});

export class PlanningError extends Error {}

export interface PlanningContext {
  /** GitHub owner (org/user) the target repositories live under. */
  githubOwner?: string;
}

/**
 * Turns a work item into a {@link DispatchPlan} (repositories + agent prompt)
 * by invoking an {@link LlmAdapter}, giving it MCP access for extra context.
 */
export class Planner {
  constructor(
    private readonly llm: LlmAdapter,
    private readonly mcpServers: McpServerRef[] = [],
    private readonly context: PlanningContext = {},
  ) {}

  async plan(item: WorkItem): Promise<DispatchPlan> {
    const response = await this.llm.complete({
      messages: [
        { role: 'system', content: this.systemPrompt() },
        { role: 'user', content: describeItem(item) },
      ],
      mcpServers: this.mcpServers,
      responseFormat: 'json',
    });
    return parsePlan(response.content);
  }

  private systemPrompt(): string {
    const { githubOwner } = this.context;
    const hasGitHubTools = this.mcpServers.some((s) => s.name === 'github');
    const lines = [
      'You are the planning stage of an autonomous engineering assistant.',
      'Given a work-tracking item, decide which GitHub repositories must change and write a',
      'robust, self-contained prompt for a downstream coding agent that has access to those repositories.',
    ];
    if (githubOwner) {
      lines.push(
        `All target repositories live under the GitHub owner "${githubOwner}". Every repository you return MUST be formatted as "${githubOwner}/<repo>".`,
      );
    }
    if (hasGitHubTools) {
      lines.push(
        `You have GitHub tools available. Before choosing repositories you MUST use them to list or search the repositories${
          githubOwner ? ` owned by "${githubOwner}"` : ''
        } and confirm the chosen repository actually exists. Never invent or guess a repository name — only return repositories you have verified exist via the tools.`,
      );
    }
    lines.push('Respond with ONLY a JSON object of the form:');
    lines.push('{ "repositories": ["owner/name", ...], "prompt": "...", "summary": "..." }');
    return lines.join(' ');
  }
}

function describeItem(item: WorkItem): string {
  return [
    `Work item: ${item.key ?? item.id}`,
    `Project: ${item.projectId}`,
    `Title: ${item.title}`,
    `Status: ${item.status}`,
    `Tags: ${item.tags.join(', ') || '(none)'}`,
    '',
    'Description:',
    item.description || '(no description)',
  ].join('\n');
}

/** Extract and validate the plan JSON, tolerating surrounding prose. */
export function parsePlan(content: string): DispatchPlan {
  const json = extractJsonObject(content);
  if (json === undefined) {
    throw new PlanningError('LLM response did not contain a JSON object');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new PlanningError(`LLM response was not valid JSON: ${(err as Error).message}`);
  }
  const result = planSchema.safeParse(parsed);
  if (!result.success) {
    throw new PlanningError(`LLM plan failed validation: ${result.error.message}`);
  }
  return result.data;
}

function extractJsonObject(content: string): string | undefined {
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return undefined;
  return content.slice(start, end + 1);
}
