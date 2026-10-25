import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { createRebaseClient } from "../src/index";
import { MemoryOfflineStore } from "../src/offline-store";

/**
 * `offline.keepLastUser`: an offline reload in cookie mode opens the last
 * signed-in user's local database instead of the signed-out one.
 *
 * Cookie mode stores nothing about the session on the device, so a load that
 * cannot reach the server has no user. Without the option the user's cache is
 * hidden and their writes queue as the signed-out user's, orphaned at the next
 * sign-in. With it, the last user's data is shown and their writes queue as
 * theirs — and nothing replays until the server confirms the session, because
 * a queue is sent under whoever is signed in, and nobody is yet.
 *
 * A real client against a fake backend: the behaviour lives in the wiring
 * between auth and the offline engine.
 */

const HOUR = 3_600_000;
const LAST_USER_KEY = "rebase-offline:last-user";

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function tokenResponse(uid: string): Response {
    return jsonResponse({
        tokens: { accessToken: `token-${uid}`, refreshToken: "", accessTokenExpiresAt: Date.now() + HOUR },
        user: { uid }
    });
}

const refused = () => jsonResponse({ error: { message: "No session", code: "INVALID_TOKEN" } }, 401);
const unreachable = (): Response => { throw new TypeError("Failed to fetch"); };

async function flush() {
    for (let i = 0; i < 20; i++) await new Promise<void>((r) => setImmediate(r));
}

function path(input: string | URL | Request): string {
    return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

function backend() {
    const state = {
        dataReachable: true,
        refresh: (): Response => refused()
    };
    const posts = new Map<string, Record<string, unknown>>();
    const writes: { method: string; authorization: string | null }[] = [];
    const fetchStub: typeof fetch = async (input, init) => {
        const url = path(input);
        const method = init?.method ?? "GET";
        if (url.endsWith("/auth/refresh")) return state.refresh();
        if (url.endsWith("/auth/logout")) return jsonResponse({ success: true });
        if (url.includes("/data/posts")) {
            if (!state.dataReachable) throw new TypeError("Failed to fetch");
            // Row-level security: a request without a session reads nothing.
            const anonymous = !new Headers(init?.headers).get("Authorization");
            const byId = /\/data\/posts\/([^/?]+)/.exec(url)?.[1];
            if (method === "GET" && byId !== undefined) {
                const row = anonymous ? undefined : posts.get(byId);
                return row ? jsonResponse(row) : jsonResponse({ error: { message: "Not found", code: "NOT_FOUND" } }, 404);
            }
            if (method === "GET") {
                const data = anonymous ? [] : [...posts.values()];
                return jsonResponse({ data, meta: { total: data.length, limit: 20, offset: 0, hasMore: false } });
            }
            writes.push({ method, authorization: new Headers(init?.headers).get("Authorization") });
            const row = { ...(JSON.parse(String(init?.body)) as Record<string, unknown>) };
            posts.set(String(row.id), row);
            return jsonResponse(row);
        }
        return jsonResponse({});
    };
    return { state, posts, writes, fetchStub };
}

type Backend = ReturnType<typeof backend>;

let open: { close: () => void }[] = [];

function client(server: Backend, store: MemoryOfflineStore, keepLastUser: boolean) {
    const c = createRebaseClient({
        baseUrl: "http://api.test",
        realtime: false,
        fetch: server.fetchStub,
        offline: { store, syncIntervalMs: 0, crossTab: false, keepLastUser },
        auth: { autoRefresh: false, authFlowMode: "cookie" }
    });
    open.push(c);
    return c;
}

async function queuedTitles(store: MemoryOfflineStore, scope: string): Promise<unknown[]> {
    const queue = await store.listQueue(`${scope}|`);
    return queue.map((m) => (m.data as Record<string, unknown> | undefined)?.title);
}

/** A visit signed in as `uid` that read `posts`, leaving its rows on the device. */
async function earlierVisit(server: Backend, store: MemoryOfflineStore, uid: string, keepLastUser: boolean) {
    server.posts.set("p1", { id: "p1", title: `only ${uid} can see this` });
    server.state.refresh = () => tokenResponse(uid);
    const earlier = client(server, store, keepLastUser);
    await earlier.auth.isInitialized();
    await earlier.data.collection("posts").find();
    await flush();
    earlier.close();
}

/** A reload with no connection: the refresh on load cannot reach the server, nor can the data API. */
function offlineReload(server: Backend, store: MemoryOfflineStore, keepLastUser: boolean) {
    server.state.refresh = unreachable;
    server.state.dataReachable = false;
    return client(server, store, keepLastUser);
}

beforeEach(() => {
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
    for (const c of open) c.close();
    open = [];
    jest.restoreAllMocks();
});

describe("offline.keepLastUser", () => {
    it("off (the default): an offline reload is the signed-out user's", async () => {
        const server = backend();
        const store = new MemoryOfflineStore();
        await earlierVisit(server, store, "u1", false);
        expect(await store.getCache(LAST_USER_KEY)).toBeUndefined();

        const rebase = offlineReload(server, store, false);
        await rebase.auth.isInitialized();
        await rebase.data.collection("posts").create({ id: "p2", title: "typed offline" });

        expect(await queuedTitles(store, "anon")).toEqual(["typed offline"]);
        expect(rebase.offline!.status().unverifiedUser).toBeUndefined();
    });

    it("on: an offline reload shows the last user's rows and queues as them", async () => {
        const server = backend();
        const store = new MemoryOfflineStore();
        await earlierVisit(server, store, "u1", true);

        const rebase = offlineReload(server, store, true);
        await rebase.auth.isInitialized();
        expect(rebase.auth.restoreOutcome()).toBe("unreachable");
        const posts = rebase.data.collection("posts");

        expect((await posts.find()).data).toEqual([{ id: "p1", title: "only u1 can see this" }]);
        await posts.create({ id: "p2", title: "typed offline" });

        expect(await queuedTitles(store, "u1")).toEqual(["typed offline"]);
        expect(await queuedTitles(store, "anon")).toEqual([]);
        expect(rebase.auth.getSession()).toBeNull();
        expect(rebase.offline!.status().unverifiedUser).toBe(true);
    });

    it("nothing replays until the session is confirmed, and then it replays as that user", async () => {
        const server = backend();
        const store = new MemoryOfflineStore();
        await earlierVisit(server, store, "u1", true);
        const rebase = offlineReload(server, store, true);
        await rebase.auth.isInitialized();
        await flush();
        await rebase.data.collection("posts").create({ id: "p2", title: "typed offline" });

        // The data API is back, the session is not yet: nothing may go out
        // without the credentials of the user who made it.
        server.state.dataReachable = true;
        expect(await rebase.offline!.sync()).toEqual({ flushed: 0, remaining: 1 });
        expect(server.writes).toEqual([]);

        // The refresh answers once the connection is back, and the client asks
        // again by itself when it sees the connection return.
        server.state.refresh = () => tokenResponse("u1");
        await rebase.data.collection("posts").find();
        await flush();

        expect(rebase.auth.getSession()?.user.uid).toBe("u1");
        expect(server.writes.map((w) => w.authorization)).toEqual(["Bearer token-u1"]);
        expect(rebase.offline!.status().unverifiedUser).toBeUndefined();
        expect(await rebase.offline!.pending()).toEqual([]);
    });

    /**
     * Back online, the session not yet confirmed: the refresh has not
     * answered, so every request goes out with no credentials. What comes back
     * is what an anonymous caller may see, not the user's data — and it used
     * to be kept as theirs: an empty list replaced their cached list, and a
     * 404 for one of their rows deleted it from the device. A write was sent
     * without credentials instead of queued for its author.
     */
    describe("online, before the session is confirmed", () => {
        async function unconfirmed(server: Backend, store: MemoryOfflineStore) {
            await earlierVisit(server, store, "u1", true);
            const rebase = offlineReload(server, store, true);
            await rebase.auth.isInitialized();
            await flush();
            // The data API answers again; the refresh still cannot be reached.
            server.state.dataReachable = true;
            await rebase.data.collection("posts").find();
            await flush();
            expect(rebase.offline!.status()).toMatchObject({ online: true, unverifiedUser: true });
            return rebase;
        }

        it("answers reads from the last user's rows and keeps the anonymous answer nowhere", async () => {
            const server = backend();
            const store = new MemoryOfflineStore();
            const rebase = await unconfirmed(server, store);
            const posts = rebase.data.collection("posts");
            const mine = [{ id: "p1", title: "only u1 can see this" }];

            expect((await posts.find()).data).toEqual(mine);
            expect(await posts.findById("p1")).toEqual(mine[0]);

            server.state.dataReachable = false;
            expect((await posts.find()).data).toEqual(mine);
            expect(await posts.findById("p1")).toEqual(mine[0]);
        });

        it("queues a write for its author instead of sending it without credentials", async () => {
            const server = backend();
            const store = new MemoryOfflineStore();
            const rebase = await unconfirmed(server, store);

            await rebase.data.collection("posts").create({ id: "p2", title: "typed before the refresh answered" });

            expect(server.writes).toEqual([]);
            expect(await queuedTitles(store, "u1")).toEqual(["typed before the refresh answered"]);

            // Confirmed: it goes out as u1.
            server.state.refresh = () => tokenResponse("u1");
            server.state.dataReachable = false;
            await rebase.data.collection("posts").find();
            server.state.dataReachable = true;
            await rebase.data.collection("posts").find();
            await flush();
            expect(rebase.auth.getSession()?.user.uid).toBe("u1");
            expect(server.writes.map((w) => w.authorization)).toEqual(["Bearer token-u1"]);
        });
    });

    it("a session the server refuses once reachable signs the device out, and keeps the queue for its author", async () => {
        const server = backend();
        const store = new MemoryOfflineStore();
        await earlierVisit(server, store, "u1", true);
        const rebase = offlineReload(server, store, true);
        await rebase.auth.isInitialized();
        await flush();
        await rebase.data.collection("posts").create({ id: "p2", title: "typed offline" });

        server.state.dataReachable = true;
        server.state.refresh = refused;
        await rebase.data.collection("posts").find();
        await flush();

        expect(rebase.offline!.status().unverifiedUser).toBeUndefined();
        expect(await rebase.offline!.pending()).toEqual([]);
        expect(await queuedTitles(store, "u1")).toEqual(["typed offline"]);
        expect(server.writes).toEqual([]);
        expect(await store.getCache(LAST_USER_KEY)).toBeUndefined();
    });

    it("is never used when the server answered that there is no session", async () => {
        const server = backend();
        const store = new MemoryOfflineStore();
        await earlierVisit(server, store, "u1", true);

        server.state.refresh = refused;
        server.state.dataReachable = false;
        const rebase = client(server, store, true);
        await rebase.auth.isInitialized();
        expect(rebase.auth.restoreOutcome()).toBe("none");
        await rebase.data.collection("posts").create({ id: "p2", title: "typed signed out" });

        expect(await queuedTitles(store, "anon")).toEqual(["typed signed out"]);
        expect(await store.getCache(LAST_USER_KEY)).toBeUndefined();
    });

    it("is forgotten at sign-out", async () => {
        const server = backend();
        const store = new MemoryOfflineStore();
        server.state.refresh = () => tokenResponse("u1");
        const rebase = client(server, store, true);
        await rebase.auth.isInitialized();
        await flush();
        expect((await store.getCache(LAST_USER_KEY))?.value).toBe("u1");

        await rebase.auth.signOut();
        await flush();

        expect(await store.getCache(LAST_USER_KEY)).toBeUndefined();
    });
});
