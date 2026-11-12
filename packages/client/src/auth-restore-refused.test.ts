import { afterEach, describe, expect, it } from "@jest/globals";
import type { AuthChangeEvent, RebaseSession } from "@rebasepro/types";
import { createMemoryStorage, type AuthStorage } from "./auth";
import { createRebaseClient } from "./index";

/**
 * A stored session whose refresh token the server refuses on load — signed out
 * elsewhere, revoked, expired after weeks away.
 *
 * A request made while that restore runs waits for it, and then has to go out
 * as what the client is once it has answered: nobody. It was handed the
 * dropped session's expired access token instead — a token the transport did
 * not even hold — so a route with a public read policy answered 401 rather
 * than its public rows, and the 401 path, finding no session, gave up. The
 * cookie-mode restore already sends such a request anonymous.
 */

const HOUR = 3_600_000;
const PUBLIC_ROWS = [{ id: "public" }];

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function storageHoldingExpired(): AuthStorage {
    const storage = createMemoryStorage();
    const session: RebaseSession = {
        accessToken: "a1",
        refreshToken: "R1",
        expiresAt: Date.now() - 60_000,
        user: { uid: "u1", email: null, displayName: null, photoURL: null, providerId: "password", isAnonymous: false }
    };
    storage.setItem("rebase_auth", JSON.stringify(session));
    return storage;
}

function createServer(refusal: "INVALID_TOKEN" | "SESSION_REVOKED") {
    const sent: { path: string; authorization: string | undefined }[] = [];
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const path = url.replace("http://api.test/api", "");
        const headers = (init?.headers ?? {}) as Record<string, string>;
        sent.push({ path, authorization: headers.Authorization });
        if (path === "/auth/refresh") return json({ error: { code: refusal, message: "refused" } }, 401);
        if (!headers.Authorization) return json({ data: PUBLIC_ROWS, meta: { total: 1, hasMore: false } });
        return json({ error: { code: "TOKEN_EXPIRED", message: "expired" } }, 401);
    }) as typeof fetch;
    return { fetchFn, sent };
}

const clients: { close: () => void }[] = [];
afterEach(() => {
    clients.splice(0).forEach((c) => c.close());
});

describe("a stored session refused on load", () => {
    it.each(["INVALID_TOKEN", "SESSION_REVOKED"] as const)(
        "lets a request made meanwhile go out anonymous (%s)",
        async (refusal) => {
            const server = createServer(refusal);
            const c = createRebaseClient({
                baseUrl: "http://api.test",
                realtime: false,
                fetch: server.fetchFn,
                auth: { storage: storageHoldingExpired() }
            });
            clients.push(c);
            const events: AuthChangeEvent[] = [];
            c.auth.onAuthStateChange((event) => { events.push(event); });

            const result = await c.data.table("posts").find({ limit: 20 });

            expect(result.data).toEqual(PUBLIC_ROWS);
            expect(server.sent.filter((s) => s.path.startsWith("/data/")).map((s) => s.authorization)).toEqual([undefined]);
            await c.auth.isInitialized();
            expect(c.auth.getSession()).toBeNull();
            expect(c.auth.restoreOutcome()).toBe("refused");
        }
    );
});
