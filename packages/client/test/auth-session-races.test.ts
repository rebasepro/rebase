import { describe, it, expect, jest, afterEach } from "@jest/globals";
import { createAuth, createMemoryStorage, type AuthStorage } from "../src/auth";
import { createTransport } from "../src/transport";
import { RebaseClientError } from "../src/errors";
import type { AuthChangeEvent, RebaseSession } from "@rebasepro/types";

/**
 * The session is one piece of state with several writers — a sign-in, a
 * sign-out, a refresh answering late, a sibling tab sharing `localStorage` —
 * and each of these tests is one of them landing on top of another.
 *
 * Real transports, a fake `fetch`. The transport's own `Authorization` header
 * is part of what is asserted, because a session can be gone from memory and
 * storage and still be sent on every request.
 */

const STORAGE_KEY = "rebase_auth";
const HOUR = 3_600_000;

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" }
    });
}

function tokenResponse(n: number, uid = "u1", ttl = HOUR): Response {
    return jsonResponse({
        tokens: { accessToken: `a${n}`, refreshToken: `R${n}`, accessTokenExpiresAt: Date.now() + ttl },
        user: { uid }
    });
}

function errorResponse(status: number, code: string): Response {
    return jsonResponse({ error: { message: code, code } }, status);
}

function storedSession(n: number, uid = "u1", expiresIn = HOUR): RebaseSession {
    return {
        accessToken: `a${n}`,
        refreshToken: `R${n}`,
        expiresAt: Date.now() + expiresIn,
        user: { uid, email: null, displayName: null, photoURL: null, providerId: "password", isAnonymous: false }
    };
}

function storageHolding(session: RebaseSession): AuthStorage {
    const storage = createMemoryStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify(session));
    return storage;
}

function stored(storage: AuthStorage): RebaseSession | null {
    const raw = storage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) as RebaseSession : null;
}

/** A value that settles when the test says so. */
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => { resolve = r; });
    return { promise, resolve };
}

/** Let every queued promise continuation run. */
async function flush() {
    for (let i = 0; i < 50; i++) await new Promise<void>((r) => setImmediate(r));
}

function path(input: string | URL | Request): string {
    return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

afterEach(() => {
    jest.useRealTimers();
});

describe("a refresh that answers after the session it was refreshing has ended", () => {
    it("does not bring back a session the user signed out of", async () => {
        const refreshAnswer = deferred<Response>();
        const fetchMock: typeof fetch = async (input) => {
            const url = path(input);
            if (url.endsWith("/auth/refresh")) return refreshAnswer.promise;
            if (url.endsWith("/auth/logout")) return jsonResponse({ success: true });
            return jsonResponse({});
        };
        const storage = storageHolding(storedSession(1));
        const transport = createTransport({ baseUrl: "http://api.test", fetch: fetchMock });
        const auth = createAuth(transport, { storage, autoRefresh: false });
        const events: AuthChangeEvent[] = [];
        auth.onAuthStateChange((event) => { events.push(event); });

        // A refresh is in flight — the 401 handler, the timer, a socket —
        // when the user clicks "Sign out".
        const refreshing = auth.refreshSession().then(
            (session) => ({ session, error: undefined }),
            (error: unknown) => ({ session: undefined, error })
        );
        await flush();
        await auth.signOut();

        refreshAnswer.resolve(tokenResponse(2));
        const outcome = await refreshing;

        expect(auth.getSession()).toBeNull();
        expect(stored(storage)).toBeNull();
        expect(transport.getHeaders().Authorization).toBeUndefined();
        // SIGNED_OUT is the last word; nothing announces a refresh after it.
        expect(events).toEqual(["SIGNED_OUT"]);
        // And the caller of the refresh is told why it has no session.
        expect(outcome.error).toBeInstanceOf(RebaseClientError);
        expect((outcome.error as RebaseClientError).code).toBe("NOT_SIGNED_IN");
    });

    it("does not overwrite the session of a sign-in that happened meanwhile", async () => {
        const refreshAnswer = deferred<Response>();
        const fetchMock: typeof fetch = async (input) => {
            const url = path(input);
            if (url.endsWith("/auth/refresh")) return refreshAnswer.promise;
            if (url.endsWith("/auth/logout")) return jsonResponse({ success: true });
            if (url.endsWith("/auth/login")) return tokenResponse(9, "u2");
            return jsonResponse({});
        };
        const storage = storageHolding(storedSession(1, "u1"));
        const transport = createTransport({ baseUrl: "http://api.test", fetch: fetchMock });
        const auth = createAuth(transport, { storage, autoRefresh: false });

        const refreshing = auth.refreshSession();
        await flush();
        await auth.signOut();
        await auth.signInWithEmail("two@example.com", "pw");
        const events: AuthChangeEvent[] = [];
        auth.onAuthStateChange((event) => { events.push(event); });

        refreshAnswer.resolve(tokenResponse(2, "u1"));
        const answered = await refreshing;

        // The refresh hands back the session that is current, not u1's.
        expect(answered.user.uid).toBe("u2");
        expect(auth.getSession()?.user.uid).toBe("u2");
        expect(auth.getSession()?.refreshToken).toBe("R9");
        expect(stored(storage)?.refreshToken).toBe("R9");
        expect(transport.getHeaders().Authorization).toBe("Bearer a9");
        expect(events).toEqual([]);
    });

    it("does not sign out a new sign-in when the old session's refresh is refused", async () => {
        const refreshAnswer = deferred<Response>();
        const fetchMock: typeof fetch = async (input) => {
            const url = path(input);
            if (url.endsWith("/auth/refresh")) return refreshAnswer.promise;
            if (url.endsWith("/auth/login")) return tokenResponse(9, "u2");
            return jsonResponse({});
        };
        const storage = storageHolding(storedSession(1, "u1"));
        const transport = createTransport({ baseUrl: "http://api.test", fetch: fetchMock });
        const auth = createAuth(transport, { storage, autoRefresh: false });

        // u1's request was refused; recovering from it refreshes u1's token…
        const recovering = auth.handleUnauthorized();
        await flush();
        // …while u2 signs in on the same client.
        await auth.signInWithEmail("two@example.com", "pw");
        const events: AuthChangeEvent[] = [];
        auth.onAuthStateChange((event) => { events.push(event); });

        // u1's refresh token is refused outright — fatal, for u1.
        refreshAnswer.resolve(errorResponse(401, "INVALID_TOKEN"));

        // Not retried: the request was u1's, and u1 is gone.
        expect(await recovering).toBe(false);
        expect(auth.getSession()?.user.uid).toBe("u2");
        expect(stored(storage)?.refreshToken).toBe("R9");
        expect(transport.getHeaders().Authorization).toBe("Bearer a9");
        expect(events).not.toContain("SIGNED_OUT");
    });

    it("answers with the current session when the old one's refresh fails on the network", async () => {
        let failRefresh!: (error: Error) => void;
        const refreshFailure = new Promise<Response>((_, reject) => { failRefresh = reject; });
        const fetchMock: typeof fetch = async (input) => {
            const url = path(input);
            if (url.endsWith("/auth/refresh")) return refreshFailure;
            if (url.endsWith("/auth/logout")) return jsonResponse({ success: true });
            if (url.endsWith("/auth/login")) return tokenResponse(9, "u2");
            return jsonResponse({});
        };
        const storage = storageHolding(storedSession(1, "u1"));
        const transport = createTransport({ baseUrl: "http://api.test", fetch: fetchMock });
        const auth = createAuth(transport, { storage, autoRefresh: false });

        const refreshing = auth.refreshSession();
        await flush();
        await auth.signOut();
        await auth.signInWithEmail("two@example.com", "pw");

        // A socket asking for a fresh token gets u2's, not u1's network error.
        failRefresh(new TypeError("Failed to fetch"));
        await expect(refreshing).resolves.toMatchObject({ refreshToken: "R9", user: { uid: "u2" } });
    });

    it("refreshes the new session rather than joining the old session's refresh", async () => {
        const firstAnswer = deferred<Response>();
        const presented: string[] = [];
        const fetchMock: typeof fetch = async (input, init) => {
            const url = path(input);
            if (url.endsWith("/auth/refresh")) {
                const { refreshToken } = JSON.parse(String(init?.body)) as { refreshToken: string };
                presented.push(refreshToken);
                return refreshToken === "R1" ? firstAnswer.promise : tokenResponse(10, "u2");
            }
            if (url.endsWith("/auth/logout")) return jsonResponse({ success: true });
            if (url.endsWith("/auth/login")) return tokenResponse(9, "u2");
            return jsonResponse({});
        };
        const storage = storageHolding(storedSession(1, "u1"));
        const transport = createTransport({ baseUrl: "http://api.test", fetch: fetchMock });
        const auth = createAuth(transport, { storage, autoRefresh: false });

        const stale = auth.refreshSession().catch(() => undefined);
        await flush();
        await auth.signOut();
        await auth.signInWithEmail("two@example.com", "pw");

        const fresh = await auth.refreshSession();
        firstAnswer.resolve(tokenResponse(2, "u1"));
        await stale;

        expect(presented).toEqual(["R1", "R9"]);
        expect(fresh.refreshToken).toBe("R10");
        expect(auth.getSession()?.refreshToken).toBe("R10");
    });

    it("does not announce a refresh that lands while /logout is still being answered", async () => {
        const refreshAnswer = deferred<Response>();
        const logoutAnswer = deferred<Response>();
        const fetchMock: typeof fetch = async (input) => {
            const url = path(input);
            if (url.endsWith("/auth/refresh")) return refreshAnswer.promise;
            if (url.endsWith("/auth/logout")) return logoutAnswer.promise;
            return jsonResponse({});
        };
        const storage = storageHolding(storedSession(1));
        const transport = createTransport({ baseUrl: "http://api.test", fetch: fetchMock });
        const auth = createAuth(transport, { storage, autoRefresh: false });
        const events: AuthChangeEvent[] = [];
        auth.onAuthStateChange((event) => { events.push(event); });

        const refreshing = auth.refreshSession().catch(() => undefined);
        await flush();
        const signingOut = auth.signOut();
        await flush();
        refreshAnswer.resolve(tokenResponse(2));
        await refreshing;
        logoutAnswer.resolve(jsonResponse({ success: true }));
        await signingOut;

        expect(events).toEqual(["SIGNED_OUT"]);
        expect(stored(storage)).toBeNull();
    });

    it("does not keep retrying a scheduled refresh for a session that was signed out", async () => {
        jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate", "queueMicrotask"] });
        let refreshCalls = 0;
        const firstAnswer = deferred<Response>();
        const fetchMock: typeof fetch = async (input) => {
            const url = path(input);
            if (url.endsWith("/auth/refresh")) {
                refreshCalls++;
                if (refreshCalls === 1) return firstAnswer.promise;
                return errorResponse(503, "UNAVAILABLE");
            }
            if (url.endsWith("/auth/logout")) return jsonResponse({ success: true });
            return jsonResponse({});
        };
        // Inside the refresh buffer, so the scheduled refresh starts at once.
        const storage = storageHolding(storedSession(1, "u1", 60_000));
        const transport = createTransport({ baseUrl: "http://api.test", fetch: fetchMock });
        const auth = createAuth(transport, { storage });
        const events: AuthChangeEvent[] = [];
        auth.onAuthStateChange((event) => { events.push(event); });
        await flush();
        expect(refreshCalls).toBe(1);

        await auth.signOut();
        // The backend was restarting: a transient failure, which for a live
        // session means "back off and try again".
        firstAnswer.resolve(errorResponse(503, "UNAVAILABLE"));
        await flush();
        for (let i = 0; i < 10; i++) {
            jest.advanceTimersByTime(60_000);
            await flush();
        }

        expect(refreshCalls).toBe(1);
        expect(events).toEqual(["SIGNED_OUT"]);
    });
});


/**
 * A fake `/auth/refresh` that rotates like the real one: each refresh token
 * is good once, and presenting a superseded one answers TOKEN_ALREADY_USED
 * (the server's answer past its reuse window).
 */
function rotatingServer(firstLive = 1) {
    const live = new Set([`R${firstLive}`]);
    const superseded = new Set<string>();
    let n = firstLive;
    const presented: string[] = [];
    /** Runs before the answer is decided — a sibling rotating mid-request. */
    let beforeAnswer: ((refreshToken: string) => void) | undefined;
    const fetchMock: typeof fetch = async (input, init) => {
        const url = path(input);
        if (!url.endsWith("/auth/refresh")) return jsonResponse({});
        const { refreshToken } = JSON.parse(String(init?.body)) as { refreshToken: string };
        presented.push(refreshToken);
        beforeAnswer?.(refreshToken);
        if (superseded.has(refreshToken)) return errorResponse(401, "TOKEN_ALREADY_USED");
        if (!live.has(refreshToken)) return errorResponse(401, "INVALID_TOKEN");
        live.delete(refreshToken);
        superseded.add(refreshToken);
        n++;
        live.add(`R${n}`);
        return tokenResponse(n);
    };
    return {
        fetchMock,
        presented,
        /** Rotate a token as though another tab's refresh had just landed. */
        rotate(refreshToken: string): number {
            live.delete(refreshToken);
            superseded.add(refreshToken);
            n++;
            live.add(`R${n}`);
            return n;
        },
        onRequest(fn: (refreshToken: string) => void) { beforeAnswer = fn; }
    };
}

describe("two tabs sharing one persisted session", () => {
    it("a tab whose token a sibling already rotated takes the sibling's session", async () => {
        const server = rotatingServer();
        const shared = storageHolding(storedSession(1));
        const transportA = createTransport({ baseUrl: "http://api.test", fetch: server.fetchMock });
        const transportB = createTransport({ baseUrl: "http://api.test", fetch: server.fetchMock });
        const tabA = createAuth(transportA, { storage: shared, autoRefresh: false });
        const tabB = createAuth(transportB, { storage: shared, autoRefresh: false });
        const eventsB: AuthChangeEvent[] = [];
        tabB.onAuthStateChange((event) => { eventsB.push(event); });

        await tabA.refreshSession();
        expect(stored(shared)?.refreshToken).toBe("R2");

        // Tab B still holds R1 in memory. Spending it would be refused.
        const session = await tabB.refreshSession();

        expect(server.presented).toEqual(["R1"]);
        expect(session.refreshToken).toBe("R2");
        expect(tabB.getSession()?.accessToken).toBe("a2");
        expect(transportB.getHeaders().Authorization).toBe("Bearer a2");
        expect(stored(shared)?.refreshToken).toBe("R2");
        expect(eventsB).toEqual(["TOKEN_REFRESHED"]);
    });

    it("a background tab's scheduled refresh neither signs out nor wipes the shared session", async () => {
        jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate", "queueMicrotask"] });
        const server = rotatingServer();
        const shared = storageHolding(storedSession(1));
        const tabB = createAuth(createTransport({ baseUrl: "http://api.test", fetch: server.fetchMock }), { storage: shared });
        const tabA = createAuth(createTransport({ baseUrl: "http://api.test", fetch: server.fetchMock }), { storage: shared, autoRefresh: false });
        const eventsB: AuthChangeEvent[] = [];
        tabB.onAuthStateChange((event) => { eventsB.push(event); });

        await tabA.refreshSession();
        // Tab B's timer fires later, when A's token is itself about to expire.
        for (let i = 0; i < 60; i++) {
            jest.advanceTimersByTime(60_000);
            await flush();
        }

        // B refreshed with the token A left in storage, not its own stale one.
        expect(server.presented.slice(0, 2)).toEqual(["R1", "R2"]);
        expect(eventsB).not.toContain("SIGNED_OUT");
        expect(tabB.getSession()).not.toBeNull();
        expect(stored(shared)?.refreshToken).toBe(tabB.getSession()?.refreshToken);
    });

    it("a refusal because a sibling rotated mid-request adopts the sibling's session", async () => {
        const server = rotatingServer();
        const shared = storageHolding(storedSession(1));
        const auth = createAuth(createTransport({ baseUrl: "http://api.test", fetch: server.fetchMock }), { storage: shared, autoRefresh: false });
        // While this tab's request is on the wire, another tab's lands first
        // and persists its successor.
        server.onRequest((token) => {
            if (token !== "R1") return;
            const next = server.rotate("R1");
            shared.setItem(STORAGE_KEY, JSON.stringify(storedSession(next)));
        });

        const session = await auth.refreshSession();

        expect(server.presented).toEqual(["R1"]);
        expect(session.refreshToken).toBe("R2");
        expect(auth.getSession()?.refreshToken).toBe("R2");
    });

    it("refreshes with the sibling's token when the sibling's access token is spent too", async () => {
        const server = rotatingServer();
        const shared = storageHolding(storedSession(1));
        const auth = createAuth(createTransport({ baseUrl: "http://api.test", fetch: server.fetchMock }), { storage: shared, autoRefresh: false });
        server.rotate("R1");
        // The sibling persisted R2 long ago; its access token is expiring.
        shared.setItem(STORAGE_KEY, JSON.stringify(storedSession(2, "u1", 30_000)));

        const session = await auth.refreshSession();

        expect(server.presented).toEqual(["R2"]);
        expect(session.refreshToken).toBe("R3");
        expect(stored(shared)?.refreshToken).toBe("R3");
    });

    it("a tab giving up leaves alone a session another tab persisted", async () => {
        const server = rotatingServer(1);
        const shared = storageHolding(storedSession(7, "u1"));
        const auth = createAuth(createTransport({ baseUrl: "http://api.test", fetch: server.fetchMock }), { storage: shared, autoRefresh: false });
        // Another tab signed a different user in.
        const other = storedSession(1, "u2");
        shared.setItem(STORAGE_KEY, JSON.stringify(other));
        const events: AuthChangeEvent[] = [];
        auth.onAuthStateChange((event) => { events.push(event); });

        // R7 is refused outright: this tab's session is over.
        expect(await auth.handleUnauthorized()).toBe(false);

        expect(server.presented).toEqual(["R7"]);
        expect(events).toEqual(["SIGNED_OUT"]);
        expect(auth.getSession()).toBeNull();
        // …but the other tab's sign-in is not this tab's to delete.
        expect(stored(shared)).toEqual(other);
    });

    it("a tab giving up still clears storage that holds its own session", async () => {
        const server = rotatingServer(1);
        const shared = storageHolding(storedSession(7, "u1"));
        const auth = createAuth(createTransport({ baseUrl: "http://api.test", fetch: server.fetchMock }), { storage: shared, autoRefresh: false });

        expect(await auth.handleUnauthorized()).toBe(false);

        expect(auth.getSession()).toBeNull();
        expect(stored(shared)).toBeNull();
    });
});
