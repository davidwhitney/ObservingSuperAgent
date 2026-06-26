import { JsonHttpClient } from '../../http/JsonHttpClient';

export interface JiraClientOptions {
  baseUrl: string;
  email?: string;
  apiToken?: string;
  fetchFn?: typeof fetch;
}

/** Raw JIRA issue shape (the subset of fields we request). */
export interface JiraIssue {
  id: string;
  key: string;
  fields: {
    summary?: string;
    description?: unknown;
    labels?: string[];
    status?: { name?: string };
    project?: { id?: string; key?: string };
    comment?: {
      comments?: Array<{ author?: { displayName?: string }; body?: unknown; created?: string }>;
    };
  };
}

const ISSUE_FIELDS = ['summary', 'description', 'labels', 'status', 'project', 'comment'];

interface JiraTransition {
  id: string;
  name?: string;
  to?: { name?: string };
}

/** Thin REST client for JIRA Cloud (API v3). HTTP transport is injectable. */
export class JiraClient {
  private readonly http: JsonHttpClient;

  constructor(options: JiraClientOptions) {
    const authHeader =
      options.email && options.apiToken
        ? `Basic ${Buffer.from(`${options.email}:${options.apiToken}`).toString('base64')}`
        : undefined;
    this.http = new JsonHttpClient({
      baseUrl: options.baseUrl,
      label: 'JIRA',
      defaultHeaders: { Accept: 'application/json' },
      authHeader,
      fetchFn: options.fetchFn,
    });
  }

  /** Run a JQL search and return the matching issues. */
  async search(jql: string, maxResults = 50): Promise<JiraIssue[]> {
    const body = { jql, maxResults, fields: ISSUE_FIELDS };
    const result = (await this.http.request('POST', '/rest/api/3/search/jql', body)) as {
      issues?: JiraIssue[];
    };
    return result.issues ?? [];
  }

  /** Fetch a single issue, or null if it no longer exists (404). */
  async getIssue(issueId: string): Promise<JiraIssue | null> {
    const path = `/rest/api/3/issue/${issueId}?fields=${ISSUE_FIELDS.join(',')}`;
    try {
      return (await this.http.request('GET', path)) as JiraIssue;
    } catch (err) {
      if (/failed: 404/.test((err as Error).message)) return null;
      throw err;
    }
  }

  /** Create an issue and return its id/key. */
  async createIssue(input: {
    projectKey: string;
    issueType: string;
    summary: string;
    description: string;
    labels?: string[];
  }): Promise<{ id: string; key: string }> {
    const body = {
      fields: {
        project: { key: input.projectKey },
        issuetype: { name: input.issueType },
        summary: input.summary,
        description: adfParagraph(input.description),
        labels: input.labels ?? [],
      },
    };
    return (await this.http.request('POST', '/rest/api/3/issue', body)) as { id: string; key: string };
  }

  async addComment(issueId: string, text: string): Promise<void> {
    await this.http.request('POST', `/rest/api/3/issue/${issueId}/comment`, {
      body: adfParagraph(text),
    });
  }

  async updateLabels(issueId: string, add: string[], remove: string[]): Promise<void> {
    const labels = [
      ...add.map((value) => ({ add: value })),
      ...remove.map((value) => ({ remove: value })),
    ];
    if (labels.length === 0) return;
    await this.http.request('PUT', `/rest/api/3/issue/${issueId}`, { update: { labels } });
  }

  /**
   * Transition an issue to the first of `candidates` that is an available
   * transition on its board. No-op if none of the candidates apply (so a
   * column that doesn't exist on this board is simply skipped).
   */
  async transition(issueId: string, candidates: string[]): Promise<void> {
    if (candidates.length === 0) return;
    const result = (await this.http.request('GET', `/rest/api/3/issue/${issueId}/transitions`)) as {
      transitions?: JiraTransition[];
    };
    const available = result.transitions ?? [];
    for (const target of candidates) {
      const match = available.find((t) => t.to?.name === target || t.name === target);
      if (match) {
        await this.http.request('POST', `/rest/api/3/issue/${issueId}/transitions`, {
          transition: { id: match.id },
        });
        return;
      }
    }
  }
}

/** Wrap plain text as an Atlassian Document Format comment body. */
function adfParagraph(text: string): unknown {
  return {
    type: 'doc',
    version: 1,
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  };
}

/** Best-effort flatten of an ADF description (or passthrough of a plain string). */
export function adfToText(description: unknown): string {
  if (typeof description === 'string') return description;
  if (!description || typeof description !== 'object') return '';
  const parts: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as { text?: string; content?: unknown[] };
    if (typeof n.text === 'string') parts.push(n.text);
    if (Array.isArray(n.content)) n.content.forEach(walk);
  };
  walk(description);
  return parts.join(' ').trim();
}
