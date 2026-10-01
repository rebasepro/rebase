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
 * `get_document` serve the admin panel's view model — a date as
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
import type { CollectionConfig, DataDriver } from "@rebasepro/types";
import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { PostgresBackendDriver } from "../../src/PostgresBackendDriver.js";
import { PostgresCollectionRegistry } from "../../src/collections/PostgresCollectionRegistry.js";
import { RealtimeService } from "../../src/services/realtimeService.js";
import { RestApiGenerator } from "../../../server/src/api/rest/api-generator.js";
import { errorHandler } from "../../../server/src/api/errors.js";
import type { HonoEnv } from "../../../server/src/api/types.js";
import { MCP_TOOLS } from "../../../server/src/mcp/mcp-tools.js";

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

const authors = {
    name: "Authors",
    slug: "authors",
    table: "authors",
    properties: {
        id: { name: "ID", type: "string", isId: true },
        name: { name: "Name", type: "string" }
    }
} as unknown as CollectionConfig;

/** A date, a belongsTo and soft delete: the three shapes REST and the view model spell differently. */
const posts = {
    name: "Posts",
    slug: "posts",
    table: "posts",
    softDelete: { field: "deleted_at" },
    properties: {
        id: { name: "ID", type: "string", isId: true },
        title: { name: "Title", type: "string" },
        status: { name: "Status", type: "string", enum: [{ id: "draft", label: "Draft" }, { id: "published", label: "Published" }] },
        views: { name: "Views", type: "number" },
        featured: { name: "Featured", type: "boolean" },
        published_at: { name: "Published at", type: "date" },
        body: { name: "Body", type: "string" },
        author: { name: "Author", type: "relation", relation: { kind: "belongsTo", target: () => authors, localKey: "author_id" } },
        deleted_at: { name: "Deleted at", type: "date" }
    }
} as unknown as CollectionConfig;

const USER = { uid: "mcp-user", roles: ["admin"] };

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
            driver: driver as unknown as DataDriver,
            collections: [authors, posts],
            caller: { ...USER, scope: "mcp:read mcp:write", clientId: "mcp-e2e" }
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
            INSERT INTO public.posts (id, title, status, views, featured, published_at, body, author_id) VALUES
                ('p1', 'Hello', 'published', 10, true, '2026-01-01T10:00:00Z', 'about gardens', 'a1'),
                ('p2', 'Draft one', 'draft', 0, false, null, 'plain', 'a2'),
                ('p3', 'Third', 'published', 5, false, '2026-02-01T10:00:00Z', 'more gardens', 'a1');
        `);

        pool = new pg.Pool({ connectionString: container.connectionString });
        const db = drizzle(pool);
        const registry = new PostgresCollectionRegistry();
        registry.registerMultiple([authors, posts]);
        registry.registerTable(authorsTable, "authors");
        registry.registerTable(postsTable, "posts");
        const realtime = new RealtimeService(db as never, registry);
        driver = new PostgresBackendDriver(db as never, realtime as never, registry);
        realtime.setDataDriver(driver);

        // REST, as `init.ts` mounts it, on a driver scoped to the same caller.
        app.onError(errorHandler);
        app.use("/api/data/*", async (c, next) => {
            c.set("user", USER as never);
            c.set("driver", await driver.withAuth(USER as never));
            await next();
        });
        app.route("/api/data", new RestApiGenerator([authors, posts], driver).generateRoutes());
    }, 120_000);

    afterAll(async () => {
        await pool?.end();
        await observer?.end();
        if (container) await stopPgContainer(container.containerName);
    });

    describe("reads serve REST's rows", () => {
        it("get_document is REST's GET /:id", async () => {
            const row = await tool("get_document", { collection: "posts", id: "p1" });
            const served = await rest("/posts/p1");
            expect(served.status).toBe(200);
            expect(row).toEqual(served.json);
            expect(envelopes(row)).toEqual([]);
            expect(row).toMatchObject({ published_at: "2026-01-01T10:00:00.000Z", authorId: "a1" });
        });

        it("query_collection is REST's list, rows and meta", async () => {
            const page = await tool("query_collection", { collection: "posts", orderBy: ["id", "asc"] });
            const served = await rest("/posts?orderBy=id:asc");
            expect(page).toEqual(served.json);
            expect(envelopes(page)).toEqual([]);
        });

        it("filters on a belongsTo by the foreign key its rows carry, as REST does", async () => {
            const page = await tool("query_collection", { collection: "posts", where: { authorId: ["==", "a1"] }, orderBy: "id" });
            const served = await rest(`/posts?where=${encodeURIComponent(JSON.stringify({ authorId: ["==", "a1"] }))}&orderBy=id`);
            expect(page.data.map((row: { id: string }) => row.id)).toEqual(["p1", "p3"]);
            expect(page).toEqual(served.json);
        });

        it("says there is no next page when the page holds the last row", async () => {
            const page = await tool("query_collection", { collection: "posts", limit: 3 });
            expect(page.meta).toMatchObject({ total: 3, hasMore: false });
        });

        it("count_documents is REST's /count", async () => {
            for (const where of [undefined, { status: ["==", "published"] }]) {
                const counted = await tool("count_documents", { collection: "posts", ...(where && { where }) });
                const served = await rest(`/posts/count${where ? `?where=${encodeURIComponent(JSON.stringify(where))}` : ""}`);
                expect(counted).toEqual(served.json);
            }
            expect(await tool("count_documents", { collection: "posts", where: { status: ["==", "published"] } })).toEqual({ count: 2 });
        });

        it("searchString finds what REST's search finds", async () => {
            const page = await tool("query_collection", { collection: "posts", searchString: "gardens", orderBy: "id" });
            const served = await rest("/posts?searchString=gardens&orderBy=id");
            expect(page.data.map((row: { id: string }) => row.id)).toEqual(["p1", "p3"]);
            expect(page).toEqual(served.json);
            expect(await tool("count_documents", { collection: "posts", searchString: "gardens" })).toEqual({ count: 2 });
        });
    });

    describe("refusals are REST's", () => {
        it.each([
            ["a limit past the ceiling", { limit: 100_000 }, "?limit=100000"],
            ["an undeclared filter field", { where: { salary: ["==", 1] } }, `?where=${encodeURIComponent(JSON.stringify({ salary: ["==", 1] }))}`],
            ["an undeclared sort field", { orderBy: "id; DROP TABLE posts" }, `?orderBy=${encodeURIComponent("id; DROP TABLE posts")}`],
            ["an unknown operator", { where: { title: ["!!", "x"] } }, `?where=${encodeURIComponent(JSON.stringify({ title: ["!!", "x"] }))}`]
        ])("%s", async (_label, args, query) => {
            const refused = await refusalOf("query_collection", { collection: "posts", ...args });
            const served = await rest(`/posts${query}`);
            expect(served.status).toBe(400);
            expect(refused).toBe(served.json.error.message);
        });
    });

    describe("a row read can be written back", () => {
        it("update_document accepts get_document's row as it came", async () => {
            const row = await tool("get_document", { collection: "posts", id: "p3" });
            const { id: _id, ...data } = row;
            const saved = await tool("update_document", { collection: "posts", id: "p3", data: { ...data, title: "Third, edited" } });
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
            await tool("delete_document", { collection: "posts", id: "t1" });
            const stamped = (await observer.query("SELECT deleted_at FROM public.posts WHERE id = 't1'")).rows[0].deleted_at;
            expect(stamped).not.toBeNull();

            expect(await refusalOf("update_document", { collection: "posts", id: "t1", data: { title: "edited while trashed" } }))
                .toBe("No row with id \"t1\" in posts.");
            expect(await refusalOf("delete_document", { collection: "posts", id: "t1" }))
                .toBe("No row with id \"t1\" in posts.");
            expect((await rest("/posts/t1", { method: "PATCH", body: { title: "x" } })).status).toBe(404);

            const after = (await observer.query("SELECT title, deleted_at FROM public.posts WHERE id = 't1'")).rows[0];
            expect(after.title).toBe("Trash me");
            expect(after.deleted_at).toEqual(stamped);

            await tool("update_document", { collection: "posts", id: "t1", data: { deleted_at: null } });
            expect((await observer.query("SELECT deleted_at FROM public.posts WHERE id = 't1'")).rows[0].deleted_at).toBeNull();
        });
    });
});
