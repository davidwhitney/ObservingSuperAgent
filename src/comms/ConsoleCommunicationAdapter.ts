import type { CommunicationAdapter } from './CommunicationAdapter';
import type { CommEvent } from '../domain/types';

/** Default communication adapter: writes structured events to the console. */
export class ConsoleCommunicationAdapter implements CommunicationAdapter {
  readonly name = 'console';

  constructor(private readonly log: (message: string) => void = console.log) {}

  async notify(event: CommEvent): Promise<void> {
    const tag = `[osa:${event.type}]`;
    const item = event.workItemKey ? ` (${event.workItemKey})` : '';
    this.log(`${tag}${item} ${event.message}`);
  }
}
