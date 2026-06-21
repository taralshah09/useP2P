const FALLBACK_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

// Fetches full ICE config (STUN + TURN) from the signaling server.
// Falls back to STUN-only if the endpoint is unreachable.
export async function fetchIceConfig(iceConfigUrl) {
  try {
    if (!iceConfigUrl) {
      return { iceServers: FALLBACK_ICE_SERVERS };
    }
    const response = await fetch(iceConfigUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json(); // expects { iceServers: [...] }
  } catch (err) {
    console.warn('Could not fetch ICE config, falling back to STUN only:', err.message);
    return { iceServers: FALLBACK_ICE_SERVERS };
  }
}
