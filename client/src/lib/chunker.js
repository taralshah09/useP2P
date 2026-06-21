import { DEFAULT_CHUNK_SIZE } from 'shared/src/constants.js';

export function getSafeChunkSize(pc) {
  if (pc && pc.sctp && pc.sctp.maxMessageSize && pc.sctp.maxMessageSize > 0) {
    // Leave some room for our header and other SCTP overhead, but cap at a reasonable size
    // For example, capping at 64KB if available, but at least DEFAULT_CHUNK_SIZE
    const negotiated = pc.sctp.maxMessageSize;
    const MAX_TARGET = 64 * 1024;
    return Math.min(negotiated - 100, MAX_TARGET); // 100 bytes for SCTP+our header
  }
  return DEFAULT_CHUNK_SIZE;
}

export async function* chunkFile(file, chunkSize) {
  let offset = 0;
  let chunkIndex = 0;
  
  if (file.size === 0) {
    yield { chunkIndex: 0, payload: new Uint8Array(0) };
    return;
  }

  while (offset < file.size) {
    const slice = file.slice(offset, offset + chunkSize);
    const arrayBuffer = await slice.arrayBuffer();
    yield {
      chunkIndex,
      payload: new Uint8Array(arrayBuffer)
    };
    offset += chunkSize;
    chunkIndex++;
  }
}
