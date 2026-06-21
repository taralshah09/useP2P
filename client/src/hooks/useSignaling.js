import { useState, useRef, useCallback, useEffect } from 'react';
import { SignalingClient } from '../lib/signalingClient.js';
import { SIGNALING_TYPES } from 'shared/src/signaling-messages.js';
import { fetchIceConfig } from '../lib/iceConfig.js';

const WS_URL = import.meta.env.VITE_WS_URL || 'wss://p2p-share-server-vbhp.onrender.com';
const ICE_CONFIG_URL = import.meta.env.VITE_ICE_CONFIG_URL || 'https://p2p-share-server-vbhp.onrender.com/ice-config';

export function useSignaling() {
  const [status, setStatus] = useState('idle'); // idle | connecting | connected | disconnected | error
  const [sessionCode, setSessionCode] = useState(null);
  const [iceConfig, setIceConfig] = useState(null);
  const clientRef = useRef(null);

  const ensureConnected = useCallback(async () => {
    if (clientRef.current) return clientRef.current;
    setStatus('connecting');
    const [client, ice] = await Promise.all([
      (async () => {
        const c = new SignalingClient(WS_URL);
        c.onDisconnect = () => setStatus('disconnected');
        await c.connect();
        clientRef.current = c;
        return c;
      })(),
      fetchIceConfig(ICE_CONFIG_URL),
    ]);
    setIceConfig(ice);
    setStatus('connected');
    return client;
  }, []);

  const createSession = useCallback(async () => {
    const client = await ensureConnected();
    return new Promise((resolve, reject) => {
      client.on(SIGNALING_TYPES.SESSION_CREATED, (msg) => {
        setSessionCode(msg.payload.code);
        resolve(msg.payload.code);
      });
      client.on(SIGNALING_TYPES.ERROR, (msg) => {
        reject(new Error(msg.payload?.message || 'Session creation failed'));
      });
      client.createSession();
    });
  }, [ensureConnected]);

  const joinSession = useCallback(async (code) => {
    const client = await ensureConnected();
    return new Promise((resolve, reject) => {
      client.on(SIGNALING_TYPES.SESSION_JOINED, () => {
        setSessionCode(code);
        resolve();
      });
      client.on(SIGNALING_TYPES.ERROR, (msg) => {
        reject(new Error(msg.payload?.message || 'Failed to join session'));
      });
      client.joinSession(code);
    });
  }, [ensureConnected]);

  const getClient = useCallback(() => clientRef.current, []);

  const disconnect = useCallback(() => {
    clientRef.current?.disconnect();
    clientRef.current = null;
    setStatus('idle');
    setSessionCode(null);
  }, []);

  useEffect(() => () => { clientRef.current?.disconnect(); }, []);

  return { status, sessionCode, iceConfig, getClient, createSession, joinSession, disconnect };
}
