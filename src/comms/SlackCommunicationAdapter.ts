import type { CommunicationAdapter } from './CommunicationAdapter';
import type { CommEvent } from '../domain/types';
import { NotImplementedError } from '../composition/errors';

export interface SlackOptions {
  webhookUrl?: string;
  channel?: string;
}

/** Posts notifications to a Slack channel. Wiring deferred. */
export class SlackCommunicationAdapter implements CommunicationAdapter {
  readonly name = 'slack';
  constructor(private readonly options: SlackOptions) {}
  async notify(_event: CommEvent): Promise<void> {
    throw new NotImplementedError('SlackCommunicationAdapter');
  }
}
