/**
 * The btree every foreign-key column gets — planned once, rendered by both
 * `db push` and boot, and never a duplicate of an index that already serves.
 *
 * Postgres indexes the key a constraint points at and never the column holding
 * it. Before these were derived, every read from the far side of a link —
 * `include=posts` on an author, `/authors/5/posts`, the reverse side of a
 * many-to-many — and every `ON DELETE` check sequentially scanned the child
 * table: 13 ms for 25 parents over 100k children, ~250 ms per nested listing
 * at a million.
 *
 * What these pin, per relation kind:
 *  - `belongsTo` holds the key, so its `localKey` is indexed — which is also
 *    the column the far side's `hasOne`/`hasMany` filters on;
 *  - a `manyToMany` junction's target column is indexed (its key covers the
 *    source column), always;
 *  - `via` plans nothing — it is a read-only chain over existing columns;
 *  - `index: false` drops the index and keeps the constraint;
 *  - nothing is indexed twice: a primary key, a UNIQUE, a declared index or
 *    the tenant index that already leads with the column is enough;
 *  - the name is the one a declared plain index on the column derives, so the
 *    two are one object, and it is frozen.
 */
import { CollectionConfig } from "@rebasepro/types";
import { planSchema } from "../src/schema/plan/plan-schema";
import { generatePostgresDdl } from "../src/schema/generate-postgres-ddl-logic";
import { generateSchema } from "../src/schema/generate-drizzle-schema-logic";
import { buildCollectionIndexSpecs, foreignKeyIndexSpec, FOREIGN_KEY_INDEX_REASON } from "../src/schema/collection-index";
import { resolveColumnName } from "../src/schema/column-plan-helpers";

const authors = {
    slug: "authors", table: "authors", name: "Authors",
    properties: {
        id: { type: "number", isId: "increment" },
        name: { type: "string" },
        // The far side of `posts.author` — the include this whole feature is for.
        posts: { type: "relation", relation: { kind: "hasMany", target: () => posts, foreignKeyOnTarget: "author_id" } },
        // And a one-row link back from `profiles.author`.
        profile: { type: "relation", relation: { kind: "hasOne", target: () => profiles, foreignKeyOnTarget: "author_id" } }
    }
} as unknown as CollectionConfig;

const tags = {
    slug: "tags", table: "tags", name: "Tags",
    properties: { id: { type: "number", isId: "increment" }, name: { type: "string" } }
} as unknown as CollectionConfig;

const companies = {
    slug: "companies", table: "companies", name: "Companies",
    properties: { id: { type: "number", isId: "increment" }, name: { type: "string" } }
} as unknown as CollectionConfig;

const posts = {
    slug: "posts", table: "posts", name: "Posts",
    properties: {
        id: { type: "number", isId: "increment" },
        title: { type: "string" },
        author: { type: "relation", relation: { kind: "belongsTo", target: () => authors } },
        tags: { type: "relation", relation: { kind: "manyToMany", target: () => tags } },
        // Read-only chain: author → company. Plans no column and no index.
        company: {
            type: "relation",
            relation: {
                kind: "via", target: () => companies, cardinality: "one",
                joinPath: [
                    { table: "authors", on: { from: "author_id", to: "id" } },
                    { table: "companies", on: { from: "company_id", to: "id" } }
                ]
            }
        }
    }
} as unknown as CollectionConfig;

const profiles = {
    slug: "profiles", table: "profiles", name: "Profiles",
    properties: {
        id: { type: "number", isId: "increment" },
        author: { type: "relation", relation: { kind: "belongsTo", target: () => authors } }
    }
} as unknown as CollectionConfig;

const collections = [authors, tags, companies, posts, profiles];

/** `table → index columns` for every derived foreign-key index in the plan. */
const derivedIndexes = (all: CollectionConfig[]): Record<string, string[]> => {
    const out: Record<string, string[]> = {};
    for (const table of planSchema(all).tables) {
        const derived = table.indexes.filter(spec => spec.derived === "foreign-key");
        if (derived.length > 0) out[table.table] = derived.map(spec => spec.keys.map(k => k.column).join(","));
    }
    return out;
};

const tableIndexes = (all: CollectionConfig[], table: string) =>
    planSchema(all).tables.find(t => t.table === table)!.indexes;

describe("which columns get a foreign-key index", () => {
    it("indexes every belongsTo key and the junction's target column, and nothing else", () => {
        expect(derivedIndexes(collections)).toEqual({
            // belongsTo — also the column `authors.posts` (hasMany) filters on.
            posts: ["author_id"],
            // belongsTo — also the column `authors.profile` (hasOne) filters on.
            profiles: ["author_id"],
            // manyToMany: `(post_id, tag_id)` is the key, so `post_id` is
            // served by it; the reverse side, tags → posts, needs `tag_id`.
            posts_tags: ["tag_id"]
        });
    });

    it("plans nothing for hasOne, hasMany or via on the declaring table", () => {
        // `authors` declares a hasMany and a hasOne and holds no foreign key of
        // its own; `posts.company` is a via. None of them adds an index.
        expect(tableIndexes(collections, "authors")).toEqual([]);
        expect(tableIndexes(collections, "companies")).toEqual([]);
        expect(tableIndexes(collections, "posts").map(i => i.keys[0].column)).toEqual(["author_id"]);
    });

    it("is a plain btree, carrying the derived reason", () => {
        const [index] = tableIndexes(collections, "posts");
        expect(index).toMatchObject({
            method: "btree", unique: false, include: [], predicate: null,
            keys: [{ column: "author_id", direction: "asc", nulls: "last" }],
            reason: FOREIGN_KEY_INDEX_REASON, derived: "foreign-key"
        });
    });

    it("drops the index — and keeps the constraint — when the relation says `index: false`", () => {
        const optedOut = {
            ...posts,
            properties: {
                ...posts.properties,
                author: { type: "relation", relation: { kind: "belongsTo", target: () => authors, index: false } }
            }
        } as unknown as CollectionConfig;
        const all = [authors, tags, companies, optedOut, profiles];

        expect(derivedIndexes(all).posts).toBeUndefined();
        const ddl = generatePostgresDdl(all);
        expect(ddl).toContain('ADD CONSTRAINT "posts_author_id_fkey" FOREIGN KEY ("author_id")');
        expect(ddl).not.toMatch(/INDEX "posts_author_id_ix_[0-9a-f]{7}"/);
        // The junction is the platform's table: no opt-out reaches it.
        expect(derivedIndexes(all).posts_tags).toEqual(["tag_id"]);
    });
});

describe("never a second index doing one job", () => {
    const withPosts = (override: Record<string, unknown>): CollectionConfig[] =>
        [authors, tags, companies, { ...posts, ...override } as unknown as CollectionConfig, profiles];

    it("defers to a declared index on the column — the same name, one object", () => {
        const all = withPosts({ indexes: [{ on: ["author"], reason: "author pages" }] });
        const indexes = tableIndexes(all, "posts");
        expect(indexes).toHaveLength(1);
        expect(indexes[0].derived).toBeUndefined();
        // And the derived one would have been byte-for-byte that index.
        expect(indexes[0].indexName).toBe(tableIndexes(collections, "posts")[0].indexName);
    });

    it("defers to a declared composite index that leads with the column", () => {
        const all = withPosts({ indexes: [{ on: ["author", { prop: "title", direction: "desc" }], reason: "an author's feed" }] });
        expect(tableIndexes(all, "posts").map(i => i.keys.map(k => k.column))).toEqual([["author_id", "title"]]);
    });

    it("does NOT defer to a composite index where the column is not first", () => {
        const all = withPosts({ indexes: [{ on: ["title", "author"], reason: "title lookups" }] });
        expect(tableIndexes(all, "posts").map(i => i.keys[0].column)).toEqual(["title", "author_id"]);
    });

    it("does NOT defer to a partial index — it cannot reach every row", () => {
        const all = withPosts({
            indexes: [{ on: ["author"], where: { prop: "title", op: "is not null" }, reason: "titled posts" }]
        });
        expect(tableIndexes(all, "posts").map(i => i.derived ?? "declared")).toEqual(["declared", "foreign-key"]);
    });

    it("does NOT defer to a GIN index", () => {
        const all = withPosts({
            properties: { ...posts.properties, labels: { type: "array", columnType: "text[]" } },
            indexes: [{ on: ["labels"], using: "gin", reason: "label filter" }]
        });
        expect(tableIndexes(all, "posts").filter(i => i.derived).map(i => i.keys[0].column)).toEqual(["author_id"]);
    });

    it("defers to a UNIQUE on the link — Postgres already backs it with a btree", () => {
        const all = withPosts({
            properties: {
                ...posts.properties,
                author: { type: "relation", validation: { unique: true }, relation: { kind: "belongsTo", target: () => authors } }
            }
        });
        expect(tableIndexes(all, "posts")).toEqual([]);
    });

    it("defers to the primary key when the column leads it, and not when it follows", () => {
        // A translation keyed by (id, locale) whose `id` is also the link to
        // its parent: `<table>_pkey` serves lookups by `id`.
        const translations = {
            slug: "company_translations", table: "company_translations", name: "Translations",
            properties: {
                id: { type: "number", isId: true },
                locale: { type: "string", isId: true },
                company: { type: "relation", relation: { kind: "belongsTo", target: () => companies, localKey: "id" } }
            }
        } as unknown as CollectionConfig;
        expect(tableIndexes([companies, translations], "company_translations")).toEqual([]);

        const reversed = {
            ...translations,
            properties: {
                locale: { type: "string", isId: true },
                id: { type: "number", isId: true },
                company: { type: "relation", relation: { kind: "belongsTo", target: () => companies, localKey: "id" } }
            }
        } as unknown as CollectionConfig;
        expect(tableIndexes([companies, reversed], "company_translations").map(i => i.keys[0].column)).toEqual(["id"]);
    });

    it("defers to the tenant index when the tenant is the link", () => {
        const orgs = {
            slug: "orgs", table: "orgs", name: "Orgs",
            properties: { id: { type: "string", isId: "uuid" } }
        } as unknown as CollectionConfig;
        const docs = {
            slug: "docs", table: "docs", name: "Docs",
            tenant: { field: "org", from: { claim: "org_id" } },
            properties: {
                id: { type: "string", isId: "uuid" },
                org: { type: "relation", relation: { kind: "belongsTo", target: () => orgs } }
            }
        } as unknown as CollectionConfig;
        const indexes = tableIndexes([orgs, docs], "docs");
        expect(indexes.map(i => i.keys[0].column)).toEqual(["org_id"]);
        expect(indexes[0].derived).toBeUndefined();
    });

    it("indexes a column once when a declared property owns it beside the relation", () => {
        const all = withPosts({
            properties: {
                ...posts.properties,
                authorId: { type: "number", columnName: "author_id" }
            }
        });
        expect(tableIndexes(all, "posts").map(i => i.keys[0].column)).toEqual(["author_id"]);
    });
});

describe("the frozen name", () => {
    it("is what a declared plain index on the column derives", () => {
        const [declared] = buildCollectionIndexSpecs(
            { ...posts, indexes: [{ on: ["author"], reason: "anything — the reason is not in the name" }] } as unknown as CollectionConfig,
            resolveColumnName
        );
        expect(tableIndexes(collections, "posts")[0].indexName).toBe(declared.indexName);
    });

    // Pinned literally. Once a release creates these, every database carries
    // them; a different name is a second index beside the first, or a drop and
    // a rebuild on every table in the field. `contracts/derived-names.txt`
    // pins the fixture's names too — this is the readable copy.
    it("does not move", () => {
        expect(tableIndexes(collections, "posts")[0].indexName).toBe("posts_author_id_ix_00ad191");
        expect(tableIndexes(collections, "posts_tags")[0].indexName).toBe("posts_tags_tag_id_ix_d4456f1");
    });
});

describe("rendered by both db push files", () => {
    it("is in schema.sql, before the constraints", () => {
        const ddl = generatePostgresDdl(collections);
        const index = ddl.indexOf('CREATE INDEX "posts_author_id_ix_');
        expect(index).toBeGreaterThan(-1);
        expect(ddl).toContain('CREATE INDEX "posts_tags_tag_id_ix_d4456f1" ON "public"."posts_tags" ("tag_id");');
        expect(index).toBeLessThan(ddl.indexOf("-- Foreign Key Constraints"));
    });

    it("is in schema.generated.ts — junction included — so drizzle-kit would not drop it", () => {
        const generated = generateSchema(collections);
        expect(generated).toContain('index("posts_author_id_ix_00ad191").on(table.authorId.asc().nullsLast())');
        expect(generated).toContain('index("posts_tags_tag_id_ix_d4456f1").on(table.tag_id.asc().nullsLast())');
    });
});

/**
 * The point of the whole thing, asked of the planner itself: the reads a
 * relation turns into choose the derived index once there is enough data for
 * an index to matter. These are the statements the driver sends, verbatim
 * (`FetchService` / `RelationService`, captured in the perf sweep's proof):
 * a nested listing's page and count, a to-many include, and the reverse side
 * of a many-to-many.
 */
describe("the reads it is for", () => {
    const blogPosts = {
        slug: "posts", table: "posts", name: "Posts",
        properties: {
            id: { type: "number", isId: "increment" },
            title: { type: "string" },
            tags: { type: "relation", relation: { kind: "manyToMany", target: () => tags } }
        }
    } as unknown as CollectionConfig;
    const comments = {
        slug: "comments", table: "comments", name: "Comments",
        properties: {
            id: { type: "number", isId: "increment" },
            body: { type: "string" },
            post: { type: "relation", relation: { kind: "belongsTo", target: () => blogPosts } }
        }
    } as unknown as CollectionConfig;

    const plans = async (ddl: string): Promise<Record<string, string>> => {
        const { PGlite } = await import("@electric-sql/pglite");
        const db = new PGlite();
        try {
            await db.exec(
                "CREATE SCHEMA IF NOT EXISTS rebase;" +
                "CREATE OR REPLACE FUNCTION rebase.uid() RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULL::text $$;" +
                "CREATE OR REPLACE FUNCTION rebase.roles() RETURNS text LANGUAGE sql STABLE AS $$ SELECT ''::text $$;"
            );
            await db.exec(ddl);
            // 1,000 posts with 20 comments each and 50 tags on 2 posts each:
            // enough rows that a sequential scan is no longer the cheap plan.
            await db.exec(
                "INSERT INTO posts (title) SELECT 'p' || g FROM generate_series(1, 1000) g;" +
                "INSERT INTO comments (body, post_id) SELECT 'c', 1 + (g % 1000) FROM generate_series(1, 20000) g;" +
                "INSERT INTO tags (name) SELECT 't' || g FROM generate_series(1, 500) g;" +
                "INSERT INTO posts_tags (post_id, tag_id) SELECT p, 1 + (p % 500) FROM generate_series(1, 1000) p;" +
                "ANALYZE;"
            );
            const explain = async (statement: string): Promise<string> =>
                (await db.query<{ "QUERY PLAN": string }>(`EXPLAIN ${statement}`)).rows.map(r => r["QUERY PLAN"]).join("\n");
            return {
                page: await explain(
                    'select "body", "post_id", "id" from "comments" where "comments"."post_id" = 5 order by "comments"."id" desc limit 25'),
                count: await explain('select count(*) from "comments" where "comments"."post_id" = 5'),
                include: await explain(
                    `select "id", "post_id", "body" from "comments" where "comments"."post_id" in (${Array.from({ length: 25 }, (_, i) => i + 1).join(", ")})`),
                reverseManyToMany: await explain(
                    'select "post_id", "tag_id" from "posts_tags" where "posts_tags"."tag_id" in (1, 2, 3)')
            };
        } finally {
            await db.close();
        }
    };

    it("uses the derived index for a nested listing, its count, an include and a reverse many-to-many", async () => {
        const all = [blogPosts, comments, tags];
        const ddl = generatePostgresDdl(all);
        const comment = tableIndexes(all, "comments")[0].indexName;
        const junction = tableIndexes(all, "posts_tags")[0].indexName;

        const withIndexes = await plans(ddl);
        expect(withIndexes.page).toContain(comment);
        expect(withIndexes.count).toContain(comment);
        expect(withIndexes.include).toContain(comment);
        expect(withIndexes.reverseManyToMany).toContain(junction);
        for (const plan of Object.values(withIndexes)) expect(plan).not.toMatch(/Seq Scan on (comments|posts_tags)/);

        // The control: the same schema without them scans the child table for
        // every one of the four.
        const without = await plans(ddl.split("\n").filter(l => !l.includes(comment) && !l.includes(junction)).join("\n"));
        expect(without.count).toMatch(/Seq Scan on comments/);
        expect(without.include).toMatch(/Seq Scan on comments/);
        expect(without.reverseManyToMany).toMatch(/Seq Scan on posts_tags/);
    }, 60_000);
});

/**
 * "Introspect, then push, changes nothing" — and a push after introspecting a
 * database whose foreign keys have no index would otherwise build one per key.
 * So introspection writes `index: false` where the database lacks the index
 * Rebase would derive, and nothing where it has it.
 */
describe("introspecting a database", () => {
    const introspect = async (setup: string): Promise<string> => {
        const { PGlite } = await import("@electric-sql/pglite");
        const { readSchemaMetadata } = await import("../src/schema/introspect-db-queries");
        const { generateCollectionFile } = await import("../src/schema/introspect-db-logic");
        const db = new PGlite();
        try {
            await db.exec(setup);
            const metadata = await readSchemaMetadata(db, "public");
            const fks = metadata.fks.filter(fk => fk.table_name === "posts");
            const meta = {
                name: "posts",
                columns: metadata.columns.filter(c => c.table_name === "posts"),
                pks: metadata.pks.filter(p => p.table_name === "posts").map(p => p.column_name),
                fks
            };
            const authorsMeta = {
                name: "authors",
                columns: metadata.columns.filter(c => c.table_name === "authors"),
                pks: ["id"],
                fks: []
            };
            return generateCollectionFile("posts", meta, metadata.fks, new Set(), new Map([["posts", meta], ["authors", authorsMeta]]),
                new Map(), undefined, { metadata });
        } finally {
            await db.close();
        }
    };
    const schema = "CREATE TABLE authors (id serial PRIMARY KEY); " +
        "CREATE TABLE posts (id serial PRIMARY KEY, author_id integer REFERENCES authors(id));";

    it("writes `index: false`, and why, where the database has no index Rebase would derive", async () => {
        const file = await introspect(schema);
        expect(file).toMatch(/localKey: "author_id",[\s\S]*\/\/ The database has no index of Rebase's on author_id\. Delete this line to have one built\.\s+index: false/);
    });

    it("writes it too over a hand-written index — keeping one index rather than adding a second", async () => {
        const file = await introspect(`${schema} CREATE INDEX idx_posts_author ON posts (author_id);`);
        expect(file).toContain("index: false");
    });

    it("writes nothing where the database already holds the derived index", async () => {
        const name = foreignKeyIndexSpec("public", "posts", "author_id").indexName;
        const file = await introspect(`${schema} CREATE INDEX "${name}" ON posts (author_id);`);
        expect(file).not.toContain("index:");
        expect(file).toContain('localKey: "author_id"');
    });
});
