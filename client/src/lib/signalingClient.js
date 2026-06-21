import { SIGNALING_TYPES, isValidSignalingMessage } from 'shared/src/signaling-messages.js';

export class SignalingClient {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.handlers = new Map();
    this.onDisconnect = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        resolve();
      };

      this.ws.onerror = (err) => {
        reject(err);
      };

      this.ws.onclose = () => {
        if (this.onDisconnect) this.onDisconnect();
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (isValidSignalingMessage(message)) {
            this.dispatch(message);
          } else {
            console.warn('Received invalid signaling message', message);
          }
        } catch (e) {
          console.error('Failed to parse signaling message', e);
        }
      };
    });
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  send(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.warn('Attempted to send message on closed WebSocket');
    }
  }

  on(type, handler) {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, []);
    }
    this.handlers.get(type).push(handler);
  }

  off(type, handler) {
    if (this.handlers.has(type)) {
      const filtered = this.handlers.get(type).filter(h => h !== handler);
      this.handlers.set(type, filtered);
    }
  }

  dispatch(message) {
    const typeHandlers = this.handlers.get(message.type);
    if (typeHandlers) {
      typeHandlers.forEach(handler => handler(message));
    }
  }

  createSession() {
    this.send({ type: SIGNALING_TYPES.CREATE_SESSION });
  }

  joinSession(code) {
    this.send({ type: SIGNALING_TYPES.JOIN_SESSION, payload: { code } });
  }
}
