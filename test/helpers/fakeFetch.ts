export interface RecordedCall {
  method: string;
  url: string;
  body?: unknown;
}

export interface RouteResult {
  status?: number;
  body?: unknown;
}

/**
 * Build an injectable `fetch` that records calls and routes them through a
 * handler. Returns the standard global `Response`, so client code that reads
 * `.ok`, `.status`, `.text()` and `.json()` works unchanged.
 */
export function fakeFetch(handler: (call: RecordedCall) => RouteResult) {
  const calls: RecordedCall[] = [];

  const fn = (async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Response> => {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    const call: RecordedCall = { method: init?.method ?? 'GET', url: String(input), body };
    calls.push(call);

    const result = handler(call);
    const status = result.status ?? 200;
    if (status === 204 || result.body === undefined) {
      return new Response(null, { status });
    }
    return new Response(JSON.stringify(result.body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;

  return { fn, calls };
}
