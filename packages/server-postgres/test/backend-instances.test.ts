/**
 * Two backends in one process are two backends.
 *
 * Each `createRebaseBackend` owns its JWT keys, its access model, its API-key
 * store, its rate-limit counts and its in-process client. None of them is a
 * process global the last backend built overwrites, so a token one backend
 * minted means nothing to the other, a key created in one does not open the
 * other, and a function served by one sees that one as `rebase`.
 *
 * The module-level API (`configureJwt`, `verifyAccessToken`, `getAccessModel`,
 * `rebase`, …) answers for the PROCESS DEFAULT: what `configureJwt` /
 * `configureAccess` set, or the backend `initializeRebaseBackend` (or
 * `setDefaultBackend`) installed. `createRebaseBackend` leaves it alone.
 *
 * Real pieces wherever the machine allows: the server's own routes and auth,
 * the Postgres realtime socket on a real `http.Server`, and PGlite — a real
 * Postgres — behind each backend's SQL admin, so API keys live in a database
 * of each backend's own. The data driver is a stand-in that says which backend
 * answered; the database driver is not what this file is about.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "@jest/globals";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { Hono } from "hono";
import { WebSocket } from "ws";
import { REBASE_USER_ROLE } from "@rebasepro/common";
import type { AccessModel, BackendBootstrapper, CollectionConfig, DataDriver, InitializedDriver } from "@rebasepro/types";
import {
    configureAccess,
    configureJwt,
    createRebaseBackend,
    defineFunction,
    getAccessModel,
    initializeRebaseBackend,
    rebase,
    verifyCredential,
    type HonoEnv,
    type RebaseBackend
} from "@rebasepro/server";
import { generateAccessToken, generateMcpAccessToken, verifyAccessToken } from "../../server/src/auth/jwt";
import { MemoryRateLimitStore } from "../../server/src/auth/rate-limit-store";
import { _resetRebaseMock } from "../../server/src/singleton";
import { createPostgresWebSocket } from "../src/websocket";
import type { RealtimeService } from "../src/services/realtimeService";
import type { PostgresBackendDriver } from "../src/PostgresBackendDriver";

const SECRET = {
    A: "backend-a-secret-0123456789abcdef-0123456789",
    B: "backend-b-secret-0123456789abcdef-0123456789",
    C: "backend-c-secret-0123456789abcdef-0123456789",
    DEFAULT: "process-default-secret-0123456789abcdef-0123"
} as const;
type Name = keyof typeof SECRET;

/** Who each backend's account store knows, and their roles. */
const ACCOUNTS: Record<string, string[]> = {
    "admin-1": ["admin"],
    "ops-1": ["ops"],
    "user-1": []
};

function collection(slug: string, extra: Record<string, unknown> = {}): CollectionConfig {
    return {
        name: slug,
        slug,
        table: slug,
        properties: { id: { name: "ID", type: "string", isId: "uuid" } },
        ...extra
    } as unknown as CollectionConfig;
}

/** The users collection, declaring the app's roles: A's grants `ops` the log reader, B's declares no role at all. */
function users(roles: AccessModel["roles"]): CollectionConfig {
    return collection("users", { auth: { enabled: true, roles } });
}

type Identity = { uid: string; roles?: string[] };

/** A driver that answers as `name`, its SQL admin a PGlite database of that backend's own. */
function driverFor(name: string, db: PGlite): DataDriver {
    const executeSql = async (text: string, options?: { params?: unknown[] }) =>
        (await db.query<Record<string, unknown>>(text, options?.params)).rows;
    const scoped = (user: Identity | null) => ({
        backend: name,
        // `imported`: what a hook importing `rebase` reaches from inside this
        // read — the backend whose database answers, or why none does.
        fetchCollection: async () => [{ id: "1", backend: name, as: user?.uid ?? null, imported: await importedRebase() }],
        fetchOne: async () => undefined,
        save: async () => ({}),
        delete: async () => undefined,
        countCollection: async () => 1,
        admin: { executeSql }
    });
    return {
        ...scoped(null),
        withAuth: async (user: Identity) => scoped(user) as unknown as DataDriver
    } as unknown as DataDriver;
}

/** The `whoami` row of the database the imported `rebase` reaches, or the error it throws. */
async function importedRebase(): Promise<unknown> {
    try {
        const [row] = await rebase.sql("SELECT name FROM whoami");
        return row?.name;
    } catch (error) {
        return `threw: ${error instanceof Error ? error.message : String(error)}`;
    }
}

/** What the Postgres socket needs of a realtime service to authenticate a client. */
function realtimeStub(): RealtimeService {
    return {
        // What the backend hands its realtime provider to run background
        // refetches in — kept, so a test can run something through it.
        setScopeRunner(run: <T>(fn: () => T) => T) {
            (this as { scopeRunner?: unknown }).scopeRunner = run;
        },
        addClient: () => undefined,
        removeClient: () => undefined,
        handleClientMessage: async () => undefined,
        rescopeClient: async () => undefined
    } as unknown as RealtimeService;
}

function bootstrapper(name: string, db: PGlite): BackendBootstrapper {
    const driver = driverFor(name, db);
    const realtime = realtimeStub();
    const repo = {
        getUserRoleIds: async (uid: string) => ACCOUNTS[uid] ?? [],
        getUserById: async (uid: string) => (uid in ACCOUNTS ? { id: uid, email: `${uid}@example.com`, disabled: false } : null),
        getAccountAccessState: async (uid: string) => (uid in ACCOUNTS
            ? { roles: ACCOUNTS[uid], disabled: false, tokensValidAfter: null, sessionActive: true }
            : null),
        getUserByEmail: async () => null
    };
    return {
        type: "postgres",
        isDefault: true,
        async initializeDriver(): Promise<InitializedDriver> {
            return { driver, collections: undefined, internals: {}, realtimeProvider: realtime } as unknown as InitializedDriver;
        },
        async initializeAuth() {
            return { userService: repo, authRepository: repo };
        },
        async ensureCollectionSchema() {
            return { applied: 0 };
        },
        async ensureCollectionPolicies() {
            return { applied: 0 };
        },
        getAdmin: () => driver.admin,
        async initializeWebsockets(server: unknown, rt: unknown, socketDriver: unknown, config: unknown, adapter: unknown, limits?: unknown) {
            createPostgresWebSocket(
                server as Server,
                rt as RealtimeService,
                socketDriver as PostgresBackendDriver,
                config as never,
                adapter as never,
                limits as never
            );
        }
    } as unknown as BackendBootstrapper;
}

/**
 * The same function file, served by both backends: what `ctx.rebase` and the
 * imported `rebase` are, read from the database each one's `sql` reaches.
 */
const whoami = defineFunction((app, { rebase: ctxRebase }) => {
    app.get("/", async (c) => {
        const [fromContext] = await ctxRebase.sql("SELECT name FROM whoami");
        const [fromImport] = await rebase.sql("SELECT name FROM whoami");
        return c.json({ ctx: fromContext?.name, imported: fromImport?.name });
    });
});

const RATE_WINDOW_MS = 15 * 60 * 1000;

interface Instance {
    name: Name;
    db: PGlite;
    backend: RebaseBackend;
    app: Hono<HonoEnv>;
    rateLimitStore: MemoryRateLimitStore;
}

async function database(name: string): Promise<PGlite> {
    const db = new PGlite();
    await db.exec(`CREATE ROLE ${REBASE_USER_ROLE} NOLOGIN`);
    await db.exec("CREATE TABLE whoami (name text)");
    await db.query("INSERT INTO whoami (name) VALUES ($1)", [name]);
    return db;
}

const storageDir = mkdtempSync(path.join(tmpdir(), "rebase-instances-"));

async function instance(name: "A" | "B", collections: CollectionConfig[], userLimit = 1000): Promise<Instance> {
    const db = await database(name);
    const rateLimitStore = new MemoryRateLimitStore(RATE_WINDOW_MS);
    const backend = await createRebaseBackend({
        collections,
        bootstrappers: [bootstrapper(name, db)],
        auth: { jwtSecret: SECRET[name] },
        functions: { whoami },
        storage: { type: "local", basePath: storageDir },
        storageInsecureAllowAnyAuthenticated: true,
        rateLimit: { store: rateLimitStore, user: userLimit },
        cronPersistence: false,
        provision: true
    });
    built.push({ backend, db });
    const app = new Hono<HonoEnv>();
    backend.mount(app, { basePath: "/api" });
    return { name, db, backend, app, rateLimitStore };
}

/** A session token for `uid`, signed with `name`'s secret, minted before any backend exists. */
const tokens: Record<string, string> = {};
const token = (name: Name, uid: string) => tokens[`${name}:${uid}`];

const bearer = (value: string) => ({ headers: { authorization: `Bearer ${value}` } });

let A: Instance;
let B: Instance;
/** Every backend this file built, to shut down at the end. */
const built: Array<{ backend: RebaseBackend; db: PGlite }> = [];

/** Read every process-default slot the module-level API answers from. */
async function processDefaults() {
    const probe = tokens[`DEFAULT:user-1`];
    return {
        jwtVerifiesDefaultToken: (await verifyAccessToken(probe))?.uid ?? null,
        jwtVerifiesA: (await verifyAccessToken(token("A", "user-1")).catch(() => null))?.uid ?? null,
        accessModel: getAccessModel(),
        singleton: (globalThis as Record<symbol, unknown>)[Symbol.for("@rebasepro/server:singleton-instance")] ?? null,
        resolver: (globalThis as Record<symbol, unknown>)[Symbol.for("@rebasepro/server:singleton-resolver")] ?? null
    };
}

const SENTINEL_MODEL: AccessModel = { roles: { sentinel: { scopes: ["logs:read"] } }, scopes: {} };

let defaultsBefore: Awaited<ReturnType<typeof processDefaults>>;
let defaultsAfter: Awaited<ReturnType<typeof processDefaults>>;

beforeAll(async () => {
    for (const name of Object.keys(SECRET) as Name[]) {
        configureJwt({ secret: SECRET[name] });
        for (const uid of Object.keys(ACCOUNTS)) {
            tokens[`${name}:${uid}`] = await generateAccessToken(uid, ACCOUNTS[uid]);
        }
    }
    // The process default, as a test or a hand-wired server sets it.
    configureJwt({ secret: SECRET.DEFAULT });
    configureAccess({ model: SENTINEL_MODEL });
    _resetRebaseMock();
    defaultsBefore = await processDefaults();

    A = await instance("A", [collection("alpha_items"), users({ ops: { scopes: ["logs:read"] } })]);
    B = await instance("B", [collection("beta_items"), users({})]);

    defaultsAfter = await processDefaults();
});

afterAll(async () => {
    for (const { backend, db } of built) {
        await backend.shutdown(0);
        await db.close();
    }
    rmSync(storageDir, { recursive: true, force: true });
});

describe("createRebaseBackend writes no process global", () => {
    it("leaves every process-default slot exactly as it found it", () => {
        expect(defaultsAfter.jwtVerifiesDefaultToken).toBe("user-1");
        expect(defaultsAfter.jwtVerifiesA).toBeNull();
        expect(defaultsAfter.accessModel).toBe(SENTINEL_MODEL);
        expect(defaultsAfter.singleton).toBe(defaultsBefore.singleton);
        expect(defaultsAfter.resolver).toBe(defaultsBefore.resolver);
        expect(defaultsAfter).toEqual(defaultsBefore);
    });
});

describe("a token minted by one backend is refused by the other", () => {
    it("on the data route, both ways", async () => {
        expect((await A.app.request("/api/data/alpha_items", bearer(token("A", "user-1")))).status).toBe(200);
        expect((await B.app.request("/api/data/beta_items", bearer(token("B", "user-1")))).status).toBe(200);
        expect((await B.app.request("/api/data/beta_items", bearer(token("A", "user-1")))).status).toBe(401);
        expect((await A.app.request("/api/data/alpha_items", bearer(token("B", "user-1")))).status).toBe(401);
        // The process default's token opens neither.
        expect((await A.app.request("/api/data/alpha_items", bearer(token("DEFAULT", "user-1")))).status).toBe(401);
    });

    it("each backend serves its own collections", async () => {
        expect((await A.app.request("/api/data/beta_items", bearer(token("A", "user-1")))).status).toBe(404);
        const res = await B.app.request("/api/data/beta_items", bearer(token("B", "user-1")));
        expect(JSON.stringify(await res.json())).toContain("\"backend\":\"B\"");
    });

    it("on the realtime socket's handshake", async () => {
        const server = createServer();
        await A.backend.attachRealtime(server);
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
        const port = (server.address() as AddressInfo).port;
        try {
            expect(await authenticate(port, token("A", "user-1"))).toBe("AUTH_SUCCESS");
            expect(await authenticate(port, token("B", "user-1"))).toBe("AUTH_ERROR");
        } finally {
            server.closeAllConnections();
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    });
});

describe("each backend has its own access model", () => {
    it("a role A declares opens A's log reader, and means nothing on B", async () => {
        expect((await A.app.request("/api/admin/logs", bearer(token("A", "ops-1")))).status).toBe(200);
        expect((await B.app.request("/api/admin/logs", bearer(token("B", "ops-1")))).status).toBe(403);
    });
});

describe("a storage download token from one backend is refused by the other", () => {
    it("is spendable on the backend that minted it only", async () => {
        const form = new FormData();
        form.append("file", new File(["hello"], "note.txt", { type: "text/plain" }));
        form.append("key", "docs/note.txt");
        const uploaded = await A.app.request("/api/storage/upload", { method: "POST", body: form, ...bearer(token("A", "user-1")) });
        expect(uploaded.status).toBeLessThan(300);

        const metadata = await A.app.request("/api/storage/metadata/default/docs/note.txt", bearer(token("A", "user-1")));
        expect(metadata.status).toBe(200);
        const downloadToken = JSON.stringify(await metadata.json()).match(/"token":"([^"]+)"/)?.[1];
        expect(downloadToken).toBeDefined();

        const query = `?token=${encodeURIComponent(downloadToken!)}`;
        expect((await A.app.request(`/api/storage/file/default/docs/note.txt${query}`)).status).toBe(200);
        expect((await B.app.request(`/api/storage/file/default/docs/note.txt${query}`)).status).toBe(401);
    });
});

describe("an API key created in one backend does not authenticate on the other", () => {
    it("opens A's data and not B's", async () => {
        const created = await A.app.request("/api/admin/api-keys", {
            method: "POST",
            headers: { authorization: `Bearer ${token("A", "admin-1")}`, "content-type": "application/json" },
            body: JSON.stringify({ name: "reader", scopes: ["data:read"] })
        });
        expect(created.status).toBe(201);
        const key = ((await created.json()) as { key: { key: string } }).key.key;

        expect((await A.app.request("/api/data/alpha_items", bearer(key))).status).toBe(200);
        expect((await B.app.request("/api/data/beta_items", bearer(key))).status).toBe(401);
        // The backend that holds it verifies it for a socket of the app's own,
        // as what the key holds; the other does not.
        expect(await A.backend.verifyCredential(key)).toEqual(expect.objectContaining({ kind: "api-key", scopes: ["data:read"] }));
        expect(await B.backend.verifyCredential(key)).toBeNull();
        // Nor does the process default know it.
        expect(await verifyCredential(key)).toBeNull();
    });
});

describe("rate-limit hits on one backend do not count against the other", () => {
    it("on the data API", async () => {
        // A pair of their own, three requests per person each, so the budget
        // spent here is spent nowhere else in this file.
        const tightA = await instance("A", [collection("alpha_items")], 3);
        const tightB = await instance("B", [collection("beta_items")], 3);
        const statuses: number[] = [];
        for (let i = 0; i < 4; i++) {
            statuses.push((await tightA.app.request("/api/data/alpha_items", bearer(token("A", "admin-1")))).status);
        }
        expect(statuses).toEqual([200, 200, 200, 429]);
        expect((await tightB.app.request("/api/data/beta_items", bearer(token("B", "admin-1")))).status).toBe(200);
        // Counted in A's own store, under the person's bucket — B's never saw them.
        expect((await tightA.rateLimitStore.hit("user:admin-1", RATE_WINDOW_MS, 1000)).remaining).toBeLessThan(997);
        expect((await tightB.rateLimitStore.hit("user:admin-1", RATE_WINDOW_MS, 1000)).remaining).toBe(998);
    });

    it("on the auth routes' own limiters", async () => {
        const forgot = (backend: Instance) => backend.app.request("/api/auth/forgot-password", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ email: "victim@example.com" })
        });
        const statuses: number[] = [];
        for (let i = 0; i < 6; i++) statuses.push((await forgot(A)).status);
        // No mail server: answered 503 until the per-address budget runs out.
        expect(statuses).toEqual([503, 503, 503, 503, 503, 429]);
        expect((await forgot(B)).status).toBe(503);
    });
});

describe("inside a function served by a backend, rebase is that backend", () => {
    it("ctx.rebase and the imported rebase, on each", async () => {
        const fromA = await A.app.request("/api/functions/whoami", bearer(token("A", "user-1")));
        expect(await fromA.json()).toEqual({ ctx: "A", imported: "A" });
        const fromB = await B.app.request("/api/functions/whoami", bearer(token("B", "user-1")));
        expect(await fromB.json()).toEqual({ ctx: "B", imported: "B" });
    });

    it("in-process calls too: backend.rebase.functions reaches its own backend's", async () => {
        const res = await A.backend.fetch(new Request("http://local/api/functions/whoami"));
        expect(await res.json()).toEqual({ ctx: "A", imported: "A" });
    });
});

/**
 * The same read, reached through each door into a backend's data, must see
 * that backend as `rebase` — a hook importing it writes to that backend's
 * database. The socket and MCP were mounted outside the scope REST runs in,
 * and saw the process default (another backend's database) or nothing.
 */
describe("a read reached over any door sees its backend as rebase", () => {
    it("REST", async () => {
        const res = await B.app.request("/api/data/beta_items", bearer(token("B", "user-1")));
        expect(JSON.stringify(await res.json())).toContain("\"imported\":\"B\"");
    });

    it("a frame on the realtime socket", async () => {
        const server = createServer();
        await B.backend.attachRealtime(server);
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
        const port = (server.address() as AddressInfo).port;
        try {
            const answer = await socketFetch(port, token("B", "user-1"), "beta_items");
            expect(answer).toContain("\"imported\":\"B\"");
        } finally {
            server.closeAllConnections();
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    });

    it("a realtime refetch, whatever scheduled it", async () => {
        // A refetch runs on a timer armed by whatever announced the change —
        // change capture's LISTEN connection among them, which is no
        // backend's. The provider runs it through the runner its backend gave.
        const provider = B.backend.realtimeService as unknown as { scopeRunner?: <T>(fn: () => T) => T };
        expect(provider.scopeRunner).toBeDefined();
        expect(await provider.scopeRunner!(() => importedRebase())).toBe("B");
    });

    it("an MCP tool call", async () => {
        const publicUrl = "https://mcp-scope.test";
        const db = await database("M");
        const previous = process.env.REBASE_PUBLIC_URL;
        process.env.REBASE_PUBLIC_URL = publicUrl;
        let backend: RebaseBackend;
        try {
            // Signed with the process default's secret, so the token below —
            // minted with the module-level helper — verifies on it.
            backend = await createRebaseBackend({
                collections: [collection("delta_items")],
                bootstrappers: [bootstrapper("M", db)],
                auth: { jwtSecret: SECRET.DEFAULT },
                surfaces: { mcp: true },
                cronPersistence: false,
                provision: true
            });
        } finally {
            if (previous === undefined) delete process.env.REBASE_PUBLIC_URL;
            else process.env.REBASE_PUBLIC_URL = previous;
        }
        built.push({ backend, db });
        const app = new Hono<HonoEnv>();
        backend.mount(app, { basePath: "/api" });
        const mcpToken = await generateMcpAccessToken({
            uid: "admin-1", roles: ["admin"], scope: "data:read", clientId: "mcp_scope_test",
            aud: `${publicUrl}/mcp`, iss: publicUrl
        }, 3600);

        const res = await app.request("/mcp", {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${mcpToken}` },
            body: JSON.stringify({
                jsonrpc: "2.0", id: 1, method: "tools/call",
                params: { name: "query_collection", arguments: { collection: "delta_items" } }
            })
        });
        const text = await res.text();
        expect(text).toContain("\\\"imported\\\":\\\"M\\\"");
    });
});

describe("initializeRebaseBackend installs its backend as the process default", () => {
    let db: PGlite;
    let server: Server;
    let booted: RebaseBackend | undefined;

    afterEach(async () => {
        await booted?.shutdown(0);
        booted = undefined;
        await db?.close();
        configureJwt({ secret: SECRET.DEFAULT });
        configureAccess({ model: SENTINEL_MODEL });
        _resetRebaseMock();
    });

    it("so the module-level API answers for it", async () => {
        db = await database("C");
        server = createServer();
        const app = new Hono<HonoEnv>();
        booted = await initializeRebaseBackend({
            app,
            server,
            collections: [collection("gamma_items"), users({ auditor: { scopes: ["logs:read"] } })],
            bootstrappers: [bootstrapper("C", db)],
            auth: { jwtSecret: SECRET.C },
            cronPersistence: false
        });
        expect((await verifyAccessToken(token("C", "user-1")))?.uid).toBe("user-1");
        expect(getAccessModel().roles).toHaveProperty("auditor");
        const [row] = await rebase.sql("SELECT name FROM whoami");
        expect(row.name).toBe("C");
        // And the two built by hand are still themselves.
        expect((await A.app.request("/api/data/alpha_items", bearer(token("A", "user-1")))).status).toBe(200);
        expect((await A.app.request("/api/data/alpha_items", bearer(token("C", "user-1")))).status).toBe(401);
    });
});

/** Dial the socket, authenticate with `jwt`, send one FETCH_COLLECTION for `path`, and answer the reply as sent. */
function socketFetch(port: number, jwt: string, path: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const socket = new WebSocket(`ws://127.0.0.1:${port}/`);
        const timer = setTimeout(() => {
            socket.terminate();
            reject(new Error("no answer to FETCH_COLLECTION"));
        }, 5000);
        socket.once("error", (error) => {
            clearTimeout(timer);
            reject(error);
        });
        socket.once("open", () => {
            socket.send(JSON.stringify({ type: "AUTHENTICATE", requestId: "auth-1", payload: { token: jwt } }));
        });
        socket.on("message", (data) => {
            const message = JSON.parse(String(data)) as { type?: string; requestId?: string };
            if (message.type === "AUTH_SUCCESS") {
                socket.send(JSON.stringify({ type: "FETCH_COLLECTION", requestId: "fetch-1", payload: { path } }));
            } else if (message.requestId === "fetch-1" || message.type === "AUTH_ERROR") {
                clearTimeout(timer);
                socket.terminate();
                resolve(String(data));
            }
        });
    });
}

/** Dial the socket, authenticate with `jwt`, and answer the reply's type. */
function authenticate(port: number, jwt: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const socket = new WebSocket(`ws://127.0.0.1:${port}/`);
        const timer = setTimeout(() => {
            socket.terminate();
            reject(new Error("no answer to AUTHENTICATE"));
        }, 5000);
        socket.once("error", (error) => {
            clearTimeout(timer);
            reject(error);
        });
        socket.once("open", () => {
            socket.send(JSON.stringify({ type: "AUTHENTICATE", requestId: "auth-1", payload: { token: jwt } }));
        });
        socket.on("message", (data) => {
            const message = JSON.parse(String(data)) as { type?: string };
            if (message.type === "AUTH_SUCCESS" || message.type === "AUTH_ERROR") {
                clearTimeout(timer);
                socket.terminate();
                resolve(message.type);
            }
        });
    });
}
