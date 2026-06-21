import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { server, wss, app } from '../src/index.js';
import { WebSocket } from 'ws';
import { SIGNALING_TYPES } from 'shared/signaling-messages';
import { sessionManager } from '../src/signaling/sessionManager.js';

let port;

function waitForMessage(ws) {
  return new Promise((resolve, reject) => {
    ws.once('message', (data) => resolve(JSON.parse(data.toString())));
    setTimeout(() => reject(new Error('Timeout waiting for message')), 2000);
  });
}

function waitForOpen(ws) {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.OPEN) {
      resolve();
    } else {
      ws.once('open', resolve);
    }
  });
}

describe('Signaling Server', () => {
  beforeAll(async () => {
    await new Promise((resolve) => {
      server.listen(0, () => {
        port = server.address().port;
        resolve();
      });
    });
  });

  afterAll(() => {
    sessionManager.stop();
    server.close();
    wss.close();
  });

  afterEach(() => {
    sessionManager.sessions.clear();
  });

  it('should return 200 on /health', async () => {
    const res = await fetch(`http://localhost:${port}/health`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('OK');
  });

  it('should create session, join, relay, and refuse third peer', async () => {
    const ws1 = new WebSocket(`ws://localhost:${port}`);
    await waitForOpen(ws1);

    // 1. Create Session
    ws1.send(JSON.stringify({ type: SIGNALING_TYPES.CREATE_SESSION }));
    const createRes = await waitForMessage(ws1);
    expect(createRes.type).toBe(SIGNALING_TYPES.SESSION_CREATED);
    const code = createRes.payload.code;
    expect(code).toBeDefined();

    // 2. Join Session
    const ws2 = new WebSocket(`ws://localhost:${port}`);
    await waitForOpen(ws2);
    ws2.send(JSON.stringify({ type: SIGNALING_TYPES.JOIN_SESSION, payload: { code } }));

    // ws2 should get SESSION_JOINED
    const joinRes = await waitForMessage(ws2);
    expect(joinRes.type).toBe(SIGNALING_TYPES.SESSION_JOINED);

    // ws1 should get PEER_JOINED
    const peerJoinedRes = await waitForMessage(ws1);
    expect(peerJoinedRes.type).toBe(SIGNALING_TYPES.PEER_JOINED);

    // 3. Relay offer/answer/ICE
    const offerPayload = { sdp: 'fake-offer' };
    ws1.send(JSON.stringify({ type: SIGNALING_TYPES.OFFER, payload: offerPayload }));
    const relayOffer = await waitForMessage(ws2);
    expect(relayOffer.type).toBe(SIGNALING_TYPES.OFFER);
    expect(relayOffer.payload).toEqual(offerPayload);

    const answerPayload = { sdp: 'fake-answer' };
    ws2.send(JSON.stringify({ type: SIGNALING_TYPES.ANSWER, payload: answerPayload }));
    const relayAnswer = await waitForMessage(ws1);
    expect(relayAnswer.type).toBe(SIGNALING_TYPES.ANSWER);
    expect(relayAnswer.payload).toEqual(answerPayload);

    const icePayload = { candidate: 'fake-ice' };
    ws1.send(JSON.stringify({ type: SIGNALING_TYPES.ICE_CANDIDATE, payload: icePayload }));
    const relayIce = await waitForMessage(ws2);
    expect(relayIce.type).toBe(SIGNALING_TYPES.ICE_CANDIDATE);
    expect(relayIce.payload).toEqual(icePayload);

    // 4. Refuse third peer
    const ws3 = new WebSocket(`ws://localhost:${port}`);
    await waitForOpen(ws3);
    ws3.send(JSON.stringify({ type: SIGNALING_TYPES.JOIN_SESSION, payload: { code } }));
    const errorRes = await waitForMessage(ws3);
    expect(errorRes.type).toBe(SIGNALING_TYPES.ERROR);
    expect(errorRes.payload.message).toBe('Session is full');

    ws1.close();
    ws2.close();
    ws3.close();
  });
});
