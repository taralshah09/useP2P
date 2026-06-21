import { unpackChunk, CONTROL_MESSAGES } from './protocol.js';
import { computeChunkHash, RootHasher, bufferToHex } from './hasher.js';
import { supportsFileSystemAccessAPI } from './capabilities.js';

export class FileReceiver {
  constructor(onProgress = () => {}) {
    this.metadata = null;
    this.rootHasher = new RootHasher();
    this.receivedChunks = 0;
    this.onProgress = onProgress;
    
    // Storage
    this.chunksMemory = [];
    this.fileHandle = null;
    this.writableStream = null;
  }

  async handleMessage(data) {
    if (typeof data === 'string') {
      const msg = JSON.parse(data);
      if (msg.type === CONTROL_MESSAGES.FILE_METADATA) {
        await this.handleMetadata(msg);
      } else if (msg.type === CONTROL_MESSAGES.TRANSFER_COMPLETE) {
        return await this.handleComplete(msg);
      } else if (msg.type === CONTROL_MESSAGES.ERROR) {
        throw new Error(`Remote error: ${msg.message}`);
      }
    } else if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
      const buffer = data instanceof Uint8Array ? data.buffer : (data.buffer || data);
      await this.handleChunk(buffer);
    }
  }

  async handleMetadata(msg) {
    this.metadata = msg;
    this.receivedChunks = 0;
    this.rootHasher = new RootHasher();
    this.chunksMemory = [];

    // Optional: cap memory if not supported
    if (!supportsFileSystemAccessAPI() && msg.size > 150 * 1024 * 1024) {
      console.warn("File is large and File System Access API is not supported. May crash.");
    }

    if (supportsFileSystemAccessAPI()) {
      try {
        this.fileHandle = await window.showSaveFilePicker({
          suggestedName: msg.name
        });
        this.writableStream = await this.fileHandle.createWritable();
      } catch (err) {
        console.warn('User cancelled save or FS API failed, falling back to memory', err);
        this.writableStream = null;
      }
    }
  }

  async handleChunk(buffer) {
    if (!this.metadata) throw new Error('Received chunk before metadata');

    const { fileIndex, chunkIndex, chunkHash, payload } = unpackChunk(buffer);
    
    // Verify hash inline
    const computedHash = await computeChunkHash(payload);
    if (bufferToHex(computedHash) !== bufferToHex(chunkHash)) {
      throw new Error(`Chunk hash mismatch at index ${chunkIndex}`);
    }

    this.rootHasher.addChunkHash(chunkHash);

    if (this.writableStream) {
      await this.writableStream.write(payload);
    } else {
      this.chunksMemory.push(payload); // Assuming ordered delivery
    }

    this.receivedChunks++;
    this.onProgress({
      receivedBytes: Math.min(this.receivedChunks * this.metadata.chunkSize, this.metadata.size),
      totalBytes: this.metadata.size
    });
  }

  async handleComplete(msg) {
    if (!this.metadata) throw new Error('Transfer complete before metadata');

    const computedRootHash = await this.rootHasher.getRootHash();
    if (computedRootHash !== msg.rootHash) {
      console.error('Root hash mismatch details:', { computedRootHash, receivedRootHash: msg.rootHash, chunks: this.receivedChunks });
      if (this.writableStream) await this.writableStream.abort();
      throw new Error('Root hash mismatch');
    }

    if (this.writableStream) {
      await this.writableStream.close();
      return { success: true, savedToDisk: true, fileHandle: this.fileHandle };
    } else {
      const blob = new Blob(this.chunksMemory, { type: this.metadata.mime });
      const url = URL.createObjectURL(blob);
      return { success: true, savedToDisk: false, blobUrl: url, name: this.metadata.name };
    }
  }
}
