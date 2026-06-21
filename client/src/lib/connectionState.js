export const CONNECTION_STATES = {
  IDLE: 'idle',
  SIGNALING: 'signaling',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  AWAITING_APPROVAL: 'awaiting-approval',
  TRANSFERRING: 'transferring',
  VERIFYING: 'verifying',
  COMPLETE: 'complete',
  FAILED: 'failed',
  ABORTED: 'aborted'
};

export class ConnectionStateMachine {
  constructor(onStateChange) {
    this.state = CONNECTION_STATES.IDLE;
    this.errorReason = null;
    this.onStateChange = onStateChange || (() => {});
  }

  transition(newState, reason = null) {
    // Basic validation
    if (!Object.values(CONNECTION_STATES).includes(newState)) {
      throw new Error(`Invalid state: ${newState}`);
    }
    
    // Once failed or complete or aborted, no more transitions unless resetting to idle
    if (
      (this.state === CONNECTION_STATES.FAILED || 
       this.state === CONNECTION_STATES.COMPLETE || 
       this.state === CONNECTION_STATES.ABORTED) && 
      newState !== CONNECTION_STATES.IDLE
    ) {
      return false; // Ignored
    }

    this.state = newState;
    if (reason) {
      this.errorReason = reason;
    }
    
    this.onStateChange(this.state, this.errorReason);
    return true;
  }

  fail(reason) {
    return this.transition(CONNECTION_STATES.FAILED, reason);
  }

  abort(reason) {
    return this.transition(CONNECTION_STATES.ABORTED, reason);
  }

  getState() {
    return this.state;
  }
}
