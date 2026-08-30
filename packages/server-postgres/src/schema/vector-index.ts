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
 *
 * ## And why the column itself is described here too
 *
 * `VECTOR(n)` is a type Atlas cannot be shown. It has to materialise the
 * desired state in a dev database to diff against, that database is created
 * empty and *emptied again* by Atlas at the start of every run, and nothing in
 * the free tier can put `CREATE EXTENSION vector` back — so a `schema.sql`
 * mentioning the type fails with `type "vector" does not exist` on every push,
 * for good. Search hit the same wall for its own reasons and took the same way
 * out: the objects leave `schema.sql`, Atlas is told to exclude them, and
 * Rebase applies them itself. See `generatePostgresVectorDdl`.
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

// ── The column, for the file Rebase applies itself ──────────────────────────

const quote = (v: string): string => `'${v.replace(/'/g, "''")}'`;

/**
 * The schema pgvector's types are installed into.
 *
 * `WITH SCHEMA public` for the same load-bearing reason `searchExtensionStatements`
 * gives: an unqualified `CREATE EXTENSION` lands in the first schema on
 * `search_path`, which is `"$user", public` — and the scaffold's role is named
 * `rebase`, the same as a schema the generator creates. Left to itself the
 * extension would install into `rebase`, and every unqualified `VECTOR(n)`
 * below would fail to resolve.
 */
export const VECTOR_EXTENSION_SCHEMA = "public";

/** The extension name a database has to name to let Rebase install pgvector. */
export const VECTOR_EXTENSION = "vector";

/**
 * How a project says Rebase may install pgvector, quoted into the messages that
 * have to name it. Spelled once so the option and the advice cannot drift.
 */
export const VECTOR_EXTENSION_OPT_IN = `database({ extensions: ["${VECTOR_EXTENSION}"] })`;

/** Did the project give Rebase leave to install pgvector? */
export const vectorExtensionDeclared = (extensions: readonly string[] | undefined): boolean =>
    (extensions ?? []).includes(VECTOR_EXTENSION);

/**
 * Install pgvector — emitted only when the database asked for it.
 *
 * Opt-in because installing an extension is a decision with a deployment behind
 * it: the image has to ship the library, the role has to be allowed to install
 * it, and a managed provider has to have it on an allow-list. None of that is
 * visible from inside the connection, so Rebase does not decide it. See
 * `DatabaseOptions.extensions`.
 *
 * Withholding the statement is not withholding the *column*: the column is
 * still created, and Postgres refuses it with `type "vector" does not exist`
 * on a database where pgvector was never installed by hand. That error is the
 * one this design accepts, and `vectorExtensionHint` is what makes it name
 * {@link VECTOR_EXTENSION_OPT_IN} rather than nothing.
 */
export const vectorExtensionStatement = (): string =>
    `CREATE EXTENSION IF NOT EXISTS ${VECTOR_EXTENSION} WITH SCHEMA ${VECTOR_EXTENSION_SCHEMA};`;

/**
 * The missing-pgvector explanation, appended to whichever error revealed it.
 *
 * Two readers, needing opposite things, which is why the branch is on the error
 * text rather than on the configuration:
 *
 *  - **`type "vector" does not exist`** — nobody opted in and the database has
 *    no pgvector. The fix is one line of config they cannot guess, so naming
 *    the option *is* the hint.
 *  - **the install itself failed** — the config is already right, and repeating
 *    the option would send them to edit a correct line. What is missing is the
 *    library on the server, or the grant.
 *
 * Lives here rather than beside either caller because both need it: the boot
 * ensure raises the first through its action applier, and `rebase db push`
 * raises it out of `applyVectorDdl`. A hint on only one path is how a bare
 * `type "vector" does not exist` reaches somebody — which is the thing this
 * exists to prevent.
 */
export const vectorExtensionHint = (message: string): string => {
    const installRefused = /extension "vector" is not available/i.test(message)
        || /(permission denied to create extension|must be (superuser|owner).{0,40}extension)/i.test(message);
    if (installRefused) {
        return (
            "\n  pgvector was declared and could not be installed. It is a server extension, so it needs an image " +
            "that ships the library (the scaffold's `pgvector/pgvector:pg18` does; a stock `postgres:18` does not) " +
            "and a role allowed to run `CREATE EXTENSION vector;`. Managed Postgres usually allows it once the " +
            "extension is on the provider's allow-list."
        );
    }
    if (!/type "(vector|halfvec|sparsevec)" does not exist/i.test(message)) return "";
    return (
        "\n  pgvector is not installed on this database, and Rebase installs it only where a database says it may: " +
        `add \`${VECTOR_EXTENSION_OPT_IN}\` in config/resources.ts, or install it once by hand with ` +
        "`CREATE EXTENSION vector;`. Either way the server needs an image that ships the library — the scaffold's " +
        "`pgvector/pgvector:pg18` does, a stock `postgres:18` does not. Rebase then creates the column and its ANN " +
        "index automatically — see the `index` option on the property."
    );
};

/** One `{ type: "vector" }` property, as a column. */
export interface VectorColumnSpec {
    schema: string;
    table: string;
    column: string;
    dimensions: number;
    /** Rendered after the type, in the generator's order: UNIQUE then NOT NULL. */
    modifiers: string;
}

/**
 * Every vector column a collection declares.
 *
 * Wider than {@link buildVectorIndexPlan} on purpose: that one answers "what
 * gets an ANN index", and skips both a property with `index: false` and one too
 * wide to index. Either still needs its column.
 */
export const buildVectorColumnSpecs = (
    collection: CollectionConfig,
    resolveColumn: (propName: string, prop?: Property | null) => string
): VectorColumnSpec[] => {
    const table = getTableName(collection);
    const schema = isPostgresCollectionConfig(collection) && collection.schema ? collection.schema : "public";
    const specs: VectorColumnSpec[] = [];

    for (const [propName, prop] of Object.entries(collection.properties ?? {})) {
        if (!isVectorProperty(prop)) continue;
        // Assembled in the CREATE TABLE generator's order, so the column this
        // file adds and the column `schema.sql` used to declare are the same
        // column. A vector property is never a primary key and carries no
        // SQL-level default, which is what leaves only these two.
        const validation = (prop as { validation?: { required?: boolean; unique?: boolean } }).validation;
        let modifiers = "";
        if (validation?.unique) modifiers += " UNIQUE";
        if (validation?.required) modifiers += " NOT NULL";
        specs.push({
            schema,
            table,
            column: resolveColumn(propName, prop as Property),
            dimensions: prop.dimensions,
            modifiers
        });
    }

    return specs;
};

/** The column type — the one place `VECTOR(n)` is spelled. */
export const vectorColumnType = (spec: Pick<VectorColumnSpec, "dimensions">): string =>
    `VECTOR(${spec.dimensions})`;

/** The column definition as it appears inside `CREATE TABLE`. */
export const vectorColumnDefinition = (spec: VectorColumnSpec): string =>
    `"${spec.column}" ${vectorColumnType(spec)}${spec.modifiers}`;

/**
 * Refuse — or perform — a `dimensions` change that `ADD COLUMN IF NOT EXISTS`
 * would otherwise swallow.
 *
 * Without this the file *launders* the change: the ADD is a no-op against a
 * column that exists, so a project that went from 384 to 768 dimensions would
 * push clean, keep a 384-wide column, and fail on the next insert with a
 * message about the row rather than about the config. Atlas used to catch this
 * — it owned the column and planned the `ALTER … TYPE` — and taking the column
 * out of its sight is exactly what makes the guard necessary.
 *
 * The widening is performed when the column holds no values, because that is
 * the case Atlas handled and it is the common one: a developer changing
 * embedding models before there are any embeddings. With values present the
 * conversion is pgvector's to reject — every stored vector is the old width —
 * so this refuses first and names the statement to run afterwards.
 *
 * `atttypmod` on a `vector` column *is* the dimension count: pgvector stores it
 * directly rather than offsetting it the way `varchar` does. `-1` means the
 * column was declared as a bare `vector`, which is drift in the same sense.
 */
export const vectorDimensionGuard = (spec: VectorColumnSpec): string => {
    const relation = `"${spec.schema}"."${spec.table}"`;
    return `DO $rebase_vector$
DECLARE actual int;
BEGIN
    SELECT a.atttypmod INTO actual
    FROM pg_attribute a
    JOIN pg_type t ON t.oid = a.atttypid
    WHERE a.attrelid = ${quote(relation)}::regclass
      AND a.attname = ${quote(spec.column)}
      AND NOT a.attisdropped
      AND t.typname = 'vector';
    IF actual IS NOT NULL AND actual <> ${spec.dimensions} THEN
        IF EXISTS (SELECT 1 FROM ${relation} WHERE "${spec.column}" IS NOT NULL) THEN
            RAISE EXCEPTION 'Rebase: ${spec.schema}.${spec.table}."${spec.column}" declares ${spec.dimensions} dimensions but the column is vector(%), and it already holds values of the old width. pgvector cannot convert them. Re-embed the rows at ${spec.dimensions} dimensions (or clear the column), then re-apply: ALTER TABLE ${relation} ALTER COLUMN "${spec.column}" TYPE ${vectorColumnType(spec)};', actual;
        END IF;
        ALTER TABLE ${relation} ALTER COLUMN "${spec.column}" TYPE ${vectorColumnType(spec)};
    END IF;
END
$rebase_vector$;`;
};

/**
 * The object names a collection's vector properties own, unqualified.
 *
 * What Atlas has to be told to exclude. Only the column and the ANN indexes: a
 * `UNIQUE` or `NOT NULL` on the column is a property *of* the column, and
 * excluding the column takes them with it — measured against Atlas 1.2.3 and
 * 1.3.2, where a target carrying `vector(3) NOT NULL UNIQUE` and a `schema.sql`
 * carrying neither reported "Schema is synced, no changes to be made".
 */
export const vectorObjectNames = (
    collection: CollectionConfig,
    resolveColumn: (propName: string, prop?: Property | null) => string
): string[] => [
    ...buildVectorColumnSpecs(collection, resolveColumn).map(spec => spec.column),
    ...vectorIndexNames(buildVectorIndexPlan(collection, resolveColumn))
];
