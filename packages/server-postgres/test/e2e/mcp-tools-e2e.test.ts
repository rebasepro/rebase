/**
 * E2E: the remote MCP tools answer as REST does, on the real driver.
 *
 * The tools are driven through their own `run()`, as `/mcp` calls them, on a
 * real `PostgresBackendDriver` over a real Postgres — beside the REST routes
 * the server mounts, on the same driver. Every read is compared with what REST
 * serves for the same question.
 *
 * The MCP suites in `packages/server/test` run the tools on a hand-written
 * stub driver, which returns whatever rows it is given. That is why nobody saw
 * `get_row` (then `get_document`) serve the admin panel's view model — a date as
 * `{ "__type": "date", "value": … }`, a relation as an embedded row — which no
 * write door accepts back: the stub has no such shape to return.
 *
 * Requires Docker.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { boolean, integer, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import { col, defineTable, rel } from "@rebasepro/types";
import { compileTables, lowerTables } from "@rebasepro/common";
import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { PostgresBackendDriver } from "../../src/PostgresBackendDriver.js";
import { FixtureTableRegistry } from "../helpers/tables.js";
import { RealtimeService } from "../../src/services/realtimeService.js";
import { RestApiGenerator } from "../../../server/src/api/rest/api-generator.js";
import { errorHandler } from "../../../server/src/api/errors.js";
import type { HonoEnv } from "../../../server/src/api/types.js";
import { MCP_TOOLS, type McpToolContext } from "../../../server/src/mcp/mcp-tools.js";
import { testUser } from "./test-user.js";

const authorsTable = pgTable("authors", {
    id: varchar("id").primaryKey(),
    name: varchar("name")
});
const postsTable = pgTable("posts", {
    id: varchar("id").primaryKey(),
    title: varchar("title"),
    status: varchar("status"),
    views: integer("views"),
    featured: boolean("featured"),
    published_at: timestamp("published_at", { withTimezone: true, mode: "string" }),
    body: text("body"),
    authorId: varchar("author_id"),
    deleted_at: timestamp("deleted_at", { withTimezone: true, mode: "string" })
});

const authors = defineTable("authors", {
    columns: {
        id: col.varchar().primaryKey(),
        name: col.varchar()
    },
    rls: "admin-only"
});

/** A date, a belongsTo and soft delete: the three shapes REST and the view model spell differently. */
const posts = defineTable("posts", {
    columns: {
        id: col.varchar().primaryKey(),
        title: col.varchar(),
        status: col.varchar(),
        views: col.integer(),
        featured: col.boolean(),
        published_at: col.timestamptz(),
        body: col.text(),
        deleted_at: col.timestamptz()
    },
    relations: {
        author: rel.belongsTo(() => authors, { localKey: "author_id" })
    },
    softDelete: { field: "deleted_at" },
    rls: "admin-only"
});

/** A table whose rows an `afterRead` hook masks. */
const readersTable = pgTable("readers", {
    id: varchar("id").primaryKey(),
    email: varchar("email")
});
const readers = defineTable("readers", {
    columns: {
        id: col.varchar().primaryKey(),
        email: col.varchar()
    },
    hooks: { afterRead: ({ values }) => ({ ...values, email: "***" }) },
    rls: "admin-only"
});

/**
 * What the backend's registry holds: the descriptors the tools describe and
 * the configs the data path reads, from one compile — as a backend boots.
 */
const SCHEMA = [authors, posts, readers];
const TABLES = compileTables(SCHEMA);
const [AUTHORS, POSTS, READERS] = lowerTables(SCHEMA, { describe: slug => TABLES.find(table => table.slug === slug) });
const COLLECTIONS = [AUTHORS, POSTS, READERS];

const USER = testUser("mcp-user", ["admin"]);

/** Every key named `__type`, at any depth — the admin view model's envelope. */
function envelopes(value: unknown, path = "$"): string[] {
    if (Array.isArray(value)) return value.flatMap((item, i) => envelopes(item, `${path}[${i}]`));
    if (value === null || typeof value !== "object") return [];
    return Object.entries(value).flatMap(([key, inner]) =>
        key === "__type" ? [`${path}.__type`] : envelopes(inner, `${path}.${key}`));
}

describe("remote MCP tools on the real driver (E2E)", () => {
    let container: PgContainer;
    let observer: pg.Client;
    let pool: pg.Pool;
    let driver: PostgresBackendDriver;
    const app = new Hono<HonoEnv>();

    async function rest(path: string, init?: { method?: string; body?: unknown }): Promise<{ status: number; json: any }> {
        const response = await app.request(`/api/data${path}`, {
            method: init?.method ?? "GET",
            headers: init?.body === undefined ? {} : { "Content-Type": "application/json" },
            body: init?.body === undefined ? undefined : JSON.stringify(init.body)
        });
        const text = await response.text();
        return { status: response.status, json: text ? JSON.parse(text) : null };
    }

    async function tool(name: string, args: Record<string, unknown>): Promise<any> {
        const definition = MCP_TOOLS.find(candidate => candidate.name === name);
        if (!definition) throw new Error(`No MCP tool ${name}`);
        return definition.run(args, {
            driver: driver,
            tables: TABLES,
            collections: COLLECTIONS,
            caller: { ...USER, scopes: ["data:read", "data:write", "data:delete"], clientId: "mcp-e2e" }
        });
    }

    /** What a tool call refused with — its message — or `undefined` when it answered. */
    async function refusalOf(name: string, args: Record<string, unknown>): Promise<string | undefined> {
        try {
            await tool(name, args);
            return undefined;
        } catch (error) {
            return (error as Error).message;
        }
    }

    beforeAll(async () => {
        container = await startPgContainer();
        for (let i = 0; ; i++) {
            try {
                observer = new pg.Client({ connectionString: container.connectionString });
                await observer.connect();
                break;
            } catch (e) {
                if (i >= 10) throw e;
                await new Promise(r => setTimeout(r, 1000));
            }
        }
        await observer.query(`
            CREATE TABLE public.authors (id varchar PRIMARY KEY, name varchar);
            CREATE TABLE public.posts (
                id varchar PRIMARY KEY,
                title varchar,
                status varchar,
                views integer,
                featured boolean,
                published_at timestamptz,
                body text,
                author_id varchar REFERENCES public.authors(id),
                deleted_at timestamptz
            );
            INSERT INTO public.authors VALUES ('a1', 'Ada'), ('a2', 'Bob');
            CREATE TABLE public.readers (id varchar PRIMARY KEY, email varchar);
            INSERT INTO public.readers VALUES ('r1', 'ada@example.com');
            INSERT INTO public.posts (id, title, status, views, featured, published_at, body, author_id) VALUES
                ('p1', 'Hello', 'published', 10, true, '2026-01-01T10:00:00Z', 'about gardens', 'a1'),
                ('p2', 'Draft one', 'draft', 0, false, null, 'plain', 'a2'),
                ('p3', 'Third', 'published', 5, false, '2026-02-01T10:00:00Z', 'more gardens', 'a1');
        `);

        pool = new pg.Pool({ connectionString: container.connectionString });
        const db = drizzle(pool);
        const registry = new FixtureTableRegistry();
        registry.registerMultiple(COLLECTIONS);
        registry.registerPgTable(authorsTable, "authors");
        registry.registerPgTable(postsTable, "posts");
        registry.registerPgTable(readersTable, "readers");
        const realtime = new RealtimeService(db, registry);
        driver = new PostgresBackendDriver(db, realtime, registry);
        realtime.setDataDriver(driver);

        // REST, as `init.ts` mounts it, on a driver scoped to the same caller.
        app.onError(errorHandler);
        app.use("/api/data/*", async (c, next) => {
            c.set("user", USER);
            c.set("driver", await driver.withAuth(USER));
            await next();
        });
        app.route("/api/data", new RestApiGenerator(COLLECTIONS, driver).generateRoutes());
    }, 120_000);

    afterAll(async () => {
        await pool?.end();
        await observer?.end();
        if (container) await stopPgContainer(container.containerName);
    });

    describe("reads serve REST's rows", () => {
        it("get_row is REST's GET /:id", async () => {
            const row = await tool("get_row", { table: "posts", id: "p1" });
            const served = await rest("/posts/p1");
            expect(served.status).toBe(200);
            expect(row).toEqual(served.json);
            expect(envelopes(row)).toEqual([]);
            expect(row).toMatchObject({ published_at: "2026-01-01T10:00:00.000Z", authorId: "a1" });
        });

        it("query_table is REST's list, rows and meta", async () => {
            const page = await tool("query_table", { table: "posts", orderBy: ["id", "asc"] });
            const served = await rest("/posts?orderBy=id:asc");
            expect(page).toEqual(served.json);
            expect(envelopes(page)).toEqual([]);
        });

        it("filters on a belongsTo by the foreign key its rows carry, as REST does", async () => {
            const page = await tool("query_table", { table: "posts", where: { authorId: ["==", "a1"] }, orderBy: "id" });
            const served = await rest(`/posts?where=${encodeURIComponent(JSON.stringify({ authorId: ["==", "a1"] }))}&orderBy=id`);
            expect(page.data.map((row: { id: string }) => row.id)).toEqual(["p1", "p3"]);
            expect(page).toEqual(served.json);
        });

        it("says there is no next page when the page holds the last row", async () => {
            const page = await tool("query_table", { table: "posts", limit: 3 });
            expect(page.meta).toMatchObject({ total: 3, hasMore: false });
        });

        it("count_rows is REST's /count", async () => {
            for (const where of [undefined, { status: ["==", "published"] }]) {
                const counted = await tool("count_rows", { table: "posts", ...(where && { where }) });
                const served = await rest(`/posts/count${where ? `?where=${encodeURIComponent(JSON.stringify(where))}` : ""}`);
                expect(counted).toEqual(served.json);
            }
            expect(await tool("count_rows", { table: "posts", where: { status: ["==", "published"] } })).toEqual({ count: 2 });
        });

        it("aggregate_rows is REST's /aggregate, groups and meta", async () => {
            const grouped = await tool("aggregate_rows", {
                table: "posts", select: ["count()", "sum(views)"], groupBy: ["status"], orderBy: ["status", "asc"], limit: 1
            });
            const served = await rest("/posts/aggregate?select=count(),sum(views)&groupBy=status&orderBy=status:asc&limit=1");
            expect(served.status).toBe(200);
            expect(grouped).toEqual(served.json);
            expect(grouped).toEqual({
                data: [{ status: "draft", count: 1, sum_views: 0 }],
                meta: { limit: 1, offset: 0, hasMore: true }
            });
            const where = { status: ["==", "published"] };
            const total = await tool("aggregate_rows", { table: "posts", select: ["max(views)"], where });
            expect(total).toEqual((await rest(`/posts/aggregate?select=max(views)&where=${encodeURIComponent(JSON.stringify(where))}`)).json);
            expect(total).toEqual({ data: [{ max_views: 10 }] });
        });

        it("aggregate_rows serves only count() where afterRead rewrites the rows, as REST does", async () => {
            const refused = await refusalOf("aggregate_rows", { table: "readers", select: ["max(email)"] });
            expect(refused).toContain("Aggregates other than count are refused on a collection whose rows an afterRead callback rewrites");
            expect(refused).not.toContain("ada@example.com");
            expect((await rest("/readers/aggregate?select=max(email)")).status).toBe(400);
            expect(await tool("aggregate_rows", { table: "readers", select: ["count()"] })).toEqual({ data: [{ count: 1 }] });
        });

        it("searchString finds what REST's search finds", async () => {
            const page = await tool("query_table", { table: "posts", searchString: "gardens", orderBy: "id" });
            const served = await rest("/posts?searchString=gardens&orderBy=id");
            expect(page.data.map((row: { id: string }) => row.id)).toEqual(["p1", "p3"]);
            expect(page).toEqual(served.json);
            expect(await tool("count_rows", { table: "posts", searchString: "gardens" })).toEqual({ count: 2 });
        });
    });

    describe("refusals are REST's", () => {
        it.each([
            ["a limit past the ceiling", { limit: 100_000 }, "?limit=100000"],
            ["an undeclared filter field", { where: { salary: ["==", 1] } }, `?where=${encodeURIComponent(JSON.stringify({ salary: ["==", 1] }))}`],
            ["an undeclared sort field", { orderBy: "id; DROP TABLE posts" }, `?orderBy=${encodeURIComponent("id; DROP TABLE posts")}`],
            ["an unknown operator", { where: { title: ["!!", "x"] } }, `?where=${encodeURIComponent(JSON.stringify({ title: ["!!", "x"] }))}`]
        ])("%s", async (_label, args, query) => {
            const refused = await refusalOf("query_table", { table: "posts", ...args });
            const served = await rest(`/posts${query}`);
            expect(served.status).toBe(400);
            expect(refused).toBe(served.json.error.message);
        });
    });

    describe("a row read can be written back", () => {
        it("update_row accepts get_row's row as it came", async () => {
            const row = await tool("get_row", { table: "posts", id: "p3" });
            const { id: _id, ...data } = row;
            const saved = await tool("update_row", { table: "posts", id: "p3", data: { ...data, title: "Third, edited" } });
            expect(saved).toMatchObject({ title: "Third, edited", published_at: row.published_at, authorId: "a1" });
            const stored = await observer.query("SELECT title, published_at, author_id FROM public.posts WHERE id = 'p3'");
            expect(stored.rows[0]).toMatchObject({ title: "Third, edited", author_id: "a1" });
            expect((stored.rows[0].published_at as Date).toISOString()).toBe(row.published_at);
        });
    });

    describe("the trash", () => {
        // REST answers 404 to an edit or a second delete of a trashed row. The
        // tools edited it, and re-stamped its deletion.
        it("refuses to edit or delete again a row in the trash, and restores it", async () => {
            await observer.query("INSERT INTO public.posts (id, title, status) VALUES ('t1', 'Trash me', 'draft')");
            await tool("delete_row", { table: "posts", id: "t1" });
            const stamped = (await observer.query("SELECT deleted_at FROM public.posts WHERE id = 't1'")).rows[0].deleted_at;
            expect(stamped).not.toBeNull();

            expect(await refusalOf("update_row", { table: "posts", id: "t1", data: { title: "edited while trashed" } }))
                .toBe("No row with id \"t1\" in posts.");
            expect(await refusalOf("delete_row", { table: "posts", id: "t1" }))
                .toBe("No row with id \"t1\" in posts.");
            expect((await rest("/posts/t1", { method: "PATCH", body: { title: "x" } })).status).toBe(404);

            const after = (await observer.query("SELECT title, deleted_at FROM public.posts WHERE id = 't1'")).rows[0];
            expect(after.title).toBe("Trash me");
            expect(after.deleted_at).toEqual(stamped);

            await tool("update_row", { table: "posts", id: "t1", data: { deleted_at: null } });
            expect((await observer.query("SELECT deleted_at FROM public.posts WHERE id = 't1'")).rows[0].deleted_at).toBeNull();
        });
    });

    describe("the views' tools", () => {
        // What show_app and show_record tell the model, and what their view
        // then writes back, on the real driver: the stub in the server's
        // suite refuses no filter and serves no relation.
        it("show_table reads the page REST serves", async () => {
            const result = await tool("show_table", { table: "posts", orderBy: "id", view: "list" });
            expect(result.data).toEqual((await rest("/posts?orderBy=id")).json.data);
            expect(result.view.blocks).toEqual([{ key: "rows", type: "table", table: "posts", view: "list", orderBy: "id" }]);
        });

        it("show_table refuses a filter the driver refuses, naming the field", async () => {
            expect(await refusalOf("show_table", { table: "posts", where: { nope: ["==", 1] } })).toContain("nope");
        });

        it("show_app hands its view the tables it reads and their relations' targets", async () => {
            const definition = MCP_TOOLS.find(candidate => candidate.name === "show_app");
            const result = await definition!.run({ tables: ["posts"], code: "export default () => null;" }, {
                driver: driver,
                tables: TABLES,
                collections: COLLECTIONS,
                caller: { ...USER, scopes: ["data:read"], clientId: "mcp-e2e" },
                compileApp: async source => ({ ok: true, code: source })
            }) as { view: { tables: { slug: string }[]; grants: Record<string, { read: boolean; write: boolean; delete: boolean }> } };
            expect(result.view.tables.map(table => table.slug)).toEqual(["authors", "posts"]);
            // A read-only connection: the view offers no change.
            expect(result.view.grants.posts).toEqual({ read: true, write: false, delete: false });
        });

        it("show_record reads the row REST serves", async () => {
            const result = await tool("show_record", { table: "posts", id: "p2" });
            expect(result.row).toEqual((await rest("/posts/p2")).json);
        });

        it("takes a write as the view sends it: a relation by its name and the target's id", async () => {
            await tool("update_row", { table: "posts", id: "p2", data: { author: "a1", views: 3 } });
            const stored = await observer.query("SELECT author_id, views FROM public.posts WHERE id = 'p2'");
            expect(stored.rows[0]).toEqual({ author_id: "a1", views: 3 });
        });

        // EXPERIMENTAL saved apps: the store's table on a real Postgres, made on
        // first use and closed to end users, and the tools around it.
        it("saves an app, lists it, opens it on the caller's data, and deletes it", async () => {
            const context: McpToolContext = {
                driver,
                tables: TABLES,
                collections: COLLECTIONS,
                caller: { ...USER, scopes: ["data:read", "data:write"], clientId: "mcp-e2e" },
                compileApp: async (source: string) => ({ ok: true as const, code: source })
            };
            const run = (name: string, args: Record<string, unknown>) => MCP_TOOLS.find(candidate => candidate.name === name)!.run(args, context);

            const saved = await run("save_app", { title: "Post desk", tables: ["posts"], code: "export default () => null;" }) as { id: string };
            expect(await run("list_apps", {})).toEqual({ apps: [expect.objectContaining({ id: saved.id, title: "Post desk", visibility: "personal" })] });
            const opened = await run("open_app", { id: saved.id }) as { view: { blocks: { type: string }[]; seeds?: { table: string }[] } };
            expect(opened.view.blocks[0].type).toBe("app");
            expect(opened.view.seeds?.map(seed => seed.table)).toEqual(["posts"]);

            // A caller without the admin role saves for themselves only, and
            // does not see another person's personal app.
            const editor = { ...context, caller: { uid: "mcp-editor", roles: ["editor"], scopes: ["data:read", "data:write"], clientId: "mcp-e2e" } };
            const asEditor = (name: string, args: Record<string, unknown>) => MCP_TOOLS.find(candidate => candidate.name === name)!.run(args, editor);
            await expect(asEditor("save_app", { title: "Shared", tables: ["posts"], code: "export default () => null;", visibility: "team" }))
                .rejects.toThrow("takes the admin role");
            expect(await asEditor("list_apps", {})).toEqual({ apps: [] });

            // The table exists, and the end-user role holds nothing on it.
            const grants = await observer.query(
                "SELECT count(*)::int AS n FROM information_schema.role_table_grants WHERE table_schema = 'rebase' AND table_name = 'saved_apps' AND grantee = 'rebase_user'");
            expect(grants.rows[0].n).toBe(0);

            expect(await run("delete_app", { id: saved.id })).toEqual({ deleted: saved.id });
            expect(await run("list_apps", {})).toEqual({ apps: [] });
        });
    });
});
