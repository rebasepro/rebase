/**
 * The UI preferences store's SQL, executed against a real Postgres.
 *
 * `server/test/ui-config-routes.test.ts` drives the routes against an
 * in-memory store; this proves the statements it stands in for: the table is
 * there after `ensureTables` and closed to `rebase_user`, a write merges into
 * the stored row, workspace and user rows (and two users' rows) are apart, and
 * a backend that provisions nothing neither creates the table nor pretends
 * to have it.
 */
import { describe, expect, it, beforeEach, afterEach } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import type { DataDriver } from "@rebasepro/types";
import { REBASE_USER_ROLE } from "@rebasepro/common";

import { createUiPreferencesStore, type UiPreferencesStore } from "../../server/src/ui-config/ui-preferences-store";

function pgliteDriver(db: PGlite): Pick<DataDriver, "admin"> {
    return {
        admin: {
            async executeSql(sql: string, options?: { params?: unknown[] }) {
                return (await db.query<Record<string, unknown>>(sql, options?.params)).rows;
            }
        }
    };
}

let db: PGlite;
let store: UiPreferencesStore;

beforeEach(async () => {
    db = new PGlite();
    await db.exec(`CREATE ROLE ${REBASE_USER_ROLE} NOLOGIN`);
    await db.exec("CREATE SCHEMA IF NOT EXISTS rebase");
    await db.exec(`GRANT USAGE ON SCHEMA rebase TO ${REBASE_USER_ROLE}; ALTER DEFAULT PRIVILEGES IN SCHEMA rebase GRANT SELECT ON TABLES TO ${REBASE_USER_ROLE}`);
    const created = createUiPreferencesStore(pgliteDriver(db));
    if (!created) throw new Error("createUiPreferencesStore returned null for a SQL-capable driver");
    store = created;
    await store.ensureTables();
});

afterEach(async () => {
    await db.close();
});

describe("the UI preferences store", () => {
    it("makes its table, closed to the role RLS scopes, and makes it again harmlessly", async () => {
        const present = await db.query<{ present: string | null }>("SELECT to_regclass('rebase.ui_preferences')::text AS present");
        expect(present.rows[0].present).toBe("rebase.ui_preferences");
        const readable = await db.query<{ holds: boolean }>(
            `SELECT has_table_privilege('${REBASE_USER_ROLE}', 'rebase.ui_preferences', 'SELECT') AS holds`
        );
        expect(readable.rows[0].holds).toBe(false);
        await store.ensureTables();
    });

    it("merges a write into the stored row and lists it by slug", async () => {
        await store.save({ scope: "workspace" }, "posts", { name: "Articles", fields: { title: { columnWidth: 320 } } }, { updatedBy: "u_admin" });
        const merged = await store.save({ scope: "workspace" }, "posts", { icon: "Article", fields: { title: { hidden: true } } }, { updatedBy: "u_admin" });
        expect(merged).toEqual({ name: "Articles", icon: "Article", fields: { title: { columnWidth: 320, hidden: true } } });
        expect(await store.list({ scope: "workspace" })).toEqual({ tables: { posts: merged } });
        const row = await db.query<{ updated_by: string }>("SELECT updated_by FROM rebase.ui_preferences WHERE table_slug = 'posts'");
        expect(row.rows[0].updated_by).toBe("u_admin");
    });

    it("keeps the workspace's rows and each user's apart", async () => {
        await store.save({ scope: "workspace" }, "posts", { name: "Articles" }, { updatedBy: "u_admin" });
        await store.save({ scope: "user", uid: "u_1" }, "posts", { defaultViewMode: "kanban" }, { updatedBy: "u_1" });
        await store.save({ scope: "user", uid: "u_2" }, "posts", { defaultSize: "s" }, { updatedBy: "u_2" });
        expect(await store.list({ scope: "user", uid: "u_1" })).toEqual({ tables: { posts: { defaultViewMode: "kanban" } } });
        expect(await store.list({ scope: "user", uid: "u_2" })).toEqual({ tables: { posts: { defaultSize: "s" } } });
        expect(await store.list({ scope: "workspace" })).toEqual({ tables: { posts: { name: "Articles" } } });
    });

    it("replaces when asked, and forgets a row", async () => {
        await store.save({ scope: "workspace" }, "posts", { name: "Articles", icon: "Article" }, { updatedBy: "u_admin" });
        expect(await store.save({ scope: "workspace" }, "posts", { icon: "Book" }, { updatedBy: "u_admin", replace: true })).toEqual({ icon: "Book" });
        await store.remove({ scope: "workspace" }, "posts");
        expect(await store.list({ scope: "workspace" })).toEqual({ tables: {} });
    });

    it("skips a stored row that is no longer a valid preference", async () => {
        await db.query("INSERT INTO rebase.ui_preferences (scope, owner, table_slug, preferences) VALUES ('workspace', '', 'posts', $1::jsonb)",
            [JSON.stringify({ columns: { title: { type: "text" } } })]);
        expect(await store.list({ scope: "workspace" })).toEqual({ tables: {} });
    });

    it("on a backend that provisions nothing, creates nothing and says the table is missing", async () => {
        const fresh = new PGlite();
        await fresh.exec("CREATE SCHEMA IF NOT EXISTS rebase");
        const off = createUiPreferencesStore(pgliteDriver(fresh), { provision: false });
        await expect(off!.ensureTables()).rejects.toThrow(/changes nothing in its database/);
        const present = await fresh.query<{ present: string | null }>("SELECT to_regclass('rebase.ui_preferences')::text AS present");
        expect(present.rows[0].present).toBeNull();
        await fresh.close();
    });

    it("is null for a driver that cannot run SQL", () => {
        expect(createUiPreferencesStore({ admin: undefined })).toBeNull();
    });
});
