/**
 * The one place a `{ type: "vector" }` property becomes an ANN index.
 *
 * Without an index, pgvector answers `ORDER BY embedding <=> $1` by computing
 * the distance to every row and sorting — exact, and linear. That is the right
 * answer at ten thousand rows and the wrong one at a million, which is why the
 * default here is to build an index rather than to leave the column bare.
 *
 * ## The operator class is not a detail
 *
 * An index is built for exactly one operator class, and the planner uses it
 * only for the operator that class implements. `vector_cosine_ops` answers
 * `<=>` and nothing else; a query asking for `<->` against a cosine index gets
 * a sequential scan and no error. So the default indexed distance here is
 * `cosine`, because `cosine` is what `vectorSearch` measures with when the
 * caller does not say — see `DrizzleConditionBuilder.buildVectorSearch`. The
 * two defaults have to agree, and this comment is the reason they do.
 *
 * ## Why 2000 dimensions is a ceiling and not an error
 *
 * pgvector cannot index a `vector` wider than 2000 dimensions with either
 * method. A 3072-dimension embedding (`text-embedding-3-large`) is therefore
 * storable and searchable but not indexable. Refusing the boot over that would
 * make a working configuration unbootable; silently indexing it is impossible.
 * So the column is created, the index is skipped, and the reason is reported.
 *
 * Like `search-column.ts`, this module exists so that the DDL generator and the
 * boot-time ensure render the *same* specification rather than describing the
 * same index twice, differently. `contracts/derived-names.txt` records the
 * names both produce, and CI fails if they diverge.
 */
import type { CollectionConfig, Property, VectorDistance, VectorIndexConfig } from "@rebasepro/types";
import { isPostgresCollectionConfig } from "@rebasepro/types";
import { getTableName } from "@rebasepro/common";
import { toPostgresIdentifier } from "@rebasepro/utils";

/**
 * The widest `vector` pgvector will build an HNSW or IVFFlat index over.
 * Storage and exact search are unaffected by this limit.
 */
export const MAX_INDEXABLE_VECTOR_DIMENSIONS = 2000;

/** The distance indexed when a property does not name one. */
export const DEFAULT_VECTOR_DISTANCE: VectorDistance = "cosine";

/** The index method used when a property does not name one. */
export const DEFAULT_VECTOR_INDEX_METHOD = "hnsw" as const;

/**
 * Operator class per distance. These strings are part of the database contract:
 * they appear in `CREATE INDEX`, so renaming one renames an index.
 */
const OPERATOR_CLASS: Record<VectorDistance, string> = {
    cosine: "vector_cosine_ops",
    l2: "vector_l2_ops",
    inner_product: "vector_ip_ops"
};

/** Short, stable tag per distance, used to name the index. */
const DISTANCE_TAG: Record<VectorDistance, string> = {
    cosine: "cosine",
    l2: "l2",
    inner_product: "ip"
};

export interface VectorIndexSpec {
    schema: string;
    table: string;
    column: string;
    indexName: string;
    method: "hnsw" | "ivfflat";
    distance: VectorDistance;
    operatorClass: string;
    /** Rendered into `WITH (...)`; empty when every parameter is defaulted. */
    parameters: Array<[string, number]>;
}

/** A vector column that will not be indexed, and why. */
export interface SkippedVectorIndex {
    schema: string;
    table: string;
    column: string;
    dimensions: number;
    reason: string;
}

export interface VectorIndexPlan {
    specs: VectorIndexSpec[];
    skipped: SkippedVectorIndex[];
}

export class VectorIndexConfigError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "VectorIndexConfigError";
    }
}

const isVectorProperty = (prop: unknown): prop is Property & {
    type: "vector";
    dimensions: number;
    index?: VectorIndexConfig | false;
} => !!prop && typeof prop === "object" && (prop as { type?: string }).type === "vector";

const asDistances = (config: VectorIndexConfig, label: string): VectorDistance[] => {
    const raw = config.distance ?? DEFAULT_VECTOR_DISTANCE;
    const list = Array.isArray(raw) ? raw : [raw];
    if (list.length === 0) {
        throw new VectorIndexConfigError(
            `${label}: \`index.distance\` is an empty array. Name at least one distance, or set \`index: false\` to create no index.`
        );
    }
    const seen = new Set<VectorDistance>();
    for (const distance of list) {
        if (!(distance in OPERATOR_CLASS)) {
            throw new VectorIndexConfigError(
                `${label}: \`index.distance\` is "${distance}", which is not a pgvector distance. Use ${Object.keys(OPERATOR_CLASS).map(d => `"${d}"`).join(", ")}.`
            );
        }
        if (seen.has(distance)) {
            throw new VectorIndexConfigError(`${label}: \`index.distance\` lists "${distance}" twice.`);
        }
        seen.add(distance);
    }
    return list;
};

const assertPositiveInteger = (value: number | undefined, key: string, label: string): void => {
    if (value === undefined) return;
    if (!Number.isInteger(value) || value <= 0) {
        throw new VectorIndexConfigError(
            `${label}: \`index.${key}\` is ${JSON.stringify(value)}. It must be a positive integer.`
        );
    }
};

/**
 * Index parameters for one method. Parameters belonging to the *other* method
 * are rejected rather than ignored, because a silently dropped `lists` on an
 * HNSW index reads, from the config, exactly like a tuned index.
 */
const parametersFor = (
    method: "hnsw" | "ivfflat",
    config: VectorIndexConfig,
    label: string
): Array<[string, number]> => {
    assertPositiveInteger(config.m, "m", label);
    assertPositiveInteger(config.efConstruction, "efConstruction", label);
    assertPositiveInteger(config.lists, "lists", label);

    if (method === "hnsw") {
        if (config.lists !== undefined) {
            throw new VectorIndexConfigError(
                `${label}: \`index.lists\` only applies to \`method: "ivfflat"\`. Remove it, or switch the method.`
            );
        }
        const params: Array<[string, number]> = [];
        if (config.m !== undefined) params.push(["m", config.m]);
        if (config.efConstruction !== undefined) params.push(["ef_construction", config.efConstruction]);
        return params;
    }

    for (const key of ["m", "efConstruction"] as const) {
        if (config[key] !== undefined) {
            throw new VectorIndexConfigError(
                `${label}: \`index.${key}\` only applies to \`method: "hnsw"\`. Remove it, or switch the method.`
            );
        }
    }
    return config.lists !== undefined ? [["lists", config.lists]] : [];
};

/**
 * Every ANN index a collection's vector properties call for.
 *
 * `resolveColumn` is passed in rather than imported so that this module stays
 * free of the DDL generator, which imports *it*. Both callers hand it the same
 * `resolveColumnName`, and a contract test asserts the names agree.
 */
export const buildVectorIndexPlan = (
    collection: CollectionConfig,
    resolveColumn: (propName: string, prop?: Property | null) => string
): VectorIndexPlan => {
    const specs: VectorIndexSpec[] = [];
    const skipped: SkippedVectorIndex[] = [];
    const properties = collection.properties ?? {};

    const table = getTableName(collection);
    const schema = isPostgresCollectionConfig(collection) && collection.schema ? collection.schema : "public";

    for (const [propName, prop] of Object.entries(properties)) {
        if (!isVectorProperty(prop)) continue;
        if (prop.index === false) continue;

        const label = `${collection.slug}.${propName}`;
        const column = resolveColumn(propName, prop as Property);
        const config: VectorIndexConfig = prop.index ?? {};
        const method = config.method ?? DEFAULT_VECTOR_INDEX_METHOD;

        if (method !== "hnsw" && method !== "ivfflat") {
            throw new VectorIndexConfigError(
                `${label}: \`index.method\` is "${method}". Use "hnsw" or "ivfflat".`
            );
        }

        // Read before the dimension gate so a malformed block is reported even
        // on a column too wide to index — the config is wrong either way.
        const distances = asDistances(config, label);
        const parameters = parametersFor(method, config, label);

        if (!Number.isInteger(prop.dimensions) || prop.dimensions <= 0) {
            throw new VectorIndexConfigError(
                `${label}: \`dimensions\` is ${JSON.stringify(prop.dimensions)}. It must be a positive integer.`
            );
        }

        if (prop.dimensions > MAX_INDEXABLE_VECTOR_DIMENSIONS) {
            skipped.push({
                schema,
                table,
                column,
                dimensions: prop.dimensions,
                reason:
                    `pgvector cannot index a vector wider than ${MAX_INDEXABLE_VECTOR_DIMENSIONS} dimensions, and ` +
                    `${label} declares ${prop.dimensions}. The column works and \`vectorSearch\` still answers, as an ` +
                    `exact scan. To index it, reduce the dimensions (many embedding models support a shorter output) ` +
                    `or set \`index: false\` to state that the scan is intended.`
            });
            continue;
        }

        for (const distance of distances) {
            specs.push({
                schema,
                table,
                column,
                // Distance is in the name because one column may carry an index
                // per distance, and two indexes cannot share a name. The method
                // is in it because switching methods is a different index, not
                // a redefinition of the same one — `CREATE INDEX IF NOT EXISTS`
                // would otherwise keep the old one and report success.
                indexName: toPostgresIdentifier(`${table}_${column}_${method}_${DISTANCE_TAG[distance]}`),
                method,
                distance,
                operatorClass: OPERATOR_CLASS[distance],
                parameters
            });
        }
    }

    return { specs, skipped };
};

/**
 * The `CREATE INDEX` for one spec.
 *
 * `CONCURRENTLY` is deliberately absent, for the same reason it is absent from
 * `searchIndexStatements`: this form is replayed as part of a migration, where
 * a concurrent build is not allowed. The boot-time ensure rewrites it — see
 * `ensureCollectionTables`.
 */
export const vectorIndexStatement = (spec: VectorIndexSpec): string => {
    const params = spec.parameters.length
        ? ` WITH (${spec.parameters.map(([key, value]) => `${key} = ${value}`).join(", ")})`
        : "";
    return (
        `CREATE INDEX IF NOT EXISTS "${spec.indexName}" ON "${spec.schema}"."${spec.table}" ` +
        `USING ${spec.method} ("${spec.column}" ${spec.operatorClass})${params};`
    );
};

/** Every statement for a plan, in a stable order. */
export const vectorIndexStatements = (plan: VectorIndexPlan): string[] =>
    plan.specs.map(vectorIndexStatement);

/** The index names a plan creates — what the derived-names contract records. */
export const vectorIndexNames = (plan: VectorIndexPlan): string[] =>
    plan.specs.map(spec => spec.indexName);
