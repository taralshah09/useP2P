import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { textByteLength, sendText, parseTextMessage } from '../src/lib/textTransfer.js';
import { copyToClipboard } from '../src/lib/clipboard.js';
import { CONTROL_MESSAGES } from '../src/lib/protocol.js';
import { MAX_TEXT_BYTES } from '../../shared/src/constants.js';

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function makeFakeChannel(readyState = 'open') {
  const messages = [];
  return {
    channel: {
      readyState,
      send: (msg) => messages.push(msg)
    },
    messages
  };
}

// pc.sctp.maxMessageSize big enough to not interfere unless we set it small
const bigPc = { sctp: { maxMessageSize: 256 * 1024 } };

// ──────────────────────────────────────────────
// textByteLength
// ──────────────────────────────────────────────

describe('textByteLength', () => {
  it('counts ascii as one byte each', () => {
    expect(textByteLength('hello')).toBe(5);
  });

  it('counts multi-byte characters by UTF-8 length, not string length', () => {
    // emoji is 4 UTF-8 bytes but string length 2
    expect('😀'.length).toBe(2);
    expect(textByteLength('😀')).toBe(4);
    // é is 2 UTF-8 bytes
    expect(textByteLength('é')).toBe(2);
  });
});

// ──────────────────────────────────────────────
// sendText
// ──────────────────────────────────────────────

describe('sendText', () => {
  it('sends a single TEXT_MESSAGE with the correct shape', () => {
    const { channel, messages } = makeFakeChannel();
    const bytes = sendText('hello world', channel, bigPc);

    expect(messages).toHaveLength(1);
    const msg = JSON.parse(messages[0]);
    expect(msg.type).toBe(CONTROL_MESSAGES.TEXT_MESSAGE);
    expect(msg.text).toBe('hello world');
    expect(msg.byteLength).toBe(11);
    expect(msg.encoding).toBe('utf-8');
    expect(bytes).toBe(11);
  });

  it('preserves unicode round-trip via parseTextMessage', () => {
    const { channel, messages } = makeFakeChannel();
    const original = 'Wi-Fi: café 🔑 — pass 123';
    sendText(original, channel, bigPc);
    const parsed = parseTextMessage(messages[0]);
    expect(parsed.text).toBe(original);
  });

  it('throws on empty text and sends nothing', () => {
    const { channel, messages } = makeFakeChannel();
    expect(() => sendText('', channel, bigPc)).toThrow(/empty/i);
    expect(messages).toHaveLength(0);
  });

  it('rejects text above MAX_TEXT_BYTES', () => {
    const { channel, messages } = makeFakeChannel();
    const huge = 'a'.repeat(MAX_TEXT_BYTES + 1);
    expect(() => sendText(huge, channel, bigPc)).toThrow(/too large/i);
    expect(messages).toHaveLength(0);
  });

  it('rejects when the serialized message exceeds the channel maxMessageSize', () => {
    const { channel, messages } = makeFakeChannel();
    const smallPc = { sctp: { maxMessageSize: 32 } };
    expect(() => sendText('this text is well over thirty-two bytes long', channel, smallPc))
      .toThrow(/too large for this connection/i);
    expect(messages).toHaveLength(0);
  });

  it('throws when the channel is not open', () => {
    const { channel } = makeFakeChannel('connecting');
    expect(() => sendText('hi', channel, bigPc)).toThrow(/not open/i);
  });
});

// ──────────────────────────────────────────────
// parseTextMessage
// ──────────────────────────────────────────────

describe('parseTextMessage', () => {
  it('returns null for binary data', () => {
    expect(parseTextMessage(new ArrayBuffer(8))).toBeNull();
  });

  it('returns null for non-text control messages', () => {
    expect(parseTextMessage(JSON.stringify({ type: CONTROL_MESSAGES.FILE_METADATA }))).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(parseTextMessage('{ not json')).toBeNull();
  });
});

// ──────────────────────────────────────────────
// copyToClipboard
// ──────────────────────────────────────────────

describe('copyToClipboard', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the async Clipboard API in a secure context and returns true', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    vi.stubGlobal('window', { isSecureContext: true });

    const ok = await copyToClipboard('hello');
    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('falls back to execCommand when the Clipboard API rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('blocked'));
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    vi.stubGlobal('window', { isSecureContext: true });

    const execCommand = vi.fn().mockReturnValue(true);
    const textarea = {
      setAttribute: vi.fn(),
      focus: vi.fn(),
      select: vi.fn(),
      setSelectionRange: vi.fn(),
      style: {},
      value: '',
    };
    vi.stubGlobal('document', {
      createElement: vi.fn(() => textarea),
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
      execCommand,
    });

    const ok = await copyToClipboard('hello');
    expect(ok).toBe(true);
    expect(execCommand).toHaveBeenCalledWith('copy');
  });
});
