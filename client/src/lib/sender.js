import { chunkFile, getSafeChunkSize } from './chunker.js';
import { computeChunkHash, RootHasher } from './hasher.js';
import { packChunk, CONTROL_MESSAGES } from './protocol.js';
import { BUFFERED_AMOUNT_HIGH_WATERMARK, BUFFERED_AMOUNT_LOW_WATERMARK } from 'shared/src/constants.js';

export async function sendFile(file, dataChannel, pc, fileIndex = 0, onProgress = () => {}) {
  return new Promise(async (resolve, reject) => {
    try {
      const chunkSize = getSafeChunkSize(pc);
      const totalChunks = Math.ceil(file.size / chunkSize) || 1; // handle empty file

      // Send metadata
      const metadata = {
        type: CONTROL_MESSAGES.FILE_METADATA,
        fileIndex,
        name: file.name,
        size: file.size,
        mime: file.type,
        chunkSize,
        totalChunks
      };
      dataChannel.send(JSON.stringify(metadata));

      // Setup backpressure
      dataChannel.bufferedAmountLowThreshold = BUFFERED_AMOUNT_LOW_WATERMARK;

      const rootHasher = new RootHasher();
      const chunkIterator = chunkFile(file, chunkSize);

      let chunkResult = await chunkIterator.next();
      
      const sendNext = async () => {
        while (!chunkResult.done) {
          if (dataChannel.readyState !== 'open') {
            return reject(new Error('DataChannel closed during transfer'));
          }

          if (dataChannel.bufferedAmount > BUFFERED_AMOUNT_HIGH_WATERMARK) {
            // Pause until bufferedAmount drops
            dataChannel.addEventListener('bufferedamountlow', function onLow() {
              dataChannel.removeEventListener('bufferedamountlow', onLow);
              sendNext();
            });
            return;
          }

          const { chunkIndex, payload } = chunkResult.value;
          const chunkHash = await computeChunkHash(payload);
          rootHasher.addChunkHash(chunkHash);
          
          const packed = packChunk(fileIndex, chunkIndex, chunkHash, payload);
          dataChannel.send(packed);

          onProgress({ sentBytes: Math.min((chunkIndex + 1) * chunkSize, file.size), totalBytes: file.size });

          chunkResult = await chunkIterator.next();
        }

        // Finished sending all chunks
        const rootHash = await rootHasher.getRootHash();
        dataChannel.send(JSON.stringify({
          type: CONTROL_MESSAGES.TRANSFER_COMPLETE,
          fileIndex,
          rootHash
        }));
        
        resolve();
      };

      await sendNext();

    } catch (err) {
      reject(err);
    }
  });
}
