/**
 * The SQL console's saved snippets (`packages/server/src/api/sql-snippet-store.ts`
 * and `sql-snippet-routes.ts`), asked of a real Postgres (PGlite): the store's
 * own DDL and statements, and the routes behind the admin gate.
 *
 * - A personal snippet is its owner's alone; a team snippet is everyone's.
 * - Only its owner or an admin changes or deletes one, whoever sees it.
 * - A snippet is bounded in length, and a person in how many they keep.
 * - `database:read` lists snippets; saving, changing and deleting take
 *   `database:write` — and the console's export gate on `/api/admin/sql/*`
 *   does not stand in the way of a reader.
 */
import { describe, expect, it, beforeEach, afterEach } from "@jest/globals";
import { createServer } from "node:http";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { Hono } from "hono";
import type { BackendBootstrapper, InitializedDriver } from "@rebasepro/types";
import type { LegacyCollectionConfig } from "@rebasepro/common/migrate";
import {
    createSqlSnippetStore,
    MAX_SQL_SNIPPET_LENGTH,
    MAX_SQL_SNIPPETS_PER_OWNER,
    SqlSnippetError,
    type SqlSnippetStore
} from "../../server/src/api/sql-snippet-store";
import { initializeRebaseBackend } from "../../server/src/init";
import { generateAccessToken } from "../../server/src/auth/jwt";
import type { HonoEnv } from "../../server/src/api/types";
import { fakeDataDriver } from "../../server/test/helpers/server-a-fakes";
import { tablesFrom } from "../../server/test/helpers/tables";

let db: PGlite;

const exec = async (sql: string, options?: { params?: unknown[] }): Promise<Record<string, unknown>[]> => {
    if (options?.params) return (await db.query<Record<string, unknown>>(sql, options.params)).rows;
    const results = await db.exec(sql);
    return results[results.length - 1]?.rows ?? [];
};

const ADA = { uid: "ada", roles: ["admin"] };
const BOB = { uid: "bob", roles: ["developer"] };
const CY = { uid: "cy", roles: ["developer"] };

beforeEach(() => {
    db = new PGlite();
});

afterEach(async () => {
    await db.close();
});

describe("the snippet store", () => {
    let store: SqlSnippetStore;
    beforeEach(() => {
        store = createSqlSnippetStore(exec);
    });

    it("shows a personal snippet to its owner and a team snippet to everyone", async () => {
        await store.create({ name: "Mine", sql: "SELECT 1" }, BOB);
        const team = await store.create({ name: "Shared", sql: "SELECT 2", visibility: "team" }, BOB);

        expect((await store.list(BOB)).map(snippet => snippet.name).sort()).toEqual(["Mine", "Shared"]);
        expect((await store.list(CY)).map(snippet => snippet.name)).toEqual(["Shared"]);
        expect(team).toMatchObject({ name: "Shared", sql: "SELECT 2", visibility: "team", favorite: false, ownerId: "bob" });
        expect(Number.isNaN(Date.parse(team.updatedAt))).toBe(false);
    });

    it("changes only the fields sent, and only for its owner or an admin", async () => {
        const team = await store.create({ name: "Shared", sql: "SELECT 2", visibility: "team" }, BOB);

        const favorite = await store.update(team.id, { favorite: true }, BOB);
        expect(favorite).toMatchObject({ name: "Shared", sql: "SELECT 2", favorite: true });
        await expect(store.update(team.id, { sql: "DROP TABLE x" }, CY)).rejects.toThrow(SqlSnippetError);
        expect((await store.update(team.id, { name: "Renamed by an admin" }, ADA)).name).toBe("Renamed by an admin");

        expect(await store.remove(team.id, CY)).toBe(false);
        expect(await store.remove(team.id, BOB)).toBe(true);
        expect(await store.list(BOB)).toEqual([]);
    });

    it("refuses an empty or too long snippet, and an id that is not a snippet's", async () => {
        await expect(store.create({ name: " ", sql: "SELECT 1" }, BOB)).rejects.toThrow("has a name");
        await expect(store.create({ name: "x", sql: "" }, BOB)).rejects.toThrow("holds some SQL");
        await expect(store.create({ name: "x", sql: "x".repeat(MAX_SQL_SNIPPET_LENGTH + 1) }, BOB)).rejects.toThrow("at most");
        await expect(store.update("'; DROP TABLE rebase.sql_snippets; --", { name: "x" }, BOB)).rejects.toThrow("No saved snippet");
        expect(await store.remove("not-a-uuid", BOB)).toBe(false);
    });

    it("keeps at most MAX_SQL_SNIPPETS_PER_OWNER snippets per person", async () => {
        await store.list(BOB);
        await db.query(
            "INSERT INTO rebase.sql_snippets (name, sql, visibility, owner_id) SELECT 'n' || g, 'SELECT 1', 'personal', 'bob' FROM generate_series(1, $1) g",
            [MAX_SQL_SNIPPETS_PER_OWNER]
        );
        await expect(store.create({ name: "one more", sql: "SELECT 1" }, BOB)).rejects.toThrow("the most one person keeps");
        await expect(store.create({ name: "Cy's first", sql: "SELECT 1" }, CY)).resolves.toMatchObject({ ownerId: "cy" });
    });
});

describe("/api/admin/sql/snippets", () => {
    const JWT_SECRET = "sql-snippets-route-test-secret-1234567890";
    const stops: Array<() => void> = [];

    afterEach(() => {
        while (stops.length) stops.pop()!();
    });

    async function boot(): Promise<Hono<HonoEnv>> {
        const driver = fakeDataDriver({ admin: { executeSql: exec } });
        const bootstrapper: BackendBootstrapper = {
            type: "fake",
            isDefault: true,
            async initializeDriver(): Promise<InitializedDriver> {
                return { driver, tables: [], internals: {} };
            },
            async initializeAuth() {
                const authRepository = {
                    getUserRoleIds: async (uid: string) => (uid.startsWith("admin") ? ["admin"]
                        : uid.startsWith("dev-") ? ["developer"] : uid.startsWith("dba-") ? ["dba"] : ["editor"]),
                    getTokensValidAfter: async () => null
                };
                return { userService: authRepository, authRepository };
            }
        };
        const users: LegacyCollectionConfig = {
            name: "Users", slug: "users", table: "users",
            auth: { enabled: true, roles: { developer: { scopes: ["database:read"] }, dba: { scopes: ["database:read", "database:write"] } } },
            properties: { id: { name: "ID", type: "string", isId: "uuid" }, email: { name: "Email", type: "string" } }
        };
        const app = new Hono<HonoEnv>();
        const backend = await initializeRebaseBackend({
            app,
            server: createServer(),
            ...tablesFrom([users]),
            cronsDir: path.join(__dirname, "..", "..", "server", "test", "fixtures", "crons"),
            cronPersistence: false,
            bootstrappers: [bootstrapper],
            enableSwagger: false,
            auth: { requireAuth: false, jwtSecret: JWT_SECRET }
        });
        stops.push(() => backend.cronScheduler?.stop());
        return app;
    }

    const call = async (app: Hono<HonoEnv>, method: string, route: string, uid: string, body?: unknown) => app.request(`/api/admin/sql/snippets${route}`, {
        method,
        headers: {
            authorization: `Bearer ${await generateAccessToken(uid, [])}`,
            ...(body === undefined ? {} : { "content-type": "application/json" })
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });

    it("lets database:write save, change and delete a snippet, and database:read list it", async () => {
        const app = await boot();

        const created = await call(app, "POST", "", "dba-1", { name: "Top posts", sql: "SELECT * FROM posts", visibility: "team" });
        expect(created.status).toBe(201);
        const { snippet } = await created.json() as { snippet: { id: string; name: string } };
        expect(snippet.name).toBe("Top posts");

        const listed = await call(app, "GET", "", "dev-1");
        expect(listed.status).toBe(200);
        expect((await listed.json() as { snippets: { name: string }[] }).snippets.map(entry => entry.name)).toEqual(["Top posts"]);

        expect((await call(app, "POST", "", "dev-1", { name: "x", sql: "SELECT 1" })).status).toBe(403);
        expect((await call(app, "PATCH", `/${snippet.id}`, "dev-1", { favorite: true })).status).toBe(403);
        expect((await call(app, "DELETE", `/${snippet.id}`, "dev-1")).status).toBe(403);

        const changed = await call(app, "PATCH", `/${snippet.id}`, "dba-1", { favorite: true });
        expect(changed.status).toBe(200);
        expect((await changed.json() as { snippet: { favorite: boolean } }).snippet.favorite).toBe(true);

        expect((await call(app, "DELETE", `/${snippet.id}`, "dba-1")).status).toBe(200);
        expect((await call(app, "DELETE", `/${snippet.id}`, "dba-1")).status).toBe(404);
    });

    it("refuses a caller without database:read, and a malformed snippet", async () => {
        const app = await boot();

        expect((await call(app, "GET", "", "editor-1")).status).toBe(403);
        expect((await app.request("/api/admin/sql/snippets")).status).toBe(401);
        expect((await call(app, "POST", "", "dba-1", { name: "x" })).status).toBe(400);
        expect((await call(app, "POST", "", "dba-1", { name: "x", sql: "SELECT 1", visibility: "everyone" })).status).toBe(400);
    });
});
