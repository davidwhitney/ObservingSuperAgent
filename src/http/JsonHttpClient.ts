export interface JsonHttpOptions {
  baseUrl: string;
  /** Label used in error messages, e.g. "JIRA" or "GitHub API". */
  label: string;
  /** Headers sent on every request (e.g. Accept, API version). */
  defaultHeaders?: Record<string, string>;
  /** Full Authorization header value, if any. */
  authHeader?: string;
  fetchFn?: typeof fetch;
}

/**
 * Minimal JSON-over-HTTP client shared by the REST integrations. Adds auth +
 * default headers, sets Content-Type when there's a body, throws a labelled
 * error on non-2xx, and parses JSON (treating 204 / empty bodies as undefined).
 */
export class JsonHttpClient {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: JsonHttpOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const headers: Record<string, string> = { ...this.options.defaultHeaders };
    if (this.options.authHeader) headers.Authorization = this.options.authHeader;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const response = await this.fetchFn(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`${this.options.label} ${method} ${path} failed: ${response.status} ${text}`);
    }
    if (response.status === 204) return undefined;
    const text = await response.text();
    return text ? JSON.parse(text) : undefined;
  }
}
