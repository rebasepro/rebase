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
 */
import { afterAll, describe, expect, it } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { REBASE_USER_ROLE } from "@rebasepro/common";
import type { BackendBootstrapper, CollectionConfig, DataDriver, InitializedDriver } from "@rebasepro/types";
import { createRebaseBackend, defineFunction, type RebaseBackend } from "@rebasepro/server";

const ping = defineFunction((app) => {
    app.post("/", (c) => c.json({ pong: true }));
});

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
        getUserByEmail: async () => null
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

const built: Array<{ backend: RebaseBackend; db: PGlite }> = [];

async function make(surfaces?: typeof WORKER): Promise<RebaseBackend> {
    const db = new PGlite();
    await db.exec(`CREATE ROLE ${REBASE_USER_ROLE} NOLOGIN`);
    const backend = await createRebaseBackend({
        collections: [{ name: "x", slug: "x", table: "x", properties: { id: { name: "ID", type: "string", isId: "uuid" } } } as unknown as CollectionConfig],
        bootstrappers: [bootstrapper(db)],
        auth: { jwtSecret: "in-process-client-trimmed-role-secret-0123456789" },
        functions: { ping },
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
        expect(await backend.rebase.functions.invoke("ping", {})).toEqual({ pong: true });
    });

    it("names the functions surface, and what to do, where it is off", async () => {
        const backend = await make(WORKER);
        const said = await refusal(backend.rebase.functions.invoke("ping", {}));
        expect(said).toMatch(/^404 NOT_FOUND /);
        expect(said).toContain("functions surface is off");
        expect(said).toContain("REBASE_ROLE=worker");
        expect(said).toContain("over HTTP");
    });

    it("names the admin surface where it is off", async () => {
        const backend = await make(WORKER);
        const said = await refusal(backend.rebase.admin.listUsers());
        expect(said).toMatch(/^404 NOT_FOUND /);
        expect(said).toContain("admin surface is off");
    });
});
