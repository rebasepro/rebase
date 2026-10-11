/**
 * E2E: `like` / `ilike` and their negations on a column that is not plain text.
 *
 * A string `enum` property is a Postgres enum type, and Postgres defines no
 * `~~` on one: `status LIKE 'dr%'` is `operator does not exist: post_status ~~
 * unknown`, which reached every door — REST, `where`, the socket, MCP, the
 * in-process data plane, `/aggregate` — as a 500. `ilike` had a guard on the
 * relation path and none on the column path; `like` had none anywhere.
 *
 * A pattern over an enum is a reasonable question (a prefix over a status), so
 * it is answered over the label, `status::text`. On a column where a pattern
 * means nothing (a number), it is a 400 naming the column, not a 500. And a
 * `citext` column keeps its own, case-insensitive `LIKE`: casting it to `text`
 * would have quietly made it case-sensitive.
 *
 * The enum is checked as both tables a server can hold for it: the generated
 * module's `pgEnum` column, and the catalogue-built table, which declares an
 * enum column as `text` (`dynamic-tables.ts`) while the database still holds
 * the enum type.
 *
 * Requires Docker.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { customType, integer, pgEnum, pgTable, text, varchar } from "drizzle-orm/pg-core";
import type { CollectionConfig, FilterValues } from "@rebasepro/types";
import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { PostgresBackendDriver } from "../../src/PostgresBackendDriver.js";
import { PostgresCollectionRegistry } from "../../src/collections/PostgresCollectionRegistry.js";
import { RealtimeService } from "../../src/services/realtimeService.js";

const citext = customType<{ data: string }>({ dataType: () => "citext" });

const roleEnum = pgEnum("author_role", ["editor", "writer"]);
const statusEnum = pgEnum("post_status", ["draft", "drafted", "published"]);

const authorsTable = pgTable("authors", {
    id: varchar("id").primaryKey(),
    role: roleEnum("role")
});

/** As the generated module declares it. */
const generatedPosts = pgTable("posts", {
    id: varchar("id").primaryKey(),
    title: text("title"),
    status: statusEnum("status"),
    views: integer("views"),
    email: citext("email"),
    authorId: varchar("author_id")
});

/** As the catalogue-built registry declares the same table: the enum is `text`. */
const catalogueBuiltPosts = pgTable("posts", {
    id: varchar("id").primaryKey(),
    title: text("title"),
    status: text("status"),
    views: integer("views"),
    email: citext("email"),
    authorId: varchar("author_id")
});

const authors = {
    slug: "authors", name: "Authors", table: "authors",
    properties: {
        id: { type: "string", isId: true },
        role: { type: "string", enum: ["editor", "writer"] }
    }
} as unknown as CollectionConfig;

const posts = {
    slug: "posts", name: "Posts", table: "posts",
    properties: {
        id: { type: "string", isId: true },
        title: { type: "string" },
        status: { type: "string", enum: ["draft", "drafted", "published"] },
        views: { type: "number" },
        email: { type: "string" },
        author: { type: "relation", relation: { kind: "belongsTo", target: () => authors } }
    }
} as unknown as CollectionConfig;

describe("pattern operators on columns that are not plain text", () => {
    let container: PgContainer;
    let admin: pg.Client;
    let pool: pg.Pool;
    const drivers: Record<"generated" | "catalogue-built", PostgresBackendDriver> = {} as never;

    function driverFor(postsTable: typeof generatedPosts | typeof catalogueBuiltPosts): PostgresBackendDriver {
        const db = drizzle(pool);
        const registry = new PostgresCollectionRegistry();
        registry.registerMultiple([authors, posts]);
        registry.registerTable(authorsTable, "authors");
        registry.registerTable(postsTable, "posts");
        const realtime = new RealtimeService(db as never, registry);
        const driver = new PostgresBackendDriver(db as never, realtime as never, registry);
        realtime.setDataDriver(driver);
        return driver;
    }

    beforeAll(async () => {
        container = await startPgContainer();
        admin = new pg.Client({ connectionString: container.connectionString });
        await admin.connect();
        await admin.query(`
            CREATE EXTENSION IF NOT EXISTS citext;
            CREATE TYPE author_role AS ENUM ('editor', 'writer');
            CREATE TYPE post_status AS ENUM ('draft', 'drafted', 'published');
            CREATE TABLE authors (id VARCHAR PRIMARY KEY, role author_role);
            CREATE TABLE posts (
                id VARCHAR PRIMARY KEY, title TEXT, status post_status, views INTEGER,
                email CITEXT, author_id VARCHAR REFERENCES authors(id)
            );
            INSERT INTO authors VALUES ('a1', 'editor'), ('a2', 'writer');
            INSERT INTO posts VALUES
                ('p1', 'One', 'draft', 1, 'Ann@Example.com', 'a1'),
                ('p2', 'Two', 'drafted', 2, 'bob@example.com', 'a2'),
                ('p3', 'Three', 'published', 3, 'cy@example.com', 'a1');
        `);
        pool = new pg.Pool({ connectionString: container.connectionString });
        drivers.generated = driverFor(generatedPosts);
        drivers["catalogue-built"] = driverFor(catalogueBuiltPosts);
    });

    afterAll(async () => {
        await pool?.end();
        await admin?.end();
        if (container) await stopPgContainer(container.containerName);
    });

    async function ids(driver: PostgresBackendDriver, filter: FilterValues<string>): Promise<string[]> {
        const rows = await driver.fetchCollection({ path: "posts", collection: posts, filter });
        return rows.map(row => String(row.id)).sort();
    }

    for (const shape of ["generated", "catalogue-built"] as const) {
        describe(`on the ${shape} table`, () => {
            it("matches an enum column's labels with like and not-like", async () => {
                expect(await ids(drivers[shape], { status: ["like", "draft%"] })).toEqual(["p1", "p2"]);
                expect(await ids(drivers[shape], { status: ["not-like", "draft%"] })).toEqual(["p3"]);
            });

            it("matches an enum column's labels with ilike and not-ilike", async () => {
                expect(await ids(drivers[shape], { status: ["ilike", "PUB%"] })).toEqual(["p3"]);
                expect(await ids(drivers[shape], { status: ["not-ilike", "PUB%"] })).toEqual(["p1", "p2"]);
            });

            it("matches the enum of a related row", async () => {
                expect(await ids(drivers[shape], { "author.role": ["like", "edit%"] })).toEqual(["p1", "p3"]);
                expect(await ids(drivers[shape], { "author.role": ["ilike", "WRI%"] })).toEqual(["p2"]);
            });

            it("keeps citext's case-insensitive like", async () => {
                expect(await ids(drivers[shape], { email: ["like", "ann@%"] })).toEqual(["p1"]);
            });

            it("refuses a pattern on a number as a request error, naming the column", async () => {
                await expect(ids(drivers[shape], { views: ["like", "1%"] })).rejects.toMatchObject({
                    statusCode: 400,
                    code: "INVALID_FILTER_OPERATOR"
                });
                await expect(ids(drivers[shape], { views: ["ilike", "1%"] })).rejects.toMatchObject({
                    statusCode: 400,
                    code: "INVALID_FILTER_OPERATOR"
                });
            });
        });
    }
});
