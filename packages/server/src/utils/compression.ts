import type { Context, MiddlewareHandler } from "hono";
import { compress, COMPRESSIBLE_CONTENT_TYPE_REGEX } from "hono/compress";

/**
 * Below this many bytes a body is sent as it is. Hono's own default: gzip's
 * header, trailer and CPU cost more than it saves on a small body.
 */
const COMPRESSION_THRESHOLD = 1024;

/**
 * Response compression (gzip/deflate), negotiated from `Accept-Encoding`.
 *
 * Wraps Hono's `compress` with two corrections it does not make itself:
 *
 * - **`Vary: Accept-Encoding`** on every response it guards. Without it a shared
 *   cache may hand a gzipped body to a client that asked for identity.
 * - **Range responses are left alone.** `Content-Range` describes offsets into
 *   the identity body, so compressing a 206 desyncs the framing from the bytes
 *   actually sent.
 *
 * - **Bodies under 1 KB are sent as they are.** Hono's `compress` has that
 *   threshold but reads it from `Content-Length`, which `c.json()` never sets,
 *   so every row, every 401 and every `{ ok: true }` went through
 *   `CompressionStream` — 4.7× the CPU of the request itself, and a 37-byte
 *   body came out at 57. {@link measureSmallBody} supplies the length.
 *
 * No brotli: `CompressionStream` has no "br", so a br-only client would fall
 * back to identity — every real client sends gzip too.
 */
export function responseCompression(): MiddlewareHandler {
    const gzip = compress({ threshold: COMPRESSION_THRESHOLD });

    return async (c, next) => {
        await next();

        const vary = c.res.headers.get("Vary");
        if (!vary) {
            c.res.headers.set("Vary", "Accept-Encoding");
        } else if (!/\baccept-encoding\b/i.test(vary)) {
            c.res.headers.append("Vary", "Accept-Encoding");
        }

        if (c.res.status === 206 || c.res.headers.has("Content-Range")) {
            return;
        }

        // Server-sent events are never compressed. gzip emits on block
        // boundaries, not on write boundaries, so a compressed event stream
        // delivers nothing until enough events have accumulated to fill one —
        // which is the entire property the stream exists to provide. Hono's
        // `compress` happens to skip these already, via the `Transfer-Encoding`
        // that `streamSSE` sets; this does not depend on that.
        if (c.res.headers.get("Content-Type")?.startsWith("text/event-stream")) {
            return;
        }

        await measureSmallBody(c);

        // The response is already built, so `compress` only needs to inspect and
        // re-wrap it — hence the no-op continuation.
        await gzip(c, async () => { /* already resolved */ });
    };
}

/**
 * Give a body that would be compressed, and turns out smaller than the
 * threshold, the `Content-Length` that lets `compress` see it is small.
 *
 * Only where compression would otherwise happen: the client accepts gzip or
 * deflate, the type is one `compress` compresses, and nothing has set a length
 * or an encoding yet. Reads at most until the threshold is crossed — never
 * the whole of a large or streamed body. A body that ends first is re-sent as
 * the bytes it was, with its length; one that does not is handed on as a
 * stream that replays what was read and then the rest, and is compressed as
 * before. Waiting for the first kilobyte delays nothing a client could see:
 * the gzip stream it would otherwise get buffers far more than that.
 */
async function measureSmallBody(c: Context): Promise<void> {
    const res = c.res;
    if (!res.body || c.req.method === "HEAD") return;
    if (res.headers.has("Content-Length") || res.headers.has("Content-Encoding") || res.headers.has("Transfer-Encoding")) return;
    if (!COMPRESSIBLE_CONTENT_TYPE_REGEX.test(res.headers.get("Content-Type") ?? "")) return;
    if (!/\b(?:gzip|deflate)\b|\*/i.test(c.req.header("Accept-Encoding") ?? "")) return;

    const reader = res.body.getReader();
    const read: Array<Uint8Array<ArrayBuffer>> = [];
    let size = 0;
    // One read past the threshold: a body built from a string (`c.json`,
    // `c.text`) arrives as a single chunk, and seeing it end lets it be
    // re-sent as bytes rather than through a replaying stream.
    for (let pastThreshold = 0; pastThreshold < 2;) {
        const chunk = await reader.read();
        if (chunk.done) {
            const bytes: Uint8Array<ArrayBuffer> = read.length === 1 ? read[0] : new Uint8Array(size);
            if (read.length !== 1) {
                let offset = 0;
                for (const part of read) {
                    bytes.set(part, offset);
                    offset += part.byteLength;
                }
            }
            c.res = new Response(bytes, res);
            c.res.headers.set("Content-Length", String(size));
            return;
        }
        read.push(chunk.value);
        size += chunk.value.byteLength;
        if (size >= COMPRESSION_THRESHOLD) pastThreshold++;
    }

    c.res = new Response(new ReadableStream<Uint8Array>({
        start(controller) {
            for (const part of read) controller.enqueue(part);
        },
        async pull(controller) {
            const chunk = await reader.read();
            if (chunk.done) controller.close();
            else controller.enqueue(chunk.value);
        },
        cancel(reason) {
            return reader.cancel(reason);
        }
    }), res);
}
