import React, { useState, useEffect, lazy, Suspense } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useSignaling } from '../hooks/useSignaling.js';
import { usePeerConnection } from '../hooks/usePeerConnection.js';
import { useFileReceiver } from '../hooks/useFileReceiver.js';
import { CONNECTION_STATES } from '../lib/connectionState.js';
import { supportsFileSystemAccessAPI } from '../lib/capabilities.js';
import { copyToClipboard } from '../lib/clipboard.js';
import AccessCodeEntry from '../components/AccessCodeEntry.jsx';
import TransferProgress from '../components/TransferProgress.jsx';
const QRScanner = lazy(() => import('../components/QRScanner.jsx'));

// Extract the 6-char session code from a scanned value.
// The QR encodes a full URL like https://example.com/join/ABC123,
// but accept a bare code too in case the user's scanner strips the URL.
function extractCode(scannedText) {
  try {
    const url = new URL(scannedText.trim());
    const segments = url.pathname.split('/').filter(Boolean);
    const last = segments[segments.length - 1] ?? '';
    if (last.length === 6) return last.toUpperCase();
  } catch {
    // not a URL — fall through
  }
  const bare = scannedText.trim().toUpperCase();
  if (bare.length === 6) return bare;
  return null;
}

export default function ReceiverPage() {
  const navigate = useNavigate();
  const { code: urlCode } = useParams();
  const [uiStep, setUiStep] = useState(urlCode ? 'connecting' : 'idle');
  const [uiError, setUiError] = useState(null);
  const [showScanner, setShowScanner] = useState(false);
  const [copyStatus, setCopyStatus] = useState(null); // null | 'copied' | 'failed'

  const { sessionCode, iceConfig, getClient, joinSession } = useSignaling();
  const { connState, connError, init, getManager } = usePeerConnection();
  const {
    receiveState,
    progress,
    result,
    receiveError,
    fileInfo,
    receivedText,
    init: initReceiver,
  } = useFileReceiver();

  async function handleCopy() {
    const ok = await copyToClipboard(receivedText ?? '');
    setCopyStatus(ok ? 'copied' : 'failed');
    if (ok) setTimeout(() => setCopyStatus(null), 2000);
  }

  // Auto-connect when URL has a code (QR scan deep-link)
  useEffect(() => {
    if (urlCode) {
      handleJoin(urlCode);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync connState -> uiStep
  useEffect(() => {
    if (connState === CONNECTION_STATES.AWAITING_APPROVAL) {
      setUiStep('waiting');
      const manager = getManager();
      if (manager) initReceiver(manager);
    } else if (
      connState === CONNECTION_STATES.FAILED ||
      connState === CONNECTION_STATES.ABORTED
    ) {
      setUiStep('error');
      setUiError(connError || 'Connection failed');
    }
  }, [connState, connError]);

  // Sync receiveState -> uiStep
  useEffect(() => {
    if (receiveState === 'receiving') setUiStep('receiving');
    else if (receiveState === 'complete') setUiStep('complete');
    else if (receiveState === 'text') setUiStep('text');
    else if (receiveState === 'error') {
      setUiStep('error');
      setUiError(receiveError);
    }
  }, [receiveState, receiveError]);

  async function handleJoin(code) {
    setShowScanner(false);
    setUiStep('connecting');
    setUiError(null);
    try {
      await joinSession(code);
    } catch (err) {
      setUiStep('error');
      setUiError(err.message);
    }
  }

  function handleQrScan(text) {
    const code = extractCode(text);
    if (code) {
      handleJoin(code);
    } else {
      // Scanned something but couldn't parse a code — stay in idle with an error hint
      setShowScanner(false);
      setUiError(`Unrecognised QR code. Please enter the 6-character code manually.`);
    }
  }

  // When session + iceConfig ready, init peer connection as receiver
  useEffect(() => {
    if (!sessionCode || !iceConfig) return;
    const client = getClient();
    if (!client) return;
    init(client, iceConfig, false, {});
  }, [sessionCode, iceConfig]);

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.5rem' }}>
        <button
          className="btn btn-secondary"
          onClick={() => navigate('/')}
          style={{ padding: '0.25rem 0.75rem', fontSize: '0.875rem' }}
        >
          ← Back
        </button>
        <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700 }}>Receive</h2>
      </div>

      {!supportsFileSystemAccessAPI() && (
        <div className="alert alert-warning" style={{ marginBottom: '1rem', fontSize: '0.85rem' }}>
          ⚠️ Files over 150 MB may not transfer reliably on this browser. Use Chrome or Edge on desktop for large files.
        </div>
      )}

      {/* idle: QR scanner toggle + manual code entry */}
      {uiStep === 'idle' && (
        <div>
          {showScanner ? (
            <Suspense fallback={<div style={{ textAlign: 'center', padding: '1.5rem', color: '#6b7280' }}>Loading scanner…</div>}>
              <QRScanner onScan={handleQrScan} onClose={() => setShowScanner(false)} />
            </Suspense>
          ) : (
            <div>
              <button
                className="btn btn-primary w-full"
                style={{ padding: '0.75rem', fontSize: '0.95rem' }}
                onClick={() => { setUiError(null); setShowScanner(true); }}
              >
                📷 Scan QR Code
              </button>

              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                margin: '1rem 0',
                color: '#9ca3af',
                fontSize: '0.875rem',
              }}>
                <hr style={{ flex: 1, border: 'none', borderTop: '1px solid #e5e7eb' }} />
                <span>or enter the code</span>
                <hr style={{ flex: 1, border: 'none', borderTop: '1px solid #e5e7eb' }} />
              </div>

              <AccessCodeEntry onJoin={handleJoin} disabled={false} />

              {uiError && (
                <div className="alert alert-error" style={{ marginTop: '0.75rem' }}>
                  {uiError}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {uiStep === 'connecting' && (
        <div className="text-center">
          <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>⏳</div>
          <p style={{ color: '#6b7280' }}>Joining session…</p>
        </div>
      )}

      {uiStep === 'waiting' && (
        <div className="text-center">
          <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>🔗</div>
          <h3 style={{ margin: '0 0 0.5rem' }}>Connected to Sender</h3>
          <p style={{ color: '#6b7280' }}>Waiting for the sender to start the transfer…</p>
        </div>
      )}

      {uiStep === 'receiving' && (
        <div>
          <div style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>📥</div>
            <h3 style={{ margin: 0 }}>Receiving {fileInfo?.name}</h3>
          </div>
          <TransferProgress
            sentBytes={progress.receivedBytes}
            totalBytes={progress.totalBytes}
            label="Download progress"
          />
        </div>
      )}

      {uiStep === 'text' && (
        <div>
          <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>📋</div>
            <h3 style={{ margin: 0 }}>Text Received</h3>
          </div>
          <textarea
            className="input"
            value={receivedText ?? ''}
            readOnly
            rows={8}
            style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit' }}
            onFocus={(e) => e.target.select()}
          />
          <button
            className="btn btn-primary w-full"
            onClick={handleCopy}
            style={{ marginTop: '0.75rem', width: '100%' }}
          >
            Copy to clipboard
          </button>
          {copyStatus === 'copied' && (
            <div className="alert alert-info" style={{ marginTop: '0.75rem', textAlign: 'center' }}>
              ✅ Copied to your clipboard
            </div>
          )}
          {copyStatus === 'failed' && (
            <div className="alert alert-error" style={{ marginTop: '0.75rem', textAlign: 'center' }}>
              Couldn't copy automatically — select the text above and copy it manually.
            </div>
          )}
          <button
            className="btn btn-secondary w-full"
            onClick={() => navigate('/')}
            style={{ marginTop: '0.75rem', width: '100%' }}
          >
            Done
          </button>
        </div>
      )}

      {uiStep === 'complete' && (
        <div className="text-center">
          <div style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>✅</div>
          <h3 style={{ marginBottom: '0.5rem' }}>Download Complete!</h3>
          {result?.savedToDisk ? (
            <p style={{ color: '#6b7280' }}>File saved to your chosen location.</p>
          ) : (
            <p style={{ color: '#6b7280' }}>"{fileInfo?.name}" downloaded successfully.</p>
          )}
          <button
            className="btn btn-primary"
            onClick={() => navigate('/receive')}
            style={{ marginTop: '0.75rem' }}
          >
            Receive Another File
          </button>
        </div>
      )}

      {uiStep === 'error' && (
        <div className="text-center">
          <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>❌</div>
          <h3>Connection Failed</h3>
          <div className="alert alert-error" style={{ textAlign: 'left', marginBottom: '1rem' }}>
            {uiError}
          </div>
          <button className="btn btn-primary" onClick={() => navigate('/')}>
            Go Home
          </button>
        </div>
      )}
    </div>
  );
}
