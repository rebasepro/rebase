/**
 * Files larger than this go up through the resumable (TUS) endpoint, a chunk
 * of this size per request, instead of `POST /storage/upload`.
 *
 * `POST /upload` is one multipart body, which the server parses whole before
 * the route runs: three to five times the file in its memory. A chunk is one
 * request body under the server's global body limit (10 MB by default), so the
 * resumable path holds one chunk at a time whatever the file's size. Below the
 * threshold the multipart request is one round trip and a few megabytes, and
 * stays.
 *
 * In a module of its own: a client compares every upload against it, and only
 * the ones past it need the resumable upload itself (see resumable-upload.ts).
 */
export const RESUMABLE_UPLOAD_THRESHOLD = 8 * 1024 * 1024;
