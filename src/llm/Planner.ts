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
 * The result of evaluating an item: either a ready-to-dispatch plan, or a set
 * of clarifying questions to post back to the human before planning.
 */
export type PlanningOutcome =
  | { kind: 'plan'; plan: DispatchPlan }
  | { kind: 'questions'; questions: string[] };

/**
 * Evaluates a work item with an {@link LlmAdapter} (and MCP access). Either
 * produces a {@link DispatchPlan} or — when the ticket lacks the detail needed
 * to plan confidently — a list of clarifying questions for the human.
 */
export class Planner {
  constructor(
    private readonly llm: LlmAdapter,
    private readonly mcpServers: McpServerRef[] = [],
    private readonly context: PlanningContext = {},
  ) {}

  async plan(item: WorkItem): Promise<PlanningOutcome> {
    const response = await this.llm.complete({
      messages: [
        { role: 'system', content: this.systemPrompt() },
        { role: 'user', content: describeItem(item) },
      ],
      mcpServers: this.mcpServers,
      responseFormat: 'json',
    });
    return parseOutcome(response.content);
  }

  private systemPrompt(): string {
    const { githubOwner } = this.context;
    const hasGitHubTools = this.mcpServers.some((s) => s.name === 'github');
    const lines = [
      'You are the planning stage of an autonomous engineering assistant.',
      'Given a work-tracking item (its description AND the full comment thread), decide which GitHub',
      'repositories must change and write a robust, self-contained prompt for a downstream coding agent.',
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
    lines.push(
      'If the ticket lacks information you need to plan confidently (which repository, unclear scope or',
      'acceptance criteria, ambiguity), do NOT guess — ask the human. The comment thread is the conversation:',
      'if your earlier questions have since been answered there, proceed to a plan.',
      'Respond with ONLY a JSON object, either a plan:',
      '{ "action": "plan", "repositories": ["owner/name", ...], "prompt": "...", "summary": "..." }',
      'or a request for clarification:',
      '{ "action": "ask", "questions": ["...", "..."] }',
    );
    return lines.join(' ');
  }
}

function describeItem(item: WorkItem): string {
  const lines = [
    `Work item: ${item.key ?? item.id}`,
    `Project: ${item.projectId}`,
    `Title: ${item.title}`,
    `Status: ${item.status}`,
    `Tags: ${item.tags.join(', ') || '(none)'}`,
    '',
    'Description:',
    item.description || '(no description)',
  ];
  if (item.comments.length > 0) {
    lines.push('', 'Comment thread (oldest first):');
    for (const c of item.comments) {
      lines.push(`- ${c.author}${c.createdAt ? ` (${c.createdAt})` : ''}: ${c.body}`);
    }
  }
  return lines.join('\n');
}

/** Extract and validate the planner outcome JSON, tolerating surrounding prose. */
export function parseOutcome(content: string): PlanningOutcome {
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

  const obj = parsed as Record<string, unknown>;
  // Treat it as a clarification request when questions are present (unless it explicitly plans).
  if (Array.isArray(obj.questions) && obj.action !== 'plan') {
    const questions = obj.questions.filter((q): q is string => typeof q === 'string' && q.trim().length > 0);
    if (questions.length > 0) return { kind: 'questions', questions };
  }

  const result = planSchema.safeParse(obj);
  if (!result.success) {
    throw new PlanningError(`LLM outcome failed validation: ${result.error.message}`);
  }
  return { kind: 'plan', plan: result.data };
}

function extractJsonObject(content: string): string | undefined {
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return undefined;
  return content.slice(start, end + 1);
}
