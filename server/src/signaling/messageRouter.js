import { isValidSignalingMessage } from 'shared/signaling-messages';
import { handleMessage } from './handlers.js';
import { sessionManager } from './sessionManager.js';

export function createMessageRouter(ipRateLimits) {
  return function routeMessage(ws, data, reqIp) {
    let message;
    try {
      message = JSON.parse(data);
    } catch (err) {
      // Invalid JSON
      return;
    }

    if (!isValidSignalingMessage(message)) {
      // Invalid structure, ignore or send error
      return;
    }

    handleMessage(ws, message, reqIp, ipRateLimits);
  };
}
