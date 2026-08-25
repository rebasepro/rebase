/**
 * The `indexes:` block — resolution, the frozen name, and the refusals.
 *
 * The assertions that matter here are not that the SQL parses. They are:
 *
 *  - a *semantic* change renames the index and a *cosmetic* one does not,
 *    because `CREATE INDEX IF NOT EXISTS` matches on name alone: a stable name
 *    over a changed definition is a silent permanent no-op, which is a bug
 *    already shipped twice in this repo;
 *  - truncation eats the readable head and never the hash;
 *  - a `belongsTo` resolves to its foreign key column, not to its property key,
 *    because that is the case people index and the case where the two differ;
 *  - `isRebaseIndexName` cannot match any other producer's names, since it is
 *    what decides whether `db push` may drop an index.
 */
import { CollectionConfig } from "@rebasepro/types";
import {
    buildCollectionIndexSpecs,
    buildCollectionIndexPlan,
    collectionIndexStatement,
    deriveIndexName,
    isRebaseIndexName,
    indexFingerprint,
    renderPredicate,
    CollectionIndexConfigError,
    MAX_INDEX_KEYS
} from "../src/schema/collection-index";
import { generatePostgresDdl, resolveColumnName } from "../src/schema/generate-postgres-ddl-logic";

const posts = (indexes: unknown[], extra: Record<string, unknown> = {}): CollectionConfig =>
    ({
        slug: "posts",
        name: "Posts",
        table: "posts",
        properties: {
            id: { type: "string", name: "Id", isId: true },
            title: { type: "string", name: "Title" },
            status: { type: "string", name: "Status" },
            views: { type: "number", name: "Views" },
            email: { type: "string", name: "Email" },
            tags: { type: "array", name: "Tags", columnType: "text[]" },
            createdAt: { type: "date", name: "Created" },
            ...(extra.properties as Record<string, unknown> ?? {})
        },
        indexes,
        ...extra
    }) as unknown as CollectionConfig;

const specs = (c: CollectionConfig) => buildCollectionIndexSpecs(c, resolveColumnName);
const one = (indexes: unknown[]) => specs(posts(indexes))[0];

describe("resolution", () => {
    it("resolves property keys to column names", () => {
        expect(one([{ on: ["createdAt"], reason: "feed order" }]).keys)
            .toEqual([{ column: "created_at", direction: "asc", nulls: "last" }]);
    });

    it("resolves a belongsTo to its foreign key column, not its property key", () => {
        const collection = posts([{ on: ["author"], reason: "author's posts" }], {
            properties: {
                author: { type: "relation", name: "Author", relation: { kind: "belongsTo", target: () => ({ slug: "authors", table: "authors", properties: { id: { type: "string", isId: true } } }) } }
            }
        });
        // `author_id`, never `author` — this is the whole reason `prop` takes a
        // property key rather than a column name.
        expect(specs(collection)[0].keys[0].column).toBe("author_id");
    });

    it("refuses a relation kind with no column on this table", () => {
        const collection = posts([{ on: ["tagList"], reason: "x" }], {
            properties: {
                tagList: { type: "relation", name: "Tags", relation: { kind: "manyToMany", target: () => ({ slug: "tags", table: "tags", properties: { id: { type: "string", isId: true } } }) } }
            }
        });
        expect(() => specs(collection)).toThrow(/manyToMany relation, which has no column/);
    });

    it("defaults NULLS to what the direction implies", () => {
        expect(one([{ on: [{ prop: "createdAt", direction: "desc" }], reason: "newest first" }]).keys[0].nulls).toBe("first");
        expect(one([{ on: [{ prop: "createdAt" }], reason: "oldest first" }]).keys[0].nulls).toBe("last");
    });
});

describe("the derived name", () => {
    const nameOf = (indexes: unknown[]) => one(indexes).indexName;

    it("is <table>_<columns>_ix_<hash>, and _ux_ when unique", () => {
        expect(nameOf([{ on: ["status"], reason: "r" }])).toMatch(/^posts_status_ix_[0-9a-f]{7}$/);
        expect(nameOf([{ on: ["status", "views"], unique: true, reason: "r" }])).toMatch(/^posts_status_views_ux_[0-9a-f]{7}$/);
    });

    it("is UNCHANGED by cosmetic edits", () => {
        const base = nameOf([{ on: ["createdAt"], reason: "feed" }]);
        // Writing Postgres's own default down explicitly.
        expect(nameOf([{ on: [{ prop: "createdAt", direction: "asc" }], reason: "feed" }])).toBe(base);
        expect(nameOf([{ on: [{ prop: "createdAt", direction: "asc", nulls: "last" }], reason: "feed" }])).toBe(base);
        // Rewording the justification must not rebuild an index.
        expect(nameOf([{ on: ["createdAt"], reason: "a completely different sentence" }])).toBe(base);
    });

    it("CHANGES whenever the index means something different", () => {
        const base = nameOf([{ on: ["status", "views"], reason: "r" }]);
        expect(nameOf([{ on: ["views", "status"], reason: "r" }])).not.toBe(base);          // key order
        expect(nameOf([{ on: ["status", "views"], unique: true, reason: "r" }])).not.toBe(base);
        expect(nameOf([{ on: [{ prop: "status" }, { prop: "views", direction: "desc" }], reason: "r" }])).not.toBe(base);
        expect(nameOf([{ on: ["status", "views"], include: ["title"], reason: "r" }])).not.toBe(base);
        expect(nameOf([{ on: ["status", "views"], where: { prop: "status", op: "=", value: "published" }, reason: "r" }])).not.toBe(base);
    });

    it("hashes uniqueness into the fingerprint, not only into the tag", () => {
        // The name already differs by `_ix_` vs `_ux_`, so asserting on names
        // alone passes whether or not `unique` is in the payload — which is how
        // a mutant dropping it from the fingerprint survived. Pin the hash
        // itself, so the tag scheme and the fingerprint are independently
        // complete rather than each covering for the other.
        const base = {
            schema: "public", table: "posts", method: "btree" as const,
            keys: [{ column: "status", direction: "asc" as const, nulls: "last" as const }],
            include: [], predicate: null, reason: "r"
        };
        expect(indexFingerprint({ ...base, unique: true }))
            .not.toBe(indexFingerprint({ ...base, unique: false }));
    });

    it("hashes every field that changes what the index is", () => {
        const base = {
            schema: "public", table: "posts", method: "btree" as const, unique: false,
            keys: [{ column: "status", direction: "asc" as const, nulls: "last" as const }],
            include: [] as string[], predicate: null as null | { column: string; op: "="; value: string }, reason: "r"
        };
        const fp = indexFingerprint(base);
        expect(indexFingerprint({ ...base, schema: "other" })).not.toBe(fp);
        expect(indexFingerprint({ ...base, table: "articles" })).not.toBe(fp);
        expect(indexFingerprint({ ...base, method: "gin" })).not.toBe(fp);
        expect(indexFingerprint({ ...base, include: ["title"] })).not.toBe(fp);
        expect(indexFingerprint({ ...base, predicate: { column: "status", op: "=", value: "published" } })).not.toBe(fp);
        expect(indexFingerprint({ ...base, keys: [{ column: "status", direction: "desc", nulls: "first" }] })).not.toBe(fp);
        expect(indexFingerprint({ ...base, keys: [{ column: "status", direction: "asc", nulls: "first" }] })).not.toBe(fp);
        // ...and nothing that does not.
        expect(indexFingerprint({ ...base, reason: "an entirely different justification" })).toBe(fp);
    });

    it("truncates the head and keeps the hash, landing inside 63 bytes", () => {
        const long = "x".repeat(80);
        const spec = {
            schema: "public", table: long, method: "btree" as const, unique: false,
            keys: [{ column: "also_very_long_column_name", direction: "asc" as const, nulls: "last" as const }],
            include: [], predicate: null, reason: "r"
        };
        const name = deriveIndexName(spec);
        expect(new TextEncoder().encode(name).byteLength).toBeLessThanOrEqual(63);
        // The hash is the part that makes it unique; truncation must never eat it.
        expect(name).toMatch(/_ix_[0-9a-f]{7}$/);
    });

    it("is recognised as Rebase's, and no other producer's name is", () => {
        expect(isRebaseIndexName(nameOf([{ on: ["status"], reason: "r" }]))).toBe(true);
        for (const foreign of [
            "posts_author_id_fkey",
            "posts_search_vector_gin",
            "posts_title_text_trgm",
            "documents_embedding_hnsw_cosine",
            "posts_pkey",
            "posts_email_key",
            "idx_users_uid",
            "users_email_verification_token_idx",
            "handwritten_status_idx"
        ]) {
            expect(isRebaseIndexName(foreign)).toBe(false);
        }
    });
});

describe("rendering", () => {
    const sqlOf = (indexes: unknown[]) => collectionIndexStatement(one(indexes));

    it("emits a plain btree with no USING clause", () => {
        expect(sqlOf([{ on: ["status"], reason: "r" }]))
            .toMatch(/^CREATE INDEX "posts_status_ix_[0-9a-f]{7}" ON "public"\."posts" \("status"\);$/);
    });

    it("emits NULLS only when it is not what the direction implies", () => {
        // DESC already implies NULLS FIRST — restating it would differ from
        // what pg_get_indexdef reads back, and the re-plan would never settle.
        expect(sqlOf([{ on: [{ prop: "createdAt", direction: "desc" }], reason: "r" }])).toContain('"created_at" DESC)');
        expect(sqlOf([{ on: [{ prop: "createdAt", direction: "desc", nulls: "last" }], reason: "r" }])).toContain('"created_at" DESC NULLS LAST)');
    });

    it("emits unique, include, using and where", () => {
        expect(sqlOf([{ on: ["email"], unique: true, reason: "r" }]).startsWith("CREATE UNIQUE INDEX")).toBe(true);
        expect(sqlOf([{ on: ["title"], include: ["views"], reason: "r" }])).toContain('INCLUDE ("views")');
        expect(sqlOf([{ on: ["tags"], using: "gin", reason: "r" }])).toContain('USING gin ("tags")');
        expect(sqlOf([{ on: ["createdAt"], where: { prop: "status", op: "=", value: "published" }, reason: "r" }]))
            .toContain(`WHERE "status" = 'published'`);
    });

    it("takes CONCURRENTLY as a parameter, including for a unique index", () => {
        // A `.replace("CREATE INDEX IF NOT EXISTS", …)` — the idiom used
        // elsewhere in this package — silently does nothing here, because the
        // rendered text is `CREATE UNIQUE INDEX`.
        const spec = one([{ on: ["email"], unique: true, reason: "r" }]);
        expect(collectionIndexStatement(spec, { concurrently: true })).toContain("CREATE UNIQUE INDEX CONCURRENTLY");
    });

    it("escapes a literal rather than interpolating it", () => {
        expect(renderPredicate({ column: "name", op: "=", value: "O'Brien" })).toBe(`"name" = 'O''Brien'`);
    });

    it("renders in, is null and nested and", () => {
        expect(renderPredicate({ column: "s", op: "in", value: ["a", "b"] })).toBe(`"s" IN ('a', 'b')`);
        expect(renderPredicate({ column: "s", op: "is not null" })).toBe(`"s" IS NOT NULL`);
        expect(renderPredicate({ and: [{ column: "a", op: "=", value: 1 }, { column: "b", op: "is null" }] }))
            .toBe(`"a" = 1 AND "b" IS NULL`);
    });
});

describe("refusals", () => {
    const rejects = (indexes: unknown[], pattern: RegExp) =>
        expect(() => specs(posts(indexes))).toThrow(pattern);

    it("names the collection and the array position", () => {
        try {
            specs(posts([{ on: ["status"], reason: "ok" }, { on: ["nope"], reason: "r" }]));
            throw new Error("should have thrown");
        } catch (err) {
            expect(err).toBeInstanceOf(CollectionIndexConfigError);
            expect((err as Error).message).toContain("posts.indexes[1]");
        }
    });

    it("refuses an unknown property", () => rejects([{ on: ["nope"], reason: "r" }], /not a property/));
    it("refuses a missing reason", () => rejects([{ on: ["status"] }], /`reason` is required/));
    it("refuses a blank reason", () => rejects([{ on: ["status"], reason: "   " }], /`reason` is required/));
    it("refuses an empty key list", () => rejects([{ on: [], reason: "r" }], /at least one property/));

    it(`refuses more than ${MAX_INDEX_KEYS} keys`, () =>
        rejects([{ on: ["id", "title", "status", "views", "email", "createdAt"], reason: "r" }], /the limit is 5/));

    it("refuses include overlapping on", () =>
        rejects([{ on: ["title"], include: ["title"], reason: "r" }], /both `on` and `include`/));

    it("refuses a repeated key", () =>
        rejects([{ on: ["status", "status"], reason: "r" }], /appears twice/));

    it("refuses redeclaring the primary key", () =>
        rejects([{ on: ["id"], reason: "r" }], /already indexes exactly these columns/));

    it("refuses ASC/DESC on an unordered access method", () =>
        rejects([{ on: [{ prop: "tags", direction: "desc" }], using: "gin", reason: "r" }], /does not support ASC\/DESC/));

    it("refuses a duplicate declaration", () =>
        rejects([{ on: ["status"], reason: "a" }, { on: ["status"], reason: "b" }], /same name as indexes\[0\]/));

    it("refuses a repeated value in an in list", () =>
        rejects([{ on: ["createdAt"], where: { prop: "status", op: "in", value: ["a", "a"] }, reason: "r" }], /repeats a value/));

    it("refuses single-column unique that duplicates validation.unique", () => {
        const collection = posts([{ on: ["email"], unique: true, reason: "r" }], {
            properties: { email: { type: "string", name: "Email", validation: { unique: true } } }
        });
        expect(() => specs(collection)).toThrow(/already declares `validation.unique`/);
    });
});

describe("the plan and the generated DDL", () => {
    it("sorts by schema, table and name so the artifact does not depend on load order", () => {
        const a = posts([{ on: ["views"], reason: "r" }]);
        const b = { ...posts([{ on: ["status"], reason: "r" }]), slug: "articles", table: "articles" } as CollectionConfig;
        const forward = buildCollectionIndexPlan([a, b], resolveColumnName).map(s => s.table);
        const backward = buildCollectionIndexPlan([b, a], resolveColumnName).map(s => s.table);
        expect(forward).toEqual(backward);
        expect(forward[0]).toBe("articles");
    });

    it("reaches schema.sql, and before the foreign keys that may depend on it", async () => {
        const ddl = await generatePostgresDdl([posts([{ on: ["status"], reason: "dashboard filter" }])] as CollectionConfig[]);
        expect(ddl).toContain("CREATE INDEX \"posts_status_ix_");
        const indexAt = ddl.indexOf("-- Indexes");
        const fkAt = ddl.indexOf("-- Foreign Key Constraints");
        if (fkAt !== -1) expect(indexAt).toBeLessThan(fkAt);
    });

    it("emits nothing for a collection that declares none", () => {
        expect(specs(posts([]))).toEqual([]);
        const bare = { slug: "posts", table: "posts", properties: { id: { type: "string", isId: true } } } as unknown as CollectionConfig;
        expect(specs(bare)).toEqual([]);
    });
});
