/**
 * Full end-to-end live run: create a JIRA ticket in the Test Project (KAN) that
 * asks for a change in davidwhitney/junkrepo, dispatch it to GitHub Copilot,
 * and poll until it flows through to completion (PR up for review → In Review).
 *
 * Creates real artifacts (JIRA ticket, GitHub issue, Copilot PR). Run with:
 *   npx tsx scripts/e2e-junkrepo.ts
 */
import { loadConfig } from '../src/config/load';
import { buildFromConfig } from '../src/composition/buildFromConfig';
import { ensureFoundryLocal } from '../src/llm/FoundryLocalLauncher';
import { JiraClient } from '../src/worktracking/jira/JiraClient';
import { Orchestrator } from '../src/orchestrator/Orchestrator';
import { recordIdFor } from '../src/memory/AgentMemory';
import type { Planner } from '../src/llm/Planner';

const REPO = 'davidwhitney/junkrepo';
const PROJECT = 'KAN';
const POLL_INTERVAL_MS = 30_000;
const MAX_WAIT_MS = 30 * 60_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Merge a PR via the GitHub API, marking it ready for review first if it's a draft. */
async function mergePullRequest(prUrl: string, token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const match = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(prUrl);
  if (!match) {
    console.log(`  could not parse PR url: ${prUrl}`);
    return false;
  }
  const [, owner, repo, number] = match;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  };

  const pr = (await (
    await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${number}`, { headers })
  ).json()) as { draft?: boolean; node_id?: string };

  if (pr.draft && pr.node_id) {
    console.log('  PR is still a draft — marking it ready for review…');
    await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        query: 'mutation($id:ID!){markPullRequestReadyForReview(input:{pullRequestId:$id}){pullRequest{isDraft}}}',
        variables: { id: pr.node_id },
      }),
    });
  }

  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${number}/merge`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    console.log(`  merge not ready yet (${res.status}): ${(await res.text()).slice(0, 160)}`);
    return false;
  }
  console.log(`  merged PR #${number}`);
  return true;
}

const config = loadConfig();

// 1. Bring up Foundry Local for planning, then wire the system.
const runtime = await ensureFoundryLocal(config.llm);
if (runtime.endpoint) config.llm.endpoint = runtime.endpoint;
if (runtime.model) config.llm.model = runtime.model;
const system = buildFromConfig(config);

const jira = new JiraClient({
  baseUrl: config.jira!.baseUrl,
  email: config.jira!.email,
  apiToken: config.jira!.apiToken,
});

// 2. Create the JIRA ticket (tagged so it's selected for dispatch).
console.log(`Creating a ticket in ${PROJECT} asking for a change in ${REPO}…`);
const created = await jira.createIssue({
  projectKey: PROJECT,
  issueType: 'Task',
  summary: 'Add a SMOKE.md note to junkrepo',
  description: `In the GitHub repository ${REPO}, add a new file SMOKE.md containing a short note that says this change was made by the observing super-agent end-to-end test. Open a pull request with the change.`,
  labels: [config.jira!.defaultConfig.readyTag],
});
console.log(`  created ${created.key} (id ${created.id})`);

// 3. Dispatch. Use the real planner for the prompt, but pin the target repo to
//    junkrepo for this controlled run.
const realPlanner = system.planner;
const pinnedPlanner = {
  plan: async (item: Parameters<Planner['plan']>[0]) => {
    const outcome = await realPlanner.plan(item);
    if (outcome.kind === 'questions') {
      console.log(`  planner asked for clarification: ${outcome.questions.join(' | ')}`);
      return outcome;
    }
    console.log(`  planner proposed repos: ${outcome.plan.repositories.join(', ')}`);
    return { kind: 'plan' as const, plan: { ...outcome.plan, repositories: [REPO] } };
  },
} as Planner;

const orchestrator = new Orchestrator({
  connectors: system.connectors,
  planner: pinnedPlanner,
  agent: system.agent,
  memory: system.memory,
  comms: system.comms,
});

console.log('Dispatching…');
const dispatch = await orchestrator.runDispatchCycle();
console.log('  dispatch summary:', dispatch);

const recordId = recordIdFor({ connector: 'jira', projectId: PROJECT, id: created.id });
let record = await system.memory.get(recordId);
if (!record || record.status !== 'dispatched') {
  console.log('Item was not dispatched (already acted on, or planning/selection failed). Stopping.');
  if (system.mcp) await system.mcp.close();
  process.exit(record ? 0 : 1);
}
console.log(`  dispatched ${record.runs.map((r) => r.agentRunId).join(', ')} (issue ${record.runs[0]?.issueUrl})`);

// 4. Poll until it flows through. When the PR is up for review, merge it via
//    the GitHub API so the run continues all the way to Done.
console.log('Polling for Copilot to open a PR and request review (this can take several minutes)…');
const token = config.agent.github.token;
const start = Date.now();
let merged = false;
while (true) {
  await sleep(POLL_INTERVAL_MS);
  const summary = await system.poller.runPollCycle();
  record = await system.memory.get(recordId);
  const run = record?.runs[0];
  console.log(
    `  [+${Math.round((Date.now() - start) / 1000)}s] status=${record?.status} run=${run?.state}` +
      `${run?.prUrl ? ` pr=${run.prUrl}` : ''} (poll ${JSON.stringify(summary)})`,
  );

  if (record?.status === 'completed' && run?.prUrl && !merged) {
    console.log('PR is up for review — merging it via the GitHub API for a full run-through…');
    merged = await mergePullRequest(run.prUrl, token);
    continue; // next poll should see the merge and advance to Done
  }
  if (record && ['done', 'rejected', 'failed'].includes(record.status)) break;
  if (Date.now() - start > MAX_WAIT_MS) {
    console.log('Timed out waiting for completion.');
    break;
  }
}

// 5. Report final JIRA state.
const issue = await jira.getIssue(created.id);
console.log('\nFinal state:');
console.log(`  record:     ${record?.status}`);
console.log(`  JIRA ${created.key}: status="${issue?.fields.status?.name}" labels=${JSON.stringify(issue?.fields.labels)}`);
console.log(`  JIRA url:   ${config.jira!.baseUrl}/browse/${created.key}`);
console.log(`  GitHub:     ${record?.runs[0]?.prUrl ?? record?.runs[0]?.issueUrl}`);

if (system.mcp) await system.mcp.close();
console.log('\nDone.');
