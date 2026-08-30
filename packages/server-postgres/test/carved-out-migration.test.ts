/**
 * Taking Atlas's carve-outs back out of the migration it wrote.
 *
 * Every `ALTER TABLE` here is real output from `atlas migrate diff` v1.2.3
 * against a migration directory carrying the appended search DDL, measured on
 * PostgreSQL 18.4 — including the merged form, which is the reason this works
 * per clause rather than per statement.
 */
import {
    parseExcludePatterns,
    stripCarvedOutStatements
} from "../src/schema/carved-out-migration";

const SEARCH = ["public.talents.search_vector", "public.talents.talents_search_vector_gin"];

/**
 * The other carve-out. Vector leaves Atlas's sight for a different reason —
 * `VECTOR(n)` cannot be resolved in a dev database that can never have pgvector
 * — and arrives at exactly the same place: objects the migration directory
 * builds and `schema.sql` omits, so the diff plans a drop for them.
 */
const VECTOR = [
    "public.listing_observations.description_embedding",
    "public.listing_observations.listing_observations_description_embedding_hnsw_cosine"
];

describe("parseExcludePatterns", () => {
    it("takes apart the three-part form the CLI builds", () => {
        expect(parseExcludePatterns(SEARCH)).toEqual([
            { schema: "public", table: "talents", object: "search_vector" },
            { schema: "public", table: "talents", object: "talents_search_vector_gin" }
        ]);
    });

    it("ignores the two-part form rather than guessing at it", () => {
        // Atlas reads `talents.search_vector` as a table in a schema and
        // matches nothing; guessing the other way here would be worse.
        expect(parseExcludePatterns(["talents.search_vector"])).toEqual([]);
        expect(parseExcludePatterns(["search_vector"])).toEqual([]);
        expect(parseExcludePatterns(["public..search_vector"])).toEqual([]);
    });
});

describe("the drop Atlas plans for a carved-out column", () => {
    it("goes, with the caption Atlas wrote above it", () => {
        const migration = '-- Modify "talents" table\nALTER TABLE "public"."talents" DROP COLUMN "search_vector";\n';
        const result = stripCarvedOutStatements(migration, SEARCH);
        expect(result.removed).toHaveLength(1);
        expect(result.empty).toBe(true);
        expect(result.sql.trim()).toBe("");
        expect(result.unhandled).toEqual([]);
    });

    it("goes clause by clause, leaving the real changes in the same statement alone", () => {
        // Atlas folds every change to one table into one statement. Dropping
        // the whole statement would throw away a migration that was asked for.
        const migration =
            '-- Modify "talents" table\n' +
            'ALTER TABLE "public"."talents" DROP COLUMN "search_vector", DROP COLUMN "interests", ADD COLUMN "headline" text NULL;\n';
        const result = stripCarvedOutStatements(migration, SEARCH);
        expect(result.sql).toContain('DROP COLUMN "interests"');
        expect(result.sql).toContain('ADD COLUMN "headline" text NULL');
        expect(result.sql).not.toContain("search_vector");
        expect(result.empty).toBe(false);
        expect(result.sql).toContain('-- Modify "talents" table');
    });

    it("leaves a statement about another table completely untouched", () => {
        const migration =
            '-- Create "posts" table\n' +
            'CREATE TABLE "public"."posts" (\n  "id" uuid NOT NULL,\n  PRIMARY KEY ("id")\n);\n' +
            '-- Modify "talents" table\n' +
            'ALTER TABLE "public"."talents" DROP COLUMN "search_vector";\n';
        const result = stripCarvedOutStatements(migration, SEARCH);
        expect(result.sql).toContain('CREATE TABLE "public"."posts"');
        expect(result.sql).not.toContain("search_vector");
        expect(result.empty).toBe(false);
    });

    it("does not touch a same-named column on a table that was not carved out", () => {
        const migration = 'ALTER TABLE "public"."posts" DROP COLUMN "search_vector";\n';
        const result = stripCarvedOutStatements(migration, SEARCH);
        expect(result.removed).toEqual([]);
        expect(result.sql).toBe(migration);
    });

    it("does not touch the same table in another schema", () => {
        const migration = 'ALTER TABLE "tenant2"."talents" DROP COLUMN "search_vector";\n';
        expect(stripCarvedOutStatements(migration, SEARCH).removed).toEqual([]);
    });

    it("matches an unquoted identifier the way Postgres folds it", () => {
        const migration = "ALTER TABLE public.talents DROP COLUMN search_vector;\n";
        expect(stripCarvedOutStatements(migration, SEARCH).empty).toBe(true);
    });

    it("removes a standalone DROP INDEX for a carved-out index", () => {
        const migration = '-- Drop index\nDROP INDEX "public"."talents_search_vector_gin";\n';
        const result = stripCarvedOutStatements(migration, SEARCH);
        expect(result.removed).toHaveLength(1);
        expect(result.empty).toBe(true);
    });
});

describe("what it reports rather than rewrites", () => {
    // `unhandled` stops `db generate` outright, so it has to mean "a drop of
    // ours is still in this file" and nothing looser. A statement that merely
    // names the column is not a reason to refuse a migration.
    it("a drop it cannot rewrite stays in place and is reported", () => {
        const migration = 'ALTER TABLE "public"."talents" DROP CONSTRAINT "search_vector_present";\n';
        const result = stripCarvedOutStatements(migration, SEARCH);
        expect(result.sql).toBe(migration);
        expect(result.removed).toEqual([]);
        expect(result.unhandled).toHaveLength(1);
    });

    it("a near-miss on an index name is reported, not guessed at", () => {
        const migration = 'DROP INDEX "public"."talents_search_vector_gin_legacy";\n';
        const result = stripCarvedOutStatements(migration, SEARCH);
        expect(result.removed).toEqual([]);
        expect(result.unhandled).toHaveLength(1);
    });

    it("reports an unrewritable clause even while removing the drop beside it", () => {
        const migration =
            'ALTER TABLE "public"."talents" DROP COLUMN "search_vector", ' +
            'DROP CONSTRAINT "search_vector_present";\n';
        const result = stripCarvedOutStatements(migration, SEARCH);
        expect(result.removed).toHaveLength(1);
        expect(result.unhandled).toHaveLength(1);
        expect(result.sql).toContain('DROP CONSTRAINT "search_vector_present"');
    });

    it("a statement that only names the column destroys nothing, so it is silent", () => {
        // Reporting these would refuse migrations over a rename or a comment.
        for (const migration of [
            'ALTER TABLE "public"."talents" RENAME COLUMN "search_vector" TO "sv";\n',
            'COMMENT ON COLUMN "public"."talents"."search_vector" IS \'rebase:search:v1:8e39\';\n',
            'CREATE INDEX "talents_search_vector_gin" ON "public"."talents" USING GIN ("search_vector");\n'
        ]) {
            const result = stripCarvedOutStatements(migration, SEARCH);
            expect(result.unhandled).toEqual([]);
            expect(result.sql).toBe(migration);
        }
    });

    it("does nothing at all when no collection carved anything out", () => {
        const migration = 'ALTER TABLE "public"."talents" DROP COLUMN "search_vector";\n';
        const result = stripCarvedOutStatements(migration, []);
        expect(result.sql).toBe(migration);
        expect(result.removed).toEqual([]);
    });

    it("bails out whole rather than half-parse a script it cannot split", () => {
        // Unterminated quote: the offsets cannot be trusted, so nothing moves.
        const migration = 'ALTER TABLE "public"."talents" DROP COLUMN "search_vector;\n';
        const result = stripCarvedOutStatements(migration, SEARCH);
        expect(result.sql).toBe(migration);
        expect(result.removed).toEqual([]);
        expect(result.unhandled).toHaveLength(1);
    });
});

describe("the splitter survives what gets appended to migrations", () => {
    it("does not shred a dollar-quoted DO block", () => {
        // `search.sql` opens with a `DO $rebase_search$ ... $rebase_search$`
        // stamp guard whose body contains semicolons and a quoted `;`. A
        // splitter that ignores dollar quoting mistakes it for four statements
        // — the trap the derived-names renderer fell into.
        const migration =
            '-- Modify "talents" table\n' +
            'ALTER TABLE "public"."talents" DROP COLUMN "search_vector";\n\n' +
            "DO $rebase_search$\nDECLARE recorded text;\nBEGIN\n" +
            "    IF recorded <> 'rebase:search:v1:8e39' THEN\n" +
            "        RAISE EXCEPTION 'changed; drop the column';\n" +
            "    END IF;\nEND\n$rebase_search$;\n";
        const result = stripCarvedOutStatements(migration, SEARCH);
        expect(result.sql).toContain("$rebase_search$");
        expect(result.sql).toContain("RAISE EXCEPTION 'changed; drop the column'");
        expect(result.sql).not.toContain('DROP COLUMN "search_vector"');
        expect(result.unhandled).toEqual([]);
        expect(result.empty).toBe(false);
    });

    it("keeps a semicolon inside a string literal out of the statement split", () => {
        const migration =
            'COMMENT ON TABLE "public"."talents" IS \'one; two\';\n' +
            'ALTER TABLE "public"."talents" DROP COLUMN "search_vector";\n';
        const result = stripCarvedOutStatements(migration, SEARCH);
        expect(result.sql).toContain("'one; two'");
        expect(result.sql).not.toContain("search_vector");
    });

    it("keeps a comma inside parentheses out of the clause split", () => {
        const migration =
            'ALTER TABLE "public"."talents" DROP COLUMN "search_vector", ' +
            'ADD COLUMN "score" numeric(10, 2) NULL;\n';
        const result = stripCarvedOutStatements(migration, SEARCH);
        expect(result.sql).toContain('ADD COLUMN "score" numeric(10, 2) NULL');
        expect(result.sql).not.toContain("search_vector");
        expect(result.unhandled).toEqual([]);
    });
});

describe("what the caller does with the answer", () => {
    it("`empty` is what says the migration file should be deleted rather than kept", () => {
        // An empty migration is worse than none: it takes a slot in the
        // revision history and the caller would append the search DDL and the
        // policies to it.
        const onlyTheSpuriousDrop =
            '-- Modify "talents" table\nALTER TABLE "public"."talents" DROP COLUMN "search_vector";\n';
        expect(stripCarvedOutStatements(onlyTheSpuriousDrop, SEARCH).empty).toBe(true);

        const alsoSomethingReal =
            '-- Modify "talents" table\n' +
            'ALTER TABLE "public"."talents" DROP COLUMN "search_vector", ADD COLUMN "headline" text NULL;\n';
        expect(stripCarvedOutStatements(alsoSomethingReal, SEARCH).empty).toBe(false);
    });

    it("is idempotent — a file already stripped comes back unchanged", () => {
        const once = stripCarvedOutStatements(
            'ALTER TABLE "public"."talents" DROP COLUMN "search_vector", ADD COLUMN "headline" text NULL;\n',
            SEARCH
        );
        const twice = stripCarvedOutStatements(once.sql, SEARCH);
        expect(twice.sql).toBe(once.sql);
        expect(twice.removed).toEqual([]);
    });

    it("leaves output Postgres still accepts", () => {
        const result = stripCarvedOutStatements(
            '-- Modify "talents" table\n' +
            'ALTER TABLE "public"."talents" DROP COLUMN "search_vector", DROP COLUMN "interests", ADD COLUMN "headline" text NULL;\n',
            SEARCH
        );
        expect(result.sql).toBe(
            '-- Modify "talents" table\n' +
            'ALTER TABLE "public"."talents" DROP COLUMN "interests", ADD COLUMN "headline" text NULL;\n'
        );
    });
});

describe("the vector carve-out goes through the same door", () => {
    /**
     * Search and vector are excluded from Atlas for different reasons — a
     * function its free tier will not parse, and a type its dev database cannot
     * have — and the consequence on the diff path is one consequence. This
     * module was written for search; these pin that the vector patterns the CLI
     * now also passes reach it and are handled, so nobody has to discover the
     * two are the same problem twice.
     */
    it("removes the drop Atlas plans for an embedding column", () => {
        const migration =
            '-- Modify "listing_observations" table\n' +
            'ALTER TABLE "public"."listing_observations" DROP COLUMN "description_embedding";\n';
        const result = stripCarvedOutStatements(migration, VECTOR);
        expect(result.removed).toHaveLength(1);
        expect(result.empty).toBe(true);
        expect(result.unhandled).toEqual([]);
    });

    it("keeps a real column added in the same statement", () => {
        // Captured from `atlas migrate diff` 1.3.2: the phantom drop and a new
        // ordinary column arrive folded together.
        const result = stripCarvedOutStatements(
            '-- Modify "listing_observations" table\n' +
            'ALTER TABLE "public"."listing_observations" DROP COLUMN "description_embedding", ADD COLUMN "neighbourhood" text NULL;\n',
            VECTOR
        );
        expect(result.sql).toContain('ADD COLUMN "neighbourhood" text NULL');
        expect(result.sql).not.toContain("DROP COLUMN");
        expect(result.empty).toBe(false);
    });

    it("removes a standalone drop of the ANN index", () => {
        const result = stripCarvedOutStatements(
            'DROP INDEX "public"."listing_observations_description_embedding_hnsw_cosine";\n',
            VECTOR
        );
        expect(result.removed).toHaveLength(1);
        expect(result.empty).toBe(true);
    });

    it("handles both carve-outs in one migration, which is what the CLI passes", () => {
        // `stripCarvedOutFromNewestMigration` concatenates the search and
        // vector patterns into one list. A project with both gets one pass.
        const result = stripCarvedOutStatements(
            'ALTER TABLE "public"."talents" DROP COLUMN "search_vector";\n' +
            'ALTER TABLE "public"."listing_observations" DROP COLUMN "description_embedding", ADD COLUMN "neighbourhood" text NULL;\n',
            [...SEARCH, ...VECTOR]
        );
        expect(result.removed).toHaveLength(2);
        expect(result.unhandled).toEqual([]);
        expect(result.sql).toContain('ADD COLUMN "neighbourhood" text NULL');
        expect(result.sql).not.toContain("search_vector");
        expect(result.empty).toBe(false);
    });

    it("does not touch a vector column on a table nobody carved out", () => {
        const migration = 'ALTER TABLE "public"."other" DROP COLUMN "description_embedding";\n';
        const result = stripCarvedOutStatements(migration, VECTOR);
        expect(result.removed).toEqual([]);
        expect(result.sql).toBe(migration);
    });

    /**
     * `vector.sql` opens with `CREATE EXTENSION` and carries a
     * `DO $rebase_vector$` guard, and it is appended to migrations. A pass over
     * an already-appended file must leave both alone — the guard's body mentions
     * the column, and shredding the dollar-quoted block is exactly how the
     * derived-names renderer broke.
     */
    it("leaves the appended vector DDL alone, guard block and all", () => {
        const appended =
            "CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;\n" +
            "DO $rebase_vector$\nDECLARE actual int;\nBEGIN\n" +
            "    IF actual <> 384 THEN\n" +
            "        RAISE EXCEPTION 'declares 384; ALTER TABLE x ALTER COLUMN \"description_embedding\" TYPE VECTOR(384);';\n" +
            "    END IF;\nEND\n$rebase_vector$;\n" +
            'ALTER TABLE "public"."listing_observations" ADD COLUMN IF NOT EXISTS "description_embedding" VECTOR(384);\n';
        const result = stripCarvedOutStatements(appended, VECTOR);
        expect(result.removed).toEqual([]);
        expect(result.unhandled).toEqual([]);
        expect(result.sql).toBe(appended);
    });
});
