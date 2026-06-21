import { describe, it, expect, vi } from 'vitest';
import { packChunk, unpackChunk } from '../src/lib/protocol.js';
import { chunkFile, getSafeChunkSize } from '../src/lib/chunker.js';
import { computeChunkHash, RootHasher, bufferToHex } from '../src/lib/hasher.js';
import { sendFile } from '../src/lib/sender.js';
import { FileReceiver } from '../src/lib/receiver.js';

describe('Protocol', () => {
  it('should pack and unpack chunk correctly', () => {
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
});

describe('Chunker', () => {
  it('should chunk file correctly', async () => {
    // Mock file
    const data = new Uint8Array(100);
    const file = new Blob([data]);
    
    const iterator = chunkFile(file, 30);
    const chunks = [];
    for await (const chunk of iterator) {
      chunks.push(chunk);
    }
    
    expect(chunks.length).toBe(4);
    expect(chunks[0].payload.length).toBe(30);
    expect(chunks[3].payload.length).toBe(10);
  });
});

describe('Hasher', () => {
  it('should compute root hash consistently', async () => {
    const root1 = new RootHasher();
    const root2 = new RootHasher();
    
    const hash1 = new Uint8Array(32).fill(1);
    const hash2 = new Uint8Array(32).fill(2);
    
    root1.addChunkHash(hash1);
    root1.addChunkHash(hash2);
    
    root2.addChunkHash(hash1);
    root2.addChunkHash(hash2);
    
    const h1 = await root1.getRootHash();
    const h2 = await root2.getRootHash();
    
    expect(h1).toBe(h2);
    expect(typeof h1).toBe('string');
  });
});

describe('End-to-End Transfer Logic', () => {
  it('should transfer file correctly through memory channel stub', async () => {
    const data = new Uint8Array(1000).fill(42);
    const file = new Blob([data]);
    file.name = "test.txt";
    
    const receiver = new FileReceiver();
    let transferCompleted = false;
    let savedData = null;

    // Fake DataChannel
    const dataChannel = {
      readyState: 'open',
      bufferedAmount: 0,
      bufferedAmountLowThreshold: 0,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      send: async (msg) => {
        const result = await receiver.handleMessage(msg);
        if (result && result.success) {
          transferCompleted = true;
          savedData = result;
        }
      }
    };
    
    const pc = { sctp: { maxMessageSize: 65536 } };

    await sendFile(file, dataChannel, pc);
    
    expect(transferCompleted).toBe(true);
    expect(savedData.savedToDisk).toBe(false);
    expect(savedData.blobUrl).toBeDefined();
    expect(receiver.receivedChunks).toBe(1);
  });
});
