import type { CommunicationAdapter } from './CommunicationAdapter';
import type { CommEvent } from '../domain/types';

/**
 * Fans a notification out to every configured adapter. A single adapter
 * failing does not prevent the others from receiving the event; the first
 * error is rethrown after all have been attempted.
 */
export class CompositeCommunicationAdapter implements CommunicationAdapter {
  readonly name = 'composite';

  constructor(private readonly adapters: CommunicationAdapter[]) {}

  async notify(event: CommEvent): Promise<void> {
    const results = await Promise.allSettled(this.adapters.map((a) => a.notify(event)));
    const failure = results.find((r) => r.status === 'rejected');
    if (failure && failure.status === 'rejected') throw failure.reason;
  }
}
