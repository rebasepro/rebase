import {
    assertAllowedBeforeConnecting,
    assertAllowedOutboundUrl,
    blockedAddressReason,
    guardedLookup,
    type AddressJudge,
    type OutboundUrlGuardOptions
} from "./outbound-url-guard";

/**
 * How the webhook dispatcher sends a POST to a destination that came from data.
 *
 * On Node, through an http(s) Agent whose `lookup` is the destination guard's
 * ({@link guardedLookup}): the name is resolved once per new connection, every
 * address it answers with is judged, and the socket connects to an address
 * that was. It used to be validate-then-fetch — a `dns.lookup` per delivery
 * attempt on the libuv threadpool, and then a second resolution inside `fetch`
 * that the guard never saw, so a TTL-0 name that flipped between the two
 * could still land on a blocked address. Keep-alive connections are reused, so
 * a steady stream of deliveries to one receiver resolves its name about once.
 *
 * With `allowPrivateNetworks` there is nothing to judge, and on a runtime
 * without `node:http` there is no Agent to hand a resolver to: both send with
 * `fetch`, after {@link assertAllowedOutboundUrl}, as before.
 *
 * Internal to the server.
 */

/** What the dispatcher reads of a response, from either transport. */
export interface OutboundResponse {
    status: number;
    header(name: string): string | null;
    /** The body as a stream, so a reader can stop at a cap and cancel the rest. */
    body: ReadableStream<Uint8Array> | null;
    text(): Promise<string>;
}

export interface OutboundPostInit {
    headers: Record<string, string>;
    body: string;
    /** Aborts the request — and the response body, while it is being read. */
    signal: AbortSignal;
}

/**
 * POST `body` to `rawUrl`, never following a redirect: a redirect would send
 * the POST — signature and all — somewhere the guard never judged.
 *
 * @throws BlockedUrlError when the guard refuses the destination.
 */
export type OutboundPost = (rawUrl: string, init: OutboundPostInit) => Promise<OutboundResponse>;

/** How long a pooled connection may sit idle before it is closed. */
const IDLE_SOCKET_MS = 15_000;

export function createOutboundPost(options: OutboundUrlGuardOptions = {}): OutboundPost {
    const viaFetch = createFetchPost(options);
    if (options.allowPrivateNetworks) return viaFetch;

    let transport: Promise<OutboundPost | undefined> | undefined;
    return async (rawUrl, init) => {
        transport ??= createNodePost(options);
        const post = await transport;
        return (post ?? viaFetch)(rawUrl, init);
    };
}

/** Validate-then-fetch: the path for `allowPrivateNetworks`, and for a runtime without `node:http`. */
export function createFetchPost(options: OutboundUrlGuardOptions = {}): OutboundPost {
    return async (rawUrl, init) => {
        const url = await assertAllowedOutboundUrl(rawUrl, options);
        const response = await fetch(url.href, {
            method: "POST",
            headers: init.headers,
            body: init.body,
            signal: init.signal,
            redirect: "manual"
        });
        return {
            status: response.status,
            header: (name) => typeof response.headers?.get === "function" ? response.headers.get(name) : null,
            body: response.body && typeof response.body.getReader === "function" ? response.body : null,
            text: () => response.text()
        };
    };
}

/**
 * The guarded Node transport, or `undefined` on a runtime without
 * `node:http`. Loaded on use, like the guard's own resolver, so that this
 * module imports on a runtime that has neither. `judge` is for tests that
 * need a receiver on loopback.
 */
export async function createNodePost(
    options: OutboundUrlGuardOptions = {},
    judge: AddressJudge = blockedAddressReason
): Promise<OutboundPost | undefined> {
    let http: typeof import("node:http");
    let https: typeof import("node:https");
    try {
        http = await import("node:http");
        https = await import("node:https");
    } catch {
        return undefined;
    }
    // One pair per dispatcher, so a receiver's connections are reused across
    // its deliveries. Idle sockets are unref'd by the Agent and closed after
    // IDLE_SOCKET_MS, so neither holds a process open.
    const lookup = guardedLookup(options, judge);
    const agents = {
        "http:": new http.Agent({ keepAlive: true, timeout: IDLE_SOCKET_MS, lookup }),
        "https:": new https.Agent({ keepAlive: true, timeout: IDLE_SOCKET_MS, lookup })
    };

    return (rawUrl, init) => new Promise<OutboundResponse>((resolve, reject) => {
        let url: URL;
        try {
            url = assertAllowedBeforeConnecting(rawUrl, options);
        } catch (error) {
            reject(error);
            return;
        }
        const headers: Record<string, string> = { ...init.headers };
        const named = (header: string) => Object.keys(headers).some(key => key.toLowerCase() === header);
        // What `fetch` sent, so a receiver that reads them sees no change.
        if (!named("content-length")) headers["Content-Length"] = String(Buffer.byteLength(init.body));
        if (!named("accept")) headers.Accept = "*/*";
        if (!named("user-agent")) headers["User-Agent"] = "node";

        const transport = url.protocol === "https:" ? https : http;
        const request = transport.request(url, {
            method: "POST",
            headers,
            agent: agents[url.protocol === "https:" ? "https:" : "http:"],
            signal: init.signal
        }, (response) => {
            const body = webStream(response);
            resolve({
                status: response.statusCode ?? 0,
                header: (name) => {
                    const value = response.headers[name.toLowerCase()];
                    return Array.isArray(value) ? value.join(", ") : value ?? null;
                },
                body,
                text: () => new Response(body).text()
            });
        });
        request.on("error", reject);
        request.end(init.body);
    });
}

/**
 * A response body as the web stream the dispatcher reads, pulling from the
 * socket only as it is read. Cancelling it — the dispatcher does at 64 KB —
 * destroys the response, and with it the connection, which cannot be reused
 * with a body left unread on it. A response that ends early, or is aborted by
 * the request's deadline, errors the stream.
 */
function webStream(response: import("node:http").IncomingMessage): ReadableStream<Uint8Array> {
    let settled = false;
    return new ReadableStream<Uint8Array>({
        start(controller) {
            response.on("data", (chunk: Buffer) => {
                controller.enqueue(chunk);
                if ((controller.desiredSize ?? 1) <= 0) response.pause();
            });
            response.on("end", () => {
                if (settled) return;
                settled = true;
                controller.close();
            });
            const fail = (error: Error) => {
                if (settled) return;
                settled = true;
                controller.error(error);
            };
            response.on("error", fail);
            response.on("close", () => {
                if (!response.complete) fail(new Error("The response ended before its body was complete"));
            });
            response.pause();
        },
        pull() {
            response.resume();
        },
        cancel() {
            settled = true;
            response.destroy();
        }
    });
}
