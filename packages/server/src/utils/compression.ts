import type { MiddlewareHandler } from "hono";
import { compress } from "hono/compress";

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
 * No brotli: `CompressionStream` has no "br", so a br-only client would fall
 * back to identity — every real client sends gzip too.
 */
export function responseCompression(): MiddlewareHandler {
    const gzip = compress();

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

        // The response is already built, so `compress` only needs to inspect and
        // re-wrap it — hence the no-op continuation.
        await gzip(c, async () => { /* already resolved */ });
    };
}
