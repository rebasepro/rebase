/**
 * Apps saved to the project (`packages/server/src/apps/saved-apps.ts`), asked
 * of a real Postgres (PGlite): the store's own DDL and statements, with the
 * visibility filter the database applies.
 *
 * - A personal app is its owner's alone; a roles app is seen by its roles; a
 *   team app by everyone.
 * - Saving for other people takes the admin role, and a roles app names one.
 * - Only its owner or an admin replaces or deletes an app, whoever sees it.
 * - An id that is not a saved app's, or not a UUID, is no app.
 */
import { describe, expect, it, beforeEach, afterEach } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { col, defineTable } from "@rebasepro/types";
import { compileTables, lowerTables } from "@rebasepro/common";
import { createSavedAppStore, MAX_APP_CODE_LENGTH, SavedAppError, type SavedAppStore } from "../../server/src/apps/saved-apps";
import { MCP_TOOLS, type McpToolContext } from "../../server/src/mcp/mcp-tools";
import { fakeDataDriver } from "../../server/test/helpers/server-a-fakes";

let db: PGlite;
let store: SavedAppStore;

const ADA = { uid: "ada", roles: ["admin"] };
const BOB = { uid: "bob", roles: ["sales"] };
const CY = { uid: "cy", roles: ["support"] };
const APP = { code: "export default function A() { return null; }", collections: ["orders"] };

beforeEach(async () => {
    db = new PGlite();
    store = createSavedAppStore(async (sql, options) => {
        if (options?.params) return (await db.query(sql, options.params)).rows as Record<string, unknown>[];
        const results = await db.exec(sql);
        return (results[results.length - 1]?.rows ?? []) as Record<string, unknown>[];
    });
});

afterEach(async () => {
    await db.close();
});

describe("saved apps", () => {
    it("shows each app to whoever it was saved for", async () => {
        const mine = await store.save({ ...APP, title: "Bob's desk", visibility: "personal" }, BOB);
        const sales = await store.save({ ...APP, title: "Sales board", visibility: "roles", roles: ["sales"] }, ADA);
        const team = await store.save({ ...APP, title: "Team pulse", visibility: "team" }, ADA);

        expect((await store.list(BOB)).map(app => app.title).sort()).toEqual(["Bob's desk", "Sales board", "Team pulse"]);
        expect((await store.list(CY)).map(app => app.title)).toEqual(["Team pulse"]);
        expect(await store.get(mine.id, CY)).toBeUndefined();
        expect((await store.get(sales.id, BOB))?.code).toBe(APP.code);
        expect(await store.get(sales.id, CY)).toBeUndefined();
        expect((await store.get(team.id, CY))?.title).toBe("Team pulse");
        // The list carries no code; one app does.
        expect(Object.keys((await store.list(CY))[0])).not.toContain("code");
        // Dates are ISO 8601, which every browser parses.
        expect(team.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}:\d{2}|Z)$/);
        expect(Number.isNaN(Date.parse((await store.list(CY))[0].updatedAt))).toBe(false);
    });

    it("takes the admin role to save for other people, and a role to save for roles", async () => {
        await expect(store.save({ ...APP, title: "x", visibility: "team" }, BOB)).rejects.toThrow(SavedAppError);
        await expect(store.save({ ...APP, title: "x", visibility: "roles", roles: ["sales"] }, BOB)).rejects.toThrow("admin role");
        await expect(store.save({ ...APP, title: "x", visibility: "roles", roles: [] }, ADA)).rejects.toThrow("at least one role");
    });

    it("refuses code longer than an app keeps, new or replaced", async () => {
        const long = "x".repeat(MAX_APP_CODE_LENGTH + 1);
        await expect(store.save({ ...APP, code: long, title: "x", visibility: "personal" }, BOB)).rejects.toThrow("at most");
        const bobs = await store.save({ ...APP, title: "Bob's desk", visibility: "personal" }, BOB);
        await expect(store.save({ ...APP, id: bobs.id, code: long, title: "x", visibility: "personal" }, BOB)).rejects.toThrow("at most");
        expect(await store.list(BOB)).toHaveLength(1);
    });

    it("lets only the owner or an admin replace or delete an app", async () => {
        const team = await store.save({ ...APP, title: "Team pulse", visibility: "team" }, ADA);
        const bobs = await store.save({ ...APP, title: "Bob's desk", visibility: "personal" }, BOB);

        await expect(store.save({ ...APP, id: team.id, title: "Mine now", visibility: "personal" }, CY)).rejects.toThrow("that you may change");
        expect(await store.remove(team.id, CY)).toBe(false);

        const renamed = await store.save({ ...APP, id: bobs.id, title: "Bob's desk 2", visibility: "personal" }, BOB);
        expect(renamed.title).toBe("Bob's desk 2");
        expect(renamed.id).toBe(bobs.id);
        // An admin may tidy anyone's.
        expect(await store.remove(bobs.id, ADA)).toBe(true);
        expect(await store.get(bobs.id, BOB)).toBeUndefined();
    });

    it("treats an unknown or malformed id as no app", async () => {
        expect(await store.get("not-a-uuid", ADA)).toBeUndefined();
        expect(await store.get("00000000-0000-4000-8000-000000000000", ADA)).toBeUndefined();
        expect(await store.remove("'; DROP TABLE rebase.saved_apps; --", ADA)).toBe(false);
        await expect(store.save({ ...APP, id: "nope", title: "x", visibility: "personal" }, ADA)).rejects.toThrow('No saved app with id "nope"');
    });
});

/**
 * The tools over the same database: save_app compiles before it stores, the
 * id it answers opens with open_app as show_app opens an app, and delete_app
 * removes it. The compiler is a stand-in; the server's is tested with show_app.
 */
describe("the saved-app tools", () => {
    /** The table the apps read, as the backend holds it: its descriptor and the config the data path reads. */
    const ORDERS = defineTable("orders", {
        columns: { id: col.uuid().primaryKey().defaultRandom(), status: col.text() },
        rls: "admin-only"
    });
    const TABLES = compileTables([ORDERS]);
    const COLLECTIONS = lowerTables([ORDERS], { describe: slug => TABLES.find(table => table.slug === slug) });

    function context(caller: { uid: string; roles: string[] }): McpToolContext {
        return {
            driver: fakeDataDriver({
                key: "postgres",
                admin: {
                    async executeSql(sql: string, options?: { params?: unknown[] }) {
                        if (options?.params) return (await db.query(sql, options.params)).rows as Record<string, unknown>[];
                        const results = await db.exec(sql);
                        return (results[results.length - 1]?.rows ?? []) as Record<string, unknown>[];
                    }
                }
            }),
            tables: TABLES,
            collections: COLLECTIONS,
            caller: { ...caller, scopes: ["data:read", "data:write"], clientId: "test" },
            compileApp: async (source: string) => source.includes("syntax error")
                ? { ok: false as const, error: "Line 1: syntax error" }
                : { ok: true as const, code: `compiled:${source.length}` }
        };
    }

    const run = (name: string, args: Record<string, unknown>, caller = ADA) => {
        const tool = MCP_TOOLS.find(candidate => candidate.name === name);
        if (!tool) throw new Error(`no tool ${name}`);
        return tool.run(args, context(caller));
    };

    it("saves, lists, opens and deletes an app", async () => {
        await expect(run("save_app", { title: "Broken", tables: ["orders"], code: "syntax error" }))
            .rejects.toThrow("Line 1: syntax error");

        const saved = await run("save_app", { title: "Order desk", tables: ["orders"], code: APP.code, visibility: "team" }) as { id: string; code?: string };
        expect(saved).toMatchObject({ title: "Order desk", tables: ["orders"], visibility: "team", ownerId: "ada" });
        expect(saved.code).toBeUndefined();

        expect(await run("list_apps", {}, CY)).toEqual({ apps: [expect.objectContaining({ id: saved.id, title: "Order desk" })] });

        const opened = await run("open_app", { id: saved.id }, CY) as { app: unknown; view: { blocks: Array<{ type: string; code: string }> } };
        expect(opened.app).toEqual({ id: saved.id, title: "Order desk" });
        expect(opened.view.blocks[0]).toMatchObject({ type: "app", code: `compiled:${APP.code.length}` });

        await expect(run("delete_app", { id: saved.id }, CY)).rejects.toThrow("that you may delete");
        expect(await run("delete_app", { id: saved.id })).toEqual({ deleted: saved.id });
        await expect(run("open_app", { id: saved.id })).rejects.toThrow("that you may open");
    });

    it("refuses to share for someone without the admin role", async () => {
        await expect(run("save_app", { title: "x", tables: ["orders"], code: APP.code, visibility: "team" }, BOB))
            .rejects.toThrow("takes the admin role");
    });
});
