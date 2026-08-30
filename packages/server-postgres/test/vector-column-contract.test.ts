/**
 * A `{ type: "vector" }` property is Rebase's to apply, not Atlas's.
 *
 * `rebase db push` hands Atlas a desired state and Atlas computes the diff by
 * *materialising* that state in a dev database. The dev database is created
 * empty, and Atlas empties it again at the start of every run — measured, with
 * the extension present before the run and gone after — so `VECTOR(384)` is
 * resolved against a database that structurally cannot have pgvector. Every
 * push for every project declaring a vector died with
 *
 *   drizzle/schema.sql:146: pq: type "vector" does not exist
 *
 * and there was no way past it from userland: seeding the dev database does not
 * survive the clean, `CREATE EXTENSION` in the desired state is refused as an
 * Atlas Pro feature, an extension in a non-`public` schema makes the dev
 * database "not clean", and `--exclude` filters the diff *after* the file has
 * already been parsed and applied.
 *
 * So the column, its ANN indexes and the extension leave `schema.sql` and land
 * in `vector.sql`, which the CLI applies itself — the arrangement search
 * already had, for its own reasons.
 *
 * What this file pins is the split: nothing vector-shaped in what Atlas sees,
 * everything vector-shaped in the file Rebase applies, and the same names on
 * both sides so the exclude list and the DDL cannot drift apart.
 */
import { CollectionConfig, PostgresCollectionConfig } from "@rebasepro/types";
import {
    generatePostgresDdl,
    generatePostgresVectorDdl,
    resolveColumnName,
    vectorExcludePatterns
} from "../src/schema/generate-postgres-ddl-logic";
import { planCollectionSchemaEnsure } from "../src/schema/ensure-collection-tables";
import {
    buildVectorColumnSpecs,
    buildVectorIndexPlan,
    vectorIndexNames
} from "../src/schema/vector-index";

const collection: PostgresCollectionConfig = {
    slug: "listing_observations",
    table: "listing_observations",
    name: "Listing observations",
    properties: {
        id: { type: "string", isId: "uuid" },
        title: { type: "string" },
        descriptionEmbedding: {
            name: "Description embedding",
            type: "vector",
            dimensions: 384,
            columnName: "description_embedding"
        }
    }
};

const collections: CollectionConfig[] = [collection];
const indexName = vectorIndexNames(buildVectorIndexPlan(collection, resolveColumnName))[0];

const noVectors: CollectionConfig[] = [{
    slug: "posts",
    table: "posts",
    name: "Posts",
    properties: { id: { type: "string", isId: "uuid" }, title: { type: "string" } }
}];

const carvedOut = { includePolicies: false, includeSearch: false, includeVector: false } as const;

describe("what Atlas is shown", () => {
    it("carries no VECTOR type, so the dev database is never asked for one", async () => {
        const ddl = await generatePostgresDdl(collections, carvedOut);
        expect(ddl).not.toMatch(/VECTOR\s*\(/i);
        expect(ddl).not.toContain("description_embedding");
    });

    it("carries no ANN index either — it names a column that is no longer there", async () => {
        const ddl = await generatePostgresDdl(collections, carvedOut);
        expect(ddl).not.toContain(indexName);
        expect(ddl).not.toMatch(/USING (hnsw|ivfflat)/i);
    });

    it("never carries CREATE EXTENSION, which Atlas refuses as a paid feature", async () => {
        const ddl = await generatePostgresDdl(collections, carvedOut);
        expect(ddl).not.toMatch(/CREATE\s+EXTENSION/i);
    });

    it("still builds the table, and every column that is not a vector", async () => {
        const ddl = await generatePostgresDdl(collections, carvedOut);
        expect(ddl).toContain(`CREATE TABLE "public"."listing_observations"`);
        expect(ddl).toContain(`"title"`);
    });

    /**
     * The carve-out is a *choice made by the caller*, not a property of the
     * generator. `contracts/derived-names.txt` renders the full surface, and
     * the runtime introspection paths read the same function — so a default
     * that silently dropped vector columns would make the contract lie about
     * what a database is supposed to contain.
     */
    it("includes the column when the caller does not ask for the carve-out", async () => {
        const ddl = await generatePostgresDdl(collections, { includePolicies: false });
        expect(ddl).toContain(`"description_embedding" VECTOR(384)`);
        expect(ddl).toContain(indexName);
    });
});

describe("installing pgvector is opt-in", () => {
    /**
     * The permission is `database({ extensions: ["vector"] })`. It exists
     * because none of what makes the install possible — the image carrying the
     * library, the role's grant, a managed provider's allow-list — is visible
     * from inside the connection, so it is not Rebase's call to make.
     */
    it("issues no CREATE EXTENSION when no database declared one", () => {
        expect(generatePostgresVectorDdl(collections)).not.toMatch(/CREATE\s+EXTENSION/i);
    });

    it("says why it did not, where someone chasing the failure will read it", () => {
        // "No CREATE EXTENSION here" is invisible unless it is written down,
        // and the reader of this file is looking for exactly that absence.
        const sql = generatePostgresVectorDdl(collections);
        expect(sql).toContain('database({ extensions: ["vector"] })');
        expect(sql).toContain("config/resources.ts");
    });

    it("still creates the column and its index — the opt-in is about the install", () => {
        // A database that already has pgvector, installed by hand, needs
        // nobody's permission. Withholding the column there would break a
        // working project to enforce a formality.
        const sql = generatePostgresVectorDdl(collections);
        expect(sql).toContain(`ADD COLUMN IF NOT EXISTS "description_embedding" VECTOR(384)`);
        expect(sql).toContain(indexName);
    });

    it("issues it when a database declared it", () => {
        const sql = generatePostgresVectorDdl(collections, { extensions: ["vector"] });
        const extension = sql.indexOf("CREATE EXTENSION IF NOT EXISTS vector");
        const column = sql.indexOf("ADD COLUMN IF NOT EXISTS");
        expect(extension).toBeGreaterThanOrEqual(0);
        expect(column).toBeGreaterThan(extension);
    });

    it("installs it into public, where an unqualified VECTOR(n) resolves", () => {
        // `"$user", public` is the default search_path and the scaffold's role
        // is named `rebase` — the same as a schema the generator creates. An
        // unqualified CREATE EXTENSION would land there instead. Same trap
        // `searchExtensionStatements` documents for unaccent.
        expect(generatePostgresVectorDdl(collections, { extensions: ["vector"] }))
            .toContain("CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;");
    });

    it("is not fooled by a database that declared some other extension", () => {
        expect(generatePostgresVectorDdl(collections, { extensions: ["postgis", "pg_cron"] }))
            .not.toMatch(/CREATE\s+EXTENSION/i);
    });
});

describe("the file Rebase applies", () => {
    it("adds the column rather than defining it inline — the table already exists", () => {
        const sql = generatePostgresVectorDdl(collections);
        expect(sql).toContain(
            `ALTER TABLE "public"."listing_observations" ADD COLUMN IF NOT EXISTS "description_embedding" VECTOR(384);`
        );
        expect(sql).not.toContain("CREATE TABLE");
    });

    it("creates the ANN index the property asked for", () => {
        expect(generatePostgresVectorDdl(collections)).toContain(`CREATE INDEX IF NOT EXISTS "${indexName}"`);
    });

    it("tolerates already being there — it is replayed on every push", () => {
        const sql = generatePostgresVectorDdl(collections, { extensions: ["vector"] });
        for (const line of sql.split("\n").filter(l => /^(CREATE|ALTER TABLE)/.test(l))) {
            expect(line).toMatch(/IF NOT EXISTS/i);
        }
    });

    it("writes nothing when no collection declares a vector", () => {
        expect(generatePostgresVectorDdl(noVectors)).toBe("");
    });

    /**
     * A column too wide for pgvector to index is still a column. The index is
     * what is skipped, and the reason is written down — see
     * `MAX_INDEXABLE_VECTOR_DIMENSIONS`.
     */
    it("still adds the column for a vector too wide to index", () => {
        const wide: CollectionConfig[] = [{
            ...collection,
            properties: {
                ...collection.properties,
                descriptionEmbedding: {
                    type: "vector",
                    dimensions: 3072,
                    columnName: "description_embedding"
                }
            }
        }];
        const sql = generatePostgresVectorDdl(wide);
        expect(sql).toContain(`ADD COLUMN IF NOT EXISTS "description_embedding" VECTOR(3072)`);
        expect(sql).not.toMatch(/USING hnsw/i);
        expect(sql).toMatch(/-- No ANN index on/);
    });

    it("adds the column for a property that opted out of indexing", () => {
        const unindexed: CollectionConfig[] = [{
            ...collection,
            properties: {
                ...collection.properties,
                descriptionEmbedding: {
                    type: "vector",
                    dimensions: 384,
                    index: false,
                    columnName: "description_embedding"
                }
            }
        }];
        const sql = generatePostgresVectorDdl(unindexed);
        expect(sql).toContain(`ADD COLUMN IF NOT EXISTS "description_embedding" VECTOR(384)`);
        expect(sql).not.toMatch(/USING (hnsw|ivfflat)/i);
    });

    /**
     * `ADD COLUMN IF NOT EXISTS` is a no-op against a column that exists, so
     * without a guard the file would report success and leave a 384-wide column
     * behind a config that now says 768 — the change laundered, and the failure
     * deferred to an insert that names a row rather than the property. Atlas
     * used to catch this because it owned the column.
     */
    it("guards a changed `dimensions` rather than skipping over it", () => {
        const sql = generatePostgresVectorDdl(collections);
        expect(sql).toContain("DO $rebase_vector$");
        expect(sql).toMatch(/atttypmod/);
        expect(sql).toContain("RAISE EXCEPTION");
        // Widening is performed when the column is empty — the case Atlas
        // handled — and refused when it is not.
        expect(sql).toContain(
            `ALTER TABLE "public"."listing_observations" ALTER COLUMN "description_embedding" TYPE VECTOR(384);`
        );
        expect(sql.indexOf("DO $rebase_vector$")).toBeLessThan(sql.indexOf("ADD COLUMN IF NOT EXISTS"));
    });

    it("carries the column's own constraints, since Atlas no longer can", () => {
        const constrained: CollectionConfig[] = [{
            ...collection,
            properties: {
                ...collection.properties,
                descriptionEmbedding: {
                    type: "vector",
                    dimensions: 384,
                    columnName: "description_embedding",
                    validation: { required: true, unique: true }
                }
            }
        }];
        expect(generatePostgresVectorDdl(constrained)).toContain(
            `ADD COLUMN IF NOT EXISTS "description_embedding" VECTOR(384) UNIQUE NOT NULL;`
        );
    });
});

describe("vectorExcludePatterns — what Atlas is told to keep its hands off", () => {
    /**
     * Atlas takes the schema from the pattern's first segment. The two-part
     * form is read as a *table* in a *schema* of that name, matches nothing,
     * and reports no error — so the push plans the `DROP COLUMN` the exclude
     * existed to prevent. Same trap `searchExcludePatterns` documents.
     */
    it("qualifies every pattern with the schema", () => {
        const patterns = vectorExcludePatterns(collections);
        expect(patterns.length).toBeGreaterThan(0);
        for (const pattern of patterns) {
            expect(pattern.split(".")).toHaveLength(3);
            expect(pattern.startsWith("public.")).toBe(true);
        }
    });

    it("covers the column and the index — both are absent from the desired state", () => {
        const patterns = vectorExcludePatterns(collections);
        expect(patterns).toContain("public.listing_observations.description_embedding");
        expect(patterns).toContain(`public.listing_observations.${indexName}`);
    });

    it("covers a column that has no index of its own", () => {
        const unindexed: CollectionConfig[] = [{
            ...collection,
            properties: {
                ...collection.properties,
                descriptionEmbedding: { type: "vector", dimensions: 384, index: false, columnName: "description_embedding" }
            }
        }];
        expect(vectorExcludePatterns(unindexed))
            .toEqual(["public.listing_observations.description_embedding"]);
    });

    it("is empty for a project that never opted in, so nothing changes for it", () => {
        expect(vectorExcludePatterns(noVectors)).toEqual([]);
    });

    it("excludes exactly the objects vector.sql creates, and nothing else", () => {
        // The two lists are built independently. If one grows an object the
        // other does not know about, Atlas drops it on the next push.
        const sql = generatePostgresVectorDdl(collections);
        for (const pattern of vectorExcludePatterns(collections)) {
            expect(sql).toContain(pattern.split(".")[2]);
        }
    });
});

describe("boot provisions what the push provisions", () => {
    const emptyDb = {
        tables: new Map<string, Set<string>>(),
        enums: new Set<string>(),
        constraints: new Set<string>()
    };

    const optedIn = { databaseExtensions: ["vector"] } as const;

    it("installs pgvector at boot too — the managed runtime never runs a push", () => {
        const actions = planCollectionSchemaEnsure(collections, emptyDb, optedIn).actions;
        expect(actions.some(a =>
            a.kind === "create-extension" && /CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;/.test(a.sql)
        )).toBe(true);
    });

    /**
     * The rule `contracts/derived-names.txt` states: boot and push compile the
     * same collections and must describe the same database. An opt-in only one
     * of them honoured would make the schema depend on which command ran first.
     */
    it("refuses at boot exactly where the push refuses — no declaration, no install", () => {
        const planned = planCollectionSchemaEnsure(collections, emptyDb).actions
            .filter(a => a.kind === "create-extension" && a.sql.includes(" vector"));
        expect(planned).toEqual([]);
        expect(generatePostgresVectorDdl(collections)).not.toMatch(/CREATE\s+EXTENSION/i);
    });

    it("plans the extension before the table that needs the type", () => {
        const actions = planCollectionSchemaEnsure(collections, emptyDb, optedIn).actions;
        const extension = actions.findIndex(a => a.kind === "create-extension" && a.sql.includes("vector"));
        const table = actions.findIndex(a => a.kind === "create-table");
        expect(extension).toBeGreaterThanOrEqual(0);
        expect(table).toBeGreaterThan(extension);
    });

    it("plans it once, however many collections declare a vector", () => {
        const two: CollectionConfig[] = [
            collection,
            { ...collection, slug: "other_observations", table: "other_observations" } as CollectionConfig
        ];
        const planned = planCollectionSchemaEnsure(two, emptyDb, optedIn).actions
            .filter(a => a.kind === "create-extension" && a.sql.includes("vector"));
        expect(planned).toHaveLength(1);
    });

    it("plans no extension for a project with no vector property, opted in or not", () => {
        // The declaration is a permission, not a request: it says Rebase *may*
        // install pgvector, and Rebase installs it only where the schema needs
        // it. A project that names it and stores no embeddings gets nothing.
        for (const options of [undefined, optedIn]) {
            const planned = planCollectionSchemaEnsure(noVectors, emptyDb, options).actions
                .filter(a => a.kind === "create-extension" && a.sql.includes(" vector"));
            expect(planned).toEqual([]);
        }
    });

    it("still installs the search extensions unasked — those need no permission", () => {
        // pg_trgm and unaccent are contrib modules present in every Postgres
        // distribution, so there is no image, grant or allow-list to check.
        const searchable = [{
            ...collection,
            // `unaccent` is what makes a search block need an extension at all;
            // a plain one needs none. See `buildSearchColumnSpec`.
            search: { fields: ["title"], unaccent: true }
        }] as unknown as CollectionConfig[];
        const planned = planCollectionSchemaEnsure(searchable, emptyDb).actions
            .filter(a => a.kind === "create-extension");
        expect(planned.length).toBeGreaterThan(0);
        expect(planned.every(a => !a.sql.includes(" vector"))).toBe(true);
    });

    it("names the same column both producers name", () => {
        const [spec] = buildVectorColumnSpecs(collection, resolveColumnName);
        const boot = planCollectionSchemaEnsure(collections, emptyDb).actions
            .find(a => a.sql.includes(`"${spec.column}"`) && a.sql.includes("ADD COLUMN"));
        expect(boot).toBeDefined();
        expect(generatePostgresVectorDdl(collections)).toContain(`"${spec.column}" VECTOR(${spec.dimensions})`);
    });
});
