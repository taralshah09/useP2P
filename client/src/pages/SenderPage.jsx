import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSignaling } from '../hooks/useSignaling.js';
import { usePeerConnection } from '../hooks/usePeerConnection.js';
import { useFileTransfer } from '../hooks/useFileTransfer.js';
import { useTextTransfer } from '../hooks/useTextTransfer.js';
import { CONNECTION_STATES } from '../lib/connectionState.js';
import { textByteLength } from '../lib/textTransfer.js';
import { MAX_TEXT_BYTES } from 'shared/src/constants.js';
import FilePicker from '../components/FilePicker.jsx';
import QRDisplay from '../components/QRDisplay.jsx';
import TransferProgress from '../components/TransferProgress.jsx';

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i];
}

export default function SenderPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState('file'); // file | text
  const [file, setFile] = useState(null);
  const [text, setText] = useState('');
  const [uiStep, setUiStep] = useState('idle');
  const [uiError, setUiError] = useState(null);
  const wakeLockRef = useRef(null);

  const { sessionCode, iceConfig, getClient, createSession } = useSignaling();
  const { connState, connError, init, getManager } = usePeerConnection();
  const { progress, startTransfer } = useFileTransfer();
  const { delivered, startTextTransfer } = useTextTransfer();

  const textBytes = textByteLength(text);
  const textTooLarge = textBytes > MAX_TEXT_BYTES;
  const canSend = mode === 'file' ? !!file : text.trim().length > 0 && !textTooLarge;

  // Sync connState to uiStep
  useEffect(() => {
    if (connState === CONNECTION_STATES.AWAITING_APPROVAL) {
      setUiStep('approval');
    } else if (connState === CONNECTION_STATES.TRANSFERRING) {
      setUiStep('transferring');
    } else if (connState === CONNECTION_STATES.COMPLETE) {
      setUiStep('complete');
    } else if (
      connState === CONNECTION_STATES.FAILED ||
      connState === CONNECTION_STATES.ABORTED
    ) {
      setUiStep('error');
      setUiError(connError || 'Connection failed');
    }
  }, [connState, connError]);

  // Wake lock management (only meaningful for file transfers, harmless for text)
  useEffect(() => {
    if (uiStep === 'transferring' && 'wakeLock' in navigator) {
      navigator.wakeLock.request('screen').then((lock) => {
        wakeLockRef.current = lock;
      }).catch(() => {});
    }
    if (uiStep === 'complete' || uiStep === 'error') {
      wakeLockRef.current?.release();
      wakeLockRef.current = null;
    }
  }, [uiStep]);

  async function handleStart() {
    setUiStep('connecting');
    setUiError(null);
    try {
      await createSession();
    } catch (err) {
      setUiStep('error');
      setUiError(err.message);
    }
  }

  // When both sessionCode and iceConfig are ready, initialize peer connection
  useEffect(() => {
    if (!sessionCode || !iceConfig) return;
    if (uiStep !== 'connecting') return;
    const client = getClient();
    if (!client) return;
    setUiStep('waiting');
    init(client, iceConfig, true, {});
  }, [sessionCode, iceConfig]);

  async function handleApprove() {
    const manager = getManager();
    if (!manager || !canSend) return;
    try {
      if (mode === 'text') {
        await startTextTransfer(text, manager);
      } else {
        await startTransfer(file, manager);
      }
    } catch (err) {
      setUiStep('error');
      setUiError(err.message);
    }
  }

  function handleReject() {
    getManager()?.close();
    setUiStep('waiting');
  }

  const joinUrl = sessionCode
    ? `${window.location.origin}/join/${sessionCode}`
    : '';

  // Shared sub-renders ──────────────────────────────────────────────

  function renderModeToggle() {
    return (
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <button
          className={`btn ${mode === 'file' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setMode('file')}
          style={{ flex: 1 }}
        >
          Send a file
        </button>
        <button
          className={`btn ${mode === 'text' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setMode('text')}
          style={{ flex: 1 }}
        >
          Send text
        </button>
      </div>
    );
  }

  function renderPayloadInput() {
    if (mode === 'file') {
      return <FilePicker file={file} onFileSelect={setFile} disabled={false} />;
    }
    return (
      <div>
        <textarea
          className="input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste or type the text to share…"
          rows={6}
          style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit' }}
        />
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: '0.8rem',
          color: textTooLarge ? '#dc2626' : '#9ca3af',
          marginTop: '0.25rem',
        }}>
          <span>{textTooLarge ? 'Too large — send it as a file instead.' : ''}</span>
          <span>{formatBytes(textBytes)} / {formatBytes(MAX_TEXT_BYTES)}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.5rem' }}>
        <button
          className="btn btn-secondary"
          onClick={() => navigate('/')}
          style={{ padding: '0.25rem 0.75rem', fontSize: '0.875rem' }}
        >
          Back
        </button>
        <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700 }}>Send</h2>
      </div>

      {uiStep === 'idle' && (
        <div>
          {renderModeToggle()}
          {renderPayloadInput()}
          <button
            className="btn btn-primary w-full"
            onClick={handleStart}
            style={{ marginTop: '1rem', width: '100%' }}
          >
            Create Session
          </button>
        </div>
      )}

      {uiStep === 'connecting' && (
        <div className="text-center">
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Connecting...</div>
          <p style={{ color: '#666' }}>Connecting to signaling server</p>
        </div>
      )}

      {uiStep === 'waiting' && (
        <div>
          <div style={{ marginBottom: '1.5rem' }}>
            <div style={{ fontSize: '0.875rem', color: '#666', marginBottom: '1rem' }}>
              Share this QR code or session code with the receiver:
            </div>
            <QRDisplay code={sessionCode} joinUrl={joinUrl} />
          </div>
          <hr style={{ border: 'none', borderTop: '1px solid #e5e7eb', margin: '1.5rem 0' }} />
          <div>
            <div style={{ fontSize: '0.875rem', color: '#666', marginBottom: '0.5rem' }}>
              {canSend ? 'Ready to send:' : 'Prepare what to send while you wait:'}
            </div>
            {renderModeToggle()}
            {renderPayloadInput()}
          </div>
          <div className="alert alert-warning" style={{ marginTop: '1rem' }}>
            Waiting for receiver to connect...
          </div>
        </div>
      )}

      {uiStep === 'approval' && (
        <div>
          <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
            <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Connected</div>
            <h3 style={{ margin: '0 0 0.25rem' }}>Receiver Connected</h3>
            <p style={{ color: '#666', margin: 0 }}>A receiver has joined your session.</p>
          </div>

          {renderModeToggle()}
          {renderPayloadInput()}

          {mode === 'file' && file && (
            <div style={{
              background: '#f0f9ff',
              border: '1px solid #bae6fd',
              borderRadius: '8px',
              padding: '1rem',
              margin: '1rem 0',
            }}>
              <div style={{ fontWeight: 600 }}>{file.name}</div>
              <div style={{ color: '#666', fontSize: '0.875rem' }}>{formatBytes(file.size)}</div>
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
            <button
              className="btn btn-success"
              onClick={handleApprove}
              disabled={!canSend}
              style={{ flexGrow: 1 }}
            >
              {canSend
                ? `Accept and Send ${mode === 'text' ? 'text' : 'file'}`
                : `Accept and Send (${mode === 'text' ? 'enter text first' : 'select a file first'})`}
            </button>
            <button
              className="btn btn-secondary"
              onClick={handleReject}
              style={{ whiteSpace: 'nowrap' }}
            >
              Reject
            </button>
          </div>
        </div>
      )}

      {uiStep === 'transferring' && (
        <div>
          {mode === 'text' ? (
            <div className="text-center">
              <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Sending...</div>
              <h3 style={{ margin: 0 }}>Sending text</h3>
            </div>
          ) : (
            <div>
              <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
                <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Sending...</div>
                <h3 style={{ margin: 0 }}>Sending {file?.name}</h3>
              </div>
              <TransferProgress
                sentBytes={progress.sentBytes}
                totalBytes={progress.totalBytes || file?.size}
                label="Transfer progress"
              />
              <div className="alert alert-warning" style={{ marginTop: '1rem' }}>
                Keep this tab open until the transfer finishes.
              </div>
            </div>
          )}
        </div>
      )}

      {uiStep === 'complete' && (
        <div className="text-center">
          <div style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>Done!</div>
          <h3>{mode === 'text' ? 'Text Sent' : 'Transfer Complete'}</h3>
          <p style={{ color: '#666' }}>
            {mode === 'text'
              ? (delivered ? 'The receiver has your text.' : 'Your text was sent.')
              : `${file?.name} was sent successfully.`}
          </p>
          <button
            className="btn btn-primary"
            onClick={() => navigate('/')}
            style={{ marginTop: '0.5rem' }}
          >
            {mode === 'text' ? 'Send Something Else' : 'Send Another File'}
          </button>
        </div>
      )}

      {uiStep === 'error' && (
        <div className="text-center">
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Error</div>
          <h3>Something went wrong</h3>
          <div className="alert alert-error" style={{ textAlign: 'left', marginBottom: '1rem' }}>
            {uiError}
          </div>
          <button className="btn btn-primary" onClick={() => navigate('/')}>
            Try Again
          </button>
        </div>
      )}
    </div>
  );
}
