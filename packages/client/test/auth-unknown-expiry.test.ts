import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { createRebaseClient } from "../src/index";
import { createMemoryStorage } from "../src/auth";

/**
 * A session whose access token's expiry the server did not say.
 *
 * The Rebase server always sends `tokens.accessTokenExpiresAt`; a backend
 * that does not — a custom auth service, a proxy that reshapes the answer, an
 * older or mismatched server — left `session.expiresAt` undefined. Every
 * comparison against it is false, and two places read "false" as "expired":
 *
 * - the refresh timer: `delay = NaN` is neither `<= 0` nor too long, and
 *   `setTimeout(fn, NaN)` fires at once. Each refresh re-armed the next with
 *   no gap — about 1,900 `/auth/refresh` calls in 15 s from one client;
 * - the per-request freshness check, which then refreshed before every
 *   request.
 *
 * An expiry nobody stated is not one that has passed: the token is used until
 * the server refuses it, and the 401 path refreshes it then.
 */

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function path(input: string | URL | Request): string {
    return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

/** A backend whose token answers carry no `accessTokenExpiresAt`. */
function backend() {
    const calls = { refresh: 0, data: 0 };
    const tokens = () => ({ accessToken: `token-${calls.refresh}`, refreshToken: `refresh-${calls.refresh}` });
    const fetchStub: typeof fetch = async (input) => {
        const url = path(input);
        if (url.endsWith("/auth/login")) return jsonResponse({ tokens: tokens(), user: { uid: "alice" } });
        if (url.endsWith("/auth/refresh")) {
            calls.refresh++;
            return jsonResponse({ tokens: tokens(), user: { uid: "alice" } });
        }
        if (url.endsWith("/auth/me")) return jsonResponse({ user: { uid: "alice" } });
        if (url.includes("/data/posts")) {
            calls.data++;
            return jsonResponse({ data: [], meta: { total: 0, limit: 20, offset: 0, hasMore: false } });
        }
        return jsonResponse({});
    };
    return { fetchStub, calls };
}

let open: { close: () => void }[] = [];

beforeEach(() => {
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
    for (const client of open) client.close();
    open = [];
    jest.restoreAllMocks();
});

describe("a session with no stated expiry", () => {
    it("is not refreshed in a loop, nor before every request", async () => {
        const server = backend();
        const rebase = createRebaseClient({
            baseUrl: "http://api.test",
            realtime: false,
            fetch: server.fetchStub,
            auth: { autoRefresh: true, storage: createMemoryStorage() }
        });
        open.push(rebase);
        await rebase.auth.isInitialized();

        await rebase.auth.signInWithEmail("alice@example.com", "pw");
        await new Promise(resolve => setTimeout(resolve, 100));
        for (let i = 0; i < 5; i++) await rebase.data.collection("posts").find();

        expect(server.calls.data).toBe(5);
        expect(server.calls.refresh).toBe(0);
    });
});
