/**
 * Storage answers a database outage the way every other door does.
 *
 * With the database down, the data API, sign-in, the admin routes and the
 * realtime socket all answer `503 DATABASE_UNAVAILABLE` with `Retry-After`.
 * Storage answered `401 UNAUTHORIZED` to a valid admin token: its auth
 * middleware caught whatever the adapter threw and called it "no user". The
 * built-in adapter throws a 503 when it cannot read the caller's account, so
 * the one door that dropped it told the SDK the session was bad, and the SDK
 * went to refresh a session that was fine.
 */
import { afterEach, describe, expect, it } from "@jest/globals";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Hono } from "hono";
import type { BackendBootstrapper, CollectionConfig, DataDriver, InitializedDriver } from "@rebasepro/types";
import { createRebaseBackend, errorHandler, type HonoEnv, type RebaseBackend } from "../src/index";
import { _resetRebaseMock } from "../src/singleton";
import { MemoryAuthStore } from "./helpers/memory-auth-store";

const widgets = {
    name: "widgets",
    slug: "widgets",
    table: "widgets",
    properties: { id: { name: "ID", type: "string", isId: "uuid" } }
} as unknown as CollectionConfig;

function driver(): DataDriver {
    const scoped = () => ({
        fetchCollection: async () => [{ id: "1" }],
        fetchOne: async () => undefined,
        save: async () => ({}),
        delete: async () => undefined,
        countCollection: async () => 1
    });
    return { ...scoped(), withAuth: async () => scoped() as unknown as DataDriver } as unknown as DataDriver;
}

/** The error node-postgres throws when the server is not there. */
const connectionRefused = () => Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), {
    code: "ECONNREFUSED", syscall: "connect", address: "127.0.0.1", port: 5432
});

const built: RebaseBackend[] = [];
const dirs: string[] = [];

afterEach(async () => {
    while (built.length) await built.pop()!.shutdown(0);
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
    _resetRebaseMock();
});

async function world() {
    const store = new MemoryAuthStore();
    let databaseDown = false;
    const repo = store.repo();
    const live = repo.getAccountAccessState!.bind(repo);
    repo.getAccountAccessState = async (uid, sid) => {
        if (databaseDown) throw connectionRefused();
        return live(uid, sid);
    };
    const bootstrapper = {
        type: "postgres",
        isDefault: true,
        async initializeDriver(): Promise<InitializedDriver> {
            return { driver: driver(), collections: undefined, internals: {}, realtimeProvider: {} } as unknown as InitializedDriver;
        },
        async initializeAuth() {
            return { userService: repo, authRepository: repo };
        }
    } as unknown as BackendBootstrapper;

    const basePath = mkdtempSync(path.join(tmpdir(), "rebase-storage-db-down-"));
    dirs.push(basePath);
    const backend = await createRebaseBackend({
        collections: [widgets],
        bootstrappers: [bootstrapper],
        auth: { jwtSecret: "storage-database-unavailable-secret-0123456789" },
        storage: { type: "local", basePath },
        storageInsecureAllowAnyAuthenticated: true,
        cronPersistence: false,
        provision: false
    } as never);
    built.push(backend);

    const app = new Hono<HonoEnv>();
    app.onError(errorHandler);
    app.route("/storage", backend.routes.storage());
    app.route("/data", backend.routes.data());

    const admin = await repo.createUser({ email: "admin@corp.test", emailVerified: true });
    await repo.setUserRoles(admin.id, ["admin"]);
    const token = await backend.services.jwt.generateAccessToken(admin.id, ["admin"]);
    const auth = { authorization: `Bearer ${token}` };

    const upload = () => {
        const form = new FormData();
        form.append("file", new File(["hello"], "note.txt", { type: "text/plain" }));
        form.append("key", "docs/note.txt");
        return app.request("/storage/upload", { method: "POST", body: form, headers: auth });
    };
    const list = () => app.request("/storage/list?prefix=docs/", { headers: auth });

    return { store: repo, admin, auth, app, upload, list, takeDatabaseDown: () => { databaseDown = true; } };
}

const codeOf = async (res: Response) => (await res.json() as { error?: { code?: string } }).error?.code;

describe("storage with the database down", () => {
    it("answers an upload 503 DATABASE_UNAVAILABLE with Retry-After, as the data API does", async () => {
        const { app, auth, upload, takeDatabaseDown } = await world();
        expect((await upload()).status).toBeLessThan(300);

        takeDatabaseDown();
        const refused = await upload();
        expect(refused.status).toBe(503);
        expect(refused.headers.get("Retry-After")).toBe("5");
        expect(await codeOf(refused)).toBe("DATABASE_UNAVAILABLE");

        const data = await app.request("/data/widgets", { headers: auth });
        expect(data.status).toBe(503);
        expect(await codeOf(data)).toBe("DATABASE_UNAVAILABLE");
    });

    it("answers a listing 503 DATABASE_UNAVAILABLE", async () => {
        const { list, takeDatabaseDown } = await world();
        expect((await list()).status).toBe(200);

        takeDatabaseDown();
        const refused = await list();
        expect(refused.status).toBe(503);
        expect(await codeOf(refused)).toBe("DATABASE_UNAVAILABLE");
    });
});

describe("storage refusing a session", () => {
    it("says why, as the data API does: a revoked session is SESSION_REVOKED", async () => {
        const { store, admin, upload } = await world();
        await store.setTokensValidAfter!(admin.id, new Date(Date.now() + 60_000));
        const refused = await upload();
        expect(refused.status).toBe(401);
        expect(await codeOf(refused)).toBe("SESSION_REVOKED");
    });

    it("still answers a request with no credential 401", async () => {
        const { app } = await world();
        const refused = await app.request("/storage/list?prefix=docs/");
        expect(refused.status).toBe(401);
        expect(await codeOf(refused)).toBe("UNAUTHORIZED");
    });
});
