import type { CommEvent } from '../domain/types';

/** Adapter for delivering notifications about agent activity to humans. */
export interface CommunicationAdapter {
  readonly name: string;
  notify(event: CommEvent): Promise<void>;
}
