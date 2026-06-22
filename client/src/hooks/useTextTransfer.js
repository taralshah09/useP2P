import { useState, useCallback } from 'react';
import { sendText } from '../lib/textTransfer.js';
import { CONTROL_MESSAGES } from '../lib/protocol.js';
import { CONNECTION_STATES } from '../lib/connectionState.js';

/**
 * Sender-side hook for the Phase 6 text path. Thin wrapper over sendText():
 * the hook only holds React state, all logic lives in lib/textTransfer.js.
 */
export function useTextTransfer() {
  const [textState, setTextState] = useState('idle'); // idle | sending | complete | error
  const [textError, setTextError] = useState(null);
  const [delivered, setDelivered] = useState(false); // receiver acked TEXT_RECEIVED

  const startTextTransfer = useCallback(async (text, manager) => {
    if (!manager?.dataChannel || !manager?.pc) {
      throw new Error('Not ready to transfer');
    }
    setTextState('sending');
    setTextError(null);
    setDelivered(false);

    // Listen for the receiver's delivery ack. The channel is reliable so the
    // send itself already guarantees arrival; this just upgrades the UI to
    // "receiver confirmed" once the other end has it.
    manager.onDataChannelMessage = (data) => {
      try {
        const msg = JSON.parse(data);
        if (msg?.type === CONTROL_MESSAGES.TEXT_RECEIVED) setDelivered(true);
      } catch {
        // ignore non-JSON
      }
    };

    manager.stateMachine.transition(CONNECTION_STATES.TRANSFERRING);
    try {
      sendText(text, manager.dataChannel, manager.pc);
      manager.stateMachine.transition(CONNECTION_STATES.COMPLETE);
      setTextState('complete');
    } catch (err) {
      manager.stateMachine.fail(err.message);
      setTextState('error');
      setTextError(err.message);
      throw err;
    }
  }, []);

  const reset = useCallback(() => {
    setTextState('idle');
    setTextError(null);
    setDelivered(false);
  }, []);

  return { textState, textError, delivered, startTextTransfer, reset };
}
