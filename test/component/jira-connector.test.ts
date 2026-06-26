import { describe, it, expect } from 'vitest';
import { JiraClient, type JiraIssue } from '../../src/worktracking/jira/JiraClient';
import { JiraConnector } from '../../src/worktracking/jira/JiraConnector';
import type { BoardConfig, JiraConfig } from '../../src/config/schema';
import { fakeFetch, type RecordedCall, type RouteResult } from '../helpers/fakeFetch';

function jiraConfig(overrides: Partial<JiraConfig> = {}, board: Partial<BoardConfig> = {}): JiraConfig {
  return {
    baseUrl: 'https://acme.atlassian.net',
    mode: 'opt-in',
    projectIds: ['ENG'],
    excludedProjectIds: [],
    defaultConfig: {
      readyTag: 'agent-ready',
      actingTag: 'agent-acting',
      completeTag: 'agent-complete',
      rejectedTag: 'reviewer-rejected',
      readyColumns: ['Ready'],
      actingColumn: [],
      completeColumn: [],
      doneColumn: ['Done'],
      ...board,
    },
    projectConfig: {},
    ...overrides,
  };
}

function issue(
  id: string,
  key: string,
  projectKey: string,
  labels: string[],
  status: string,
  description: unknown = '',
): JiraIssue {
  return {
    id,
    key,
    fields: { summary: `${key} summary`, description, labels, status: { name: status }, project: { key: projectKey } },
  };
}

function connectorWith(config: JiraConfig, issues: JiraIssue[], extraRoutes: (call: RecordedCall) => RouteResult | undefined = () => undefined) {
  const { fn, calls } = fakeFetch((call) => {
    const extra = extraRoutes(call);
    if (extra) return extra;
    if (call.url.endsWith('/rest/api/3/search/jql')) return { body: { issues } };
    return { status: 204 };
  });
  const client = new JiraClient({ baseUrl: config.baseUrl, email: 'e', apiToken: 't', fetchFn: fn });
  return { connector: new JiraConnector(config, client), calls };
}

describe('JiraConnector selection', () => {
  it('opt-in: builds project/label/column JQL and filters to ready items', async () => {
    const adf = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'rich text' }] }] };
    const { connector, calls } = connectorWith(jiraConfig(), [
      issue('100', 'ENG-1', 'ENG', ['agent-ready'], 'To Do', adf),
      issue('101', 'ENG-2', 'ENG', [], 'Done'),
    ]);

    const items = await connector.RetrieveWorkReadyForDispatch();

    expect(items.map((i) => i.key)).toEqual(['ENG-1']);
    expect(items[0]).toMatchObject({ description: 'rich text', url: 'https://acme.atlassian.net/browse/ENG-1' });

    const jql = calls.find((c) => c.url.endsWith('/search/jql'))!.body as { jql: string };
    expect(jql.jql).toContain('project = "ENG"');
    expect(jql.jql).toContain('labels = "agent-ready"');
    expect(jql.jql).toContain('status in ("Ready")');
  });

  it('opt-in with no projects configured queries nothing', async () => {
    const { connector, calls } = connectorWith(jiraConfig({ projectIds: [] }), []);
    const items = await connector.RetrieveWorkReadyForDispatch();
    expect(items).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('opt-out: excludes configured projects in JQL and in code', async () => {
    const config = jiraConfig({ mode: 'opt-out', projectIds: [], excludedProjectIds: ['SECRET'] });
    const { connector, calls } = connectorWith(config, [
      issue('1', 'ENG-1', 'ENG', ['agent-ready'], 'To Do'),
      issue('2', 'SEC-1', 'SECRET', ['agent-ready'], 'To Do'),
    ]);

    const items = await connector.RetrieveWorkReadyForDispatch();

    expect(items.map((i) => i.key)).toEqual(['ENG-1']);
    const jql = calls[0]!.body as { jql: string };
    expect(jql.jql).toContain('project not in ("SECRET")');
  });

  it('applies per-project overrides on top of defaultConfig', async () => {
    const config = jiraConfig(
      {
        projectIds: ['OPS'],
        projectConfig: { OPS: { readyColumns: ['Automate'], actingColumn: ['In Progress'], completeColumn: ['Done'] } },
      },
      { readyColumns: [] },
    );
    const { connector } = connectorWith(config, [issue('5', 'OPS-5', 'OPS', [], 'Automate')]);

    const items = await connector.RetrieveWorkReadyForDispatch();

    expect(items.map((i) => i.key)).toEqual(['OPS-5']);
    expect(connector.annotationFor(items[0]!, 'dispatched')).toEqual({
      removeTags: ['agent-ready'],
      addTags: ['agent-acting'],
      transitionTo: ['In Progress'],
    });
    // completeTag/rejectedTag fall through to defaultConfig; column comes from the override.
    expect(connector.annotationFor(items[0]!, 'completed')).toEqual({
      removeTags: ['agent-ready', 'agent-acting'],
      addTags: ['agent-complete'],
      transitionTo: ['Done'],
    });
  });

  it('accepts a single column string or a list (normalised to a list)', async () => {
    const config = jiraConfig({}, { actingTag: 'wip', actingColumn: ['In Progress', 'Doing'] });
    const { connector } = connectorWith(config, []);
    expect(connector.annotationFor({ connector: 'jira', projectId: 'KAN', id: '1' }, 'dispatched')).toEqual({
      removeTags: ['agent-ready'],
      addTags: ['wip'],
      transitionTo: ['In Progress', 'Doing'],
    });
  });
});

describe('JiraConnector.AnnotateItem', () => {
  it('posts a comment, updates labels, and transitions', async () => {
    const config = jiraConfig();
    const { connector, calls } = connectorWith(config, [], (call) => {
      if (call.url.endsWith('/issue/1001/transitions') && call.method === 'GET') {
        return { body: { transitions: [{ id: '31', to: { name: 'Done' } }] } };
      }
      return undefined;
    });

    await connector.AnnotateItem(
      { connector: 'jira', projectId: 'ENG', id: '1001', key: 'ENG-1' },
      { comment: 'hello', addTags: ['agent-complete'], removeTags: ['agent-ready'], transitionTo: ['Done'] },
    );

    const comment = calls.find((c) => c.url.endsWith('/issue/1001/comment'));
    expect(comment?.method).toBe('POST');

    const labelUpdate = calls.find((c) => c.method === 'PUT' && c.url.endsWith('/issue/1001'));
    expect(labelUpdate?.body).toEqual({
      update: { labels: [{ add: 'agent-complete' }, { remove: 'agent-ready' }] },
    });

    const transition = calls.find((c) => c.method === 'POST' && c.url.endsWith('/issue/1001/transitions'));
    expect(transition?.body).toEqual({ transition: { id: '31' } });
  });

  it('moves to the first candidate column that exists on the board', async () => {
    const config = jiraConfig();
    const { connector, calls } = connectorWith(config, [], (call) => {
      if (call.url.endsWith('/issue/1001/transitions') && call.method === 'GET') {
        // Board has "In Review" but not "QA".
        return { body: { transitions: [{ id: '42', to: { name: 'In Review' } }] } };
      }
      return undefined;
    });

    await connector.AnnotateItem(
      { connector: 'jira', projectId: 'ENG', id: '1001' },
      { transitionTo: ['QA', 'In Review', 'Done'] },
    );

    const transition = calls.find((c) => c.method === 'POST' && c.url.endsWith('/issue/1001/transitions'));
    expect(transition?.body).toEqual({ transition: { id: '42' } });
  });

  it('skips the transition when no candidate column exists on the board', async () => {
    const config = jiraConfig();
    const { connector, calls } = connectorWith(config, [], (call) => {
      if (call.url.endsWith('/issue/1001/transitions') && call.method === 'GET') {
        return { body: { transitions: [{ id: '7', to: { name: 'Done' } }] } };
      }
      return undefined;
    });

    await connector.AnnotateItem({ connector: 'jira', projectId: 'ENG', id: '1001' }, { transitionTo: ['QA', 'Staging'] });

    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/transitions'))).toBe(false);
  });
});
