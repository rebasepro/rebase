/**
 * Forwarding `/api/functions/*` to the process that serves it.
 *
 * A split deployment normally puts a reverse proxy in front and routes the path
 * there. This exists so it does not have to: set `REBASE_FUNCTIONS_UPSTREAM` on
 * the API process and the two-container topology presents the identical URL
 * surface as the one-container one, with nothing new to install and nothing for
 * a client or an SDK to know about.
 *
 * It is a transport hop, not a trust boundary. Nothing is authenticated or
 * authorised here: the upstream runs the same auth middleware against the same
 * `JWT_SECRET` and must see the original `Authorization` header, so re-deciding
 * anything on the way through would put two answers where the system has one.
 */
import { Hono, type Context } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { HonoEnv } from "../api/types";
import { logger } from "../utils/logger";

/**
 * Headers that describe *this* connection rather than the request, and so must
 * not be copied onto a new one.
 *
 * `host` is the important one: forwarded unchanged it names the API process, and
 * an upstream doing any virtual-host routing would answer for the wrong service.
 * `content-length` and `transfer-encoding` are recomputed by `fetch` from the
 * body it is actually given, and a stale value is a hang or a truncation.
 */
const HOP_BY_HOP = new Set([
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "host",
    "content-length"
]);

/**
 * Additionally dropped from the *response*, because `fetch` has already acted on
 * them by the time we see the body.
 *
 * `Content-Encoding` is the one that matters and the one that is easy to miss:
 * undici decompresses a `gzip` response transparently, but leaves the header on
 * the `Response` object. Copy it onto the body we hand back and the client is
 * told to gunzip bytes that are already plain — which does not fail cleanly. It
 * hangs, or it surfaces as a decode error several layers away from the proxy
 * that caused it. (This is not hypothetical: the runtime compresses its own
 * responses, so *every* forwarded response carries the header.)
 */
const RESPONSE_ONLY_DROP = new Set(["content-encoding", "content-length"]);

export interface FunctionsProxyOptions {
    /** Base URL of the process serving the functions, e.g. `http://functions:8080`. */
    upstream: string;
    /** The mount path being forwarded, e.g. `/api/functions`. */
    basePath: string;
}

/**
 * A router that forwards everything under its mount point to `upstream`.
 *
 * Method, path, query string, body and headers travel verbatim, with two
 * deliberate exceptions:
 *
 * 1. Hop-by-hop headers are dropped ({@link HOP_BY_HOP}).
 * 2. `X-Forwarded-For` gains the address this process saw the request come from.
 *    This is not decoration — the upstream's rate limiters and the auth routes'
 *    IP logging read that chain, and without the append every forwarded request
 *    arrives from one address: the API pod's. Every caller would share a single
 *    rate-limit bucket and every login would be logged from the same IP.
 *
 *    **The upstream must therefore count one more proxy hop than the API process
 *    does.** `TRUSTED_PROXY_HOPS` on the functions process is the API's value
 *    plus one. Left unset it defaults to 0, and the upstream falls back to the
 *    socket address — again, the API pod's — which is safe but useless.
 */
export function createFunctionsProxy(options: FunctionsProxyOptions): Hono<HonoEnv> {
    const router = new Hono<HonoEnv>();
    // Trailing slash trimmed once, here: joining it per request is how a proxy
    // ends up asking for `//functions/x`, which some servers route and some 404.
    const upstream = options.upstream.replace(/\/+$/, "");

    router.all("/*", async (c) => {
        const incoming = new URL(c.req.url);
        // The path *below* the mount point. Hono gives the full request path, so
        // taking the suffix is what keeps the upstream's own mount identical:
        // `/api/functions/send-invoice` here becomes `/api/functions/send-invoice`
        // there, not `/api/functions/api/functions/send-invoice`.
        const suffix = incoming.pathname.startsWith(options.basePath)
            ? incoming.pathname.slice(options.basePath.length)
            : incoming.pathname;
        const target = `${upstream}${options.basePath}${suffix}${incoming.search}`;

        const headers = new Headers();
        for (const [name, value] of c.req.raw.headers) {
            if (!HOP_BY_HOP.has(name.toLowerCase())) headers.set(name, value);
        }

        const seenFrom = socketAddress(c);
        if (seenFrom) {
            const chain = c.req.header("x-forwarded-for");
            headers.set("x-forwarded-for", chain ? `${chain}, ${seenFrom}` : seenFrom);
        }

        try {
            const response = await fetch(target, {
                method: c.req.method,
                headers,
                // GET and HEAD may not carry one; everything else streams
                // through rather than being buffered, so a large upload does not
                // have to fit in this process's memory on its way past.
                body: c.req.method === "GET" || c.req.method === "HEAD" ? undefined : c.req.raw.body,
                // Required by undici whenever the body is a stream. Without it
                // the fetch rejects with a message about duplex that says
                // nothing about what to do.
                duplex: "half",
                redirect: "manual"
            } as RequestInit);

            return new Response(response.body, {
                status: response.status,
                statusText: response.statusText,
                headers: responseHeaders(response.headers)
            });
        } catch (err) {
            // The upstream being down is an infrastructure fact, not a bug in
            // the caller's request, and 502 is the one status that says so.
            // Named explicitly in the body because the alternative — a generic
            // 500 from the API process — sends people reading the wrong logs.
            logger.error("Functions upstream unreachable", {
                upstream,
                path: incoming.pathname,
                error: err instanceof Error ? err : new Error(String(err))
            });
            return c.json({
                error: {
                    code: "FUNCTIONS_UPSTREAM_UNREACHABLE",
                    message: "The process serving custom functions could not be reached from this one."
                }
            }, 502);
        }
    });

    return router;
}

/**
 * Response headers, minus the ones that describe the upstream's connection and
 * the ones `fetch` has already consumed on our behalf.
 */
function responseHeaders(headers: Headers): Headers {
    const out = new Headers();
    for (const [name, value] of headers) {
        const lower = name.toLowerCase();
        if (HOP_BY_HOP.has(lower) || RESPONSE_ONLY_DROP.has(lower)) continue;
        out.set(name, value);
    }
    return out;
}

/** The address this process saw, or undefined on a runtime that cannot say. */
function socketAddress(c: Context<HonoEnv>): string | undefined {
    try {
        return getConnInfo(c).remote.address;
    } catch {
        return undefined;
    }
}
