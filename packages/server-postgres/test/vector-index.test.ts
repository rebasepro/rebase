/**
 * ANN indexes for vector columns, and the agreement between the two producers.
 *
 * The important assertions here are not that the SQL parses. They are:
 *
 *  - the indexed distance defaults to the one `vectorSearch` measures with, so
 *    the default index is actually used by the default query;
 *  - `rebase db push` and the boot-time ensure name the same index, because
 *    `contracts/derived-names.txt` records one name per identifier and a
 *    database in the field carries whichever one created it;
 *  - a column too wide for pgvector is skipped rather than thrown, and says so.
 */
import { CollectionConfig, PostgresCollectionConfig } from "@rebasepro/types";
import {
    buildVectorIndexPlan,
    vectorIndexStatement,
    vectorIndexStatements,
    vectorIndexNames,
    VectorIndexConfigError,
    MAX_INDEXABLE_VECTOR_DIMENSIONS
} from "../src/schema/vector-index";
import { generatePostgresDdl, resolveColumnName } from "../src/schema/generate-postgres-ddl-logic";
import { planCollectionSchemaEnsure } from "../src/schema/ensure-collection-tables";

const collection = (properties: Record<string, unknown>, extra: Record<string, unknown> = {}): CollectionConfig =>
    ({
        slug: "documents",
        name: "Documents",
        properties: {
            id: { type: "string", name: "Id", isId: true },
            ...properties
        },
        ...extra
    }) as unknown as CollectionConfig;

const vector = (over: Record<string, unknown> = {}) =>
    ({ type: "vector", name: "Embedding", dimensions: 1536, ...over });

const plan = (c: CollectionConfig) => buildVectorIndexPlan(c, resolveColumnName);

describe("buildVectorIndexPlan", () => {
    it("indexes cosine by default, because that is what vectorSearch defaults to", () => {
        const { specs, skipped } = plan(collection({ embedding: vector() }));
        expect(skipped).toEqual([]);
        expect(specs).toHaveLength(1);
        expect(specs[0]).toMatchObject({
            schema: "public",
            table: "documents",
            column: "embedding",
            method: "hnsw",
            distance: "cosine",
            operatorClass: "vector_cosine_ops",
            parameters: []
        });
    });

    it("renders a CREATE INDEX without a WITH clause when nothing is tuned", () => {
        const [spec] = plan(collection({ embedding: vector() })).specs;
        expect(vectorIndexStatement(spec)).toBe(
            'CREATE INDEX IF NOT EXISTS "documents_embedding_hnsw_cosine" ON "public"."documents" ' +
            'USING hnsw ("embedding" vector_cosine_ops);'
        );
    });

    it("carries HNSW tuning into WITH", () => {
        const [spec] = plan(collection({
            embedding: vector({ index: { m: 24, efConstruction: 128 } })
        })).specs;
        expect(vectorIndexStatement(spec)).toContain("WITH (m = 24, ef_construction = 128)");
    });

    it("carries IVFFlat lists into WITH", () => {
        const [spec] = plan(collection({
            embedding: vector({ index: { method: "ivfflat", lists: 200 } })
        })).specs;
        expect(vectorIndexStatement(spec)).toBe(
            'CREATE INDEX IF NOT EXISTS "documents_embedding_ivfflat_cosine" ON "public"."documents" ' +
            'USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 200);'
        );
    });

    it("builds one index per named distance, each with its own operator class", () => {
        const { specs } = plan(collection({
            embedding: vector({ index: { distance: ["cosine", "l2", "inner_product"] } })
        }));
        expect(specs.map(s => [s.distance, s.operatorClass, s.indexName])).toEqual([
            ["cosine", "vector_cosine_ops", "documents_embedding_hnsw_cosine"],
            ["l2", "vector_l2_ops", "documents_embedding_hnsw_l2"],
            ["inner_product", "vector_ip_ops", "documents_embedding_hnsw_ip"]
        ]);
    });

    it("creates nothing when the property opts out", () => {
        expect(plan(collection({ embedding: vector({ index: false }) })).specs).toEqual([]);
    });

    it("honours an explicit columnName and a non-public schema", () => {
        const c = collection(
            { embedding: vector({ columnName: "vec" }) },
            { schema: "app" }
        ) as PostgresCollectionConfig;
        const [spec] = plan(c as CollectionConfig).specs;
        expect(spec.column).toBe("vec");
        expect(spec.schema).toBe("app");
        expect(spec.indexName).toBe("documents_vec_hnsw_cosine");
    });

    it("ignores non-vector properties", () => {
        expect(plan(collection({ title: { type: "string", name: "Title" } })).specs).toEqual([]);
    });
});

describe("dimensions beyond what pgvector can index", () => {
    const wide = collection({ embedding: vector({ dimensions: 3072 }) });

    it("skips the index instead of failing the boot", () => {
        const { specs, skipped } = plan(wide);
        expect(specs).toEqual([]);
        expect(skipped).toHaveLength(1);
        expect(skipped[0]).toMatchObject({ table: "documents", column: "embedding", dimensions: 3072 });
    });

    it("says why, and names the limit", () => {
        const [skip] = plan(wide).skipped;
        expect(skip.reason).toContain(String(MAX_INDEXABLE_VECTOR_DIMENSIONS));
        expect(skip.reason).toContain("exact scan");
    });

    it("indexes exactly at the limit", () => {
        const atLimit = collection({ embedding: vector({ dimensions: MAX_INDEXABLE_VECTOR_DIMENSIONS }) });
        expect(plan(atLimit).specs).toHaveLength(1);
        expect(plan(atLimit).skipped).toEqual([]);
    });
});

describe("configuration errors are refused, not ignored", () => {
    const fails = (index: unknown, fragment: string) => {
        expect(() => plan(collection({ embedding: vector({ index }) })))
            .toThrow(VectorIndexConfigError);
        expect(() => plan(collection({ embedding: vector({ index }) })))
            .toThrow(fragment);
    };

    it("rejects lists on an HNSW index rather than silently dropping it", () =>
        fails({ lists: 100 }, 'only applies to `method: "ivfflat"`'));

    it("rejects m on an IVFFlat index", () =>
        fails({ method: "ivfflat", m: 16 }, 'only applies to `method: "hnsw"`'));

    it("rejects an unknown method", () =>
        fails({ method: "brute" }, 'Use "hnsw" or "ivfflat"'));

    it("rejects an unknown distance", () =>
        fails({ distance: "manhattan" }, "not a pgvector distance"));

    it("rejects a duplicated distance, which would collide on the index name", () =>
        fails({ distance: ["cosine", "cosine"] }, 'lists "cosine" twice'));

    it("rejects an empty distance list", () =>
        fails({ distance: [] }, "empty array"));

    it("rejects a non-integer m", () =>
        fails({ m: 1.5 }, "positive integer"));

    it("rejects dimensions that are not a positive integer", () => {
        expect(() => plan(collection({ embedding: vector({ dimensions: 0 }) })))
            .toThrow("must be a positive integer");
    });
});

describe("the two producers describe the same index", () => {
    const c = collection({ embedding: vector({ index: { distance: ["cosine", "l2"] } }) });

    it("db push emits every statement the plan names", async () => {
        const ddl = await generatePostgresDdl([c]);
        for (const statement of vectorIndexStatements(plan(c))) {
            expect(ddl).toContain(statement);
        }
    });

    it("boot plans the same names, in the concurrent form", () => {
        const ensure = planCollectionSchemaEnsure([c], { tables: new Map(), enums: new Set() });
        const indexSql = ensure.actions
            .filter(a => a.kind === "create-index")
            .map(a => a.sql);

        for (const name of vectorIndexNames(plan(c))) {
            const statement = indexSql.find(sql => sql.includes(`"${name}"`));
            expect(statement).toBeDefined();
            expect(statement).toContain("CREATE INDEX CONCURRENTLY IF NOT EXISTS");
        }
    });

    it("boot reports a skipped column instead of planning an index for it", () => {
        const wide = collection({ embedding: vector({ dimensions: 4096 }) });
        const ensure = planCollectionSchemaEnsure([wide], { tables: new Map(), enums: new Set() });
        expect(ensure.actions.filter(a => a.kind === "create-index" && a.sql.includes("hnsw"))).toEqual([]);
        expect(ensure.vectorIndexSkipped).toHaveLength(1);
        expect(ensure.vectorIndexSkipped[0].column).toBe("embedding");
    });

    it("db push records the skip as a comment rather than saying nothing", async () => {
        const ddl = await generatePostgresDdl([collection({ embedding: vector({ dimensions: 4096 }) })]);
        expect(ddl).toContain("-- No ANN index on");
        expect(ddl).not.toContain("USING hnsw");
    });
});
