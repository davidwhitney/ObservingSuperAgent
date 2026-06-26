/** Thrown by adapters that are declared but not yet implemented in this build. */
export class NotImplementedError extends Error {
  constructor(what: string) {
    super(`${what} is not implemented in this build`);
    this.name = 'NotImplementedError';
  }
}
