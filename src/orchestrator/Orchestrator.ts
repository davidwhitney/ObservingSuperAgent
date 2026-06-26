import type { WorkTrackingConnector } from '../worktracking/WorkTrackingConnector';
import type { AgentConnector } from '../agents/AgentConnector';
import type { CommunicationAdapter } from '../comms/CommunicationAdapter';
import type { Planner } from '../llm/Planner';
import { AgentMemory, recordIdFor } from '../memory/AgentMemory';
import { DEFAULT_ACTING, hasLifecyclePolicy } from '../worktracking/LifecyclePolicy';
import type { Annotation, DispatchRecord, DispatchRun, WorkItem, WorkItemRef } from '../domain/types';

export interface OrchestratorDeps {
  connectors: WorkTrackingConnector[];
  planner: Planner;
  agent: AgentConnector;
  memory: AgentMemory;
  comms: CommunicationAdapter;
}

export interface DispatchSummary {
  considered: number;
  skipped: number;
  dispatched: number;
  failed: number;
}

/**
 * Runs one dispatch cycle: pull ready work from every connector, skip items
 * already acted on, plan each new item, record the plan, dispatch an agent per
 * repository, and annotate the source ticket.
 */
export class Orchestrator {
  constructor(private readonly deps: OrchestratorDeps) {}

  async runDispatchCycle(): Promise<DispatchSummary> {
    const summary: DispatchSummary = { considered: 0, skipped: 0, dispatched: 0, failed: 0 };

    for (const connector of this.deps.connectors) {
      const items = await connector.RetrieveWorkReadyForDispatch();
      for (const item of items) {
        summary.considered += 1;
        if (await this.deps.memory.hasActedOn(item)) {
          summary.skipped += 1;
          continue;
        }
        try {
          await this.dispatchItem(connector, item);
          summary.dispatched += 1;
        } catch (err) {
          summary.failed += 1;
          await this.onFailure(item, err);
        }
      }
    }

    return summary;
  }

  private async dispatchItem(connector: WorkTrackingConnector, item: WorkItem): Promise<void> {
    const ref = toRef(item);
    const plan = await this.deps.planner.plan(item);

    // Record the established plan + repositories before dispatching anything.
    const record = this.deps.memory.newRecord({
      id: recordIdFor(ref),
      connector: connector.name,
      workItem: ref,
      projectId: ref.projectId,
      plan,
      runs: [],
      status: 'planned',
    });
    await this.deps.memory.save(record);
    await this.deps.comms.notify({
      type: 'planned',
      workItemKey: ref.key,
      message: `Planned ${plan.repositories.length} repo change(s): ${plan.repositories.join(', ')}`,
    });

    const runs: DispatchRun[] = [];
    for (const repository of plan.repositories) {
      const result = await this.deps.agent.dispatch({ repository, prompt: plan.prompt, workItem: ref });
      runs.push({
        repository,
        agentConnector: this.deps.agent.name,
        agentRunId: result.agentRunId,
        issueUrl: result.issueUrl,
        state: 'in_progress',
        linkAnnounced: false,
      });
    }

    record.runs = runs;
    record.status = 'dispatched';
    await this.deps.memory.save(record);

    // Mark the item as picked up: drop the ready tag, add the acting tag /
    // move columns (per connector policy), and leave a linking comment.
    const acting: Annotation = hasLifecyclePolicy(connector)
      ? connector.dispatchAnnotationFor(ref)
      : { ...DEFAULT_ACTING };
    await connector.AnnotateItem(ref, { ...acting, comment: dispatchComment(record) });
    await this.deps.comms.notify({
      type: 'dispatched',
      workItemKey: ref.key,
      message: `Dispatched to ${this.deps.agent.name}: ${runs.map((r) => r.agentRunId).join(', ')}`,
      data: { agentRunIds: runs.map((r) => r.agentRunId) },
    });
  }

  private async onFailure(item: WorkItem, err: unknown): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    const ref = toRef(item);
    const existing = await this.deps.memory.get(recordIdFor(ref));
    if (existing) {
      existing.status = 'failed';
      await this.deps.memory.save(existing);
    }
    await this.deps.comms.notify({
      type: 'failed',
      workItemKey: ref.key,
      message: `Dispatch failed: ${message}`,
    });
  }
}

export function toRef(item: WorkItem): WorkItemRef {
  return {
    connector: item.connector,
    projectId: item.projectId,
    id: item.id,
    key: item.key,
    url: item.url,
  };
}

function dispatchComment(record: DispatchRecord): string {
  const lines = [
    `🤖 Observing super-agent dispatched this item to ${record.runs[0]?.agentConnector ?? 'an agent'}.`,
    ...record.runs.map((run) => `• ${run.repository} — run ${run.agentRunId}${run.issueUrl ? ` (${run.issueUrl})` : ''}`),
  ];
  if (record.plan.summary) lines.push(`Plan: ${record.plan.summary}`);
  return lines.join('\n');
}
