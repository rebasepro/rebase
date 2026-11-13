import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import type { BackendBootstrapper, SchemaChangePlan } from "@rebasepro/types";

import { initializeRebaseBackend } from "../src/init";
import type { HonoEnv } from "../src/api/types";
import { fakeBootstrapper, fakeDataDriver, idleServer } from "./helpers/server-b-fakes";
import { generateAccessToken } from "../src/auth/jwt";
import { readSchemaFile, writeSchemaFixture } from "./helpers/schema-source-fixture";

/**
 * After an apply, the running server serves the change.
 *
 * Boot compiles `backend/schema` into the table registry (what
 * `GET /api/schema/tables` serves, cached per revision) and the lowered
 * tables the REST routes validate writes against. A live apply runs the DDL —
 * so the database has the column — and until now the server went on serving
 * the tables it booted with: the new column missing from the descriptors, and
 * every write naming it refused as an unknown field, until a restart.
 */

const JWT_SECRET = "live-schema-serves-applied-secret-1234567890";
const BOOTS_A_BACKEND = 30_000;

let fixture: ReturnType<typeof writeSchemaFixture>;
const saved: Record<string, unknown>[] = [];
const executed: string[] = [];
const originalNodeEnv = process.env.NODE_ENV;

beforeEach(() => {
    process.env.NODE_ENV = "development";
    saved.length = 0;
    executed.length = 0;
    fixture = writeSchemaFixture();
    const git = (...args: string[]) => execFileSync("git", args, { cwd: fixture.root, stdio: "pipe" });
    fs.writeFileSync(path.join(fixture.root, "rebase.json"), "{}\n");
    git("init", "-q");
    git("add", "-A");
    git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "init");
});

afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    fixture.cleanup();
});

function bootstrapper(): BackendBootstrapper {
    const plan: SchemaChangePlan = {
        files: [],
        statements: ['ALTER TABLE "public"."posts" ADD COLUMN IF NOT EXISTS "subtitle" TEXT;'],
        classified: { changes: [], verdict: "safe", applicable: true },
        message: "feat(schema): add subtitle to posts\n"
    };
    return fakeBootstrapper({
        driver: fakeDataDriver({
            async save(props) {
                saved.push({ ...props.values });
                return { id: "p1", path: props.path, values: props.values };
            },
            admin: {
                planSchemaChange: async () => plan,
                executeSql: async (sql: string) => { executed.push(sql); return []; }
            }
        }),
        tables: undefined
    }, {
        async initializeAuth() {
            const authRepository = {
                getUserRoleIds: async (uid: string) => (uid === "admin-1" ? ["admin"] : []),
                getTokensValidAfter: async () => undefined
            };
            return { userService: authRepository, authRepository };
        }
    });
}

async function boot(): Promise<Hono<HonoEnv>> {
    const app = new Hono<HonoEnv>();
    await initializeRebaseBackend({
        app,
        server: idleServer(),
        schemaDir: fixture.dir,
        cronPersistence: false,
        auth: { jwtSecret: JWT_SECRET },
        bootstrappers: [bootstrapper()]
    });
    return app;
}

const admin = async () => ({ authorization: `Bearer ${await generateAccessToken("admin-1", ["admin"])}` });

async function tables(app: Hono<HonoEnv>): Promise<{ etag: string | null; columns: string[] }> {
    const res = await app.request("/api/schema/tables", { headers: await admin() });
    expect(res.status).toBe(200);
    const body = await res.json() as { slug: string; columns: { key: string }[] }[];
    return {
        etag: res.headers.get("etag"),
        columns: body.find(table => table.slug === "posts")?.columns.map(column => column.key) ?? []
    };
}

const writePost = async (app: Hono<HonoEnv>) => app.request("/api/data/posts", {
    method: "POST",
    headers: { "content-type": "application/json", ...(await admin()) },
    body: JSON.stringify({ title: "Hello", subtitle: "World" })
});

describe("an applied column, as the running server serves it", () => {
    it("is described by GET /api/schema/tables under a new ETag, and accepted by REST", async () => {
        const app = await boot();

        const before = await tables(app);
        expect(before.columns).not.toContain("subtitle");
        // Refused as a field the table does not have: what the edit changes.
        expect((await writePost(app)).status).toBe(400);

        const applied = await app.request("/api/admin/schema/apply", {
            method: "POST",
            headers: { "content-type": "application/json", ...(await admin()) },
            body: JSON.stringify({ patches: [{ op: "addColumn", table: "posts", key: "subtitle", column: { type: { kind: "text" } } }] })
        });
        expect(applied.status).toBe(200);
        expect(await applied.json()).toMatchObject({ applied: true });
        expect(executed).toContain('ALTER TABLE "public"."posts" ADD COLUMN IF NOT EXISTS "subtitle" TEXT;');
        expect(readSchemaFile(fixture.dir, "posts.ts")).toContain("subtitle: col.text()");

        const after = await tables(app);
        expect(after.columns).toContain("subtitle");
        expect(after.etag).not.toBe(before.etag);

        const written = await writePost(app);
        expect(written.status).toBeLessThan(300);
        expect(saved.at(-1)).toMatchObject({ title: "Hello", subtitle: "World" });
    }, BOOTS_A_BACKEND);

    it("is not served after a source-only commit: the database does not have it", async () => {
        const app = await boot();
        const before = await tables(app);
        // Source-only needs a change the planner offers source-only; this one
        // is safe, so `sourceOnly` is refused as not needed — and nothing is served.
        await app.request("/api/admin/schema/apply", {
            method: "POST",
            headers: { "content-type": "application/json", ...(await admin()) },
            body: JSON.stringify({ sourceOnly: true, patches: [{ op: "addColumn", table: "posts", key: "subtitle", column: { type: { kind: "text" } } }] })
        });
        const after = await tables(app);
        expect(after.columns).not.toContain("subtitle");
        expect(after.etag).toBe(before.etag);
    }, BOOTS_A_BACKEND);
});
