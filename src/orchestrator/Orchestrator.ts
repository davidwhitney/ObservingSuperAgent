import type { WorkTrackingConnector } from '../worktracking/WorkTrackingConnector';
import type { AgentConnector } from '../agents/AgentConnector';
import type { CommunicationAdapter } from '../comms/CommunicationAdapter';
import type { Planner } from '../llm/Planner';
import { AgentMemory, recordIdFor } from '../memory/AgentMemory';
import { expectedAnnotationFor } from './lifecycle';
import type { DispatchPlan, DispatchRecord, DispatchRun, WorkItem, WorkItemRef } from '../domain/types';

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
  /** Items the planner asked clarifying questions about (awaiting a reply). */
  asked: number;
  dispatched: number;
  failed: number;
}

/**
 * Runs one dispatch cycle: pull ready work, skip items already acted on, and
 * evaluate each new (or newly-answered) item. The planner either asks for
 * clarification — which we post to the ticket and revisit once a human replies —
 * or returns a plan, which we record, dispatch, and annotate onto the ticket.
 */
export class Orchestrator {
  constructor(private readonly deps: OrchestratorDeps) {}

  async runDispatchCycle(): Promise<DispatchSummary> {
    const summary: DispatchSummary = { considered: 0, skipped: 0, asked: 0, dispatched: 0, failed: 0 };

    for (const connector of this.deps.connectors) {
      const items = await connector.RetrieveWorkReadyForDispatch();
      for (const item of items) {
        summary.considered += 1;

        const existing = await this.deps.memory.findByWorkItem(item);
        if (existing && existing.status !== 'clarifying') {
          summary.skipped += 1; // already dispatched / terminal
          continue;
        }
        if (existing?.status === 'clarifying' && !hasNewReply(item, existing)) {
          summary.skipped += 1; // still waiting on a human reply
          continue;
        }

        try {
          const outcome = await this.deps.planner.plan(item);
          if (outcome.kind === 'questions') {
            await this.recordClarification(connector, item, outcome.questions);
            await this.deps.comms.notify({
              type: 'asked',
              workItemKey: item.key,
              message: `Asked for clarification (${outcome.questions.length} question(s))`,
            });
            summary.asked += 1;
          } else {
            await this.dispatchItem(connector, item, outcome.plan);
            summary.dispatched += 1;
          }
        } catch (err) {
          summary.failed += 1;
          await this.onFailure(item, err);
        }
      }
    }

    return summary;
  }

  /** Post the planner's questions to the ticket and record a 'clarifying' state. */
  private async recordClarification(
    connector: WorkTrackingConnector,
    item: WorkItem,
    questions: string[],
  ): Promise<void> {
    const ref = toRef(item);
    const countBefore = item.comments.length;
    await connector.AnnotateItem(ref, { comment: clarificationComment(questions) });

    const record = this.deps.memory.newRecord({
      id: recordIdFor(ref),
      connector: connector.name,
      workItem: ref,
      projectId: ref.projectId,
      plan: { repositories: [], prompt: '' },
      runs: [],
      status: 'clarifying',
      clarification: { questions, commentCountAtAsk: countBefore + 1, askedAt: '' },
    });
    record.clarification!.askedAt = record.createdAt;
    await this.deps.memory.save(record);
  }

  private async dispatchItem(connector: WorkTrackingConnector, item: WorkItem, plan: DispatchPlan): Promise<void> {
    const ref = toRef(item);

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

    const acting = expectedAnnotationFor(connector, ref, 'dispatched') ?? {};
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

/** True if the item has gained comments since we last asked for clarification. */
function hasNewReply(item: WorkItem, record: DispatchRecord): boolean {
  return item.comments.length > (record.clarification?.commentCountAtAsk ?? 0);
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

function clarificationComment(questions: string[]): string {
  return [
    '🤖 Before I can dispatch this, I need some clarification:',
    ...questions.map((q, i) => `${i + 1}. ${q}`),
    '',
    "Reply on this ticket and I'll re-evaluate on the next run.",
  ].join('\n');
}

function dispatchComment(record: DispatchRecord): string {
  const lines = [
    `🤖 Observing super-agent dispatched this item to ${record.runs[0]?.agentConnector ?? 'an agent'}.`,
    ...record.runs.map((run) => `• ${run.repository} — run ${run.agentRunId}${run.issueUrl ? ` (${run.issueUrl})` : ''}`),
  ];
  if (record.plan.summary) lines.push(`Plan: ${record.plan.summary}`);
  return lines.join('\n');
}
