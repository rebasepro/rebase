/**
 * E2E: a query naming a private (`.private()`) column gets the answer a misspelled
 * field gets — byte for byte — and a field restricted by role still answers
 * `FIELD_NOT_READABLE`.
 *
 * ## Why this is pinned
 *
 * OpenAPI, `describe_table` and the generated SDK leave a private column out
 * (it was `excludeFromApi`). A filter on one answered `FIELD_NOT_READABLE … 'email' is not
 * readable on 'authors'`, which confirms exactly what those hide; the
 * unknown-field answer for a typo listed it among the "valid fields" too. Each
 * case here asks the same question twice — once naming the hidden field, once
 * a misspelling of it — and requires the two responses to be equal once the
 * name is swapped back.
 *
 * Also pinned (DATA-HYDRATE): MCP `get_row` and `query_table`, and
 * REST's `?include=`, never carry a related row's withheld values.
 *
 * Requires Docker.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { integer, pgTable, serial, varchar, vector } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import { col, defineTable, rel } from "@rebasepro/types";
import { compileTables, lowerTables } from "@rebasepro/common";
import { startPgContainer, stopPgContainer, PGVECTOR_IMAGE, type PgContainer } from "./pg-setup.js";
import { PostgresBackendDriver } from "../../src/PostgresBackendDriver.js";
import { FixtureTableRegistry } from "../helpers/tables.js";
import { RealtimeService } from "../../src/services/realtimeService.js";
import { RestApiGenerator } from "../../../server/src/api/rest/api-generator.js";
import { errorHandler } from "../../../server/src/api/errors.js";
import type { HonoEnv } from "../../../server/src/api/types.js";
import { MCP_TOOLS } from "../../../server/src/mcp/mcp-tools.js";
import { testUser } from "./test-user.js";

const authorsTable = pgTable("authors", {
    id: serial("id").primaryKey(),
    name: varchar("name"),
    email: varchar("email"),
    salary: integer("salary"),
    embedding: vector("embedding", { dimensions: 3 }),
    style: vector("style", { dimensions: 3 })
});
const notesTable = pgTable("notes", {
    id: serial("id").primaryKey(),
    body: varchar("body"),
    authorId: integer("author_id")
});
const postsTable = pgTable("posts", {
    id: serial("id").primaryKey(),
    title: varchar("title"),
    draftKey: varchar("draft_key"),
    authorId: integer("author_id")
});

const notes = defineTable("notes", {
    columns: {
        id: col.serial().primaryKey(),
        body: col.varchar()
    },
    rls: "admin-only"
});

/** Private columns (one a vector), one column restricted by role, one private relation. */
const authors = defineTable("authors", {
    columns: {
        id: col.serial().primaryKey(),
        name: col.varchar(),
        email: col.varchar().private(),
        salary: col.integer().access({ read: ["admin"] }),
        embedding: col.vector(3, { index: false }).private(),
        style: col.vector(3, { index: false })
    },
    relations: {
        notes: rel.hasMany(() => notes, { foreignKey: "author_id", private: true }),
        posts: rel.hasMany(() => posts, { foreignKey: "author_id" })
    },
    rls: "admin-only"
});

const posts = defineTable("posts", {
    columns: {
        id: col.serial().primaryKey(),
        title: col.varchar(),
        draftKey: col.varchar().private()
    },
    relations: {
        author: rel.belongsTo(() => authors, { localKey: "author_id" })
    },
    rls: "admin-only"
});

/**
 * What the backend's registry holds: the descriptors the MCP tools describe
 * and the configs REST and the driver read, from one compile — as a backend boots.
 */
const SCHEMA = [authors, notes, posts];
const TABLES = compileTables(SCHEMA);
const ALL = lowerTables(SCHEMA, { describe: slug => TABLES.find(table => table.slug === slug) });
const [AUTHORS] = ALL;
const EDITOR = testUser("editor-1", ["editor"]);
const SECRET_EMAIL = "ada-secret@hidden.test";
const SECRET_SALARY = 987654;

describe("a private column answers as a field that does not exist (E2E)", () => {
    let container: PgContainer;
    let observer: pg.Client;
    let pool: pg.Pool;
    let driver: PostgresBackendDriver;
    const app = new Hono<HonoEnv>();

    async function rest(path: string): Promise<{ status: number; text: string; json: any }> {
        const response = await app.request(`/api/data${path}`);
        const text = await response.text();
        return { status: response.status, text, json: text ? JSON.parse(text) : null };
    }

    /**
     * The response to `hidden`, and the response to `typo` with the misspelt
     * name swapped back for the hidden one. Equal means a caller cannot tell
     * the hidden field from a field that does not exist.
     */
    async function pair(hidden: string, typo: string, name: string, misspelt: string) {
        const a = await rest(hidden);
        const b = await rest(typo);
        return {
            hidden: { status: a.status, body: a.json },
            typo: { status: b.status, body: JSON.parse(b.text.split(misspelt).join(name)) },
            raw: a.text
        };
    }

    async function tool(name: string, args: Record<string, unknown>): Promise<unknown> {
        const definition = MCP_TOOLS.find(candidate => candidate.name === name);
        if (!definition) throw new Error(`No MCP tool ${name}`);
        return definition.run(args, {
            driver: driver,
            tables: TABLES,
            collections: ALL,
            caller: { ...EDITOR, scopes: ["data:read"], clientId: "hidden-field-e2e" }
        });
    }

    beforeAll(async () => {
        container = await startPgContainer({ image: PGVECTOR_IMAGE });
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
            CREATE EXTENSION IF NOT EXISTS vector;
            CREATE TABLE public.authors (id serial PRIMARY KEY, name varchar, email varchar, salary integer,
                embedding vector(3), style vector(3));
            CREATE TABLE public.notes (id serial PRIMARY KEY, body varchar, author_id integer REFERENCES public.authors(id));
            CREATE TABLE public.posts (id serial PRIMARY KEY, title varchar, draft_key varchar, author_id integer REFERENCES public.authors(id));
            INSERT INTO public.authors (name, email, salary) VALUES ('Ada', '${SECRET_EMAIL}', ${SECRET_SALARY}), ('Bob', 'bob@hidden.test', 1);
            INSERT INTO public.notes (body, author_id) VALUES ('n1', 1), ('n2', 1), ('n3', 2);
            INSERT INTO public.posts (title, author_id) VALUES ('Hello', 1), ('Again', 2);
        `);

        pool = new pg.Pool({ connectionString: container.connectionString });
        const db = drizzle(pool);
        const registry = new FixtureTableRegistry();
        registry.registerMultiple(ALL);
        registry.registerPgTable(authorsTable, "authors");
        registry.registerPgTable(notesTable, "notes");
        registry.registerPgTable(postsTable, "posts");
        const realtime = new RealtimeService(db, registry);
        driver = new PostgresBackendDriver(db, realtime, registry);
        realtime.setDataDriver(driver);

        app.onError(errorHandler);
        app.use("/api/data/*", async (c, next) => {
            c.set("user", EDITOR);
            c.set("driver", await driver.withAuth(EDITOR));
            await next();
        });
        app.route("/api/data", new RestApiGenerator(ALL, driver).generateRoutes());
    }, 120_000);

    afterAll(async () => {
        await pool?.end();
        await observer?.end();
        if (container) await stopPgContainer(container.containerName);
    });

    describe("answers as a misspelt field", () => {
        const where = (field: string) => `?where=${encodeURIComponent(JSON.stringify({ [field]: ["==", "x"] }))}`;
        const include = (field: string) =>
            `?include=${encodeURIComponent(JSON.stringify({ author: { where: { [field]: ["==", "x"] } } }))}`;

        it.each([
            ["a PostgREST filter", "/authors?email=eq.x", "/authors?emial=eq.x"],
            ["a `where` filter", `/authors${where("email")}`, `/authors${where("emial")}`],
            ["a filter inside `or`", "/authors?or=(name.eq.x,email.eq.x)", "/authors?or=(name.eq.x,emial.eq.x)"],
            ["a JSON path into it", "/authors?email->x=eq.1", "/authors?emial->x=eq.1"],
            ["a count", "/authors/count?email=eq.x", "/authors/count?emial=eq.x"],
            ["an `orderBy`", "/authors?orderBy=email:asc", "/authors?orderBy=emial:asc"],
            ["a `fields` projection", "/authors?fields=id,email", "/authors?fields=id,emial"],
            ["a filter through a relation", "/posts?author.email=eq.x", "/posts?author.emial=eq.x"],
            ["an include's filter on the target", `/posts${include("email")}`, `/posts${include("emial")}`],
            ["a filter after an unknown one", "/authors?aaa=eq.1&email=eq.x", "/authors?aaa=eq.1&emial=eq.x"],
            ["a filter before an unknown sort", "/authors?email=eq.x&orderBy=zzz", "/authors?emial=eq.x&orderBy=zzz"]
        ])("%s", async (label, hidden, typo) => {
            const { hidden: a, typo: b, raw } = await pair(hidden, typo, "email", "emial");
            expect(a.status).toBe(400);
            expect(a).toEqual(b);
            expect(a.body.error.code).not.toBe("FIELD_NOT_READABLE");
            // Named as the field asked about — unless an unknown one comes
            // first, which the driver would name — and never listed as valid.
            if (!label.includes("after an unknown")) expect(raw).toContain("email");
            expect(JSON.stringify(a.body.error.details?.validFields ?? [])).not.toContain("email");
            expect(a.body.error.message).not.toMatch(/Valid fields:[^']*\bemail\b/);
        });

        it.each([
            ["a nested listing's filter", "/authors/1/posts?draftKey=eq.x", "/authors/1/posts?draftKye=eq.x"],
            ["the column name", "/posts?draft_key=eq.x", "/posts?draft_kye=eq.x"]
        ])("%s", async (_label, hidden, typo) => {
            const { hidden: a, typo: b } = await pair(hidden, typo, hidden.includes("draft_key") ? "draft_key" : "draftKey",
                hidden.includes("draft_key") ? "draft_kye" : "draftKye");
            expect(a.status).toBe(400);
            expect(a).toEqual(b);
        });

        it.each([
            ["a nested path", "/authors/1/notes", "/authors/1/nootes"],
            ["an include", "/authors?include=notes", "/authors?include=nootes"],
            ["an aggregate sort", "/authors?orderBy=count(notes):desc", "/authors?orderBy=count(nootes):desc"]
        ])("a hidden relation in %s", async (_label, hidden, typo) => {
            const { hidden: a, typo: b, raw } = await pair(hidden, typo, "notes", "nootes");
            expect(a.status).toBeGreaterThanOrEqual(400);
            expect(a).toEqual(b);
            expect(raw).not.toContain("FIELD_NOT_READABLE");
        });
    });

    describe("in an aggregate or a vector search", () => {
        const vector = `&vector=${encodeURIComponent("[1,0,0]")}`;

        it.each([
            ["an aggregate `select`", "/authors/aggregate?select=count(email)", "/authors/aggregate?select=count(emial)",
                "email", "emial"],
            ["an aggregate `groupBy`", "/authors/aggregate?select=count()&groupBy=email",
                "/authors/aggregate?select=count()&groupBy=emial", "email", "emial"],
            ["a vector search", `/authors?vector_search=embedding${vector}`, `/authors?vector_search=embeddnig${vector}`,
                "embedding", "embeddnig"],
            ["a vector count", `/authors/count?vector_search=embedding${vector}`,
                `/authors/count?vector_search=embeddnig${vector}`, "embedding", "embeddnig"]
        ])("%s answers as a misspelt field", async (_label, hidden, typo, name, misspelt) => {
            const { hidden: a, typo: b, raw } = await pair(hidden, typo, name, misspelt);
            expect(a.status).toBe(400);
            expect(a).toEqual(b);
            expect(raw).not.toContain("FIELD_NOT_READABLE");
        });

        it("an unknown aggregate field lists no hidden column", async () => {
            const served = await rest("/authors/aggregate?select=count(zzz)");
            expect(served.status).toBe(400);
            expect(served.json.error.code).toBe("UNKNOWN_AGGREGATE_FIELD");
            expect(served.json.error.message).toContain("name");
            expect(served.text).not.toMatch(/\bemail\b|\bembedding\b/);
        });

        it("an unknown vector property lists no hidden vector", async () => {
            const served = await rest(`/authors?vector_search=zzz${vector}`);
            expect(served.status).toBe(400);
            expect(served.json.error.code).toBe("UNKNOWN_VECTOR_PROPERTY");
            expect(served.json.error.message).toContain("style");
            expect(served.text).not.toContain("embedding");
        });

        it("a vector property restricted by nothing still searches", async () => {
            const served = await rest(`/authors?vector_search=style${vector}`);
            expect(served.status).toBe(200);
        });
    });

    describe("a field restricted by role is still named", () => {
        it.each([
            ["a filter", "/authors?salary=gt.1"],
            ["an `orderBy`", "/authors?orderBy=salary:desc"],
            ["a `fields` projection", "/authors?fields=id,salary"],
            ["a filter through a relation", "/posts?author.salary=gt.1"],
            ["an aggregate sort over it", "/posts?orderBy=max(author.salary):desc"]
        ])("%s", async (_label, path) => {
            const served = await rest(path);
            expect(served.status).toBe(400);
            expect(served.json.error.code).toBe("FIELD_NOT_READABLE");
            expect(served.json.error.message).toContain("'salary'");
        });
    });

    describe("the trusted server plane still reaches the column", () => {
        it("filters on it in process", async () => {
            const rows = await driver.fetchCollection({
                path: "authors",
                collection: AUTHORS,
                filter: { email: ["==", SECRET_EMAIL] }
            });
            expect(rows.map(r => Number(r.id))).toEqual([1]);
        });
    });

    describe("a related row never carries a withheld value (DATA-HYDRATE)", () => {
        const leaks = (value: unknown) => {
            const text = JSON.stringify(value);
            return text.includes(SECRET_EMAIL) || text.includes(String(SECRET_SALARY));
        };

        it("MCP get_row", async () => {
            const row = await tool("get_row", { table: "posts", id: "1" });
            expect(row).toMatchObject({ title: "Hello" });
            expect(leaks(row)).toBe(false);
        });

        it("MCP query_table", async () => {
            const page = await tool("query_table", { table: "posts" }) as { data: unknown[] };
            expect(page.data.length).toBe(2);
            expect(leaks(page)).toBe(false);
        });

        it("MCP get_row on the target itself", async () => {
            const row = await tool("get_row", { table: "authors", id: "1" });
            expect(row).toMatchObject({ name: "Ada" });
            expect(leaks(row)).toBe(false);
        });

        it("REST `?include=`, the parity row", async () => {
            const served = await rest("/posts?include=author");
            expect(served.status).toBe(200);
            const author = served.json.data.find((r: { id: number }) => Number(r.id) === 1).author;
            expect(author).toMatchObject({ name: "Ada" });
            expect(author).not.toHaveProperty("email");
            expect(author).not.toHaveProperty("salary");
            expect(leaks(served.json)).toBe(false);
        });
    });
});
