import { afterEach, describe, expect, it, jest } from "@jest/globals";
import type { RebaseSession } from "@rebasepro/types";
import { createMemoryStorage, type AuthStorage } from "../src/auth";
import { createRebaseClient } from "../src/index";

/**
 * Requests carry a token the client knows to be good.
 *
 * Two ways they did not:
 *
 * - **Booting with an expired stored session.** The session was restored and a
 *   refresh started, but the transport held no token until it landed, so every
 *   request sent meanwhile went out with none. A route that admits anonymous
 *   reads answered those with its public rows rather than a 401 — never
 *   retried as the user, and wrong for them.
 * - **A token the client knew had expired** — a laptop that slept past
 *   `expiresAt`, a frozen tab restored. Every request went out with it, came
 *   back 401, and was sent again after the refresh: 10 queries cost 21
 *   requests, each a round trip slower than it had to be.
 *
 * Both now wait for the refresh — the one already running, or one started for
 * them — and go out once, with the fresh token.
 */

const HOUR = 3_600_000;
const STORAGE_KEY = "rebase_auth";
const USER_ROWS = [{ id: "mine" }];
const PUBLIC_ROWS = [{ id: "public" }];

function storedSession(expiresIn: number, user: Record<string, unknown> = { uid: "u1" }): RebaseSession {
    return {
        accessToken: "a1",
        refreshToken: "R1",
        expiresAt: Date.now() + expiresIn,
        user: { email: null, displayName: null, photoURL: null, providerId: "password", isAnonymous: false, ...user }
    } as RebaseSession;
}

function storageHolding(session: RebaseSession): AuthStorage {
    const storage = createMemoryStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify(session));
    return storage;
}

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => { resolve = r; });
    return { promise, resolve };
}

interface Sent { path: string; authorization: string | undefined }

/**
 * A server whose only valid access token is `a2`, minted by `/auth/refresh`.
 * A data request with no token is answered as an anonymous read — public rows,
 * 200 — exactly as a route with a public read policy would.
 */
function createServer(options: {
    refreshGate?: Promise<void>;
    refreshUser?: boolean;
    refreshFails?: boolean;
    /** No session to restore: the refresh is refused, as with no cookie. */
    refreshRefused?: boolean;
} = {}) {
    const sent: Sent[] = [];
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const path = url.replace("http://api.test/api", "");
        const headers = (init?.headers ?? {}) as Record<string, string>;
        sent.push({ path, authorization: headers.Authorization });
        if (path === "/auth/refresh") {
            await options.refreshGate;
            if (options.refreshFails) throw new TypeError("Failed to fetch");
            if (options.refreshRefused) return json({ error: { code: "INVALID_TOKEN", message: "no session" } }, 401);
            return json({
                tokens: { accessToken: "a2", refreshToken: "R2", accessTokenExpiresAt: Date.now() + HOUR },
                ...(options.refreshUser !== false && { user: { uid: "u1" } })
            });
        }
        if (path === "/auth/me") {
            return headers.Authorization === "Bearer a2"
                ? json({ user: { uid: "u1" } })
                : json({ error: { code: "TOKEN_EXPIRED", message: "expired" } }, 401);
        }
        if (!headers.Authorization) return json({ data: PUBLIC_ROWS, meta: { total: 1, hasMore: false } });
        if (headers.Authorization !== "Bearer a2") {
            return json({ error: { code: "TOKEN_EXPIRED", message: "expired" } }, 401);
        }
        return json({ data: USER_ROWS, meta: { total: 1, hasMore: false } });
    }) as typeof fetch;
    const data = () => sent.filter((s) => s.path.startsWith("/data/"));
    const refreshes = () => sent.filter((s) => s.path === "/auth/refresh").length;
    return { fetchFn, sent, data, refreshes };
}

const clients: { close: () => void }[] = [];
afterEach(() => {
    clients.splice(0).forEach((c) => c.close());
    jest.useRealTimers();
});

function client(fetchFn: typeof fetch, storage: AuthStorage, authFlowMode?: "cookie") {
    const c = createRebaseClient({ baseUrl: "http://api.test", realtime: false, fetch: fetchFn, auth: { storage, authFlowMode } });
    clients.push(c);
    return c;
}

describe("a client restored with an expired session", () => {
    it("sends the requests made before the refresh lands as the user, once each", async () => {
        const gate = deferred();
        const server = createServer({ refreshGate: gate.promise });
        const c = client(server.fetchFn, storageHolding(storedSession(-60_000)));

        // Fired at boot, before the refresh started for the restored session
        // has answered — what an app's first render does.
        const finds = Array.from({ length: 10 }, () => c.data.collection("posts").find({ limit: 20 }));
        gate.resolve();
        const results = await Promise.all(finds);

        for (const result of results) expect(result.data).toEqual(USER_ROWS);
        expect(server.refreshes()).toBe(1);
        expect(server.data()).toHaveLength(10);
        expect(server.data().every((s) => s.authorization === "Bearer a2")).toBe(true);
    });

    it("does not wait on itself when the refresh has to fetch the user", async () => {
        // A refresh answer with no `user`, over a stored session with none
        // either: the refresh reads `/auth/me` itself, through the transport.
        // That request must not wait for the refresh it is part of.
        const server = createServer({ refreshUser: false });
        const c = client(server.fetchFn, storageHolding(storedSession(-60_000, { uid: "" })));

        const result = await c.data.collection("posts").find({ limit: 20 });

        expect(result.data).toEqual(USER_ROWS);
        expect(c.auth.getSession()?.user.uid).toBe("u1");
    });

    it("sends what it holds when the refresh cannot reach the server", async () => {
        const server = createServer({ refreshFails: true });
        const c = client(server.fetchFn, storageHolding(storedSession(-60_000)));

        await expect(c.data.collection("posts").find({ limit: 20 })).rejects.toMatchObject({ status: 401 });
        // The session's own token — what the 401 recovery path has always
        // been handed — and never the anonymous read.
        expect(server.data().every((s) => s.authorization === "Bearer a1")).toBe(true);
    });
});

describe("a cookie-mode client restoring its session on load", () => {
    it("sends the requests made before the restore answers as the restored user", async () => {
        // The refresh token is an HttpOnly cookie, so there is no session in
        // memory until the silent refresh answers — on every load.
        const gate = deferred();
        const server = createServer({ refreshGate: gate.promise });
        const c = client(server.fetchFn, createMemoryStorage(), "cookie");

        const finds = Array.from({ length: 5 }, () => c.data.collection("posts").find({ limit: 20 }));
        gate.resolve();
        const results = await Promise.all(finds);

        for (const result of results) expect(result.data).toEqual(USER_ROWS);
        expect(server.refreshes()).toBe(1);
        expect(server.data().every((s) => s.authorization === "Bearer a2")).toBe(true);
    });

    it("sends them anonymous once it is clear there is no session", async () => {
        const server = createServer({ refreshRefused: true });
        const c = client(server.fetchFn, createMemoryStorage(), "cookie");

        const result = await c.data.collection("posts").find({ limit: 20 });

        expect(result.data).toEqual(PUBLIC_ROWS);
        expect(server.refreshes()).toBe(1);
        expect(server.sent.map((s) => s.path)).toEqual(["/auth/refresh", "/data/posts?limit=20"]);
    });
});

describe("a session whose token the client knows has expired", () => {
    it("refreshes once before the requests, instead of after ten 401s", async () => {
        // The refresh timer never fired: the laptop slept through it.
        jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate", "queueMicrotask"] });
        const server = createServer();
        const c = client(server.fetchFn, storageHolding(storedSession(HOUR)));
        await c.auth.isInitialized();
        jest.setSystemTime(Date.now() + 2 * HOUR);

        const results = await Promise.all(
            Array.from({ length: 10 }, (_, i) => c.data.collection("posts").find({ limit: 20, offset: i * 20 }))
        );

        for (const result of results) expect(result.data).toEqual(USER_ROWS);
        expect(server.refreshes()).toBe(1);
        expect(server.data()).toHaveLength(10);
        expect(server.data().every((s) => s.authorization === "Bearer a2")).toBe(true);
    });

    it("adds nothing while the token is good", async () => {
        const server = createServer();
        const c = client(server.fetchFn, storageHolding({ ...storedSession(HOUR), accessToken: "a2" }));
        await c.auth.isInitialized();

        await Promise.all(Array.from({ length: 10 }, () => c.data.collection("posts").find({ limit: 20 })));

        expect(server.refreshes()).toBe(0);
        expect(server.data()).toHaveLength(10);
    });
});
