export const CODE_LENGTH = 6;
export const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
export const DEFAULT_CHUNK_SIZE = 16 * 1024; // 16 KB safe default
export const BUFFERED_AMOUNT_HIGH_WATERMARK = 1024 * 1024 * 2; // 2 MB
export const BUFFERED_AMOUNT_LOW_WATERMARK = 1024 * 1024 * 1; // 1 MB

// Phase 6 — Text sharing. Cap on the raw UTF-8 byte length of a shared text
// snippet. Larger payloads are rejected with a "send it as a file" message
// rather than chunked (text sharing intentionally stays single-message).
export const MAX_TEXT_BYTES = 64 * 1024; // 64 KB
