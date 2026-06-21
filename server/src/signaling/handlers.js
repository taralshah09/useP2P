import { SIGNALING_TYPES } from 'shared/signaling-messages';
import { sessionManager } from './sessionManager.js';

export function handleMessage(ws, message, reqIp, ipRateLimits) {
  switch (message.type) {
    case SIGNALING_TYPES.CREATE_SESSION: {
      const code = sessionManager.createSession(ws);
      ws.send(JSON.stringify({
        type: SIGNALING_TYPES.SESSION_CREATED,
        payload: { code }
      }));
      break;
    }

    case SIGNALING_TYPES.JOIN_SESSION: {
      const { code } = message.payload || {};
      if (!code) {
        return ws.send(JSON.stringify({ type: SIGNALING_TYPES.ERROR, payload: { message: 'Code required' } }));
      }

      // Check IP rate limit
      const limit = ipRateLimits.get(reqIp) || { count: 0, resetTime: Date.now() + 60000 };
      if (Date.now() > limit.resetTime) {
        limit.count = 0;
        limit.resetTime = Date.now() + 60000;
      }
      limit.count++;
      ipRateLimits.set(reqIp, limit);

      if (limit.count > 10) { // arbitrary limit per minute
        return ws.send(JSON.stringify({ type: SIGNALING_TYPES.ERROR, payload: { message: 'Rate limit exceeded' } }));
      }

      const result = sessionManager.joinSession(code, ws);
      if (result.error) {
        return ws.send(JSON.stringify({ type: SIGNALING_TYPES.ERROR, payload: { message: result.error } }));
      }

      // Tell the receiver they successfully joined
      ws.send(JSON.stringify({ type: SIGNALING_TYPES.SESSION_JOINED }));

      // Tell the sender that a peer joined
      const session = result.session;
      if (session.sender && session.sender.readyState === 1) {
        session.sender.send(JSON.stringify({ type: SIGNALING_TYPES.PEER_JOINED }));
      }
      break;
    }

    case SIGNALING_TYPES.OFFER:
    case SIGNALING_TYPES.ANSWER:
    case SIGNALING_TYPES.ICE_CANDIDATE: {
      if (!ws.session) {
        return ws.send(JSON.stringify({ type: SIGNALING_TYPES.ERROR, payload: { message: 'Not in a session' } }));
      }
      const target = ws.role === 'sender' ? ws.session.receiver : ws.session.sender;
      if (!target || target.readyState !== 1) {
        // target not available
        return;
      }
      // relay directly
      target.send(JSON.stringify(message));
      break;
    }

    default:
      ws.send(JSON.stringify({ type: SIGNALING_TYPES.ERROR, payload: { message: 'Unknown message type' } }));
  }
}
