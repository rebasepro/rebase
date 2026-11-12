/**
 * Security review S-5: UI preferences are bounded.
 *
 * `PUT /api/admin/ui-config/user/:slug` is open to any signed-in person,
 * guests included. It took any slug and any body the global limit allowed,
 * so one caller could loop it into unbounded rows of `rebase.ui_preferences`;
 * a `__proto__` slug was stored and then set the prototype of the map `GET`
 * built. Through the bounds the backend mounts in front of the routes: a
 * slug must be a served table (for a user write, one the caller is described
 * by `GET /api/schema/tables`), a body is capped at 64 KB, prototype keys are
 * refused, and the store's maps are built so a stored `__proto__` stays a key.
 */
import { describe, expect, it } from "@jest/globals";
import { Hono } from "hono";
import { col, defineTable, isSQLAdmin, type DataDriver, type UiPreferences, type UiTablePreferences } from "@rebasepro/types";
import { mergeUiTablePreferences } from "@rebasepro/types";

import type { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { compileSchemaDefs } from "../src/schema/load-schema";
import { createUiConfigRoutes } from "../src/ui-config/ui-config-routes";
import { UI_PREFERENCES_MAX_BYTES, forbiddenKeyPath, uiConfigBounds } from "../src/ui-config/ui-config-bounds";
import { createUiPreferencesStore, type UiPreferenceOwner, type UiPreferencesStore } from "../src/ui-config/ui-preferences-store";

const posts = defineTable("posts", {
    columns: { id: col.uuid().primaryKey().defaultRandom(), title: col.text() },
    rls: [{ operation: "select", access: "authenticated" }]
});
const ledger = defineTable("ledger", {
    columns: { id: col.uuid().primaryKey().defaultRandom(), amount: col.integer() },
    rls: "admin-only"
});
const TABLES = compileSchemaDefs([posts, ledger]).descriptors;

function memoryStore(): UiPreferencesStore {
    const rows = new Map<string, UiTablePreferences>();
    const key = (owner: UiPreferenceOwner, slug: string) => `${owner.scope}|${owner.uid ?? ""}|${slug}`;
    return {
        async ensureTables() { /* nothing to make */ },
        async list(owner) {
            const prefix = `${owner.scope}|${owner.uid ?? ""}|`;
            const tables = new Map<string, UiTablePreferences>();
            for (const [k, v] of rows) if (k.startsWith(prefix)) tables.set(k.slice(prefix.length), v);
            return { tables: Object.fromEntries(tables) };
        },
        async save(owner, slug, delta, { replace }) {
            const next = replace ? delta : mergeUiTablePreferences(rows.get(key(owner, slug)) ?? {}, delta);
            rows.set(key(owner, slug), next);
            return next;
        },
        async remove(owner, slug) { rows.delete(key(owner, slug)); }
    };
}

function harness(user: { uid: string; roles: string[] }) {
    const app = new Hono<HonoEnv>();
    app.onError(errorHandler);
    app.use("/*", async (c, next) => {
        c.set("user", user);
        await next();
    });
    const router = new Hono<HonoEnv>();
    router.onError(errorHandler);
    router.use("/:scope/:slug", uiConfigBounds({ tables: () => TABLES }));
    router.route("/", createUiConfigRoutes({ store: memoryStore() }));
    app.route("/api/admin/ui-config", router);
    return (method: string, route: string, body?: string) => app.fetch(new Request(`http://localhost/api/admin/ui-config${route}`, {
        method,
        headers: { "Content-Type": "application/json" },
        ...(body !== undefined ? { body } : {})
    }));
}

const MEMBER = { uid: "u_member", roles: [] };
const ADMIN = { uid: "u_admin", roles: ["admin"] };
const preferences = (value: unknown) => JSON.stringify({ preferences: value });

describe("PUT /user/:slug", () => {
    it("stores preferences for a table the caller is described", async () => {
        const call = harness(MEMBER);
        expect((await call("PUT", "/user/posts", preferences({ name: "Articles" }))).status).toBe(200);
    });

    it("answers 404 for a slug the server does not serve", async () => {
        const call = harness(MEMBER);
        const response = await call("PUT", "/user/t0001", preferences({ name: "x" }));
        expect(response.status).toBe(404);
        expect(await response.json()).toMatchObject({ error: { code: "TABLE_NOT_FOUND" } });
    });

    it("answers 404 for a served table the caller is not described (admin-only)", async () => {
        expect((await harness(MEMBER)("PUT", "/user/ledger", preferences({ name: "x" }))).status).toBe(404);
        expect((await harness(ADMIN)("PUT", "/user/ledger", preferences({ name: "x" }))).status).toBe(200);
    });

    it("answers 413 for a body over 64 KB", async () => {
        const call = harness(MEMBER);
        const response = await call("PUT", "/user/posts", preferences({ name: "x".repeat(UI_PREFERENCES_MAX_BYTES) }));
        expect(response.status).toBe(413);
        expect(await response.json()).toMatchObject({ error: { code: "UI_PREFERENCES_TOO_LARGE" } });
    });

    it("answers 400 for a __proto__, constructor or prototype slug, on every route", async () => {
        const call = harness(MEMBER);
        for (const slug of ["__proto__", "constructor", "prototype"]) {
            expect((await call("PUT", `/user/${slug}`, preferences({ name: "x" }))).status).toBe(400);
            expect((await call("DELETE", `/user/${slug}`)).status).toBe(400);
        }
    });

    it("answers 400 for a prototype key anywhere in the body", async () => {
        const call = harness(MEMBER);
        const response = await call("PUT", "/user/posts", '{"preferences":{"fields":{"__proto__":{"hidden":true}}}}');
        expect(response.status).toBe(400);
        expect(await response.text()).toContain("fields.__proto__");
    });
});

describe("PUT /workspace/:slug", () => {
    it("answers 404 for a slug the server does not serve", async () => {
        expect((await harness(ADMIN)("PUT", "/workspace/nope", preferences({ name: "x" }))).status).toBe(404);
        expect((await harness(ADMIN)("PUT", "/workspace/ledger", preferences({ name: "x" }))).status).toBe(200);
    });
});

describe("forbiddenKeyPath", () => {
    it("finds a prototype key in nested objects and arrays", () => {
        expect(forbiddenKeyPath(JSON.parse('{"a":[{"constructor":1}]}'))).toBe("a[0].constructor");
        expect(forbiddenKeyPath({ a: { b: 1 } })).toBeUndefined();
    });
});

describe("the store", () => {
    /** A driver whose SQL escape hatch answers from one table in memory. */
    function sqlDriver(rows: { table_slug: string; preferences: unknown }[]): Pick<DataDriver, "admin"> {
        return {
            admin: {
                executeSql: async (sql: string) => {
                    if (sql.includes("SELECT table_slug, preferences")) return rows;
                    if (sql.includes("SELECT preferences")) return rows.length > 0 ? [{ preferences: rows[0].preferences }] : [];
                    return [];
                }
            }
        };
    }

    it("lists a stored __proto__ slug as a key, never as the prototype", async () => {
        const driver = sqlDriver([{ table_slug: "__proto__", preferences: { name: "evil" } }, { table_slug: "posts", preferences: { name: "Posts" } }]);
        if (!isSQLAdmin(driver.admin)) throw new Error("expected a SQL admin");
        const store = createUiPreferencesStore(driver);
        const listed: UiPreferences | undefined = await store?.list({ scope: "user", uid: "u1" });
        expect(Object.getPrototypeOf(listed?.tables)).toBe(Object.prototype);
        expect(Object.keys(listed?.tables ?? {})).toEqual(["__proto__", "posts"]);
    });

    it("refuses a merge that would grow a row past 64 KB with 413", async () => {
        const big = { fields: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`c${i}`, { name: "x".repeat(1000) }])) };
        const store = createUiPreferencesStore(sqlDriver([{ table_slug: "posts", preferences: big }]));
        const more = { fields: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`d${i}`, { name: "y".repeat(1000) }])) };
        await expect(store?.save({ scope: "user", uid: "u1" }, "posts", more, { updatedBy: "u1" }))
            .rejects.toMatchObject({ statusCode: 413, code: "UI_PREFERENCES_TOO_LARGE" });
    });
});
