import express from 'express';
import { WebSocketServer } from 'ws';
import http from 'http';
import { config } from './config.js';
import { createMessageRouter } from './signaling/messageRouter.js';
import { sessionManager } from './signaling/sessionManager.js';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowed = config.allowedOrigins;
  if (allowed.includes('*') || (origin && allowed.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  }
  next();
});
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Returns ICE server config including TURN credentials.
// Requires METERED_API_KEY env var (free tier at metered.ca).
// Falls back to STUN-only if the env var is missing (cross-NAT connections will fail).
app.get('/ice-config', async (req, res) => {
  const stun = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];

  const apiKey = process.env.METERED_API_KEY;
  if (!apiKey) {
    console.warn('[ice-config] METERED_API_KEY not set — returning STUN only');
    return res.json({ iceServers: stun });
  }

  try {
    const meteredApp = process.env.METERED_APP_NAME || 'p2p-share';
    const r = await fetch(
      `https://${meteredApp}.metered.live/api/v1/turn/credentials?apiKey=${apiKey}`
    );
    if (!r.ok) throw new Error(`Metered API ${r.status}`);
    const turnServers = await r.json();
    res.json({ iceServers: [...stun, ...turnServers] });
  } catch (err) {
    console.error('[ice-config] Failed to fetch TURN credentials:', err.message);
    res.json({ iceServers: stun });
  }
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
