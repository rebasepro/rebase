/**
 * The in-process client on a backend that serves part of the API.
 *
 * `backend.rebase.functions`, `.auth` and `.admin` dispatch into the backend's
 * own routes, so on a process whose role turned a surface off — `worker` turns
 * off all of them — there is no route to reach. A cron job calling
 * `rebase.functions.invoke("send-digest")` works under `REBASE_ROLE=all` and,
 * after the documented move of cron to a worker, failed every night with
 * "No route for POST /api/functions/send-digest on this backend.": a sentence
 * that names no surface, no role and nothing to do. It now says which surface
 * is off and what to do instead.
 *
 * Per role, what the in-process client reaches:
 * - `functions` — forwarded through `REBASE_FUNCTIONS_UPSTREAM` where one is
 *   set (`functions-proxy.test.ts` in @rebasepro/server), the named refusal
 *   where none is.
 * - `admin` and `cron` — the account administration and the cron controls
 *   are carried in-process whatever the role serves; the rest of the admin
 *   group (backups, logs, …) answers the named refusal.
 * - `auth` — a person's sign-in flows, refused by name, pointing at
 *   `rebase.admin`.
 */
import { afterAll, describe, expect, it } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { REBASE_USER_ROLE } from "@rebasepro/common";
import type { AuthClient, BackendBootstrapper, CollectionConfig, DataDriver, InitializedDriver } from "@rebasepro/types";
import { createRebaseBackend, defineCron, defineFunction, type RebaseBackend } from "@rebasepro/server";

const ping = defineFunction((app) => {
    app.post("/", (c) => c.json({ pong: true }));
});

const nightly = defineCron({ schedule: "0 3 * * *", handler: async () => undefined });

function bootstrapper(db: PGlite): BackendBootstrapper {
    const executeSql = async (text: string) => (await db.query<Record<string, unknown>>(text)).rows;
    const scoped = {
        fetchCollection: async () => [],
        fetchOne: async () => undefined,
        save: async () => ({}),
        delete: async () => undefined,
        countCollection: async () => 0,
        admin: { executeSql }
    };
    const driver = { ...scoped, withAuth: async () => scoped } as unknown as DataDriver;
    const repo = {
        getUserRoleIds: async () => [],
        getUserById: async () => null,
        getAccountAccessState: async () => null,
        getUserByEmail: async () => null,
        listUsersPaginated: async () => ({ users: [], total: 0, limit: 25, offset: 0 })
    };
    return {
        type: "postgres",
        isDefault: true,
        async initializeDriver(): Promise<InitializedDriver> {
            return { driver, internals: {} } as unknown as InitializedDriver;
        },
        async initializeAuth() { return { userService: repo, authRepository: repo }; },
        async ensureCollectionSchema() { return { applied: 0 }; },
        async ensureCollectionPolicies() { return { applied: 0 }; },
        getAdmin: () => scoped.admin
    } as unknown as BackendBootstrapper;
}

/** What `REBASE_ROLE=worker` turns off. */
const WORKER = { auth: false, data: false, storage: false, admin: false, functions: false, cron: false, meta: false, realtime: false };

/** What `REBASE_ROLE=functions` turns off. */
const FUNCTIONS = { auth: false, data: false, storage: false, admin: false, cron: false, meta: false, realtime: false };

const built: Array<{ backend: RebaseBackend; db: PGlite }> = [];

async function make(surfaces?: typeof WORKER | typeof FUNCTIONS): Promise<RebaseBackend> {
    const db = new PGlite();
    await db.exec(`CREATE ROLE ${REBASE_USER_ROLE} NOLOGIN`);
    const backend = await createRebaseBackend({
        collections: [{ name: "x", slug: "x", table: "x", properties: { id: { name: "ID", type: "string", isId: "uuid" } } } as unknown as CollectionConfig],
        bootstrappers: [bootstrapper(db)],
        auth: { jwtSecret: "in-process-client-trimmed-role-secret-0123456789" },
        functions: { ping },
        crons: { nightly },
        cronPersistence: false,
        provision: true,
        ...(surfaces ? { surfaces } : {})
    });
    built.push({ backend, db });
    return backend;
}

afterAll(async () => {
    for (const { backend, db } of built) {
        await backend.shutdown(0);
        await db.close();
    }
});

/** An accessor the in-process client always carries, typed optional on the shared client type. */
function present<T>(accessor: T | undefined, name: string): T {
    if (!accessor) throw new Error(`backend.rebase.${name} is missing`);
    return accessor;
}

/**
 * The client's own auth carries the email reset flow, which the shared
 * `AuthClient` interface does not declare. A guard rather than a cast, so a
 * client without it fails the test by name.
 */
function hasEmailReset(auth: AuthClient): auth is AuthClient & { resetPasswordForEmail(email: string): Promise<unknown> } {
    return "resetPasswordForEmail" in auth && typeof auth.resetPasswordForEmail === "function";
}

function askEmailReset(auth: AuthClient, email: string): Promise<unknown> {
    if (!hasEmailReset(auth)) throw new Error("backend.rebase.auth has no resetPasswordForEmail");
    return auth.resetPasswordForEmail(email);
}

/** The error a call rejects with, as `status code message`. */
async function refusal(call: Promise<unknown>): Promise<string> {
    try {
        await call;
    } catch (error) {
        const e = error as Error & { status?: number; code?: string };
        return `${e.status ?? ""} ${e.code ?? ""} ${e.message}`;
    }
    throw new Error("the call succeeded");
}

describe("the in-process client on a trimmed role", () => {
    it("reaches the function where the functions surface is on", async () => {
        const backend = await make();
        expect(await present(backend.rebase.functions, "functions").invoke("ping", {})).toEqual({ pong: true });
    });

    it("names the functions surface, and what to do, where it is off", async () => {
        const backend = await make(WORKER);
        const said = await refusal(present(backend.rebase.functions, "functions").invoke("ping", {}));
        expect(said).toMatch(/^404 NOT_FOUND /);
        expect(said).toContain("functions surface is off");
        expect(said).toContain("REBASE_ROLE=worker");
        expect(said).toContain("over HTTP");
    });

    it("reaches the account administration where the admin surface is off", async () => {
        // A cron job on a worker that deactivates stale accounts, or lists
        // them for a digest: the adapter's admin routes load no user code, so
        // the worker carries them in-process.
        const backend = await make(WORKER);
        expect(await present(backend.rebase.admin, "admin").listUsers()).toMatchObject({ users: [], total: 0 });
    });

    it("reaches the cron controls where the cron surface is off", async () => {
        const backend = await make(WORKER);
        const listing = await present(backend.rebase.cron, "cron").listJobs();
        expect(JSON.stringify(listing)).toContain("nightly");
    });

    it("names the admin surface for the admin routes a worker does not carry", async () => {
        const backend = await make(WORKER);
        const said = await refusal(present(backend.rebase.backups, "backups").list());
        expect(said).toMatch(/^404 NOT_FOUND /);
        expect(said).toContain("admin surface is off");
        expect(said).toContain("only the user and role administration");
    });

    it("names the auth surface, and points at rebase.admin, where it is off", async () => {
        const backend = await make(WORKER);
        const said = await refusal(askEmailReset(present(backend.rebase.auth, "auth"), "ada@example.com"));
        expect(said).toMatch(/^404 NOT_FOUND /);
        expect(said).toContain("auth surface is off");
        expect(said).toContain("use rebase.admin");
    });

    it("on the functions role, serves its functions and the account administration in-process", async () => {
        // A function calling `rebase.admin.*` from a handler: the functions
        // role serves no admin surface either.
        const backend = await make(FUNCTIONS);
        expect(await present(backend.rebase.functions, "functions").invoke("ping", {})).toEqual({ pong: true });
        expect(await present(backend.rebase.admin, "admin").listUsers()).toMatchObject({ users: [], total: 0 });
        const said = await refusal(askEmailReset(present(backend.rebase.auth, "auth"), "ada@example.com"));
        expect(said).toContain("auth surface is off");
    });

    it("serves none of it on the worker's own port", async () => {
        // Carried for the in-process client only: mounted on an app, the
        // worker still answers nothing under /api/admin.
        const { Hono } = await import("hono");
        const backend = await make(WORKER);
        const app = new Hono();
        backend.mount(app as never);
        for (const path of ["/api/admin/users", "/api/admin/cron"]) {
            const res = await app.request(path);
            expect(res.status).toBe(404);
            // The generic envelope for a path nothing serves — not the
            // in-process refusal, and not a 401 from a route that exists.
            expect(await res.json()).toMatchObject({ error: { code: "NOT_FOUND", message: `No route for GET ${path} on this backend.` } });
        }
    });
});
