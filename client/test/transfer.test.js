import { describe, it, expect, vi, beforeEach } from 'vitest';
import { packChunk, unpackChunk, CONTROL_MESSAGES, HEADER_SIZE } from '../src/lib/protocol.js';
import { chunkFile, getSafeChunkSize } from '../src/lib/chunker.js';
import { computeChunkHash, RootHasher, bufferToHex } from '../src/lib/hasher.js';
import { sendFile } from '../src/lib/sender.js';
import { FileReceiver } from '../src/lib/receiver.js';

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function makeFileLike(data, name = 'test.bin', type = 'application/octet-stream') {
  const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
  return {
    name,
    type,
    size: u8.byteLength,
    slice: (start, end) => new Blob([u8.slice(start, end)])
  };
}

function makeFakeChannel() {
  const messages = [];
  return {
    channel: {
      readyState: 'open',
      bufferedAmount: 0,
      bufferedAmountLowThreshold: 0,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      send: (msg) => messages.push(msg)
    },
    messages
  };
}

async function replayThroughReceiver(messages, receiver) {
  let finalResult = null;
  for (const msg of messages) {
    const result = await receiver.handleMessage(msg);
    if (result != null) finalResult = result;
  }
  return finalResult;
}

// ──────────────────────────────────────────────
// Protocol — pack / unpack
// ──────────────────────────────────────────────

describe('Protocol', () => {
  it('round-trips a chunk with arbitrary header values', () => {
    const fileIndex = 1;
    const chunkIndex = 42;
    const chunkHash = new Uint8Array(32).fill(7);
    const payload = new Uint8Array([1, 2, 3, 4]);

    const packed = packChunk(fileIndex, chunkIndex, chunkHash, payload);
    const unpacked = unpackChunk(packed.buffer);

    expect(unpacked.fileIndex).toBe(fileIndex);
    expect(unpacked.chunkIndex).toBe(chunkIndex);
    expect(new Uint8Array(unpacked.chunkHash)).toEqual(chunkHash);
    expect(new Uint8Array(unpacked.payload)).toEqual(payload);
  });

  it('round-trips max uint16 fileIndex and max uint32 chunkIndex', () => {
    const chunkHash = new Uint8Array(32).fill(0xff);
    const payload = new Uint8Array([9]);

    const packed = packChunk(0xffff, 0xffffffff, chunkHash, payload);
    const unpacked = unpackChunk(packed.buffer);

    expect(unpacked.fileIndex).toBe(0xffff);
    expect(unpacked.chunkIndex).toBe(0xffffffff);
  });

  it('packed length equals HEADER_SIZE + payload length', () => {
    const payload = new Uint8Array(128);
    const packed = packChunk(0, 0, new Uint8Array(32), payload);
    expect(packed.byteLength).toBe(HEADER_SIZE + 128);
  });

  it('round-trips an empty payload', () => {
    const chunkHash = new Uint8Array(32).fill(1);
    const packed = packChunk(0, 0, chunkHash, new Uint8Array(0));
    const unpacked = unpackChunk(packed.buffer);
    expect(unpacked.payload.byteLength).toBe(0);
  });
});

// ──────────────────────────────────────────────
// Chunker
// ──────────────────────────────────────────────

describe('Chunker', () => {
  it('splits a file into the expected number of chunks', async () => {
    const data = new Uint8Array(100);
    const chunks = [];
    for await (const chunk of chunkFile(new Blob([data]), 30)) chunks.push(chunk);

    expect(chunks.length).toBe(4);
    expect(chunks[0].payload.length).toBe(30);
    expect(chunks[3].payload.length).toBe(10);
  });

  it('produces one chunk when file size equals chunk size exactly', async () => {
    const data = new Uint8Array(64);
    const chunks = [];
    for await (const chunk of chunkFile(new Blob([data]), 64)) chunks.push(chunk);

    expect(chunks.length).toBe(1);
    expect(chunks[0].payload.length).toBe(64);
  });

  it('yields a single zero-length chunk for an empty file', async () => {
    const chunks = [];
    for await (const chunk of chunkFile(new Blob([]), 1024)) chunks.push(chunk);

    expect(chunks.length).toBe(1);
    expect(chunks[0].payload.length).toBe(0);
  });

  it('assigns sequential chunkIndex values', async () => {
    const data = new Uint8Array(90);
    const indices = [];
    for await (const chunk of chunkFile(new Blob([data]), 30)) indices.push(chunk.chunkIndex);

    expect(indices).toEqual([0, 1, 2]);
  });

  it('getSafeChunkSize returns DEFAULT_CHUNK_SIZE when sctp info is absent', async () => {
    const { DEFAULT_CHUNK_SIZE } = await import('shared/src/constants.js');
    expect(getSafeChunkSize(null)).toBe(DEFAULT_CHUNK_SIZE);
    expect(getSafeChunkSize({})).toBe(DEFAULT_CHUNK_SIZE);
    expect(getSafeChunkSize({ sctp: { maxMessageSize: 0 } })).toBe(DEFAULT_CHUNK_SIZE);
  });

  it('getSafeChunkSize caps at 64 KB even if negotiated size is larger', () => {
    const size = getSafeChunkSize({ sctp: { maxMessageSize: 256 * 1024 } });
    expect(size).toBeLessThanOrEqual(64 * 1024);
  });
});

// ──────────────────────────────────────────────
// Hasher
// ──────────────────────────────────────────────

describe('Hasher', () => {
  it('two RootHashers with the same chunks in the same order produce identical roots', async () => {
    const h1 = new Uint8Array(32).fill(1);
    const h2 = new Uint8Array(32).fill(2);

    const r1 = new RootHasher();
    r1.addChunkHash(h1);
    r1.addChunkHash(h2);

    const r2 = new RootHasher();
    r2.addChunkHash(h1);
    r2.addChunkHash(h2);

    expect(await r1.getRootHash()).toBe(await r2.getRootHash());
  });

  it('root hash is order-sensitive — same chunks in different order yield different roots', async () => {
    const h1 = new Uint8Array(32).fill(0xaa);
    const h2 = new Uint8Array(32).fill(0xbb);

    const rA = new RootHasher();
    rA.addChunkHash(h1);
    rA.addChunkHash(h2);

    const rB = new RootHasher();
    rB.addChunkHash(h2);
    rB.addChunkHash(h1);

    expect(await rA.getRootHash()).not.toBe(await rB.getRootHash());
  });

  it('computeChunkHash returns a 32-byte Uint8Array', async () => {
    const hash = await computeChunkHash(new Uint8Array([1, 2, 3]));
    expect(hash).toBeInstanceOf(Uint8Array);
    expect(hash.byteLength).toBe(32);
  });

  it('bufferToHex produces a 64-character lowercase hex string for a 32-byte input', () => {
    const buf = new Uint8Array(32).fill(0xab);
    const hex = bufferToHex(buf);
    expect(hex).toHaveLength(64);
    expect(hex).toMatch(/^[0-9a-f]+$/);
  });
});

// ──────────────────────────────────────────────
// Sender — flow control (backpressure)
// ──────────────────────────────────────────────

describe('Sender — flow control', () => {
  it('pauses when bufferedAmount exceeds high watermark and resumes on bufferedamountlow', async () => {
    const { BUFFERED_AMOUNT_HIGH_WATERMARK } = await import('shared/src/constants.js');

    // maxMessageSize=200 → chunkSize = min(200-100, 64KB) = 100 bytes
    // 300-byte file → 3 chunks, so backpressure can fire between chunks
    const data = new Uint8Array(300).fill(1);
    const file = makeFileLike(data);
    const pc = { sctp: { maxMessageSize: 200 } };

    const lowListeners = [];
    let binaryChunksSent = 0;

    const channel = {
      readyState: 'open',
      bufferedAmount: 0,
      bufferedAmountLowThreshold: 0,
      addEventListener: vi.fn((event, handler) => {
        if (event === 'bufferedamountlow') lowListeners.push(handler);
      }),
      removeEventListener: vi.fn(),
      send: vi.fn((msg) => {
        if (msg instanceof Uint8Array) {
          binaryChunksSent++;
          // Simulate buffer filling on the first chunk send
          if (binaryChunksSent === 1) {
            channel.bufferedAmount = BUFFERED_AMOUNT_HIGH_WATERMARK + 1;
          }
        }
      })
    };

    const sendPromise = sendFile(file, channel, pc);

    // Let the sender reach the pause point (it's async due to hashing)
    await new Promise(r => setTimeout(r, 10));

    // Drain the buffer and fire the bufferedamountlow listener
    channel.bufferedAmount = 0;
    for (const handler of lowListeners) handler();

    await sendPromise;

    expect(binaryChunksSent).toBeGreaterThan(1);
    expect(channel.addEventListener).toHaveBeenCalledWith('bufferedamountlow', expect.any(Function));
  });
});

// ──────────────────────────────────────────────
// Receiver — corruption and root mismatch
// ──────────────────────────────────────────────

describe('Receiver — integrity checks', () => {
  it('throws when a chunk arrives before metadata', async () => {
    const receiver = new FileReceiver();
    const badChunk = packChunk(0, 0, new Uint8Array(32), new Uint8Array([1]));
    await expect(receiver.handleChunk(badChunk.buffer)).rejects.toThrow('before metadata');
  });

  it('throws on a chunk with a corrupt hash', async () => {
    const receiver = new FileReceiver();

    // Inject metadata manually
    await receiver.handleMetadata({
      type: CONTROL_MESSAGES.FILE_METADATA,
      fileIndex: 0,
      name: 'x.bin',
      size: 4,
      mime: 'application/octet-stream',
      chunkSize: 4,
      totalChunks: 1
    });

    const payload = new Uint8Array([1, 2, 3, 4]);
    const wrongHash = new Uint8Array(32).fill(0xff); // deliberately wrong
    const packed = packChunk(0, 0, wrongHash, payload);

    await expect(receiver.handleChunk(packed.buffer)).rejects.toThrow('hash mismatch');
  });

  it('throws on root hash mismatch at TRANSFER_COMPLETE', async () => {
    const data = new Uint8Array(8).fill(5);
    const file = makeFileLike(data);
    const { channel, messages } = makeFakeChannel();
    const pc = { sctp: { maxMessageSize: 65536 } };

    await sendFile(file, channel, pc);

    // Tamper with the TRANSFER_COMPLETE root hash
    const lastMsgRaw = messages[messages.length - 1];
    const lastMsg = JSON.parse(lastMsgRaw);
    lastMsg.rootHash = 'deadbeef'.repeat(8);
    messages[messages.length - 1] = JSON.stringify(lastMsg);

    const receiver = new FileReceiver();
    await expect(replayThroughReceiver(messages, receiver)).rejects.toThrow('Root hash mismatch');
  });
});

// ──────────────────────────────────────────────
// End-to-end transfer through an in-memory channel stub
// ──────────────────────────────────────────────

describe('End-to-End Transfer', () => {
  beforeEach(() => {
    // URL.createObjectURL is not available in Node.js — stub it
    if (typeof URL.createObjectURL !== 'function') {
      URL.createObjectURL = vi.fn(() => 'blob:mock');
    }
  });

  it('transfers a multi-chunk file byte-for-byte through the channel stub', async () => {
    const data = new Uint8Array(1000).fill(42);
    const file = makeFileLike(data, 'hello.bin');
    const { channel, messages } = makeFakeChannel();
    const pc = { sctp: { maxMessageSize: 65536 } };

    let progressCalls = 0;
    await sendFile(file, channel, pc, 0, () => { progressCalls++; });

    const receiver = new FileReceiver();
    const result = await replayThroughReceiver(messages, receiver);

    expect(result).not.toBeNull();
    expect(result.success).toBe(true);
    expect(result.savedToDisk).toBe(false);
    expect(result.blobUrl).toBeTruthy();
    expect(progressCalls).toBeGreaterThan(0);
  });

  it('transfers an empty file without error', async () => {
    const file = makeFileLike(new Uint8Array(0), 'empty.txt');
    const { channel, messages } = makeFakeChannel();
    const pc = { sctp: { maxMessageSize: 65536 } };

    await sendFile(file, channel, pc);

    const receiver = new FileReceiver();
    const result = await replayThroughReceiver(messages, receiver);

    expect(result.success).toBe(true);
  });

  it('transfers a file that is exactly one chunk', async () => {
    const chunkSize = getSafeChunkSize({ sctp: { maxMessageSize: 65536 } });
    const data = new Uint8Array(chunkSize).fill(0xab);
    const file = makeFileLike(data, 'exact.bin');
    const { channel, messages } = makeFakeChannel();
    const pc = { sctp: { maxMessageSize: 65536 } };

    await sendFile(file, channel, pc);

    const receiver = new FileReceiver();
    const result = await replayThroughReceiver(messages, receiver);

    expect(result.success).toBe(true);
    expect(receiver.receivedChunks).toBe(1);
  });

  it('first message is FILE_METADATA, last is TRANSFER_COMPLETE', async () => {
    const file = makeFileLike(new Uint8Array(100).fill(1));
    const { channel, messages } = makeFakeChannel();
    const pc = { sctp: { maxMessageSize: 65536 } };

    await sendFile(file, channel, pc);

    const first = JSON.parse(messages[0]);
    const last = JSON.parse(messages[messages.length - 1]);

    expect(first.type).toBe(CONTROL_MESSAGES.FILE_METADATA);
    expect(last.type).toBe(CONTROL_MESSAGES.TRANSFER_COMPLETE);
    expect(typeof last.rootHash).toBe('string');
    expect(last.rootHash.length).toBe(64);
  });
});
