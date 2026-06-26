import type { WorkTrackingConnector } from '../worktracking/WorkTrackingConnector';
import type { AgentConnector } from '../agents/AgentConnector';
import type { CommunicationAdapter } from '../comms/CommunicationAdapter';
import { AgentMemory } from '../memory/AgentMemory';
import { connectorsByName, resolveRecord } from './lifecycle';

export interface PollerDeps {
  connectors: WorkTrackingConnector[];
  agent: AgentConnector;
  memory: AgentMemory;
  comms: CommunicationAdapter;
}

export interface PollSummary {
  polled: number;
  linked: number;
  completed: number;
  done: number;
  rejected: number;
  failed: number;
}

/**
 * Runs one poll cycle over in-flight records (dispatched or up for review):
 * refreshes each agent run, links opened PRs, and advances the ticket through
 * the lifecycle (in review → done on merge, or rejected on close) via the
 * shared {@link resolveRecord}.
 */
export class Poller {
  private readonly connectors: Map<string, WorkTrackingConnector>;

  constructor(private readonly deps: PollerDeps) {
    this.connectors = connectorsByName(deps.connectors);
  }

  async runPollCycle(): Promise<PollSummary> {
    const summary: PollSummary = { polled: 0, linked: 0, completed: 0, done: 0, rejected: 0, failed: 0 };
    const records = await this.deps.memory.recordsToPoll();

    for (const record of records) {
      const connector = this.connectors.get(record.connector);
      if (!connector) continue;
      summary.polled += 1;

      try {
        const linkedBefore = record.runs.filter((r) => r.linkAnnounced).length;
        const result = await resolveRecord(connector, this.deps, record, true);
        summary.linked += record.runs.filter((r) => r.linkAnnounced).length - linkedBefore;

        if (result.statusChanged) {
          if (result.after === 'completed') summary.completed += 1;
          else if (result.after === 'done') summary.done += 1;
          else if (result.after === 'rejected') summary.rejected += 1;
          else if (result.after === 'failed') summary.failed += 1;
        }
      } catch (err) {
        // A single failing item must not abort the whole cycle.
        await this.deps.comms.notify({
          type: 'failed',
          workItemKey: record.workItem.key,
          message: `Poll failed for ${record.id}: ${(err as Error).message.slice(0, 160)}`,
        });
      }
    }

    return summary;
  }
}
