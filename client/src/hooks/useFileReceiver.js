import { useState, useRef, useCallback } from 'react';
import { FileReceiver } from '../lib/receiver.js';
import { CONTROL_MESSAGES } from '../lib/protocol.js';
import { CONNECTION_STATES } from '../lib/connectionState.js';

export function useFileReceiver() {
  const [receiveState, setReceiveState] = useState('idle'); // idle | receiving | complete | text | error
  const [progress, setProgress] = useState({ receivedBytes: 0, totalBytes: 0 });
  const [result, setResult] = useState(null);
  const [receiveError, setReceiveError] = useState(null);
  const [fileInfo, setFileInfo] = useState(null);
  const [receivedText, setReceivedText] = useState(null);
  const receiverRef = useRef(null);

  const init = useCallback((manager) => {
    const fileReceiver = new FileReceiver((p) => setProgress(p));
    receiverRef.current = fileReceiver;

    manager.onDataChannelMessage = async (data) => {
      try {
        // Peek at metadata message to surface file info in the UI before handleMessage processes it
        if (typeof data === 'string') {
          try {
            const msg = JSON.parse(data);
            if (msg.type === CONTROL_MESSAGES.TEXT_MESSAGE) {
              // Phase 6 — text sharing. Handled entirely here; the FileReceiver
              // has no concept of text, so surface it and ack the sender.
              setReceivedText(msg.text);
              setReceiveState('text');
              manager.stateMachine.transition(CONNECTION_STATES.COMPLETE);
              try {
                manager.sendData(JSON.stringify({ type: CONTROL_MESSAGES.TEXT_RECEIVED }));
              } catch (_) {
                // ack is best-effort; the receiver already has the text
              }
              return;
            }
            if (msg.type === CONTROL_MESSAGES.FILE_METADATA) {
              setFileInfo({ name: msg.name, size: msg.size, mime: msg.mime });
              setReceiveState('receiving');
              setProgress({ receivedBytes: 0, totalBytes: msg.size });
            }
          } catch (_) {
            // not JSON — let handleMessage deal with it
          }
        }

        const transferResult = await fileReceiver.handleMessage(data);

        if (transferResult?.success) {
          manager.stateMachine.transition(CONNECTION_STATES.COMPLETE);
          setReceiveState('complete');
          setResult(transferResult);

          // Auto-trigger download for in-memory blob path
          if (!transferResult.savedToDisk && transferResult.blobUrl) {
            const a = document.createElement('a');
            a.href = transferResult.blobUrl;
            a.download = transferResult.name;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
          }
        }
      } catch (err) {
        manager.stateMachine.fail(err.message);
        setReceiveState('error');
        setReceiveError(err.message);
      }
    };
  }, []);

  const reset = useCallback(() => {
    receiverRef.current = null;
    setReceiveState('idle');
    setProgress({ receivedBytes: 0, totalBytes: 0 });
    setResult(null);
    setReceiveError(null);
    setFileInfo(null);
    setReceivedText(null);
  }, []);

  return { receiveState, progress, result, receiveError, fileInfo, receivedText, init, reset };
}
