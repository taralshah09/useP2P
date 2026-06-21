import express from 'express';
import { WebSocketServer } from 'ws';
import http from 'http';
import { config } from './config.js';
import { createMessageRouter } from './signaling/messageRouter.js';
import { sessionManager } from './signaling/sessionManager.js';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

const ipRateLimits = new Map();

// Periodic cleanup of rate limits
setInterval(() => {
  const now = Date.now();
  for (const [ip, limit] of ipRateLimits.entries()) {
    if (now > limit.resetTime) {
      ipRateLimits.delete(ip);
    }
  }
}, 60000);

const routeMessage = createMessageRouter(ipRateLimits);

wss.on('connection', (ws, req) => {
  // Try to grab IP for rate limiting
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';

  ws.on('message', (data) => {
    routeMessage(ws, data, ip);
  });

  ws.on('close', () => {
    sessionManager.handleDisconnect(ws);
  });
  
  ws.on('error', () => {
    sessionManager.handleDisconnect(ws);
  });
});

if (process.env.NODE_ENV !== 'test') {
  server.listen(config.port, () => {
    console.log(`Signaling server running on port ${config.port}`);
  });
}

export { app, server, wss };
