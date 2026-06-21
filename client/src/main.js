import { SignalingClient } from './lib/signalingClient.js';
import { PeerConnectionManager } from './lib/peerConnection.js';
import { fetchIceConfig } from './lib/iceConfig.js';
import { SIGNALING_TYPES } from 'shared/src/signaling-messages.js';

const SIGNALING_URL = 'ws://localhost:3001';
const ICE_CONFIG_URL = 'http://localhost:3001/ice-config';

const ui = {
  stateDisplay: document.getElementById('stateDisplay'),
  btnCreate: document.getElementById('btnCreate'),
  btnJoin: document.getElementById('btnJoin'),
  inputCode: document.getElementById('inputCode'),
  setupView: document.getElementById('setupView'),
  transferView: document.getElementById('transferView'),
  displayCode: document.getElementById('displayCode'),
  msgInput: document.getElementById('msgInput'),
  btnSend: document.getElementById('btnSend'),
  btnDisconnect: document.getElementById('btnDisconnect'),
  logBox: document.getElementById('logBox')
};

function log(msg) {
  const time = new Date().toLocaleTimeString();
  ui.logBox.textContent += `[${time}] ${msg}\n`;
  ui.logBox.scrollTop = ui.logBox.scrollHeight;
}

let signalingClient = null;
let pcManager = null;
let currentCode = '';
let cachedIceConfig = null;

async function initSignaling() {
  if (!signalingClient) {
    signalingClient = new SignalingClient(SIGNALING_URL);
    signalingClient.onDisconnect = () => {
      log('Signaling server disconnected');
      if (pcManager) pcManager.stateMachine.fail('Signaling disconnected');
    };
    await signalingClient.connect();
    log('Connected to signaling server');
    // Prefetch ICE config so the PeerConnectionManager can be created
    // synchronously inside session handlers — avoiding a race where the
    // sender's OFFER arrives before the receiver's OFFER handler is registered.
    cachedIceConfig = await fetchIceConfig(ICE_CONFIG_URL);
  }
}

ui.btnCreate.addEventListener('click', async () => {
  await initSignaling();

  signalingClient.on(SIGNALING_TYPES.SESSION_CREATED, async (msg) => {
    currentCode = msg.payload.code;
    log(`Session created. Code: ${currentCode}`);
    ui.displayCode.textContent = currentCode;
    ui.setupView.classList.add('hidden');
    ui.transferView.classList.remove('hidden');

    const iceConfig = cachedIceConfig;
    pcManager = new PeerConnectionManager(signalingClient, iceConfig, true);

    pcManager.onStateChange = (state, reason) => {
      ui.stateDisplay.textContent = state + (reason ? ` (${reason})` : '');
      log(`State changed: ${state}${reason ? ` (${reason})` : ''}`);
    };

    pcManager.onIceCandidate = (type, candidate) => {
      if (type === 'done') {
        log('[ICE] gathering complete');
      } else {
        log(`[ICE] gathered ${type} candidate`);
      }
    };

    pcManager.onDataChannelMessage = (data) => {
      const text = new TextDecoder().decode(data);
      log(`Received: ${text}`);
    };
  });

  signalingClient.createSession();
});

ui.btnJoin.addEventListener('click', async () => {
  const code = ui.inputCode.value.trim().toUpperCase();
  if (code.length !== 6) return alert('Enter a 6 character code');

  await initSignaling();

  signalingClient.on(SIGNALING_TYPES.SESSION_JOINED, async () => {
    currentCode = code;
    log(`Joined session: ${currentCode}`);
    ui.displayCode.textContent = currentCode;
    ui.setupView.classList.add('hidden');
    ui.transferView.classList.remove('hidden');

    const iceConfig = cachedIceConfig;
    pcManager = new PeerConnectionManager(signalingClient, iceConfig, false);

    pcManager.onStateChange = (state, reason) => {
      ui.stateDisplay.textContent = state + (reason ? ` (${reason})` : '');
      log(`State changed: ${state}${reason ? ` (${reason})` : ''}`);
    };

    pcManager.onIceCandidate = (type, candidate) => {
      if (type === 'done') {
        log('[ICE] gathering complete');
      } else {
        log(`[ICE] gathered ${type} candidate`);
      }
    };

    pcManager.onDataChannelMessage = (data) => {
      const text = new TextDecoder().decode(data);
      log(`Received: ${text}`);
    };
  });

  signalingClient.on(SIGNALING_TYPES.ERROR, (msg) => {
    log(`Error joining: ${msg.message}`);
  });

  signalingClient.joinSession(code);
});

ui.btnSend.addEventListener('click', () => {
  if (!pcManager) return;
  const text = ui.msgInput.value;
  if (!text) return;

  const data = new TextEncoder().encode(text);
  try {
    pcManager.sendData(data);
    log(`Sent: ${text}`);
    ui.msgInput.value = '';
  } catch (e) {
    log(`Send failed: ${e.message}`);
  }
});

ui.btnDisconnect.addEventListener('click', () => {
  if (pcManager) pcManager.close();
  if (signalingClient) signalingClient.disconnect();
  log('Disconnected explicitly');
  ui.setupView.classList.remove('hidden');
  ui.transferView.classList.add('hidden');
});
