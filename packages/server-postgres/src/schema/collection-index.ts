/**
 * The one place a collection's `indexes:` block becomes `CREATE INDEX`.
 *
 * Like `search-column.ts` and `vector-index.ts`, this module exists so the DDL
 * generator and the boot-time ensure render the *same* specification rather
 * than describing the same index twice, differently.
 *
 * ## Why every form here is core Postgres
 *
 * `rebase db push` runs `atlas schema apply`, which materialises the desired
 * state in a bare scratch database to plan against. `--exclude` does not
 * suppress that replay, and `CREATE EXTENSION` cannot go in the file. So an
 * index wanting `gin_trgm_ops` or `vector_cosine_ops` would parse, plan, and
 * then fail against a database the author has never heard of. Those are
 * refused here instead, and redirected to the feature that owns them: trigram
 * search is `search:`, ANN is a `vector` property.
 *
 * Verified against atlas v1.2.3 and Postgres 18 before this was written: plain,
 * composite with `DESC NULLS LAST`, partial, unique, covering `INCLUDE`, `GIN`
 * and expression indexes all parse, apply, and re-plan clean. The Atlas
 * limitation that forced the search carve-out is that it will not parse a file
 * containing a function *definition* — a function *call* inside an index is
 * fine. That is why this module needs no carve-out and search did.
 *
 * ## Why the name carries a hash
 *
 * `CREATE INDEX IF NOT EXISTS` is a **name** check, not a definition check. A
 * readable name means a changed declaration keeps the old index and reports
 * success, forever. Hashing the index's *semantics* into its name makes a
 * redefinition a different object: the new one is built before the old one is
 * dropped, there is never a window with no index, and drift detection reduces
 * to a set difference over names.
 */
import type { CollectionConfig, CollectionIndex, IndexPredicate, Property, ResolvedRelation } from "@rebasepro/types";
import { isPostgresCollectionConfig } from "@rebasepro/types";
import { getTableName, resolveCollectionRelations } from "@rebasepro/common";
import { sha1Hex, truncateToBytes } from "@rebasepro/utils";

/** Resolve a property key to its column name. Injected to avoid an import cycle. */
export type ResolveColumnName = (propName: string, prop?: Property | null) => string;

export type IndexMethod = "btree" | "gin" | "brin";

/** A key column, with the ordering Postgres will actually apply. */
export interface ResolvedIndexKey {
    column: string;
    /** Always concrete. `btree` defaults ascending; unordered methods report `asc`. */
    direction: "asc" | "desc";
    /** Postgres's own default: `last` under `asc`, `first` under `desc`. */
    nulls: "first" | "last";
}

/** A predicate resolved onto column names, ready to render and to hash. */
export type ResolvedPredicate =
    | { column: string; op: "=" | "!=" | "<" | "<=" | ">" | ">="; value: string | number | boolean }
    | { column: string; op: "is null" | "is not null" }
    | { column: string; op: "in"; value: readonly (string | number)[] }
    | { and: readonly ResolvedPredicate[] };

/** One index, fully resolved. The only shape the renderers accept. */
export interface CollectionIndexSpec {
    schema: string;
    table: string;
    method: IndexMethod;
    unique: boolean;
    keys: ResolvedIndexKey[];
    include: string[];
    predicate: ResolvedPredicate | null;
    /** The author's one-line justification. Never enters the name. */
    reason: string;
    /** Derived by {@link deriveIndexName}. Frozen — see the module comment. */
    indexName: string;
}

/**
 * A declaration that cannot become an index.
 *
 * Thrown at build time, naming the collection and the array position, because
 * the alternative is a `CREATE INDEX` that fails during a push with a Postgres
 * error mentioning a column the author never wrote.
 */
export class CollectionIndexConfigError extends Error {
    readonly collectionSlug: string;
    readonly position: number;

    constructor(collectionSlug: string, position: number, message: string) {
        super(`${collectionSlug}.indexes[${position}]: ${message}`);
        this.name = "CollectionIndexConfigError";
        this.collectionSlug = collectionSlug;
        this.position = position;
    }
}

/** Postgres allows 32 key columns. See the doc comment on `on`. */
export const MAX_INDEX_KEYS = 5;

/**
 * `_ix`/`_ux` plus `_` plus 7 hex — the part of the name that must always
 * survive truncation, and therefore is never inside the truncated portion.
 */
const NAME_SUFFIX_BYTES = 11;

/**
 * Every Rebase-managed index name, and nothing else.
 *
 * The terminal `_ix_`/`_ux_` plus exactly seven lowercase hex characters is
 * what separates this scheme from every other producer in the codebase —
 * `_fkey`, `_gin`, `_trgm`, `_pkey`, `_key`, the vector distances, and the
 * `idx_` prefix auth uses. `_idx` was rejected as a tail because it is already
 * taken for real: `users_email_verification_token_idx` is byte-for-byte what a
 * naive `<table>_<column>_idx` derives on an auth-enabled `users` collection.
 *
 * Load-bearing for safety, not just tidiness. An index that does NOT match this
 * belongs to somebody else — a hand-written one, or one an introspected
 * database arrived with — and is excluded from the Atlas diff so the push
 * cannot drop it.
 */
export const isRebaseIndexName = (name: string): boolean => /_(?:ix|ux)_[0-9a-f]{7}$/.test(name);

const isOrderedMethod = (method: IndexMethod): boolean => method === "btree";

/**
 * The parts of an index that decide what it *is*.
 *
 * A semantic projection, not the rendered statement — the same arrangement as
 * `getPolicyNameHash`, and for the same reason. A change to how this file
 * formats SQL (eliding a default `USING btree`, quoting differently, emitting
 * `NULLS LAST` explicitly) must not silently rename every index in every
 * deployed database. Hashing generator output would make every cosmetic edit a
 * fleet-wide DROP + CREATE.
 *
 * `reason` is deliberately absent: rewording a comment must not rebuild an
 * index. `nulls` is the *effective* placement, so writing Postgres's own
 * default down is a no-op rather than a redefinition.
 *
 * `v` is the only escape hatch, and it is expensive on purpose: bumping it
 * renames every index in the field.
 */
export const indexFingerprint = (spec: Omit<CollectionIndexSpec, "indexName">): string => sha1Hex(JSON.stringify({
    v: 1,
    s: spec.schema,
    t: spec.table,
    m: spec.method,
    u: spec.unique,
    k: spec.keys.map(k => [k.column, k.direction, k.nulls]),
    i: spec.include,
    w: spec.predicate
})).substring(0, 7);

/**
 * `<table>_<columns>_ix_<hash>`, or `_ux_` when unique.
 *
 * Truncation eats the readable head and never the hash. `toPostgresIdentifier`
 * truncates the whole string at 63 bytes, which on a hashed name would cut off
 * the one part that makes it unique — the failure already frozen into
 * `contracts/derived-names.txt`, where a foreign key is recorded with its
 * `_fkey` suffix truncated away, so a second foreign key on that table would
 * derive a byte-identical name.
 */
export const deriveIndexName = (spec: Omit<CollectionIndexSpec, "indexName">): string => {
    // Built suffix-first, so the two parts that carry meaning — the `_ix`/`_ux`
    // tag that {@link isRebaseIndexName} matches on, and the fingerprint — are
    // never in the string being truncated. Composing the whole name and then
    // trimming it to 63 loses both, silently: an 80-byte table name yields
    // `xxxx…xxx_610bb9e` with the tag gone, so the index stops being
    // recognisable as Rebase's and `db push` treats it as foreign forever.
    const tag = spec.unique ? "ux" : "ix";
    const suffix = `_${tag}_${indexFingerprint(spec)}`;
    const readable = `${spec.table}_${spec.keys.map(k => k.column).join("_")}`;
    return `${truncateToBytes(readable, 63 - NAME_SUFFIX_BYTES)}${suffix}`;
};

const quoteLiteral = (value: string | number | boolean): string => {
    if (typeof value === "number") return String(value);
    if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
    return `'${value.replace(/'/g, "''")}'`;
};

/** Render a resolved predicate as the body of a `WHERE` clause. */
export const renderPredicate = (predicate: ResolvedPredicate): string => {
    if ("and" in predicate) {
        // Always parenthesised. Postgres would apply the same precedence
        // without it, but the rendered SQL is read by people diffing a plan.
        return predicate.and.map(renderPredicate).join(" AND ");
    }
    switch (predicate.op) {
        case "is null":
        case "is not null":
            return `"${predicate.column}" ${predicate.op.toUpperCase()}`;
        case "in":
            return `"${predicate.column}" IN (${predicate.value.map(quoteLiteral).join(", ")})`;
        default:
            return `"${predicate.column}" ${predicate.op} ${quoteLiteral(predicate.value)}`;
    }
};

/**
 * The `CREATE INDEX` for one spec.
 *
 * `concurrently` is a parameter rather than a string replacement on the way
 * out. `search-column.ts` and `vector-index.ts` both reach for
 * `.replace("CREATE INDEX IF NOT EXISTS", …)` instead, which silently does
 * nothing for a UNIQUE index — the rendered text is `CREATE UNIQUE INDEX …`
 * and the pattern never matches.
 */
export const collectionIndexStatement = (
    spec: CollectionIndexSpec,
    options: { concurrently?: boolean; ifNotExists?: boolean } = {}
): string => {
    const unique = spec.unique ? "UNIQUE " : "";
    const concurrently = options.concurrently ? "CONCURRENTLY " : "";
    const ifNotExists = options.ifNotExists ? "IF NOT EXISTS " : "";
    const using = spec.method === "btree" ? "" : ` USING ${spec.method}`;

    const keys = spec.keys.map(k => {
        if (!isOrderedMethod(spec.method)) return `"${k.column}"`;
        const direction = k.direction === "desc" ? " DESC" : "";
        // Emitted only when it is not what the direction already implies, so
        // the rendered SQL matches what `pg_get_indexdef` reads back and a
        // re-plan finds no difference.
        const impliedNulls = k.direction === "desc" ? "first" : "last";
        const nulls = k.nulls === impliedNulls ? "" : ` NULLS ${k.nulls.toUpperCase()}`;
        return `"${k.column}"${direction}${nulls}`;
    }).join(", ");

    const include = spec.include.length > 0
        ? ` INCLUDE (${spec.include.map(c => `"${c}"`).join(", ")})`
        : "";
    const where = spec.predicate ? ` WHERE ${renderPredicate(spec.predicate)}` : "";

    return `CREATE ${unique}INDEX ${concurrently}${ifNotExists}"${spec.indexName}" ` +
        `ON "${spec.schema}"."${spec.table}"${using} (${keys})${include}${where};`;
};

export const collectionIndexStatements = (
    specs: readonly CollectionIndexSpec[],
    options: { concurrently?: boolean; ifNotExists?: boolean } = {}
): string[] => specs.map(spec => collectionIndexStatement(spec, options));

const relationOf = (
    collection: CollectionConfig,
    propKey: string
): ResolvedRelation | undefined => resolveCollectionRelations(collection)[propKey];

/**
 * The column a property key indexes.
 *
 * A `belongsTo` resolves to its `localKey` — `primaryCategory` becomes
 * `primary_category_id` — which is the case an index is most often wanted for
 * and the case where the property key and the column differ. Everything else
 * goes through `resolveColumnName`.
 *
 * The other relation kinds have no local column at all: the foreign key lives
 * on the target's table, or in a junction. Indexing them here is refused
 * rather than resolved to a column that does not exist.
 */
export const resolveIndexableColumn = (
    collection: CollectionConfig,
    propKey: string,
    resolveColumnName: ResolveColumnName,
    fail: (message: string) => never
): string => {
    const relation = relationOf(collection, propKey);
    if (relation) {
        if (relation.kind === "belongsTo") return relation.localKey;
        fail(
            `"${propKey}" is a ${relation.kind} relation, which has no column on this table — ` +
            `the foreign key lives on "${relation.targetSlug}". Declare the index there.`
        );
    }

    const property = collection.properties?.[propKey] as Property | undefined;
    if (!property) {
        fail(`"${propKey}" is not a property of this collection.`);
    }
    return resolveColumnName(propKey, property);
};

const resolvePredicate = (
    collection: CollectionConfig,
    predicate: IndexPredicate,
    resolveColumnName: ResolveColumnName,
    fail: (message: string) => never
): ResolvedPredicate => {
    if ("and" in predicate) {
        return { and: predicate.and.map(p => resolvePredicate(collection, p, resolveColumnName, fail)) };
    }
    const column = resolveIndexableColumn(collection, predicate.prop, resolveColumnName, fail);
    switch (predicate.op) {
        case "is null":
        case "is not null":
            return { column, op: predicate.op };
        case "in": {
            const seen = new Set(predicate.value);
            if (seen.size !== predicate.value.length) {
                fail(`the \`in\` list for "${predicate.prop}" repeats a value, which changes nothing.`);
            }
            return { column, op: "in", value: [...predicate.value] };
        }
        default:
            return { column, op: predicate.op, value: predicate.value };
    }
};

/** The primary key columns of a collection, for the "you already have this" refusal. */
const primaryKeyColumns = (collection: CollectionConfig, resolveColumnName: ResolveColumnName): string[] =>
    Object.entries(collection.properties ?? {})
        .filter(([, prop]) => prop && typeof prop === "object" && "isId" in prop && Boolean((prop as { isId?: unknown }).isId))
        .map(([key, prop]) => resolveColumnName(key, prop as Property));

/**
 * Every index one collection declares, resolved and named.
 *
 * Throws {@link CollectionIndexConfigError} rather than dropping a bad entry:
 * an index that silently does not exist is the failure mode this whole feature
 * is here to remove.
 */
export const buildCollectionIndexSpecs = (
    collection: CollectionConfig,
    resolveColumnName: ResolveColumnName
): CollectionIndexSpec[] => {
    if (!isPostgresCollectionConfig(collection)) return [];
    const declared = collection.indexes;
    if (!declared || declared.length === 0) return [];

    const slug = collection.slug ?? getTableName(collection);
    const schema = collection.schema ?? "public";
    const table = getTableName(collection);
    const pk = primaryKeyColumns(collection, resolveColumnName).sort().join(",");

    const specs: CollectionIndexSpec[] = [];
    const byName = new Map<string, number>();

    declared.forEach((index: CollectionIndex, position: number) => {
        const fail = (message: string): never => {
            throw new CollectionIndexConfigError(slug, position, message);
        };

        if (typeof index.reason !== "string" || index.reason.trim() === "") {
            fail("`reason` is required — see the doc comment. An index nobody can justify is one nobody can delete.");
        }
        if (!Array.isArray(index.on) || index.on.length === 0) {
            fail("`on` must name at least one property.");
        }
        if (index.on.length > MAX_INDEX_KEYS) {
            fail(`\`on\` has ${index.on.length} keys; the limit is ${MAX_INDEX_KEYS}. Payload columns belong in \`include\`.`);
        }

        const method: IndexMethod = index.using ?? "btree";
        const unique = method === "btree" && Boolean((index as { unique?: boolean }).unique);
        if (!isOrderedMethod(method)) {
            for (const key of index.on) {
                if (typeof key !== "string" && ("direction" in key || "nulls" in key)) {
                    fail(`access method "${method}" does not support ASC/DESC or NULLS options.`);
                }
            }
        }

        const keys: ResolvedIndexKey[] = index.on.map(key => {
            const propKey = typeof key === "string" ? key : key.prop;
            const column = resolveIndexableColumn(collection, propKey, resolveColumnName, fail);
            const direction = (typeof key === "string" ? undefined : (key as { direction?: "asc" | "desc" }).direction) ?? "asc";
            const nulls = (typeof key === "string" ? undefined : (key as { nulls?: "first" | "last" }).nulls)
                ?? (direction === "desc" ? "first" : "last");
            return { column, direction, nulls };
        });

        const duplicateKey = keys.map(k => k.column).find((c, i, all) => all.indexOf(c) !== i);
        if (duplicateKey) fail(`"${duplicateKey}" appears twice in \`on\`.`);

        if (keys.map(k => k.column).sort().join(",") === pk && pk !== "") {
            fail(`this is the primary key — "${table}_pkey" already indexes exactly these columns.`);
        }

        const include = ((index as { include?: readonly string[] }).include ?? [])
            .map(propKey => resolveIndexableColumn(collection, propKey, resolveColumnName, fail));
        const overlap = include.find(c => keys.some(k => k.column === c));
        if (overlap) fail(`"${overlap}" is in both \`on\` and \`include\`; Postgres rejects the overlap.`);

        if (unique && keys.length === 1) {
            const propKey = typeof index.on[0] === "string" ? index.on[0] as string : (index.on[0] as { prop: string }).prop;
            const property = collection.properties?.[propKey] as { validation?: { unique?: boolean } } | undefined;
            if (property?.validation?.unique) {
                fail(
                    `"${propKey}" already declares \`validation.unique\`, which compiles to an inline UNIQUE. ` +
                    `Two declarations of one guarantee — remove one.`
                );
            }
        }

        const predicate = index.where
            ? resolvePredicate(collection, index.where, resolveColumnName, fail)
            : null;

        const withoutName = { schema, table, method, unique, keys, include, predicate, reason: index.reason };
        const indexName = deriveIndexName(withoutName);

        const clash = byName.get(indexName);
        if (clash !== undefined) {
            fail(`derives the same name as indexes[${clash}] — they are the same index declared twice.`);
        }
        byName.set(indexName, position);

        specs.push({ ...withoutName, indexName });
    });

    return specs;
};

/**
 * Every declared index across a set of collections, in a stable order.
 *
 * Sorted because the result reaches `schema.sql`, which `doctor` string-
 * compares against a regenerated copy — `generatePostgresDdl` does not sort its
 * collections, so leaving this in declaration order would make the artifact
 * depend on the order files happened to load in.
 */
export const buildCollectionIndexPlan = (
    collections: readonly CollectionConfig[],
    resolveColumnName: ResolveColumnName
): CollectionIndexSpec[] =>
    collections
        .flatMap(collection => buildCollectionIndexSpecs(collection, resolveColumnName))
        .sort((a, b) =>
            a.schema.localeCompare(b.schema) ||
            a.table.localeCompare(b.table) ||
            a.indexName.localeCompare(b.indexName));
