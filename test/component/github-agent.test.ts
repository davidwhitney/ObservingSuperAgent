import { describe, it, expect } from 'vitest';
import {
  GitHubCopilotAgentConnector,
  parseRepository,
  parseAgentRunId,
} from '../../src/agents/GitHubCopilotAgentConnector';
import { fakeFetch, type RecordedCall, type RouteResult } from '../helpers/fakeFetch';
import { FakeMcpToolProvider } from '../../src/mcp/fakes/FakeMcpToolProvider';

function connector(routes: (call: RecordedCall) => RouteResult, mcp?: FakeMcpToolProvider) {
  const { fn, calls } = fakeFetch(routes);
  return {
    connector: new GitHubCopilotAgentConnector({ assignee: 'copilot', token: 'tok', fetchFn: fn, mcp }),
    calls,
  };
}

function assignTool() {
  return new FakeMcpToolProvider([
    { server: 'github', name: 'assign_copilot_to_issue', inputSchema: {}, handler: () => 'assigned' },
  ]);
}

describe('parsing helpers', () => {
  it('parses repository and run id', () => {
    expect(parseRepository('acme/widgets')).toEqual({ owner: 'acme', repo: 'widgets' });
    expect(parseAgentRunId('acme/widgets#7')).toEqual({ owner: 'acme', repo: 'widgets', issueNumber: 7 });
    expect(() => parseRepository('bad')).toThrow();
    expect(() => parseAgentRunId('acme/widgets')).toThrow();
  });
});

describe('GitHubCopilotAgentConnector', () => {
  it('creates an issue then assigns Copilot via the MCP tool', async () => {
    const mcp = assignTool();
    const { connector: c, calls } = connector((call) => {
      if (call.method === 'POST' && call.url.endsWith('/repos/acme/widgets/issues')) {
        return { status: 201, body: { number: 7, html_url: 'https://github.com/acme/widgets/issues/7' } };
      }
      return { status: 404 };
    }, mcp);

    const result = await c.dispatch({
      repository: 'acme/widgets',
      prompt: 'Fix the bug\nmore detail',
      workItem: { connector: 'jira', projectId: 'ENG', id: '1', key: 'ENG-1' },
    });

    expect(result).toEqual({ agentRunId: 'acme/widgets#7', issueUrl: 'https://github.com/acme/widgets/issues/7' });

    const create = calls[0]!.body as { title: string; body: string; assignees?: string[] };
    expect(create.title).toContain('ENG-1');
    expect(create.body).toBe('Fix the bug\nmore detail');
    expect(create.assignees).toBeUndefined();

    expect(mcp.calls).toEqual([
      { server: 'github', name: 'assign_copilot_to_issue', args: { owner: 'acme', repo: 'widgets', issue_number: 7, custom_instructions: 'Fix the bug\nmore detail' } },
    ]);
  });

  it('falls back to REST assignees when no MCP is wired', async () => {
    const { connector: c, calls } = connector((call) => {
      if (call.method === 'POST' && call.url.endsWith('/repos/acme/widgets/issues')) {
        return { status: 201, body: { number: 8, html_url: 'https://github.com/acme/widgets/issues/8' } };
      }
      return { status: 201 };
    });

    await c.dispatch({
      repository: 'acme/widgets',
      prompt: 'Do it',
      workItem: { connector: 'jira', projectId: 'ENG', id: '1', key: 'ENG-1' },
    });

    const assign = calls.find((call) => call.url.endsWith('/repos/acme/widgets/issues/8/assignees'));
    expect(assign?.method).toBe('POST');
    expect(assign?.body).toEqual({ assignees: ['copilot'] });
  });

  const prRoutes = (pr: Record<string, unknown>) => (call: RecordedCall): RouteResult => {
    if (call.url.endsWith('/issues/7/timeline')) {
      return { body: [{ event: 'cross-referenced', source: { issue: { number: 12, pull_request: {} } } }] };
    }
    if (call.url.endsWith('/pulls/12')) {
      return { body: { html_url: 'https://github.com/acme/widgets/pull/12', ...pr } };
    }
    return { status: 404 };
  };

  it('treats a draft PR as in_progress', async () => {
    const { connector: c } = connector(prRoutes({ state: 'open', draft: true, merged_at: null }));
    expect(await c.getStatus('acme/widgets#7')).toMatchObject({
      state: 'in_progress',
      prUrl: 'https://github.com/acme/widgets/pull/12',
    });
  });

  it('treats a ready-for-review (non-draft) PR as completed', async () => {
    const { connector: c } = connector(prRoutes({ state: 'open', draft: false, merged_at: null }));
    expect(await c.getStatus('acme/widgets#7')).toMatchObject({ state: 'completed', detail: 'PR ready for review' });
  });

  it('treats a PR with requested reviewers as completed', async () => {
    const { connector: c } = connector(prRoutes({ state: 'open', draft: true, merged_at: null, requested_reviewers: [{ login: 'alice' }] }));
    expect(await c.getStatus('acme/widgets#7')).toMatchObject({ state: 'completed' });
  });

  it('treats a merged PR as merged and a closed-unmerged PR as rejected', async () => {
    const merged = connector(prRoutes({ state: 'closed', draft: false, merged_at: '2026-06-25T00:00:00Z' }));
    expect(await merged.connector.getStatus('acme/widgets#7')).toMatchObject({ state: 'merged' });

    const closed = connector(prRoutes({ state: 'closed', draft: true, merged_at: null }));
    expect(await closed.connector.getStatus('acme/widgets#7')).toMatchObject({ state: 'rejected' });
  });

  it('reports in_progress with no linked PR yet', async () => {
    const { connector: c } = connector((call) =>
      call.url.endsWith('/timeline') ? { body: [] } : { status: 404 },
    );
    expect(await c.getStatus('acme/widgets#7')).toMatchObject({ state: 'in_progress', detail: 'no linked PR yet' });
  });
});
