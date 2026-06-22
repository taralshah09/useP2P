import { CONTROL_MESSAGES } from './protocol.js';
import { MAX_TEXT_BYTES } from 'shared/src/constants.js';

const encoder = new TextEncoder();

/**
 * UTF-8 byte length of a string. Use this (not String.length) for the size
 * cap so multi-byte characters and emoji are measured correctly.
 * @param {string} text
 * @returns {number}
 */
export function textByteLength(text) {
  return encoder.encode(text).length;
}

/**
 * Sends a text snippet as a single TEXT_MESSAGE control message over the
 * DataChannel. No chunking: text sharing is intentionally one message.
 *
 * Two guards:
 *  - the raw text must be within MAX_TEXT_BYTES (the user-facing cap), and
 *  - the serialized JSON envelope must fit the negotiated sctp.maxMessageSize,
 *    so a large message never silently tears down the channel.
 *
 * @param {string} text
 * @param {RTCDataChannel} dataChannel
 * @param {RTCPeerConnection} pc
 * @returns {number} the UTF-8 byte length that was sent
 */
export function sendText(text, dataChannel, pc) {
  if (!dataChannel || dataChannel.readyState !== 'open') {
    throw new Error('Data channel is not open');
  }

  const byteLength = textByteLength(text);
  if (byteLength === 0) {
    throw new Error('Cannot send empty text');
  }
  if (byteLength > MAX_TEXT_BYTES) {
    throw new Error(
      `Text is too large (${byteLength} bytes, max ${MAX_TEXT_BYTES}). Send it as a file instead.`
    );
  }

  const payload = JSON.stringify({
    type: CONTROL_MESSAGES.TEXT_MESSAGE,
    text,
    byteLength,
    encoding: 'utf-8'
  });

  // JSON escaping can inflate the wire size beyond the raw text length, so
  // measure the actual serialized message against the channel's limit.
  const max = pc?.sctp?.maxMessageSize;
  if (typeof max === 'number' && max > 0 && encoder.encode(payload).length > max) {
    throw new Error('Text is too large for this connection. Send it as a file instead.');
  }

  dataChannel.send(payload);
  return byteLength;
}

/**
 * Parses an incoming DataChannel message and returns the TEXT_MESSAGE object
 * if it is one, otherwise null. Safe to call on binary chunks and other
 * control messages (returns null without throwing).
 * @param {*} data
 * @returns {{ type: string, text: string, byteLength: number, encoding: string } | null}
 */
export function parseTextMessage(data) {
  if (typeof data !== 'string') return null;
  try {
    const msg = JSON.parse(data);
    if (msg && msg.type === CONTROL_MESSAGES.TEXT_MESSAGE) return msg;
  } catch {
    // not JSON
  }
  return null;
}
