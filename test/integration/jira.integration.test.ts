import { describe, it, expect } from 'vitest';
import { loadConfig } from '../../src/config/load';
import { JiraClient } from '../../src/worktracking/jira/JiraClient';
import { JiraConnector } from '../../src/worktracking/jira/JiraConnector';

const config = loadConfig();
const jira = config.jira;
const enabled = !!jira?.email && !!jira?.apiToken;

// Read-only smoke: authenticate and run the real selection query. No writes,
// so it needs no junk project.
describe.skipIf(!enabled)('JIRA integration', () => {
  it('authenticates against the configured instance', async () => {
    const res = await fetch(`${jira!.baseUrl.replace(/\/$/, '')}/rest/api/3/myself`, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${jira!.email}:${jira!.apiToken}`).toString('base64')}`,
        Accept: 'application/json',
      },
    });
    expect(res.ok).toBe(true);
  });

  it('retrieves ready work without error', async () => {
    const connector = new JiraConnector(
      jira!,
      new JiraClient({ baseUrl: jira!.baseUrl, email: jira!.email, apiToken: jira!.apiToken }),
    );
    const items = await connector.RetrieveWorkReadyForDispatch();
    expect(Array.isArray(items)).toBe(true);
    for (const item of items) {
      expect(item.connector).toBe('jira');
      expect(item.id).toBeTruthy();
    }
  });
});
