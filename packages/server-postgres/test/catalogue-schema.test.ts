/**
 * The runtime's tables, built from a real database rather than from a file.
 *
 * Everything here runs against PGlite — a real Postgres — because the claims
 * being made are about what `information_schema` says and what a value looks
 * like after a round trip, and neither can be faked convincingly. What it pins:
 *
 *  1. the Drizzle object is keyed by the WIRE name (`authorId`), which is what
 *     every read and write path in this driver indexes tables and rows by;
 *  2. a declared relation loads through `db.query` under the name the
 *     collection gave it, not under one guessed from the foreign-key column;
 *  3. the wire value of every column type matches what the generated module
 *     used to produce — a numeric is a number, a timestamptz is a string.
 */
import { describe, expect, it, beforeAll, afterAll } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq, getTableColumns } from "drizzle-orm";
import type { CollectionConfig } from "@rebasepro/types";

import { readCatalogueSchema } from "../src/schema/catalogue-schema";
import type { Queryable } from "../src/schema/introspect-runtime";
import { hiddenColumnsOption } from "../src/schema/search-column";
import { patchPgNumericToNumber } from "../src/utils/pg-numeric-number-patch";
import { assertWritableColumns, getPrimaryKeys } from "../src/services/collection-helpers";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";

// ── The project, as its author wrote it ──────────────────────────────────────

const authors = {
    slug: "authors",
    table: "authors",
    name: "Authors",
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        displayName: { name: "Display name", type: "string" },
        // Named `articles`, deliberately: a relation key that no column name
        // could have been guessed from.
        articles: {
            name: "Articles",
            type: "relation",
            relation: {
                kind: "hasMany",
                target: () => posts,
                relationName: "articles",
                foreignKeyOnTarget: "author_id"
            }
        }
    }
} as unknown as CollectionConfig;

const tags = {
    slug: "tags",
    table: "tags",
    name: "Tags",
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        label: { name: "Label", type: "string" }
    }
} as unknown as CollectionConfig;

const posts = {
    slug: "posts",
    table: "posts",
    name: "Posts",
    search: { fields: ["title"] },
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        title: { name: "Title", type: "string" },
        price: { name: "Price", type: "number" },
        ratings: { name: "Ratings", type: "array", of: { type: "number", validation: { integer: true } } },
        publishedAt: { name: "Published", type: "date" },
        status: { name: "Status", type: "string", enum: [{ id: "draft", label: "Draft" }, { id: "published", label: "Published" }] },
        code: { name: "Code", type: "string", columnType: "char", validation: { length: 3 } },
        sku: { name: "SKU", type: "string", columnType: "varchar" },
        meta: { name: "Meta", type: "map" },
        // The FK column is `author_id` and the relation is called `writer`.
        // Nothing derived from the column would produce that name.
        writer: {
            name: "Writer",
            type: "relation",
            relation: {
                kind: "belongsTo",
                target: () => authors,
                relationName: "writer",
                localKey: "author_id"
            }
        },
        tags: {
            name: "Tags",
            type: "relation",
            relation: {
                kind: "manyToMany",
                target: () => tags,
                relationName: "tags",
                through: { table: "posts_tags", sourceColumn: "post_id", targetColumn: "tag_id" }
            }
        }
    }
} as unknown as CollectionConfig;

const collections = [posts, authors, tags];

const DDL = `
CREATE TYPE post_status AS ENUM ('draft', 'published');

CREATE TABLE authors (
    id uuid PRIMARY KEY,
    display_name text NOT NULL
);

CREATE TABLE tags (
    id uuid PRIMARY KEY,
    label text
);

CREATE TABLE posts (
    id uuid PRIMARY KEY,
    title text NOT NULL,
    price numeric,
    ratings integer[],
    published_at timestamptz,
    status post_status,
    code char(3),
    sku varchar(12),
    meta jsonb,
    author_id uuid REFERENCES authors(id),
    search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english'::regconfig, coalesce(title, ''))) STORED
);

CREATE TABLE posts_tags (
    post_id uuid NOT NULL REFERENCES posts(id),
    tag_id uuid NOT NULL REFERENCES tags(id),
    PRIMARY KEY (post_id, tag_id)
);
`;

const AUTHOR_ID = "11111111-1111-4111-8111-111111111111";
const POST_ID = "22222222-2222-4222-8222-222222222222";
const TAG_ID = "33333333-3333-4333-8333-333333333333";

describe("tables built from the live catalogue", () => {
    let pg: PGlite;
    let catalogue: Awaited<ReturnType<typeof readCatalogueSchema>>;
    let db: ReturnType<typeof drizzle>;

    beforeAll(async () => {
        pg = await PGlite.create();
        await pg.exec(DDL);
        catalogue = await readCatalogueSchema({
            client: pg as unknown as Queryable,
            collections,
            defaultSchema: "public"
        });
        // Exactly what the bootstrapper does with them.
        patchPgNumericToNumber(catalogue.tables as unknown as Record<string, unknown>);
        db = drizzle(pg, { schema: { ...catalogue.tables, ...catalogue.relations } });
    }, 60_000);

    afterAll(async () => {
        await pg?.close();
    });

    it("reads every table the collections declare, and their junction", () => {
        expect(Object.keys(catalogue.tables).sort()).toEqual(["authors", "posts", "posts_tags", "tags"]);
        expect(catalogue.missing).toEqual([]);
    });

    it("keys columns by the wire name, not by the column", () => {
        const keys = Object.keys(getTableColumns(catalogue.tables.posts));
        expect(keys).toContain("authorId");
        expect(keys).toContain("publishedAt");
        expect(keys).not.toContain("author_id");
        expect(keys).not.toContain("published_at");
        expect(Object.keys(getTableColumns(catalogue.tables.authors))).toContain("displayName");
    });

    it("keeps a generated search column under its own name, so it stays hidden", () => {
        const columns = getTableColumns(catalogue.tables.posts);
        // Not `searchVector`: `searchColumnNames` excludes it by the column name
        // and the condition builder looks it up by the same.
        expect(Object.keys(columns)).toContain("search_vector");
        expect(hiddenColumnsOption(columns, posts)).toEqual({ search_vector: false });
    });

    it("keys a junction table by its columns, which have no collection to name them", () => {
        expect(Object.keys(getTableColumns(catalogue.tables.posts_tags)).sort())
            .toEqual(["post_id", "tag_id"]);
    });

    it("resolves the composite key of a junction table", () => {
        const registry = new PostgresCollectionRegistry();
        registry.registerTable(catalogue.tables.posts_tags, "posts_tags");
        const junction = { slug: "posts_tags", table: "posts_tags", name: "posts_tags", properties: {} } as unknown as CollectionConfig;
        expect(getPrimaryKeys(junction, registry).map(k => k.fieldName).sort())
            .toEqual(["post_id", "tag_id"]);
    });

    describe("with rows in it", () => {
        beforeAll(async () => {
            await db.insert(catalogue.tables.authors).values({
                id: AUTHOR_ID,
                displayName: "Ada"
            } as never);
            await db.insert(catalogue.tables.tags).values({ id: TAG_ID, label: "release" } as never);
            await db.insert(catalogue.tables.posts).values({
                id: POST_ID,
                title: "Hello",
                price: "12.50",
                ratings: [4, 5],
                publishedAt: "2026-01-02T03:04:05.000Z",
                status: "published",
                code: "abc",
                sku: "SKU-1",
                meta: { a: 1 },
                authorId: AUTHOR_ID
            } as never);
            await db.insert(catalogue.tables.posts_tags).values({ post_id: POST_ID, tag_id: TAG_ID } as never);
        });

        it("loads a declared relation under the name the collection gave it", async () => {
            const query = (db as unknown as { query: Record<string, { findFirst(o: unknown): Promise<unknown> }> }).query;
            const row = await query.posts.findFirst({ with: { writer: true } }) as
                { title: string; writer?: { displayName?: string } };

            expect(row.title).toBe("Hello");
            // `writer`, not `author`: the relation is named by the config, and a
            // builder that guessed from `author_id` would answer `undefined`.
            expect(row.writer?.displayName).toBe("Ada");
        });

        it("loads the inverse side, paired by the same derived relation name", async () => {
            const query = (db as unknown as { query: Record<string, { findFirst(o: unknown): Promise<unknown> }> }).query;
            const row = await query.authors.findFirst({ with: { articles: true } }) as
                { articles?: { title: string }[] };

            expect(row.articles?.map(a => a.title)).toEqual(["Hello"]);
        });

        it("loads a many-to-many through its junction", async () => {
            const query = (db as unknown as { query: Record<string, { findFirst(o: unknown): Promise<unknown> }> }).query;
            const row = await query.posts.findFirst({
                with: { tags: { with: { tag_id: true } } }
            }) as { tags?: { tag_id?: { label?: string } }[] };

            expect(row.tags?.[0]?.tag_id?.label).toBe("release");
        });

        it("serves every column type as the generated module served it", async () => {
            const [row] = await db
                .select()
                .from(catalogue.tables.posts)
                .where(eq((catalogue.tables.posts as never as Record<string, never>).id, POST_ID as never)) as
                Record<string, unknown>[];

            // numeric → number. Postgres sends it as text and drizzle keeps the
            // string; `patchPgNumericToNumber` is what the driver does about it,
            // and it has to reach a catalogue-built column too.
            expect(row.price).toBe(12.5);
            // timestamptz → ISO string, never a Date: `mode: "string"` is what
            // the generated module declared for every date property.
            expect(typeof row.publishedAt).toBe("string");
            expect(new Date(row.publishedAt as string).toISOString()).toBe("2026-01-02T03:04:05.000Z");
            // enum → the label, as text on the wire.
            expect(row.status).toBe("published");
            // char(3) keeps its width (Postgres pads), varchar(12) its value.
            expect(row.code).toBe("abc");
            expect(row.sku).toBe("SKU-1");
            // arrays stay arrays of their element type.
            expect(row.ratings).toEqual([4, 5]);
            expect(row.meta).toEqual({ a: 1 });
            expect(row.authorId).toBe(AUTHOR_ID);
        });

        it("does not try to write the generated column", async () => {
            // drizzle leaves a `generatedAlwaysAs` column out of the INSERT
            // entirely. Without the marker it emits `DEFAULT` for it, which
            // Postgres accepts for a generated column today but is one server
            // version away from being a 428C9.
            const searchColumn = getTableColumns(catalogue.tables.posts).search_vector as unknown as
                { shouldDisableInsert(): boolean };
            expect(searchColumn.shouldDisableInsert()).toBe(true);

            const inserted = await db.insert(catalogue.tables.posts).values({
                id: "44444444-4444-4444-8444-444444444444",
                title: "Second"
            } as never).returning() as Record<string, unknown>[];

            expect(inserted[0].search_vector).toContain("second");
        });
    });
});

describe("a write against the catalogue, with a stale schema.generated.ts", () => {
    let pg: PGlite;

    beforeAll(async () => {
        pg = await PGlite.create();
        await pg.exec("CREATE TABLE notes (id text PRIMARY KEY, title text, subtitle text)");
    }, 60_000);

    afterAll(async () => {
        await pg?.close();
    });

    /** The collection, with a property the committed schema file predates. */
    const notes = {
        slug: "notes",
        table: "notes",
        name: "Notes",
        properties: {
            id: { name: "ID", type: "string", isId: true },
            title: { name: "Title", type: "string" },
            subtitle: { name: "Subtitle", type: "string" }
        }
    } as unknown as CollectionConfig;

    it("accepts a column the database has and the generated module does not", async () => {
        const catalogue = await readCatalogueSchema({
            client: pg as unknown as Queryable,
            collections: [notes],
            defaultSchema: "public"
        });

        // The old failure: `assertWritableColumns` read the generated module, so
        // the first save of a row carrying a newly added property answered 400
        // for a column that existed. The module is not consulted any more, and
        // this is the proof — the table came from the database.
        expect(() => assertWritableColumns(
            { id: "1", title: "t", subtitle: "s" },
            catalogue.tables.notes,
            "notes"
        )).not.toThrow();

        const db = drizzle(pg, { schema: catalogue.tables });
        await db.insert(catalogue.tables.notes).values({ id: "1", title: "t", subtitle: "s" } as never);
        const rows = await db.select().from(catalogue.tables.notes) as Record<string, unknown>[];
        expect(rows[0].subtitle).toBe("s");
    });

    it("refuses a column the database does not have, and says the schema is unapplied", async () => {
        const catalogue = await readCatalogueSchema({
            client: pg as unknown as Queryable,
            collections: [notes],
            defaultSchema: "public"
        });

        try {
            assertWritableColumns({ id: "2", footnote: "nope" }, catalogue.tables.notes, "notes");
            throw new Error("should have thrown");
        } catch (error) {
            const message = (error as Error).message;
            expect((error as { code?: string }).code).toBe("VALIDATION_UNKNOWN_FIELDS");
            expect(message).toContain("'footnote'");
            // The remedy is to apply the schema, not to regenerate a file the
            // runtime no longer reads.
            expect(message).toContain("rebase db push");
            expect(message).not.toContain("rebase schema generate");
        }
    });
});
