/**
 * Staged manual run against the real configured services.
 *
 *   tsx scripts/dry-run.ts            # stage 1: retrieve ready work (read-only)
 *   tsx scripts/dry-run.ts --plan     # stage 2: also produce a plan (local LLM, no dispatch)
 *   tsx scripts/dry-run.ts --dispatch # stage 3: full dispatch (creates GitHub issues, assigns
 *                                      #          Copilot, comments JIRA) — real side effects
 */
import { loadConfig } from '../src/config/load';
import { buildFromConfig } from '../src/composition/buildFromConfig';
import { ensureFoundryLocal } from '../src/llm/FoundryLocalLauncher';

const doPlan = process.argv.includes('--plan');
const doDispatch = process.argv.includes('--dispatch');
const doPoll = process.argv.includes('--poll');
const doReconcile = process.argv.includes('--reconcile');
const apply = process.argv.includes('--apply');

const config = loadConfig();

if (doPlan || doDispatch) {
  const runtime = await ensureFoundryLocal(config.llm);
  if (runtime.endpoint) config.llm.endpoint = runtime.endpoint;
  if (runtime.model) config.llm.model = runtime.model;
}

const system = buildFromConfig(config);

if (system.connectors.length === 0) {
  console.log('No work-tracking connectors configured.');
  process.exit(0);
}

console.log('Stage 1 — retrieving ready work…\n');
let total = 0;
for (const connector of system.connectors) {
  const items = await connector.RetrieveWorkReadyForDispatch();
  total += items.length;
  console.log(`[${connector.name}] ${items.length} ready item(s):`);
  for (const item of items) {
    console.log(`  • ${item.key ?? item.id} — "${item.title}"  [${item.projectId}, status="${item.status}", tags=${item.tags.join('/')}]`);
    console.log(`    ${item.url}`);
  }
}

if (total === 0 && !doPoll && !doReconcile) {
  console.log('\nNothing ready. Make sure the ticket has the "agent-ready" label (or is in a ready column).');
  process.exit(0);
}

if (doPlan && !doDispatch) {
  console.log('\nStage 2 — planning (no dispatch)…\n');
  for (const connector of system.connectors) {
    for (const item of await connector.RetrieveWorkReadyForDispatch()) {
      try {
        const outcome = await system.planner.plan(item);
        if (outcome.kind === 'questions') {
          console.log(`Clarification needed for ${item.key ?? item.id}:`);
          outcome.questions.forEach((q, i) => console.log(`  ${i + 1}. ${q}`));
          console.log('');
          continue;
        }
        const plan = outcome.plan;
        console.log(`Plan for ${item.key ?? item.id}:`);
        console.log(`  repositories: ${plan.repositories.join(', ')}`);
        if (plan.summary) console.log(`  summary: ${plan.summary}`);
        console.log(`  prompt:\n${plan.prompt.split('\n').map((l) => '    ' + l).join('\n')}\n`);
      } catch (err) {
        console.log(`  ❌ planning failed: ${(err as Error).message}\n`);
      }
    }
  }
  if (system.mcp) await system.mcp.close();
}

if (doDispatch) {
  console.log('\nStage 3 — DISPATCHING (real side effects)…\n');
  const summary = await system.orchestrator.runDispatchCycle();
  console.log('Dispatch summary:', summary);
  console.log('\nRecords:');
  for (const record of await system.memory.all()) {
    console.log(`  ${record.workItem.key ?? record.id}: ${record.status} -> ${record.runs.map((r) => r.agentRunId).join(', ')}`);
  }
  if (system.mcp) await system.mcp.close();
}

if (doPoll) {
  console.log('\nStage — POLLING dispatched work (real side effects on status change)…\n');
  const summary = await system.poller.runPollCycle();
  console.log('Poll summary:', summary);
  console.log('\nRecords:');
  for (const record of await system.memory.all()) {
    const runs = record.runs.map((r) => `${r.agentRunId} [${r.state}${r.prUrl ? ', ' + r.prUrl : ''}]`).join(', ');
    console.log(`  ${record.workItem.key ?? record.id}: ${record.status} -> ${runs}`);
  }
  if (system.mcp) await system.mcp.close();
}

if (doReconcile) {
  console.log(`\nStage — RECONCILE (${apply ? 'APPLY — real writes' : 'dry-run, read-only'})…\n`);
  const summary = await system.reconciler.reconcile({ apply });
  console.log('Reconcile summary:', {
    apply: summary.apply,
    scanned: summary.scanned,
    inSync: summary.inSync,
    drifted: summary.drifted,
    repaired: summary.repaired,
  });
  for (const e of summary.entries) {
    const flag = e.actions.length === 0 ? 'ok' : e.applied ? 'REPAIRED' : 'DRIFT';
    const detail = e.actions.length ? ` | ${e.actions.join('; ')}` : '';
    console.log(`  [${flag}] ${e.workItemKey ?? e.id}: ${e.recordedStatus} -> ${e.derivedStatus}${detail}`);
  }
  if (system.mcp) await system.mcp.close();
}

console.log('\nDone.');
