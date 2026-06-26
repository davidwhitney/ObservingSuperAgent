import type { AgentConnector, DispatchInput, DispatchResult } from './AgentConnector';
import type { AgentRunStatus } from '../domain/types';
import type { McpToolProvider } from '../mcp/McpToolProvider';

export interface GitHubCopilotOptions {
  token?: string;
  /** Login the Copilot coding agent is assigned under (default "copilot"), used only for REST fallback. */
  assignee: string;
  /** API base, override for GitHub Enterprise or tests. */
  baseUrl?: string;
  fetchFn?: typeof fetch;
  /** When set, Copilot is assigned via the MCP `assign_copilot_to_issue` tool (the supported trigger). */
  mcp?: McpToolProvider;
  /** MCP server name hosting the GitHub tools (default "github"). */
  mcpServerName?: string;
}

interface RepoRef {
  owner: string;
  repo: string;
  issueNumber: number;
}

/**
 * Dispatches work to GitHub Copilot by creating an issue in the target
 * repository with the generated prompt and assigning it to Copilot, which then
 * opens a PR on its own. The agent run id is `owner/repo#issueNumber`.
 *
 * Real reference implementation against the GitHub REST API. Tests inject a
 * fake `fetchFn`. Note: assigning to Copilot's coding agent may require the
 * GraphQL `replaceActorsForAssignable` mutation in some orgs; the REST
 * assignees path is used here and the assignee login is configurable.
 */
export class GitHubCopilotAgentConnector implements AgentConnector {
  readonly name = 'github-copilot';
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly mcpServerName: string;

  constructor(private readonly options: GitHubCopilotOptions) {
    this.baseUrl = options.baseUrl ?? 'https://api.github.com';
    this.fetchFn = options.fetchFn ?? fetch;
    this.mcpServerName = options.mcpServerName ?? 'github';
  }

  async dispatch(input: DispatchInput): Promise<DispatchResult> {
    const { owner, repo } = parseRepository(input.repository);
    const issue = (await this.request('POST', `/repos/${owner}/${repo}/issues`, {
      title: titleFor(input),
      body: input.prompt,
    })) as { number: number; html_url: string };

    await this.assignCopilot(owner, repo, issue.number, input.prompt);

    return {
      agentRunId: `${owner}/${repo}#${issue.number}`,
      issueUrl: issue.html_url,
    };
  }

  /** Hand the issue to Copilot — via the MCP tool when available, else REST assignees. */
  private async assignCopilot(owner: string, repo: string, issueNumber: number, prompt: string): Promise<void> {
    if (this.options.mcp) {
      await this.options.mcp.callTool(this.mcpServerName, 'assign_copilot_to_issue', {
        owner,
        repo,
        issue_number: issueNumber,
        custom_instructions: prompt,
      });
      return;
    }
    await this.request('POST', `/repos/${owner}/${repo}/issues/${issueNumber}/assignees`, {
      assignees: [this.options.assignee],
    });
  }

  async getStatus(agentRunId: string): Promise<AgentRunStatus> {
    const ref = parseAgentRunId(agentRunId);
    const { owner, repo, issueNumber } = ref;

    const timeline = (await this.request(
      'GET',
      `/repos/${owner}/${repo}/issues/${issueNumber}/timeline`,
    )) as TimelineEvent[];

    const prNumber = latestLinkedPrNumber(timeline);
    if (prNumber === undefined) {
      return { agentRunId, state: 'in_progress', detail: 'no linked PR yet' };
    }

    const pr = (await this.request('GET', `/repos/${owner}/${repo}/pulls/${prNumber}`)) as {
      state: string;
      draft?: boolean;
      merged_at: string | null;
      html_url: string;
      requested_reviewers?: unknown[];
      requested_teams?: unknown[];
    };

    // The Copilot agent signals it has finished by taking the PR out of draft
    // and requesting review; merge/close are the post-review outcomes.
    const reviewRequested =
      pr.draft === false ||
      (pr.requested_reviewers?.length ?? 0) > 0 ||
      (pr.requested_teams?.length ?? 0) > 0;

    let state: AgentRunStatus['state'];
    let detail: string;
    if (pr.merged_at) {
      state = 'merged';
      detail = 'PR merged';
    } else if (pr.state === 'closed') {
      state = 'rejected';
      detail = 'PR closed without merge';
    } else if (reviewRequested) {
      state = 'completed';
      detail = 'PR ready for review';
    } else {
      state = 'in_progress';
      detail = 'PR in draft';
    }

    return { agentRunId, state, prUrl: pr.html_url, detail };
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (this.options.token) headers.Authorization = `Bearer ${this.options.token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const response = await this.fetchFn(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`GitHub API ${method} ${path} failed: ${response.status} ${text}`);
    }
    if (response.status === 204) return undefined;
    const text = await response.text();
    return text ? JSON.parse(text) : undefined;
  }
}

interface TimelineEvent {
  event?: string;
  source?: { issue?: { number: number; pull_request?: unknown } };
}

function latestLinkedPrNumber(timeline: TimelineEvent[]): number | undefined {
  let found: number | undefined;
  for (const event of timeline) {
    if (event.event === 'cross-referenced' && event.source?.issue?.pull_request) {
      found = event.source.issue.number;
    }
  }
  return found;
}

function titleFor(input: DispatchInput): string {
  const firstLine = input.prompt.split('\n', 1)[0]!.trim();
  const base = input.workItem.key ?? input.workItem.id;
  const suffix = firstLine.length > 0 ? `: ${firstLine.slice(0, 120)}` : '';
  return `[agent] ${base}${suffix}`;
}

export function parseRepository(repository: string): { owner: string; repo: string } {
  const match = /^([^/]+)\/([^/#]+)$/.exec(repository.trim());
  if (!match) throw new Error(`Invalid repository "${repository}", expected "owner/name"`);
  return { owner: match[1]!, repo: match[2]! };
}

export function parseAgentRunId(agentRunId: string): RepoRef {
  const match = /^([^/]+)\/([^/#]+)#(\d+)$/.exec(agentRunId.trim());
  if (!match) throw new Error(`Invalid agent run id "${agentRunId}"`);
  return { owner: match[1]!, repo: match[2]!, issueNumber: Number(match[3]) };
}
