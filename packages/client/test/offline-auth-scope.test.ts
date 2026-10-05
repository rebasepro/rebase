import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { createRebaseClient } from "../src/index";
import { createMemoryStorage, type AuthStorage } from "../src/auth";
import { MemoryOfflineStore, type OfflineCacheEntry, type PendingMutation } from "../src/offline-store";
import type { RebaseSession } from "@rebasepro/types";
import { fakeServer, manager, settle } from "./support/offline-fake-server";

/**
 * Whose local database and outbox the offline engine uses before the client
 * knows who is signed in.
 *
 * A real client — real auth, real transport, real offline manager — against a
 * fake backend, because the bug lives in the wiring between auth and the
 * offline engine: in cookie mode nothing is stored on the device, so until the
 * refresh made on load answers there is no session, and the engine used to
 * take that for "nobody is signed in". A write made in that window went to the
 * signed-out queue, which no sign-in replays.
 */

const HOUR = 3_600_000;

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function tokenResponse(uid: string): Response {
    return jsonResponse({
        tokens: { accessToken: `token-${uid}`, refreshToken: `refresh-${uid}`, accessTokenExpiresAt: Date.now() + HOUR },
        user: { uid }
    });
}

function storedSession(uid: string, expiresIn: number): RebaseSession {
    return {
        accessToken: `token-${uid}`,
        refreshToken: `refresh-${uid}`,
        expiresAt: Date.now() + expiresIn,
        user: { uid, email: null, displayName: null, photoURL: null, providerId: "password", isAnonymous: false }
    };
}

function storageHolding(session: RebaseSession): AuthStorage {
    const storage = createMemoryStorage();
    storage.setItem("rebase_auth", JSON.stringify(session));
    return storage;
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => { resolve = r; });
    return { promise, resolve };
}

async function flush() {
    for (let i = 0; i < 20; i++) await new Promise<void>((r) => setImmediate(r));
}

function path(input: string | URL | Request): string {
    return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

/** Every key the offline engine reads or writes, in order. */
class RecordingStore extends MemoryOfflineStore {
    readonly touched: string[] = [];

    override async getCache(key: string) { this.touched.push(key); return super.getCache(key); }
    override async setCache(key: string, entry: OfflineCacheEntry) { this.touched.push(key); return super.setCache(key, entry); }
    override async setCacheMany(entries: { key: string; entry: OfflineCacheEntry }[]) {
        for (const { key } of entries) this.touched.push(key);
        return super.setCacheMany(entries);
    }
    override async deleteCache(keys: string[]) { this.touched.push(...keys); return super.deleteCache(keys); }
    override async listCache(prefix: string) { this.touched.push(prefix); return super.listCache(prefix); }
    override async listCacheEntries(prefix: string) { this.touched.push(prefix); return super.listCacheEntries(prefix); }
    override async enqueue(key: string, mutation: PendingMutation) { this.touched.push(key); return super.enqueue(key, mutation); }
    override async dequeue(key: string) { this.touched.push(key); return super.dequeue(key); }
    override async listQueue(prefix: string) { this.touched.push(prefix); return super.listQueue(prefix); }
    override async clear(prefix: string) { this.touched.push(prefix); return super.clear(prefix); }
}

/** The titles queued under one user's scope, read straight off the store. */
async function queuedTitles(store: MemoryOfflineStore, scope: string): Promise<unknown[]> {
    const queue = await store.listQueue(`${scope}|`);
    return queue.map((m) => (m.data as Record<string, unknown> | undefined)?.title);
}

/**
 * A backend with a `posts` collection, an auth service, and a data API that
 * can be unreachable while auth still answers — the shape of a flaky
 * connection on load, and the one that makes a write queue.
 */
function backend() {
    const state = {
        dataReachable: true,
        refresh: (): Response | Promise<Response> => jsonResponse({ error: { message: "No session", code: "INVALID_TOKEN" } }, 401)
    };
    const posts = new Map<string, Record<string, unknown>>();
    const writes: { method: string; authorization: string | null; body: unknown }[] = [];
    const fetchStub: typeof fetch = async (input, init) => {
        const url = path(input);
        const method = init?.method ?? "GET";
        if (url.endsWith("/auth/refresh")) return state.refresh();
        if (url.endsWith("/auth/login")) {
            const { email } = JSON.parse(String(init?.body)) as { email: string };
            return tokenResponse(email.split("@")[0]);
        }
        if (url.endsWith("/auth/logout")) return jsonResponse({ success: true });
        if (url.includes("/data/posts")) {
            if (!state.dataReachable) throw new TypeError("Failed to fetch");
            if (method === "GET") {
                const data = [...posts.values()];
                return jsonResponse({ data, meta: { total: data.length, limit: 20, offset: 0, hasMore: false } });
            }
            const body: unknown = init?.body ? JSON.parse(String(init.body)) : undefined;
            writes.push({ method, authorization: new Headers(init?.headers).get("Authorization"), body });
            if (method === "POST" && body && typeof body === "object") {
                const row = { ...(body as Record<string, unknown>) };
                posts.set(String(row.id), row);
                return jsonResponse(row);
            }
            return jsonResponse({});
        }
        return jsonResponse({});
    };
    return { state, posts, writes, fetchStub };
}

type Backend = ReturnType<typeof backend>;

function client(server: Backend, store: MemoryOfflineStore, auth: { authFlowMode?: "cookie" | "json"; storage?: AuthStorage } = {}) {
    return createRebaseClient({
        baseUrl: "http://api.test",
        realtime: false,
        fetch: server.fetchStub,
        offline: { store, syncIntervalMs: 0, crossTab: false },
        auth: { autoRefresh: false, ...auth }
    });
}

let open: { close: () => void }[] = [];

beforeEach(() => {
    // Tokenless clients in Node — what the anonymous-server-client guard warns about.
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
    for (const c of open) c.close();
    open = [];
    jest.restoreAllMocks();
});

function track<T extends { close: () => void }>(c: T): T {
    open.push(c);
    return c;
}

describe("cookie mode: before the refresh made on load has answered", () => {
    it("a write is not queued as the signed-out user's", async () => {
        const server = backend();
        const refresh = deferred<Response>();
        server.state.refresh = () => refresh.promise;
        server.state.dataReachable = false;
        const store = new MemoryOfflineStore();
        const rebase = track(client(server, store, { authFlowMode: "cookie" }));

        const write = rebase.data.collection("posts").create({ title: "typed while the session was coming back" });
        await flush();
        refresh.resolve(tokenResponse("u1"));
        await write;

        expect(await queuedTitles(store, "anon")).toEqual([]);
    });

    it("that write is queued as the user the session turns out to be", async () => {
        const server = backend();
        const refresh = deferred<Response>();
        server.state.refresh = () => refresh.promise;
        server.state.dataReachable = false;
        const store = new MemoryOfflineStore();
        const rebase = track(client(server, store, { authFlowMode: "cookie" }));

        const write = rebase.data.collection("posts").create({ title: "typed while the session was coming back" });
        await flush();
        refresh.resolve(tokenResponse("u1"));
        const row = await write;

        expect(row.title).toBe("typed while the session was coming back");
        expect(await queuedTitles(store, "u1")).toEqual(["typed while the session was coming back"]);
        expect(await rebase.offline!.pending()).toHaveLength(1);

        // And it replays as that user once the data API is back.
        server.state.dataReachable = true;
        await rebase.offline!.sync();
        expect(server.writes.map((w) => w.authorization)).toEqual(["Bearer token-u1"]);
    });

    it("a read answers from the user's local database, not the signed-out one", async () => {
        const server = backend();
        server.posts.set("p1", { id: "p1", title: "only u1 can see this" });
        server.state.refresh = () => tokenResponse("u1");
        const store = new MemoryOfflineStore();
        // A previous visit, signed in, left the row on the device.
        const earlier = track(client(server, store, { authFlowMode: "cookie" }));
        await earlier.auth.isInitialized();
        await earlier.data.collection("posts").find();
        earlier.close();

        const refresh = deferred<Response>();
        server.state.refresh = () => refresh.promise;
        server.state.dataReachable = false;
        const rebase = track(client(server, store, { authFlowMode: "cookie" }));
        const read = rebase.data.collection("posts").find();
        await flush();
        refresh.resolve(tokenResponse("u1"));

        expect((await read).data).toEqual([{ id: "p1", title: "only u1 can see this" }]);
    });

    it("nothing in the local database or the outbox is touched until the session is known", async () => {
        const server = backend();
        const refresh = deferred<Response>();
        server.state.refresh = () => refresh.promise;
        server.state.dataReachable = false;
        const store = new RecordingStore();
        const rebase = track(client(server, store, { authFlowMode: "cookie" }));
        const posts = rebase.data.collection("posts");

        const stop = posts.observe(undefined, () => undefined);
        const work = Promise.allSettled([
            posts.find(),
            posts.findById("p1"),
            posts.create({ title: "draft" }),
            posts.count(),
            rebase.offline!.pending(),
            rebase.offline!.sync()
        ]);
        await flush();

        expect(store.touched).toEqual([]);

        refresh.resolve(tokenResponse("u1"));
        await work;
        await flush();
        stop();

        expect(store.touched.length).toBeGreaterThan(0);
        expect(store.touched.filter((key) => !key.startsWith("u1|"))).toEqual([]);
    });

    it("a refresh that finds no session leaves writes with the signed-out user, where they belong", async () => {
        const server = backend();
        server.state.dataReachable = false;
        const store = new MemoryOfflineStore();
        const rebase = track(client(server, store, { authFlowMode: "cookie" }));

        await rebase.data.collection("posts").create({ title: "written signed out" });

        expect(rebase.auth.getSession()).toBeNull();
        expect(await queuedTitles(store, "anon")).toEqual(["written signed out"]);
    });
});

describe("JSON mode: the session stored on the device", () => {
    it("a live stored session is the scope from the first write", async () => {
        const server = backend();
        server.state.dataReachable = false;
        const store = new MemoryOfflineStore();
        const rebase = track(client(server, store, { storage: storageHolding(storedSession("u1", HOUR)) }));

        await rebase.data.collection("posts").create({ title: "mine" });

        expect(await queuedTitles(store, "u1")).toEqual(["mine"]);
        expect(await queuedTitles(store, "anon")).toEqual([]);
    });

    it("an expired stored session kept through an unreachable refresh keeps its user's scope", async () => {
        const server = backend();
        server.state.dataReachable = false;
        server.state.refresh = () => { throw new TypeError("Failed to fetch"); };
        const store = new MemoryOfflineStore();
        const rebase = track(client(server, store, { storage: storageHolding(storedSession("u1", -60_000)) }));

        await rebase.data.collection("posts").create({ title: "mine, offline" });

        expect(rebase.auth.getSession()?.user.uid).toBe("u1");
        expect(await queuedTitles(store, "u1")).toEqual(["mine, offline"]);
        expect(await queuedTitles(store, "anon")).toEqual([]);
    });

    it("an expired stored session whose refresh is refused does not leave its user's data in play", async () => {
        const server = backend();
        server.posts.set("p1", { id: "p1", title: "only u1 can see this" });
        const store = new MemoryOfflineStore();
        // A previous visit, signed in as u1, left the row on the device.
        const earlier = track(client(server, store, { storage: storageHolding(storedSession("u1", HOUR)) }));
        await earlier.data.collection("posts").find();
        earlier.close();

        // u1's refresh token has since been revoked.
        server.state.dataReachable = false;
        const rebase = track(client(server, store, { storage: storageHolding(storedSession("u1", -60_000)) }));
        const posts = rebase.data.collection("posts");
        await rebase.auth.isInitialized();
        expect(rebase.auth.getSession()).toBeNull();

        await posts.create({ title: "written signed out" });
        await expect(posts.find()).resolves.toMatchObject({ data: [expect.objectContaining({ title: "written signed out" })] });
        expect(await queuedTitles(store, "u1")).toEqual([]);
        expect(await queuedTitles(store, "anon")).toEqual(["written signed out"]);
    });
});

describe("writes queued while signed out, once someone signs in", () => {
    async function signedOutWrite() {
        const server = backend();
        server.state.dataReachable = false;
        const store = new MemoryOfflineStore();
        const rebase = track(client(server, store));
        await rebase.data.collection("posts").create({ title: "written signed out" });
        expect(await rebase.offline!.pending({ orphaned: true })).toEqual([]);
        expect(await rebase.offline!.pending()).toHaveLength(1);
        server.state.dataReachable = true;
        await rebase.auth.signInWithEmail("u1@example.com", "pw");
        await flush();
        return { server, store, rebase };
    }

    it("are not replayed as the user who signed in", async () => {
        const { server, rebase } = await signedOutWrite();

        await rebase.offline!.sync();

        expect(server.writes).toEqual([]);
        expect(await rebase.offline!.pending()).toEqual([]);
    });

    it("are listed by pending({ orphaned: true })", async () => {
        const { rebase } = await signedOutWrite();

        const orphaned = await rebase.offline!.pending({ orphaned: true });

        expect(orphaned.map((m) => (m.data as Record<string, unknown>).title)).toEqual(["written signed out"]);
        expect(orphaned[0]).toMatchObject({ collection: "posts", type: "create" });
    });

    it("are discarded by clear({ orphaned: true }), and then never replay — not at sign-out either", async () => {
        const { server, store, rebase } = await signedOutWrite();

        await rebase.offline!.clear({ orphaned: true });

        expect(await rebase.offline!.pending({ orphaned: true })).toEqual([]);
        expect(await store.listQueue("anon|")).toEqual([]);
        await rebase.auth.signOut();
        await flush();
        await rebase.offline!.sync();
        expect(server.writes).toEqual([]);
    });

    it("clear({ orphaned: true }) leaves the signed-in user's own queue alone", async () => {
        const { server, store, rebase } = await signedOutWrite();
        server.state.dataReachable = false;
        await rebase.data.collection("posts").create({ title: "u1's own" });

        await rebase.offline!.clear({ orphaned: true });

        expect(await queuedTitles(store, "u1")).toEqual(["u1's own"]);
        expect(await rebase.offline!.pending()).toHaveLength(1);
    });

    it("left alone, they replay the next time nobody is signed in", async () => {
        const { server, rebase } = await signedOutWrite();

        await rebase.auth.signOut();
        await flush();
        await rebase.offline!.sync();

        expect(server.writes.map((w) => (w.body as Record<string, unknown>).title)).toEqual(["written signed out"]);
        expect(server.writes[0].authorization).toBeNull();
    });
});

describe("signing out, and in as somebody else", () => {
    it("neither replays nor reports the first user's queue, and keeps it for them", async () => {
        const server = backend();
        server.state.dataReachable = false;
        const store = new MemoryOfflineStore();
        const rebase = track(client(server, store, { storage: storageHolding(storedSession("u1", HOUR)) }));
        const posts = rebase.data.collection("posts");
        await posts.create({ title: "u1's draft" });

        await rebase.auth.signOut();
        await rebase.auth.signInWithEmail("u2@example.com", "pw");
        await flush();
        await rebase.offline!.sync();

        expect(server.writes).toEqual([]);
        expect(await rebase.offline!.pending()).toEqual([]);
        expect(await rebase.offline!.pending({ orphaned: true })).toEqual([]);
        await expect(posts.find()).rejects.toThrow();
        expect(await queuedTitles(store, "u1")).toEqual(["u1's draft"]);

        // u1 comes back, and their write goes out as them.
        server.state.dataReachable = true;
        await rebase.auth.signOut();
        await rebase.auth.signInWithEmail("u1@example.com", "pw");
        await flush();
        await rebase.offline!.sync();
        expect(server.writes.map((w) => [w.authorization, (w.body as Record<string, unknown>).title]))
            .toEqual([["Bearer token-u1", "u1's draft"]]);
    });
});

describe("a realtime frame before the scope is known", () => {
    it("is handed on as the server sent it and kept nowhere", async () => {
        const server = fakeServer();
        const store = new RecordingStore();
        const { offline, posts } = manager(server, { store });
        offline.holdScope();
        const frames: unknown[] = [];
        posts.listen!(undefined, (result: { data: Record<string, unknown>[] }) => { frames.push(result.data); }, () => undefined);

        server.listeners[0]({ data: [{ id: "1", title: "live" }] });
        await settle();

        expect(frames).toEqual([[{ id: "1", title: "live" }]]);
        expect(store.touched).toEqual([]);

        offline.setScope("u1");
        server.listeners[0]({ data: [{ id: "1", title: "live" }] });
        await settle();
        expect(store.touched.filter((key) => !key.startsWith("u1|"))).toEqual([]);
        expect(store.touched.length).toBeGreaterThan(0);
    });
});
