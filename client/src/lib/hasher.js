export async function computeChunkHash(buffer) {
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return new Uint8Array(hashBuffer);
}

export class RootHasher {
  constructor() {
    this.chunkHashes = [];
  }

  addChunkHash(hashUint8Array) {
    this.chunkHashes.push(hashUint8Array);
  }

  async getRootHash() {
    const totalLength = this.chunkHashes.length * 32;
    const combined = new Uint8Array(totalLength);
    for (let i = 0; i < this.chunkHashes.length; i++) {
      combined.set(this.chunkHashes[i], i * 32);
    }
    const hashBuffer = await crypto.subtle.digest('SHA-256', combined);
    // Return hex string for easy comparison
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
}

export function bufferToHex(buffer) {
  return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}
