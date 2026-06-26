/**
 * Live demo of the planner clarification loop: create a deliberately vague
 * ticket, run a dispatch cycle (expect the planner to ask questions rather than
 * dispatch), post a human answer on the ticket, then re-run (expect dispatch).
 *
 * Pins the target repo to davidwhitney/junkrepo so any real dispatch is safe.
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

// A deliberately under-specified ticket: no repo, no detail.
console.log('Creating a deliberately vague ticket…');
const created = await jira.createIssue({
  projectKey: PROJECT,
  issueType: 'Task',
  summary: 'Please make some improvements',
  description: 'We should make this better. Can you sort it out?',
  labels: [config.jira!.defaultConfig.readyTag],
});
console.log(`  created ${created.key} (id ${created.id})`);

// Pin the repo so a real dispatch (if it plans) is safe.
const realPlanner = system.planner;
const pinnedPlanner = {
  plan: async (item: Parameters<Planner['plan']>[0]) => {
    const outcome = await realPlanner.plan(item);
    if (outcome.kind === 'plan') return { kind: 'plan' as const, plan: { ...outcome.plan, repositories: [REPO] } };
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
const recordId = recordIdFor({ connector: 'jira', projectId: PROJECT, id: created.id });

console.log('\nCycle 1 — evaluate the vague ticket…');
console.log('  summary:', await orchestrator.runDispatchCycle());
let record = await system.memory.get(recordId);

if (record?.status === 'clarifying') {
  console.log('✅ Planner asked for clarification instead of dispatching:');
  record.clarification?.questions.forEach((q, i) => console.log(`   ${i + 1}. ${q}`));

  console.log('\nPosting a human answer on the ticket…');
  await jira.addComment(
    created.id,
    `Please add a file called CLARIFY.md to the ${REPO} repository containing a short note describing this change, and open a pull request.`,
  );

  console.log('\nCycle 2 — re-evaluate now that the question is answered…');
  console.log('  summary:', await orchestrator.runDispatchCycle());
  record = await system.memory.get(recordId);
} else {
  console.log(`Planner did not ask (status=${record?.status}) — it planned without clarification this time.`);
}

const issue = await jira.getIssue(created.id);
console.log('\nFinal state:');
console.log(`  record:   ${record?.status}${record?.runs[0] ? ` (${record.runs[0].agentRunId})` : ''}`);
console.log(`  JIRA ${created.key}: status="${issue?.fields.status?.name}" comments=${issue?.fields.comment?.comments?.length ?? 0}`);
console.log(`  JIRA url: ${config.jira!.baseUrl}/browse/${created.key}`);

if (system.mcp) await system.mcp.close();
console.log('\nDone.');
