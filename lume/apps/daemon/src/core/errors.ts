/** Error taxonomy shared across core components. */
export class TurnAbortedError extends Error {
  constructor() {
    super('turn aborted')
    this.name = 'TurnAbortedError'
  }
}

export class MaxLoopsError extends Error {
  constructor(readonly maxLoops: number) {
    super(`tool loop limit of ${maxLoops} exceeded`)
    this.name = 'MaxLoopsError'
  }
}
