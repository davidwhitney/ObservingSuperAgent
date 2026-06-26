import type { CommunicationAdapter } from './CommunicationAdapter';
import type { CommEvent } from '../domain/types';
import { NotImplementedError } from '../composition/errors';

export interface TeamsOptions {
  webhookUrl?: string;
  channel?: string;
}

/** Posts notifications to a Microsoft Teams channel. Wiring deferred. */
export class TeamsCommunicationAdapter implements CommunicationAdapter {
  readonly name = 'teams';
  constructor(private readonly options: TeamsOptions) {}
  async notify(_event: CommEvent): Promise<void> {
    throw new NotImplementedError('TeamsCommunicationAdapter');
  }
}
