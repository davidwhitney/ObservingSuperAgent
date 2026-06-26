/**
 * Continue a clarifying ticket: post an (explicit) answer and run one more
 * dispatch cycle. Usage: npx tsx scripts/clarify-continue.ts <issueId> [answer]
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
const issueId = process.argv[2] ?? '10035';
const answer =
  process.argv[3] ??
  `The task is exactly this: create a file named CLARIFY.md in the ${REPO} GitHub repository containing the single line "clarification demo", and open a pull request. There are no other requirements and no ambiguity — please proceed and do not ask further questions.`;

const config = loadConfig();
const runtime = await ensureFoundryLocal(config.llm);
if (runtime.endpoint) config.llm.endpoint = runtime.endpoint;
if (runtime.model) config.llm.model = runtime.model;
const system = buildFromConfig(config);

const jira = new JiraClient({
  baseUrl: config.jira!.baseUrl,
  email: config.jira!.email,
  apiToken: config.jira!.apiToken,
});

console.log(`Posting an explicit answer on issue ${issueId}…`);
await jira.addComment(issueId, answer);

const pinnedPlanner = {
  plan: async (item: Parameters<Planner['plan']>[0]) => {
    const outcome = await system.planner.plan(item);
    if (outcome.kind === 'plan') return { kind: 'plan' as const, plan: { ...outcome.plan, repositories: [REPO] } };
    console.log(`  planner asked again: ${outcome.questions.join(' | ')}`);
    return outcome;
  },
} as Planner;

const orchestrator = new Orchestrator({
  connectors: system.connectors,
  planner: pinnedPlanner,
  agent: system.agent,
  memory: system.memory,
  comms: system.comms,
});

console.log('Re-evaluating…');
console.log('  summary:', await orchestrator.runDispatchCycle());
const record = await system.memory.get(recordIdFor({ connector: 'jira', projectId: PROJECT, id: issueId }));
console.log(`  record: ${record?.status}${record?.runs[0] ? ` (${record.runs[0].agentRunId})` : ''}`);

if (system.mcp) await system.mcp.close();
console.log('Done.');
