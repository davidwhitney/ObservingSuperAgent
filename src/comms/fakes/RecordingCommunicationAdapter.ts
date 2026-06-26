import type { CommunicationAdapter } from '../CommunicationAdapter';
import type { CommEvent } from '../../domain/types';

/** Captures every notified event for assertions in tests. */
export class RecordingCommunicationAdapter implements CommunicationAdapter {
  readonly name = 'recording';
  readonly events: CommEvent[] = [];

  async notify(event: CommEvent): Promise<void> {
    this.events.push(event);
  }

  typesSeen(): string[] {
    return this.events.map((e) => e.type);
  }
}
