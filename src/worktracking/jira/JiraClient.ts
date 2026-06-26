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
  };
}

interface JiraTransition {
  id: string;
  name?: string;
  to?: { name?: string };
}

/** Thin REST client for JIRA Cloud (API v3). HTTP transport is injectable. */
export class JiraClient {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly authHeader?: string;

  constructor(options: JiraClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.fetchFn = options.fetchFn ?? fetch;
    if (options.email && options.apiToken) {
      const token = Buffer.from(`${options.email}:${options.apiToken}`).toString('base64');
      this.authHeader = `Basic ${token}`;
    }
  }

  /** Run a JQL search and return the matching issues. */
  async search(jql: string, maxResults = 50): Promise<JiraIssue[]> {
    const body = {
      jql,
      maxResults,
      fields: ['summary', 'description', 'labels', 'status', 'project'],
    };
    const result = (await this.request('POST', '/rest/api/3/search/jql', body)) as {
      issues?: JiraIssue[];
    };
    return result.issues ?? [];
  }

  /** Fetch a single issue, or null if it no longer exists (404). */
  async getIssue(issueId: string): Promise<JiraIssue | null> {
    const path = `/rest/api/3/issue/${issueId}?fields=summary,description,labels,status,project`;
    try {
      return (await this.request('GET', path)) as JiraIssue;
    } catch (err) {
      if (/failed: 404/.test((err as Error).message)) return null;
      throw err;
    }
  }

  async addComment(issueId: string, text: string): Promise<void> {
    await this.request('POST', `/rest/api/3/issue/${issueId}/comment`, {
      body: adfParagraph(text),
    });
  }

  async updateLabels(issueId: string, add: string[], remove: string[]): Promise<void> {
    const labels = [
      ...add.map((value) => ({ add: value })),
      ...remove.map((value) => ({ remove: value })),
    ];
    if (labels.length === 0) return;
    await this.request('PUT', `/rest/api/3/issue/${issueId}`, { update: { labels } });
  }

  /** Transition an issue to a target status by name. No-op if already there. */
  async transition(issueId: string, targetStatusName: string): Promise<void> {
    const result = (await this.request('GET', `/rest/api/3/issue/${issueId}/transitions`)) as {
      transitions?: JiraTransition[];
    };
    const match = (result.transitions ?? []).find(
      (t) => t.to?.name === targetStatusName || t.name === targetStatusName,
    );
    if (!match) {
      throw new Error(`No JIRA transition to "${targetStatusName}" for issue ${issueId}`);
    }
    await this.request('POST', `/rest/api/3/issue/${issueId}/transitions`, {
      transition: { id: match.id },
    });
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.authHeader) headers.Authorization = this.authHeader;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const response = await this.fetchFn(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`JIRA ${method} ${path} failed: ${response.status} ${text}`);
    }
    if (response.status === 204) return undefined;
    const text = await response.text();
    return text ? JSON.parse(text) : undefined;
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
