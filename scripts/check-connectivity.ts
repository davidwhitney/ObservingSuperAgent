/**
 * Live connectivity check for the configured JIRA, GitHub, Foundry Local and
 * GitHub MCP credentials. Run with: npm run check
 *
 * Makes real network calls using config.json (overlaid by env). Never prints
 * secrets.
 */
import { loadConfig } from '../src/config/load';
import { JiraConnector } from '../src/worktracking/jira/JiraConnector';
import { JiraClient } from '../src/worktracking/jira/JiraClient';
import { FoundryLocalAdapter } from '../src/llm/FoundryLocalAdapter';
import { ensureFoundryLocal } from '../src/llm/FoundryLocalLauncher';
import { McpClientPool } from '../src/mcp/McpClientPool';
import { buildMcpServers } from '../src/mcp/McpConfig';

const config = loadConfig();

function ok(label: string, detail = ''): void {
  console.log(`✅ ${label}${detail ? ` — ${detail}` : ''}`);
}
function bad(label: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  console.log(`❌ ${label} — ${msg.slice(0, 300)}`);
}

async function checkJira(): Promise<void> {
  if (!config.jira) return console.log('— JIRA not configured');
  const { baseUrl, email, apiToken } = config.jira;
  const auth = 'Basic ' + Buffer.from(`${email}:${apiToken}`).toString('base64');

  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/rest/api/3/myself`, {
      headers: { Authorization: auth, Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    const me = (await res.json()) as { displayName?: string; emailAddress?: string };
    ok('JIRA auth', `${me.displayName ?? '?'} <${me.emailAddress ?? '?'}>`);
  } catch (err) {
    return bad('JIRA auth', err);
  }

  try {
    const connector = new JiraConnector(config.jira, new JiraClient({ baseUrl, email, apiToken }));
    const items = await connector.RetrieveWorkReadyForDispatch();
    ok('JIRA ready-work query', `${items.length} ready item(s)${items.length ? ': ' + items.map((i) => i.key).join(', ') : ''}`);
  } catch (err) {
    bad('JIRA ready-work query (check readyColumns/JQL)', err);
  }
}

async function checkGitHub(): Promise<void> {
  const token = config.agent.github.token;
  if (config.agent.provider !== 'github-copilot' || !token) return console.log('— GitHub agent not configured');
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    const user = (await res.json()) as { login?: string };
    const scopes = res.headers.get('x-oauth-scopes') ?? '(fine-grained or none reported)';
    ok('GitHub auth', `login=${user.login ?? '?'}, scopes=[${scopes}]`);
  } catch (err) {
    return bad('GitHub auth', err);
  }

  const owner = config.agent.github.owner;
  if (owner) {
    try {
      const res = await fetch(`https://api.github.com/users/${owner}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
      });
      if (!res.ok) throw new Error(`${res.status}`);
      ok('GitHub owner reachable', owner);
    } catch (err) {
      bad(`GitHub owner "${owner}"`, err);
    }
  }
}

async function checkFoundry(): Promise<void> {
  if (config.llm.provider !== 'foundry-local') return console.log('— Foundry Local not configured');

  // Bring it up if needed, exactly as the app does on startup.
  const runtime = await ensureFoundryLocal(config.llm);
  if (runtime.endpoint) config.llm.endpoint = runtime.endpoint;
  if (runtime.model) config.llm.model = runtime.model;

  const base = (config.llm.endpoint ?? '').replace(/\/$/, '');
  try {
    const res = await fetch(`${base}/models`);
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    const data = (await res.json()) as { data?: Array<{ id: string }> };
    const ids = (data.data ?? []).map((m) => m.id);
    const present = ids.includes(config.llm.model ?? '');
    ok('Foundry Local endpoint', `models=[${ids.join(', ') || 'none'}]`);
    console.log(`   configured model "${config.llm.model}" ${present ? 'is loaded ✅' : 'is NOT in the list ⚠️'}`);
  } catch (err) {
    return bad('Foundry Local endpoint (is it running?)', err);
  }

  try {
    const adapter = new FoundryLocalAdapter(config.llm);
    const out = await adapter.complete({ messages: [{ role: 'user', content: 'Reply with the single word: pong' }] });
    ok('Foundry Local completion', JSON.stringify(out.content.slice(0, 60)));
  } catch (err) {
    bad('Foundry Local completion', err);
  }
}

async function checkMcp(): Promise<void> {
  const servers = buildMcpServers(config.mcp);
  if (!servers.length) return console.log('— No MCP servers configured');
  const pool = new McpClientPool(servers);
  try {
    const tools = await pool.listTools();
    const names = tools.slice(0, 8).map((t) => `${t.server}/${t.name}`);
    ok('GitHub MCP', `${tools.length} tool(s), e.g. ${names.join(', ')}`);
  } catch (err) {
    bad('GitHub MCP', err);
  } finally {
    await pool.close();
  }
}

console.log('Running connectivity checks...\n');
await checkJira();
await checkGitHub();
await checkFoundry();
await checkMcp();
console.log('\nDone.');
