export const HEADER_SIZE = 38; // 2 (fileIndex) + 4 (chunkIndex) + 32 (sha256)

export const CONTROL_MESSAGES = {
  FILE_METADATA: 'FILE_METADATA',
  TRANSFER_COMPLETE: 'TRANSFER_COMPLETE',
  ERROR: 'ERROR'
};

/**
 * Packs a chunk payload with its binary header.
 * @param {number} fileIndex - uint16
 * @param {number} chunkIndex - uint32
 * @param {Uint8Array} chunkHash - 32 bytes
 * @param {Uint8Array} payload - raw chunk data
 * @returns {Uint8Array} - packed data
 */
export function packChunk(fileIndex, chunkIndex, chunkHash, payload) {
  const buffer = new ArrayBuffer(HEADER_SIZE + payload.byteLength);
  const dataView = new DataView(buffer);
  
  dataView.setUint16(0, fileIndex, true);
  dataView.setUint32(2, chunkIndex, true);
  
  const uint8Array = new Uint8Array(buffer);
  uint8Array.set(chunkHash, 6);
  uint8Array.set(payload, HEADER_SIZE);
  
  return uint8Array;
}

/**
 * Unpacks a received chunk buffer into its components.
 * @param {ArrayBuffer} buffer 
 * @returns {{ fileIndex: number, chunkIndex: number, chunkHash: Uint8Array, payload: Uint8Array }}
 */
export function unpackChunk(buffer) {
  const dataView = new DataView(buffer);
  
  const fileIndex = dataView.getUint16(0, true);
  const chunkIndex = dataView.getUint32(2, true);
  
  const uint8Array = new Uint8Array(buffer);
  const chunkHash = uint8Array.slice(6, HEADER_SIZE);
  const payload = uint8Array.slice(HEADER_SIZE);
  
  return { fileIndex, chunkIndex, chunkHash, payload };
}
