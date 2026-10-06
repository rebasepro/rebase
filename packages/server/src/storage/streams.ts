/**
 * Moving object bytes without holding them.
 *
 * A stored object can be as large as the deployment's `maxFileSize` allows — a
 * video, a database dump — and the paths that used to read one whole (a
 * `File`, an `arrayBuffer()`, a `Buffer.concat`) held it three or four times
 * over per request. These helpers are what the streamed paths share instead.
 */
import fs from "node:fs";

/** Anything that hands over bytes a chunk at a time: a Node readable, an SDK body. */
type ByteSource = AsyncIterable<Uint8Array>;

/**
 * A byte source as a web stream that reads a chunk only when the consumer asks
 * for one, and releases the source when the consumer stops early.
 *
 * Pull-based with a zero high-water mark, so nothing is read ahead of the
 * reader: a slow client holds one chunk, not a queue of them. A source given
 * as a function is opened on the first read, which keeps a stream nobody reads
 * — a `HEAD`, a 304 decided late — from holding a file descriptor or a
 * connection open. Cancelling (a client that disconnects mid-download)
 * returns the iterator, which destroys a Node stream and so closes its file or
 * socket.
 */
export function webStreamFrom(source: ByteSource | (() => ByteSource)): ReadableStream<Uint8Array> {
    let iterator: AsyncIterator<Uint8Array> | undefined;
    const open = (): AsyncIterator<Uint8Array> => {
        iterator ??= (typeof source === "function" ? source() : source)[Symbol.asyncIterator]();
        return iterator;
    };
    return new ReadableStream<Uint8Array>({
        async pull(controller) {
            try {
                const next = await open().next();
                if (next.done) controller.close();
                else controller.enqueue(next.value);
            } catch (err) {
                controller.error(err);
            }
        },
        async cancel() {
            // A source never opened has nothing to release — and opening it
            // now only to close it would be the cost this avoids.
            if (!iterator && typeof source === "function") return;
            try {
                await open().return?.();
            } catch {
                // Already failed or closed; either way it is released.
            }
        }
    }, { highWaterMark: 0 });
}

/**
 * A file on disk, or an inclusive byte range of it, as a web stream. The file
 * is opened on the first read; see {@link webStreamFrom}.
 */
export function fileWebStream(filePath: string, range?: { start: number; end: number }): ReadableStream<Uint8Array> {
    return webStreamFrom(() => fs.createReadStream(filePath, range ? { start: range.start, end: range.end } : {}));
}

/** A buffer already in memory as a web stream of views onto it, never copies. */
export function bufferWebStream(bytes: Uint8Array, chunkSize = 64 * 1024): ReadableStream<Uint8Array> {
    let offset = 0;
    return new ReadableStream<Uint8Array>({
        pull(controller) {
            if (offset >= bytes.byteLength) {
                controller.close();
                return;
            }
            const end = Math.min(offset + chunkSize, bytes.byteLength);
            controller.enqueue(bytes.subarray(offset, end));
            offset = end;
        }
    }, { highWaterMark: 0 });
}

/**
 * Read a stream into one buffer.
 *
 * For the one consumer that needs the whole object at once — an image decode.
 * With the size known the bytes are copied once, into a buffer of that size,
 * rather than collected and then concatenated (which holds them twice); a
 * stream that turns out longer or shorter than announced still comes back
 * whole and exact.
 */
export async function readStreamFully(stream: ReadableStream<Uint8Array>, expectedSize?: number): Promise<Buffer> {
    const reader = stream.getReader();
    const target = expectedSize !== undefined && expectedSize > 0 ? Buffer.allocUnsafe(expectedSize) : undefined;
    let offset = 0;
    let overflow: Uint8Array[] | undefined;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (target && !overflow && offset + value.byteLength <= target.byteLength) {
                target.set(value, offset);
            } else {
                overflow ??= target ? [target.subarray(0, offset)] : [];
                overflow.push(value);
            }
            offset += value.byteLength;
        }
    } finally {
        reader.releaseLock();
    }
    if (overflow) return Buffer.concat(overflow, offset);
    if (!target) return Buffer.alloc(0);
    return offset === target.byteLength ? target : target.subarray(0, offset);
}

/**
 * The bytes of a buffer as a `Uint8Array` the response APIs accept, without
 * copying them. `new Uint8Array(buffer)` copies; a view does not. Only a buffer
 * over shared memory — which nothing here produces — is copied.
 */
export function bytesView(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
    const backing = bytes.buffer;
    return backing instanceof ArrayBuffer
        ? new Uint8Array(backing, bytes.byteOffset, bytes.byteLength)
        : new Uint8Array(bytes);
}
