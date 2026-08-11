import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { buildQueryString, createTransport, RebaseApiError } from "../src/transport";

/**
 * A minimal mock shape that satisfies the `fetch` signature used by `createTransport`.
 * This avoids `as any` by providing a compatible callable type.
 */
type MockFetch = jest.Mock<(input: RequestInfo | URL, init?: RequestInit) => Promise<Partial<Response>>>;

// These build tokenless transports on purpose, in a Node environment, which is
// exactly what the anonymous-server-client guard warns about (see
// `ANONYMOUS_SERVER_CLIENT_WARNING`). The guard itself is covered by
// `src/anonymous-client-guard.test.ts`; here it is only noise.
beforeEach(() => { jest.spyOn(console, "warn").mockImplementation(() => undefined); });

// --------------------------------------------------------------------------
// buildQueryString
// --------------------------------------------------------------------------
describe("buildQueryString", () => {
    it("returns empty string for undefined", () => {
        expect(buildQueryString(undefined)).toBe("");
    });

    it("returns empty string for empty params", () => {
        expect(buildQueryString({})).toBe("");
    });

    it("serializes limit and offset parameters", () => {
        expect(buildQueryString({ limit: 10,
offset: 20 })).toBe("?limit=10&offset=20");
    });

    it("serializes page parameter", () => {
        expect(buildQueryString({ page: 3 })).toBe("?page=3");
    });

    it("serializes orderBy parameter", () => {
        expect(buildQueryString({ orderBy: ["createdAt", "desc"] })).toBe("?orderBy=createdAt%3Adesc");
    });

    it("serializes include array", () => {
        expect(buildQueryString({ include: ["author", "tags"] }))
            .toBe("?include=author%2Ctags");
    });

    it("skips empty include array", () => {
        expect(buildQueryString({ include: [] })).toBe("");
    });

    it("serializes PostgREST-style where clauses directly as query parameters", () => {
        expect(buildQueryString({ where: { status: "eq.published",
count: "gt.5" } }))
            .toBe("?status=eq.published&count=gt.5");
    });

    it("URL encodes values correctly", () => {
        expect(buildQueryString({ where: { name: "eq.John Doe&" } }))
            .toBe("?name=eq.John%20Doe%26");
    });

    it("combines multiple parameter types", () => {
        const qs = buildQueryString({
            limit: 5,
            offset: 10,
            orderBy: "name",
            include: ["tags"],
            where: { active: "true" }
        });
        expect(qs).toContain("limit=5");
        expect(qs).toContain("offset=10");
        expect(qs).toContain("orderBy=name");
        expect(qs).toContain("include=tags");
        expect(qs).toContain("active=true");
        expect(qs.startsWith("?")).toBe(true);
    });
});

// --------------------------------------------------------------------------
// RebaseApiError
// --------------------------------------------------------------------------
describe("RebaseApiError", () => {
    it("sets name, status, code, and details", () => {
        const err = new RebaseApiError("Validation failed", { status: 422, code: "INVALID_INPUT", details: { field: "email" } });
        expect(err).toBeInstanceOf(Error);
        expect(err.name).toBe("RebaseApiError");
        expect(err.status).toBe(422);
        expect(err.message).toBe("Validation failed");
        expect(err.code).toBe("INVALID_INPUT");
        expect(err.details).toEqual({ field: "email" });
    });

    it("works without optional parameters", () => {
        const err = new RebaseApiError("Server error", { status: 500 });
        expect(err.status).toBe(500);
        expect(err.code).toBeUndefined();
        expect(err.details).toBeUndefined();
    });
});

// --------------------------------------------------------------------------
// createTransport
// --------------------------------------------------------------------------
describe("createTransport", () => {
    let fetchMock: MockFetch;

    beforeEach(() => {
        fetchMock = jest.fn() as MockFetch;
    });

    // --- Initialization ---
    it("initializes with default apiPath", () => {
        const transport = createTransport({ baseUrl: "https://api.example.com",
token: "jwt-token" });
        expect(transport.baseUrl).toBe("https://api.example.com");
        expect(transport.apiPath).toBe("/api");
    });

    it("uses custom apiPath when provided", () => {
        const transport = createTransport({ baseUrl: "https://api.example.com",
apiPath: "/v2" });
        expect(transport.apiPath).toBe("/v2");
    });

    it("strips trailing slash from baseUrl", () => {
        const transport = createTransport({ baseUrl: "https://api.example.com/" });
        expect(transport.baseUrl).toBe("https://api.example.com");
    });

    it("exposes fetchFn", () => {
        const transport = createTransport({ baseUrl: "http://localhost",
fetch: fetchMock as typeof globalThis.fetch });
        expect(transport.fetchFn).toBe(fetchMock);
    });

    /**
     * A success this client cannot read used to be returned as `{}`.
     *
     * `find()` answered an empty object instead of an array and nothing threw,
     * which reads as "no data" rather than "you are not talking to the API".
     * The case is ordinary: point the base URL at the frontend's own host and
     * `/api/data/posts` lands on the SPA fallback, which serves `index.html`
     * with a 200.
     */
    describe("a success status carrying something that is not JSON", () => {
        const html = "<!doctype html>\n<html><body>app shell</body></html>";

        it("refuses it rather than returning an empty object", async () => {
            const transport = createTransport({
                baseUrl: "https://app.example.com",
                fetch: fetchMock as typeof globalThis.fetch
            });
            fetchMock.mockResolvedValueOnce({ ok: true, status: 200, text: async () => html });

            await expect(transport.request("/data/posts")).rejects.toMatchObject({
                name: "RebaseApiError",
                status: 200,
                code: "INVALID_JSON_RESPONSE"
            });
        });

        it("quotes the start of the body, which is what names the sender", async () => {
            const transport = createTransport({
                baseUrl: "https://app.example.com",
                fetch: fetchMock as typeof globalThis.fetch
            });
            fetchMock.mockResolvedValueOnce({ ok: true, status: 200, text: async () => html });

            await expect(transport.request("/data/posts")).rejects.toThrow(/<!doctype html>/);
        });

        it("still returns an empty object for a success with no body at all", async () => {
            // Not the same thing: a 200 with nothing in it is an answer, and
            // some endpoints give it.
            const transport = createTransport({
                baseUrl: "https://api.example.com",
                fetch: fetchMock as typeof globalThis.fetch
            });
            fetchMock.mockResolvedValueOnce({ ok: true, status: 200, text: async () => "" });

            await expect(transport.request("/ping")).resolves.toEqual({});
        });

        it("leaves an error status reporting its status, not the parse", async () => {
            // A 500 behind an HTML error page is still a 500: the status is the
            // answer and the unreadable body adds nothing.
            const transport = createTransport({
                baseUrl: "https://api.example.com",
                fetch: fetchMock as typeof globalThis.fetch
            });
            fetchMock.mockResolvedValueOnce({
                ok: false, status: 500, statusText: "Internal Server Error", text: async () => html
            });

            await expect(transport.request("/data/posts")).rejects.toMatchObject({ status: 500 });
        });
    });

    // --- Basic requests ---
    it("makes a basic GET request", async () => {
        const transport = createTransport({ baseUrl: "https://api.example.com",
fetch: fetchMock as typeof globalThis.fetch });
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            text: async () => JSON.stringify ({ data: "success" })
        });

        const res = await transport.request("/test", { method: "GET" });
        expect(res).toEqual({ data: "success" });

        expect(fetchMock).toHaveBeenCalledWith(
            "https://api.example.com/api/test",
            expect.objectContaining({
                method: "GET",
                headers: expect.objectContaining({
                    "Content-Type": "application/json"
                })
            })
        );
    });

    it("handles 204 No Content responses", async () => {
        const transport = createTransport({ baseUrl: "http://localhost",
fetch: fetchMock as typeof globalThis.fetch });
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 204
        });

        const result = await transport.request("/delete-thing", { method: "DELETE" });
        expect(result).toBeUndefined();
    });

    // --- Token management ---
    it("injects Authorization headers when a token is provided", async () => {
        const transport = createTransport({ baseUrl: "http://localhost",
token: "static-token",
fetch: fetchMock as typeof globalThis.fetch });
        fetchMock.mockResolvedValueOnce({ ok: true,
status: 200,
text: async () => JSON.stringify ({}) });

        await transport.request("/secure", { method: "GET" });

        expect(fetchMock).toHaveBeenCalledWith(
            "http://localhost/api/secure",
            expect.objectContaining({
                headers: expect.objectContaining({
                    "Authorization": "Bearer static-token"
                })
            })
        );
    });

    it("updates token dynamically using setToken", async () => {
        const transport = createTransport({ baseUrl: "http://localhost",
fetch: fetchMock as typeof globalThis.fetch });
        transport.setToken("dynamic-token");

        fetchMock.mockResolvedValueOnce({ ok: true,
status: 200,
text: async () => JSON.stringify ({}) });

        await transport.request("/secure", { method: "GET" });
        expect(fetchMock).toHaveBeenCalledWith(
            "http://localhost/api/secure",
            expect.objectContaining({
                headers: expect.objectContaining({
                    "Authorization": "Bearer dynamic-token"
                })
            })
        );
    });

    it("clears token when setToken is called with null", async () => {
        const transport = createTransport({ baseUrl: "http://localhost",
token: "initial",
fetch: fetchMock as typeof globalThis.fetch });
        transport.setToken(null);

        fetchMock.mockResolvedValueOnce({ ok: true,
status: 200,
text: async () => JSON.stringify ({}) });
        await transport.request("/test");

        const callArgs = fetchMock.mock.calls[0];
        const headers = (callArgs[1] as RequestInit).headers as Record<string, string>;
        expect(headers["Authorization"]).toBeUndefined();
    });

    // --- Token getter ---
    it("uses tokenGetter over static token when set", async () => {
        const transport = createTransport({ baseUrl: "http://localhost",
token: "static",
fetch: fetchMock as typeof globalThis.fetch });
        transport.setAuthTokenGetter(async () => "dynamic-from-getter");

        fetchMock.mockResolvedValueOnce({ ok: true,
status: 200,
text: async () => JSON.stringify ({}) });
        await transport.request("/test");

        expect(fetchMock).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
                headers: expect.objectContaining({
                    "Authorization": "Bearer dynamic-from-getter"
                })
            })
        );
    });

    it("falls back to static token when tokenGetter returns null", async () => {
        const transport = createTransport({ baseUrl: "http://localhost",
token: "fallback",
fetch: fetchMock as typeof globalThis.fetch });
        transport.setAuthTokenGetter(async () => null);

        fetchMock.mockResolvedValueOnce({ ok: true,
status: 200,
text: async () => JSON.stringify ({}) });
        await transport.request("/test");

        expect(fetchMock).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
                headers: expect.objectContaining({
                    "Authorization": "Bearer fallback"
                })
            })
        );
    });

    it("falls back to static token when tokenGetter throws", async () => {
        const transport = createTransport({ baseUrl: "http://localhost",
token: "fallback",
fetch: fetchMock as typeof globalThis.fetch });
        transport.setAuthTokenGetter(async () => { throw new Error("getter failed"); });

        fetchMock.mockResolvedValueOnce({ ok: true,
status: 200,
text: async () => JSON.stringify ({}) });
        await transport.request("/test");

        expect(fetchMock).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
                headers: expect.objectContaining({
                    "Authorization": "Bearer fallback"
                })
            })
        );
    });

    // --- resolveToken ---
    it("resolveToken returns tokenGetter result when set", async () => {
        const transport = createTransport({ baseUrl: "http://localhost",
token: "static" });
        transport.setAuthTokenGetter(async () => "from-getter");

        const resolved = await transport.resolveToken();
        expect(resolved).toBe("from-getter");
    });

    it("resolveToken returns static token when no getter", async () => {
        const transport = createTransport({ baseUrl: "http://localhost",
token: "static" });
        const resolved = await transport.resolveToken();
        expect(resolved).toBe("static");
    });

    it("resolveToken returns null when nothing is set", async () => {
        const transport = createTransport({ baseUrl: "http://localhost" });
        const resolved = await transport.resolveToken();
        expect(resolved).toBeNull();
    });

    it("resolveToken falls back to static when getter throws", async () => {
        const transport = createTransport({ baseUrl: "http://localhost",
token: "static" });
        transport.setAuthTokenGetter(async () => { throw new Error("fail"); });
        const resolved = await transport.resolveToken();
        expect(resolved).toBe("static");
    });

    // --- getHeaders ---
    it("getHeaders returns proper headers with token", () => {
        const transport = createTransport({ baseUrl: "http://localhost",
token: "test-token" });
        const headers = transport.getHeaders();
        expect(headers["Content-Type"]).toBe("application/json");
        expect(headers["Authorization"]).toBe("Bearer test-token");
    });

    it("getHeaders without token omits Authorization", () => {
        const transport = createTransport({ baseUrl: "http://localhost" });
        const headers = transport.getHeaders();
        expect(headers["Content-Type"]).toBe("application/json");
        expect(headers["Authorization"]).toBeUndefined();
    });

    it("getHeaders merges custom headers from init", () => {
        const transport = createTransport({ baseUrl: "http://localhost" });
        const headers = transport.getHeaders({ headers: { "X-Custom": "val" } as any } as RequestInit);
        expect(headers["X-Custom"]).toBe("val");
    });

    // --- FormData handling ---
    it("removes Content-Type header for FormData bodies", async () => {
        const transport = createTransport({ baseUrl: "http://localhost",
fetch: fetchMock as typeof globalThis.fetch });
        const formData = new FormData();
        formData.append("file", "data");

        fetchMock.mockResolvedValueOnce({ ok: true,
status: 200,
text: async () => JSON.stringify ({}) });
        await transport.request("/upload", { method: "POST",
body: formData });

        const callHeaders = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
        expect(callHeaders["Content-Type"]).toBeUndefined();
    });

    // --- POST body ---
    it("parses JSON payloads for standard POST bodies", async () => {
        const transport = createTransport({ baseUrl: "http://localhost",
fetch: fetchMock as typeof globalThis.fetch });
        fetchMock.mockResolvedValueOnce({ ok: true,
status: 201,
text: async () => JSON.stringify ({ id: 1 }) });

        await transport.request("/create", { method: "POST",
body: JSON.stringify({ name: "test" }) });
        expect(fetchMock).toHaveBeenCalledWith(
            "http://localhost/api/create",
            expect.objectContaining({
                method: "POST",
                body: JSON.stringify({ name: "test" })
            })
        );
    });

    // --- Error Handling ---
    describe("Error Handling", () => {
        it("throws RebaseApiError on non-ok JSON responses", async () => {
            const transport = createTransport({ baseUrl: "http://localhost",
fetch: fetchMock as typeof globalThis.fetch });
            fetchMock.mockResolvedValueOnce({
                ok: false,
                status: 400,
                text: async () => JSON.stringify ({ error: { message: "Bad Request",
code: "validation_failed" } })
            });

            await expect(transport.request("/fail", { method: "GET" })).rejects.toThrow(RebaseApiError);

            const transport2 = createTransport({ baseUrl: "http://localhost",
fetch: fetchMock as typeof globalThis.fetch });
            fetchMock.mockResolvedValueOnce({
                ok: false,
                status: 400,
                text: async () => JSON.stringify ({ error: { message: "Bad Request",
code: "validation_failed" } })
            });
            await expect(transport2.request("/fail", { method: "GET" })).rejects.toThrow("Bad Request");
        });

        it("captures error code and details on RebaseApiError", async () => {
            const transport = createTransport({ baseUrl: "http://localhost",
fetch: fetchMock as typeof globalThis.fetch });
            fetchMock.mockResolvedValueOnce({
                ok: false,
                status: 422,
                text: async () => JSON.stringify ({ error: { message: "Validation failed",
code: "INVALID",
details: { field: "email" } } })
            });

            try {
                await transport.request("/fail");
                // Without this, a request that resolved would skip the catch
                // block entirely and the test would pass having asserted
                // nothing (see the sibling case below for the same guard).
                throw new Error("expected request to reject");
            } catch (e) {
                expect(e).toBeInstanceOf(RebaseApiError);
                const err = e as RebaseApiError;
                expect(err.status).toBe(422);
                expect(err.code).toBe("INVALID");
                expect(err.details).toEqual({ field: "email" });
            }
        });

        it("ignores a bare top-level message/code (only the canonical error envelope is read)", async () => {
            const transport = createTransport({ baseUrl: "http://localhost",
fetch: fetchMock as typeof globalThis.fetch });
            fetchMock.mockResolvedValueOnce({
                ok: false,
                status: 403,
                statusText: "Forbidden",
                text: async () => JSON.stringify ({ message: "Forbidden",
code: "ACCESS_DENIED" })
            });

            try {
                await transport.request("/fail");
                throw new Error("expected request to reject");
            } catch (e) {
                const err = e as RebaseApiError;
                // The server always emits `{ error: { message, code } }`, so a bare
                // top-level `{ message, code }` is not parsed — we fall back to statusText.
                expect(err.status).toBe(403);
                expect(err.message).toBe("Forbidden"); // from statusText fallback
                expect(err.code).toBeUndefined();
            }
        });

        it("throws RebaseApiError falling back to statusText on generic failure", async () => {
            const transport = createTransport({ baseUrl: "http://localhost",
fetch: fetchMock as typeof globalThis.fetch });
            fetchMock.mockResolvedValueOnce({
                ok: false,
                status: 500,
                statusText: "Server Error",
                text: async () => { throw new Error("not json"); }
            });

            await expect(transport.request("/fail", { method: "GET" })).rejects.toThrow("Server Error");
        });
    });

    // --- 401 Retry Logic ---
    describe("401 Retry Logic", () => {
        it("retries once if onUnauthorized callback returns true", async () => {
            const onUnauthorized = jest.fn<() => Promise<boolean>>().mockResolvedValueOnce(true);
            const transport = createTransport({
                baseUrl: "http://localhost",
                onUnauthorized,
                fetch: fetchMock as typeof globalThis.fetch
            });

            fetchMock.mockResolvedValueOnce({
                ok: false,
                status: 401,
                text: async () => JSON.stringify ({ error: { message: "Unauthorized" } })
            });

            fetchMock.mockResolvedValueOnce({
                ok: true,
                status: 200,
                text: async () => JSON.stringify ({ success: true })
            });

            const res = await transport.request("/retry", { method: "GET" });
            expect(res).toEqual({ success: true });
            expect(onUnauthorized).toHaveBeenCalledTimes(1);
            expect(fetchMock).toHaveBeenCalledTimes(2);
        });

        it("fails immediately if onUnauthorized returns false", async () => {
            const onUnauthorized = jest.fn<() => Promise<boolean>>().mockResolvedValueOnce(false);
            const transport = createTransport({
                baseUrl: "http://localhost",
                onUnauthorized,
                fetch: fetchMock as typeof globalThis.fetch
            });

            fetchMock.mockResolvedValueOnce({
                ok: false,
                status: 401,
                text: async () => JSON.stringify ({ error: { message: "Unauthorized" } })
            });

            await expect(transport.request("/retry", { method: "GET" })).rejects.toThrow("Unauthorized");
            expect(onUnauthorized).toHaveBeenCalledTimes(1);
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });

        it("handles 204 on retry correctly", async () => {
            const onUnauthorized = jest.fn<() => Promise<boolean>>().mockResolvedValueOnce(true);
            const transport = createTransport({
                baseUrl: "http://localhost",
                onUnauthorized,
                fetch: fetchMock as typeof globalThis.fetch
            });

            fetchMock.mockResolvedValueOnce({
                ok: false,
status: 401,
                text: async () => JSON.stringify ({ error: { message: "Unauthorized" } })
            });
            fetchMock.mockResolvedValueOnce({
                ok: true,
status: 204
            });

            const result = await transport.request("/retry");
            expect(result).toBeUndefined();
        });

        it("throws error when retry also fails", async () => {
            const onUnauthorized = jest.fn<() => Promise<boolean>>().mockResolvedValueOnce(true);
            const transport = createTransport({
                baseUrl: "http://localhost",
                onUnauthorized,
                fetch: fetchMock as typeof globalThis.fetch
            });

            fetchMock.mockResolvedValueOnce({
                ok: false,
status: 401,
                text: async () => JSON.stringify ({ error: { message: "Unauthorized" } })
            });
            fetchMock.mockResolvedValueOnce({
                ok: false,
status: 403,
                statusText: "Forbidden",
                text: async () => JSON.stringify ({ error: { message: "Still forbidden" } })
            });

            await expect(transport.request("/retry")).rejects.toThrow("Still forbidden");
        });

        it("uses fresh tokenGetter value on retry", async () => {
            let callCount = 0;
            const onUnauthorized = jest.fn<() => Promise<boolean>>().mockResolvedValueOnce(true);
            const transport = createTransport({
                baseUrl: "http://localhost",
                onUnauthorized,
                fetch: fetchMock as typeof globalThis.fetch
            });
            transport.setAuthTokenGetter(async () => {
                callCount++;
                return callCount === 1 ? "old-token" : "refreshed-token";
            });

            fetchMock.mockResolvedValueOnce({
                ok: false,
status: 401,
                text: async () => JSON.stringify ({ error: { message: "Unauthorized" } })
            });
            fetchMock.mockResolvedValueOnce({
                ok: true,
status: 200,
                text: async () => JSON.stringify ({ data: "ok" })
            });

            await transport.request("/retry");

            // Second call should have the refreshed token
            const secondCallHeaders = (fetchMock.mock.calls[1][1] as RequestInit).headers as Record<string, string>;
            expect(secondCallHeaders["Authorization"]).toBe("Bearer refreshed-token");
        });

        it("does not retry 401 when no onUnauthorized is configured", async () => {
            const transport = createTransport({
                baseUrl: "http://localhost",
                fetch: fetchMock as typeof globalThis.fetch
            });

            fetchMock.mockResolvedValueOnce({
                ok: false,
status: 401,
                statusText: "Unauthorized",
                text: async () => JSON.stringify ({ error: { message: "Unauthorized" } })
            });

            await expect(transport.request("/no-retry")).rejects.toThrow("Unauthorized");
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });
    });
});
