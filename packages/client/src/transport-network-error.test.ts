import { describe, it, expect, jest } from "@jest/globals";
import { RebaseApiError, RebaseClientError, isUnsupported } from "@rebasepro/types";
import { createTransport } from "./transport";
import { createFunctionsClient } from "./functions";
import { isNetworkError } from "./offline-connectivity";
import { isOfflineError } from "./offline";

/**
 * The failure every app hits first — the server is not there — reached callers
 * as whatever the runtime's `fetch` felt like rejecting with: a `TypeError`
 * reading "Failed to fetch" in a browser, a `TypeError` with a `cause` in
 * undici, a `DOMException` on abort.
 *
 * So the one class the SDK documents as "a `catch` block only ever needs to
 * check for this one" did not cover it, and `e.status` / `e.code` were
 * undefined on the error an app is most likely to write a branch for.
 */
describe("a transport failure is a RebaseApiError like everything else", () => {
    const downstream = (reason: unknown) =>
        createTransport({
            baseUrl: "http://127.0.0.1:1",
            fetch: jest.fn(async () => { throw reason; }) as unknown as typeof globalThis.fetch
        });

    it("wraps a refused connection as NETWORK_ERROR with status 0", async () => {
        const transport = downstream(new TypeError("fetch failed"));

        const error = await transport.request("/data/posts").then(
            () => { throw new Error("expected a rejection"); },
            (e: unknown) => e
        );

        expect(error).toBeInstanceOf(RebaseApiError);
        expect((error as RebaseApiError).code).toBe("NETWORK_ERROR");
        // 0, not a fabricated 5xx: there was no response, and a made-up status
        // would be indistinguishable from one the server actually sent.
        expect((error as RebaseApiError).status).toBe(0);
        expect((error as RebaseApiError).message).toContain("http://127.0.0.1:1");
    });

    it("keeps the original failure on `cause`, so nothing is hidden", async () => {
        const original = new TypeError("Load failed");
        const transport = downstream(original);

        const error = await transport.request("/data/posts").catch((e: unknown) => e);

        expect((error as { cause?: unknown }).cause).toBe(original);
    });

    it("wraps an abort too", async () => {
        const abort = Object.assign(new Error("The operation was aborted."), { name: "AbortError" });
        const transport = downstream(abort);

        const error = await transport.request("/data/posts").catch((e: unknown) => e);

        expect(error).toBeInstanceOf(RebaseApiError);
        expect((error as RebaseApiError).code).toBe("NETWORK_ERROR");
    });

    it("does not re-wrap an error this client already raised", async () => {
        const already = new RebaseApiError("nope", { status: 418, code: "TEAPOT" });
        const transport = downstream(already);

        const error = await transport.request("/data/posts").catch((e: unknown) => e);

        expect(error).toBe(already);
    });

    /**
     * `isNetworkError` used to sniff for the shapes a raw `fetch` rejects with,
     * a list that has to be kept in step with three runtimes. It is now one
     * question — `status === 0` — which the wrapper above guarantees.
     */
    it("is recognised by isNetworkError", async () => {
        const transport = downstream(new TypeError("fetch failed"));
        const error = await transport.request("/data/posts").catch((e: unknown) => e);

        expect(isNetworkError(error)).toBe(true);
        // …and an ordinary application `TypeError` is not, which the old
        // shape-sniffing version got wrong: it served a cached answer in place
        // of a bug thrown inside a callback.
        expect(isNetworkError(new TypeError("cannot read property of undefined"))).toBe(false);
    });
});

describe("client-side refusals are RebaseClientError", () => {
    it("refuses a function name carrying a path segment", async () => {
        const transport = createTransport({ baseUrl: "http://localhost:3000" });
        const functions = createFunctionsClient(transport);

        await expect(functions.invoke("storage-provision/abc"))
            .rejects.toBeInstanceOf(RebaseClientError);
    });
});

/**
 * `"offline"` was the one lowercase code in a surface whose every other code is
 * SCREAMING_SNAKE_CASE, so `e.code === "OFFLINE"` — which is what anyone writes
 * — never matched.
 */
describe("the offline code is spelled like every other code", () => {
    it("answers to OFFLINE", () => {
        expect(isOfflineError(new RebaseApiError("x", { status: 0, code: "OFFLINE" }))).toBe(true);
        expect(isOfflineError(new RebaseApiError("x", { status: 0, code: "offline" }))).toBe(false);
    });
});

/**
 * The envelope's `requestId` and the response's `Retry-After` were both read
 * off the wire and then dropped: a bug report could not quote the one string
 * that finds the server-side line, and the offline queue's backoff ignored a
 * server that had said exactly how long to wait.
 */
describe("a failed response carries what it said about itself", () => {
    const failing = (init: {
        status: number;
        body: unknown;
        headers?: Record<string, string>;
    }) => createTransport({
        baseUrl: "http://localhost:3000",
        fetch: jest.fn(async () => ({
            ok: false,
            status: init.status,
            statusText: "Too Many Requests",
            headers: { get: (name: string) => init.headers?.[name] ?? null },
            text: async () => JSON.stringify(init.body)
        })) as unknown as typeof globalThis.fetch
    });

    it("keeps the envelope's requestId", async () => {
        const transport = failing({
            status: 409,
            body: { error: { message: "nope", code: "CONFLICT", requestId: "req-9f1c" } }
        });

        const error = await transport.request("/data/posts").catch((e: unknown) => e);
        expect((error as RebaseApiError).requestId).toBe("req-9f1c");
    });

    it("falls back to the X-Request-ID header when the body carries none", async () => {
        const transport = failing({
            status: 500,
            body: { error: { message: "boom", code: "INTERNAL_ERROR" } },
            headers: { "X-Request-ID": "req-from-header" }
        });

        const error = await transport.request("/data/posts").catch((e: unknown) => e);
        expect((error as RebaseApiError).requestId).toBe("req-from-header");
    });

    it("reads Retry-After as seconds", async () => {
        const transport = failing({
            status: 429,
            body: { error: { message: "slow down", code: "RATE_LIMITED" } },
            headers: { "Retry-After": "30" }
        });

        const error = await transport.request("/data/posts").catch((e: unknown) => e);
        expect((error as RebaseApiError).retryAfterSeconds).toBe(30);
    });

    it("reads Retry-After as an HTTP date too, which is the other legal spelling", async () => {
        const at = new Date(Date.now() + 45_000).toUTCString();
        const transport = failing({
            status: 503,
            body: { error: { message: "down", code: "SERVICE_UNAVAILABLE" } },
            headers: { "Retry-After": at }
        });

        const error = await transport.request("/data/posts").catch((e: unknown) => e);
        const seconds = (error as RebaseApiError).retryAfterSeconds!;
        expect(seconds).toBeGreaterThanOrEqual(43);
        expect(seconds).toBeLessThanOrEqual(46);
    });

    it("leaves both undefined when the server said neither", async () => {
        const transport = failing({
            status: 404,
            body: { error: { message: "gone", code: "NOT_FOUND" } }
        });

        const error = await transport.request("/data/posts").catch((e: unknown) => e);
        expect((error as RebaseApiError).requestId).toBeUndefined();
        expect((error as RebaseApiError).retryAfterSeconds).toBeUndefined();
    });
});

/** The two helpers this workstream added, on the class they describe. */
describe("unsupported-method stubs", () => {
    it("are recognised, and a plain function is not", () => {
        expect(isUnsupported(() => undefined)).toBe(false);
        expect(isUnsupported(undefined)).toBe(true);
    });
});
