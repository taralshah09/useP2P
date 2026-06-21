import { nanoid } from 'nanoid';
import { v4 as uuidv4 } from 'uuid';
import { CODE_LENGTH } from 'shared/constants';
import { config } from '../config.js';
import { SIGNALING_TYPES } from 'shared/signaling-messages';

class SessionManager {
  constructor() {
    // Map of shortCode -> session data
    this.sessions = new Map();
    // Start cleanup interval
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
  }

  generateCode() {
    // Basic custom alphabet without visually ambiguous chars
    const alphabet = '346789ABCDEFGHJKLMNPQRTUVWXY';
    let code;
    do {
      code = '';
      for(let i = 0; i < CODE_LENGTH; i++) {
        code += alphabet[Math.floor(Math.random() * alphabet.length)];
      }
    } while (this.sessions.has(code));
    return code;
  }

  createSession(ws) {
    const code = this.generateCode();
    const sessionId = uuidv4();
    const session = {
      id: sessionId,
      code,
      sender: ws,
      receiver: null,
      createdAt: Date.now(),
      joinAttempts: 0
    };
    
    // Attach session info to websocket for easy access on disconnect
    ws.session = session;
    ws.role = 'sender';

    this.sessions.set(code, session);
    return code;
  }

  joinSession(code, ws) {
    const session = this.sessions.get(code);
    if (!session) {
      return { error: 'Session not found or expired' };
    }

    session.joinAttempts++;
    if (session.joinAttempts > config.rateLimit.joinAttemptsPerCode) {
      this.sessions.delete(code); // prevent brute force
      return { error: 'Too many join attempts. Session terminated.' };
    }

    if (session.receiver) {
      return { error: 'Session is full' };
    }

    session.receiver = ws;
    ws.session = session;
    ws.role = 'receiver';

    return { session };
  }

  getSession(code) {
    return this.sessions.get(code);
  }

  removeSession(code) {
    this.sessions.delete(code);
  }

  cleanup() {
    const now = Date.now();
    for (const [code, session] of this.sessions.entries()) {
      if (now - session.createdAt > config.sessionTtl) {
        // notify peers
        const msg = JSON.stringify({ type: SIGNALING_TYPES.SESSION_EXPIRED });
        if (session.sender && session.sender.readyState === 1 /* OPEN */) {
          session.sender.send(msg);
        }
        if (session.receiver && session.receiver.readyState === 1 /* OPEN */) {
          session.receiver.send(msg);
        }
        this.sessions.delete(code);
      }
    }
  }

  handleDisconnect(ws) {
    if (!ws.session) return;
    const session = ws.session;
    
    // If sender disconnects, terminate the session
    if (ws.role === 'sender') {
      if (session.receiver && session.receiver.readyState === 1) {
        session.receiver.send(JSON.stringify({ type: SIGNALING_TYPES.ERROR, payload: { message: 'Sender disconnected' } }));
      }
      this.sessions.delete(session.code);
    } else if (ws.role === 'receiver') {
      // If receiver disconnects, let sender know but keep session? Or terminate? 
      // Plan says: closing sender mid-transfer shows failure. What if receiver closes? 
      // The session should probably be terminated or just inform the sender.
      if (session.sender && session.sender.readyState === 1) {
        session.sender.send(JSON.stringify({ type: SIGNALING_TYPES.ERROR, payload: { message: 'Receiver disconnected' } }));
      }
      this.sessions.delete(session.code);
    }
  }

  stop() {
    clearInterval(this.cleanupInterval);
  }
}

export const sessionManager = new SessionManager();
