/**
 * The one place a collection's `search` block becomes SQL.
 *
 * Four things describe a Postgres table in this codebase — the DDL generator,
 * the Drizzle schema generator, the runtime table builder for BaaS mode, and
 * the boot-time schema ensure — and each of them has, at some point, described
 * a column differently from the others. The `varchar(255)` note in
 * `generate-postgres-ddl-logic` is one such scar: the same property produced a
 * capped column down one path and an uncapped one down the other, and nothing
 * failed until a user hit the cap.
 *
 * So the search column is not implemented four times. It is computed once,
 * here, and every generator renders the same {@link SearchColumnSpec}. There is
 * a test asserting exactly that (`search-column-contract.test.ts`); the point of
 * this module is that the test has something to assert *about*.
 *
 * ## Why the expressions look the way they do
 *
 * A `GENERATED ALWAYS AS … STORED` expression must be strictly IMMUTABLE, and
 * Postgres is stricter here than intuition. Verified against PostgreSQL 18:
 *
 * | expression                              | immutable |
 * |-----------------------------------------|-----------|
 * | `to_tsvector('spanish', col)`           | yes       |
 * | `to_tsvector(col)` (1-arg)              | **no** — depends on `default_text_search_config` |
 * | `array_to_string(col, ' ')`             | **no**    |
 * | `col::text` on `text[]`                 | **no**    |
 * | `to_jsonb(col)`                         | **no**    |
 * | `unaccent(col)`                         | **no** — dictionary lookup is STABLE |
 * | `jsonb_to_tsvector('spanish', j, '["string"]')` | yes |
 * | `setweight(...) || setweight(...)`      | yes       |
 *
 * Three of the four things a real search column needs are therefore unavailable
 * directly, which is why {@link searchHelperFunctions} exists: each wraps a
 * stable built-in in an SQL function declared IMMUTABLE. That declaration is a
 * promise, and it is a true one for these three — array joining, JSON string
 * extraction and accent folding are all deterministic for a given input; the
 * built-ins are marked stable only because they must account for element types
 * and dictionaries in general.
 *
 * The alternative was to skip `unaccent` and text arrays entirely. That is not
 * a real option in an accented language: Postgres stems `auditoría` to
 * `auditor` and `auditoria` to `auditori` — *different lexemes* — so a query
 * typed without accents misses every row that carries them.
 */
import {
    CollectionConfig,
    Property,
    StringProperty,
    ArrayProperty,
    MapProperty,
    SearchConfig,
    SearchField,
    SearchWeight,
    isPostgresCollectionConfig,
    DEFAULT_SEARCH_COLUMN,
    DEFAULT_SEARCH_LANGUAGE,
    DEFAULT_SEARCH_WEIGHT,
    DEFAULT_FUZZY_THRESHOLD
} from "@rebasepro/types";
import { getTableName } from "@rebasepro/common";
import { toSnakeCase, toPostgresIdentifier } from "@rebasepro/utils";

/** Schema-qualified so a collection outside `public` still resolves them. */
const HELPER_SCHEMA = "public";

/**
 * Names of the helper functions. Frozen: they are recorded in the stored
 * generation expression of every search column ever created, so renaming one
 * orphans every table that already has a search column.
 */
export const SEARCH_TEXT_FN = `${HELPER_SCHEMA}.rebase_search_text`;
export const SEARCH_UNACCENT_FN = `${HELPER_SCHEMA}.rebase_search_unaccent`;

/** How a declared path reaches text, which decides the SQL that extracts it. */
type FieldKind = "text" | "text_array" | "jsonb";

/** One resolved field: where it lives, how to read it, what it is worth. */
export interface ResolvedSearchField {
    /** The path exactly as the author wrote it, for error messages. */
    path: string;
    /** The physical column the path starts at. */
    column: string;
    /** Dotted remainder addressed inside a JSONB column, if any. */
    jsonPath: string[];
    kind: FieldKind;
    weight: SearchWeight;
    /** The `setweight(to_tsvector(…), 'X')` term this field contributes. */
    sql: string;
    /** The plain-text term this field contributes, for the fuzzy column. */
    textSql: string;
}

/** Everything the generators need to render one collection's search column. */
export interface SearchColumnSpec {
    schema: string;
    table: string;
    /** The generated `tsvector` column. */
    column: string;
    language: string;
    unaccent: boolean;
    fields: ResolvedSearchField[];
    /** Body of `GENERATED ALWAYS AS ( … ) STORED` for the tsvector column. */
    expression: string;
    indexName: string;
    /** Extensions that must exist before the column can be created. */
    extensions: string[];
    fuzzy?: {
        column: string;
        expression: string;
        indexName: string;
        threshold: number;
    };
}

/** Raised when a `search` block names something that cannot be searched. */
export class SearchConfigError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "SearchConfigError";
    }
}

/** The `search` block of a collection, or undefined when it has none. */
export const getSearchConfig = (collection: CollectionConfig): SearchConfig | undefined =>
    isPostgresCollectionConfig(collection) ? collection.search : undefined;

const columnNameOf = (propName: string, prop?: Property | null): string =>
    prop && "columnName" in prop && typeof prop.columnName === "string" ? prop.columnName : toSnakeCase(propName);

/**
 * Classify a property for search purposes.
 *
 * Deliberately narrower than `getSqlColumnType`: search only cares whether a
 * value reaches text, and the mapping from property to *physical* type is
 * asserted against `getSqlColumnType` in the contract test rather than
 * duplicated here.
 *
 * Returns null for anything that is not text-bearing, which the caller turns
 * into a boot error naming the property.
 */
const classify = (prop: Property): { kind: FieldKind; reason?: string } | null => {
    switch (prop.type) {
        case "string": {
            const sp = prop as StringProperty;
            if (sp.enum) {
                return { kind: "text", reason: "enum" };
            }
            if (sp.isId === "uuid" || sp.columnType === "uuid") {
                return { kind: "text", reason: "uuid" };
            }
            return { kind: "text" };
        }
        case "map": {
            const mp = prop as MapProperty;
            // A `json` column is not `jsonb`, and the cast between them is not
            // immutable. Declaring `columnType: "json"` puts the value out of
            // reach of a generated column.
            if (mp.columnType === "json") return { kind: "jsonb", reason: "json" };
            return { kind: "jsonb" };
        }
        case "array": {
            const ap = prop as ArrayProperty;
            let colType = ap.columnType;
            if (!colType && ap.of && !Array.isArray(ap.of)) {
                const of = ap.of as Property;
                if (of.type === "string") colType = "text[]";
                else if (of.type === "number") colType = of.validation?.integer ? "integer[]" : "numeric[]";
                else if (of.type === "boolean") colType = "boolean[]";
            }
            if (colType === "text[]") return { kind: "text_array" };
            if (colType === "json") return { kind: "jsonb", reason: "json" };
            if (colType === "integer[]" || colType === "boolean[]" || colType === "numeric[]") {
                return { kind: "text_array", reason: "non_text_array" };
            }
            // Everything else lands in JSONB, which the JSON extractor handles.
            return { kind: "jsonb" };
        }
        default:
            return null;
    }
};

const normalize = (inner: string, unaccent: boolean): string =>
    unaccent ? `${SEARCH_UNACCENT_FN}(${inner})` : inner;

/** SQL reading one field as plain text, before normalization. */
const rawTextSql = (field: { column: string; jsonPath: string[]; kind: FieldKind }): string => {
    const col = `"${field.column}"`;
    if (field.kind === "text") return `coalesce(${col}, '')`;
    if (field.kind === "text_array") return `${SEARCH_TEXT_FN}(coalesce(${col}, '{}'::text[]))`;
    // JSONB, optionally addressed at a path inside the document.
    const target = field.jsonPath.length === 0
        ? col
        : field.jsonPath.length === 1
            ? `${col} -> ${quote(field.jsonPath[0])}`
            : `${col} #> ${quote(`{${field.jsonPath.join(",")}}`)}`;
    return `${SEARCH_TEXT_FN}(coalesce(${target}, '{}'::jsonb))`;
};

const quote = (v: string): string => `'${v.replace(/'/g, "''")}'`;

/**
 * Resolve and validate one declared field path.
 *
 * A path that does not resolve throws. The whole point of an explicit block is
 * that the author knows what is indexed; a silently dropped field would make it
 * a guess again, and the failure — a search that returns nothing for content
 * that is plainly in the row — is invisible from the outside.
 */
const resolveField = (
    entry: string | SearchField,
    collection: CollectionConfig,
    cfg: SearchConfig
): ResolvedSearchField => {
    const path = typeof entry === "string" ? entry : entry.path;
    const weight = (typeof entry === "string" ? undefined : entry.weight) ?? DEFAULT_SEARCH_WEIGHT;
    const where = `${collection.slug}.search`;

    if (!path || typeof path !== "string") {
        throw new SearchConfigError(`${where}: every entry in \`fields\` needs a property path.`);
    }

    const [head, ...rest] = path.split(".");
    const prop = collection.properties?.[head] as Property | undefined;
    if (!prop) {
        const known = Object.keys(collection.properties ?? {}).join(", ");
        throw new SearchConfigError(
            `${where}: "${path}" starts at property "${head}", which this collection does not declare. Known properties: ${known}.`
        );
    }

    const classified = classify(prop);
    if (!classified) {
        throw new SearchConfigError(
            `${where}: "${path}" is a \`${prop.type}\` property, which holds no text to search. ` +
            `Searchable kinds are \`string\`, \`string[]\` and \`map\` (or a path inside one).`
        );
    }
    if (classified.reason === "enum") {
        throw new SearchConfigError(
            `${where}: "${path}" is an enum. Enums are a fixed vocabulary — filter on them with \`where\` instead, which is exact and uses an index.`
        );
    }
    if (classified.reason === "uuid") {
        throw new SearchConfigError(
            `${where}: "${path}" is a UUID column. Look it up by id rather than searching it.`
        );
    }
    if (classified.reason === "json") {
        throw new SearchConfigError(
            `${where}: "${path}" is a \`json\` column, and the cast from \`json\` to \`jsonb\` is not immutable, so it cannot feed a generated column. Declare the property as \`jsonb\` (the default) to search it.`
        );
    }
    if (classified.reason === "non_text_array") {
        throw new SearchConfigError(
            `${where}: "${path}" is an array of numbers or booleans. Only \`string[]\` carries text to search.`
        );
    }

    if (rest.length > 0 && classified.kind !== "jsonb") {
        throw new SearchConfigError(
            `${where}: "${path}" addresses a path inside "${head}", but "${head}" is a \`${prop.type}\` property, not a \`map\`. Only map properties have paths inside them.`
        );
    }

    const column = columnNameOf(head, prop);
    const field = { column, jsonPath: rest, kind: classified.kind };
    const textSql = normalize(rawTextSql(field), cfg.unaccent === true);
    const language = cfg.language ?? DEFAULT_SEARCH_LANGUAGE;

    return {
        path,
        column,
        jsonPath: rest,
        kind: classified.kind,
        weight,
        sql: `setweight(to_tsvector(${quote(language)}, ${textSql}), ${quote(weight)})`,
        textSql
    };
};

/**
 * Build the full spec for a collection, or undefined when it has not opted in.
 *
 * Throws {@link SearchConfigError} on a config that cannot be honoured. Callers
 * at boot surface that as a startup failure — a search block that half-works is
 * worse than one that refuses.
 */
export const buildSearchColumnSpec = (collection: CollectionConfig): SearchColumnSpec | undefined => {
    const cfg = getSearchConfig(collection);
    if (!cfg) return undefined;

    if (!Array.isArray(cfg.fields) || cfg.fields.length === 0) {
        throw new SearchConfigError(
            `${collection.slug}.search: \`fields\` is empty. Name the properties to index, or remove the \`search\` block to keep the default ILIKE behaviour.`
        );
    }

    const table = getTableName(collection);
    const schema = isPostgresCollectionConfig(collection) && collection.schema ? collection.schema : "public";
    const column = cfg.column ?? DEFAULT_SEARCH_COLUMN;

    if (collection.properties?.[column]) {
        throw new SearchConfigError(
            `${collection.slug}.search: the generated column "${column}" collides with a declared property of the same name. Set \`search.column\` to something else.`
        );
    }

    const fields = cfg.fields.map(entry => resolveField(entry, collection, cfg));

    const seen = new Set<string>();
    for (const f of fields) {
        if (seen.has(f.path)) {
            throw new SearchConfigError(`${collection.slug}.search: "${f.path}" is listed twice.`);
        }
        seen.add(f.path);
    }

    const extensions: string[] = [];
    if (cfg.unaccent) extensions.push("unaccent");
    if (cfg.fuzzy) extensions.push("pg_trgm");

    const spec: SearchColumnSpec = {
        schema,
        table,
        column,
        language: cfg.language ?? DEFAULT_SEARCH_LANGUAGE,
        unaccent: cfg.unaccent === true,
        fields,
        expression: fields.map(f => f.sql).join(" || "),
        indexName: toPostgresIdentifier(`${table}_${column}_gin`),
        extensions
    };

    if (cfg.fuzzy) {
        const fuzzyColumn = `${column}_text`;
        if (collection.properties?.[fuzzyColumn]) {
            throw new SearchConfigError(
                `${collection.slug}.search: \`fuzzy\` needs the column "${fuzzyColumn}", which collides with a declared property. Set \`search.column\` to something else.`
            );
        }
        spec.fuzzy = {
            column: fuzzyColumn,
            // Concatenated with spaces so a trigram never spans two fields.
            expression: fields.map(f => f.textSql).join(" || ' ' || "),
            indexName: toPostgresIdentifier(`${table}_${fuzzyColumn}_trgm`),
            threshold: cfg.fuzzyThreshold ?? DEFAULT_FUZZY_THRESHOLD
        };
    }

    return spec;
};

/**
 * The IMMUTABLE wrappers the generated expressions call.
 *
 * `CREATE OR REPLACE` so a boot against an existing database is a no-op rather
 * than an error, and idempotent for the same reason every other boot-time DDL
 * statement here is.
 *
 * The bodies are stable built-ins wrapped in an immutable promise — see the
 * module comment for why that promise is sound. `STRICT` matters: it makes NULL
 * in mean NULL out without executing the body, which is what the `coalesce` at
 * each call site then absorbs.
 */
export const searchHelperFunctions = (spec: SearchColumnSpec): string[] => {
    const statements: string[] = [
        // text[] → " "-joined text.
        `CREATE OR REPLACE FUNCTION ${SEARCH_TEXT_FN}(text[]) RETURNS text\n` +
        `    LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS\n` +
        `    $$ SELECT array_to_string($1, ' ') $$;`,
        // jsonb → every string value at or below the node, space-joined. Keys
        // are not values: indexing them would make `certifications` itself a
        // search term on every row that has the field at all.
        `CREATE OR REPLACE FUNCTION ${SEARCH_TEXT_FN}(jsonb) RETURNS text\n` +
        `    LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS\n` +
        `    $$ SELECT coalesce(string_agg(v, ' '), '')\n` +
        `       FROM jsonb_array_elements_text(jsonb_path_query_array($1, 'strict $.**?(@.type() == "string")')) AS v $$;`
    ];
    if (spec.unaccent) {
        // The two-argument form with an explicit dictionary is the one that can
        // honestly be called immutable: the single-argument form resolves the
        // dictionary through the current search_path at call time.
        statements.push(
            `CREATE OR REPLACE FUNCTION ${SEARCH_UNACCENT_FN}(text) RETURNS text\n` +
            `    LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS\n` +
            `    $$ SELECT ${HELPER_SCHEMA}.unaccent('${HELPER_SCHEMA}.unaccent'::regdictionary, $1) $$;`
        );
    }
    return statements;
};

/**
 * `CREATE EXTENSION` statements the spec's expressions depend on.
 *
 * `WITH SCHEMA public` is load-bearing, not tidiness. An unqualified
 * `CREATE EXTENSION` installs into the first schema on `search_path`, which
 * defaults to `"$user", public` — and the scaffold's database role is named
 * `rebase`, the same as the schema the generator creates one statement earlier.
 * So the moment that schema exists, `CREATE EXTENSION unaccent` puts the
 * dictionary in `rebase`, and every reference to `public.unaccent` below fails
 * with "text search dictionary does not exist". Observed, not theorised.
 */
export const searchExtensionStatements = (spec: SearchColumnSpec): string[] =>
    spec.extensions.map(e => `CREATE EXTENSION IF NOT EXISTS ${e} WITH SCHEMA ${HELPER_SCHEMA};`);

/** The column definition as it appears inside `CREATE TABLE`. */
export const searchColumnDefinition = (spec: SearchColumnSpec): string =>
    `"${spec.column}" tsvector GENERATED ALWAYS AS (${spec.expression}) STORED`;

/** The fuzzy column definition, when the spec asks for one. */
export const fuzzyColumnDefinition = (spec: SearchColumnSpec): string | undefined =>
    spec.fuzzy ? `"${spec.fuzzy.column}" text GENERATED ALWAYS AS (${spec.fuzzy.expression}) STORED` : undefined;

/**
 * Index statements for the spec.
 *
 * `CONCURRENTLY` is deliberately *not* used here: this form runs inside the
 * same transaction as the `CREATE TABLE` that precedes it, where a concurrent
 * build is not allowed and not needed (the table is empty and unreachable).
 * The boot-time ensure path, which meets populated tables, uses the
 * concurrent form instead — see `ensureSearchColumns`.
 */
export const searchIndexStatements = (spec: SearchColumnSpec): string[] => {
    const statements = [
        `CREATE INDEX IF NOT EXISTS "${spec.indexName}" ON "${spec.schema}"."${spec.table}" USING GIN ("${spec.column}");`
    ];
    if (spec.fuzzy) {
        statements.push(
            // The operator class is resolved through `search_path` like any
            // other object, so it is qualified for the same reason the
            // extension is installed explicitly.
            `CREATE INDEX IF NOT EXISTS "${spec.fuzzy.indexName}" ON "${spec.schema}"."${spec.table}" USING GIN ("${spec.fuzzy.column}" ${HELPER_SCHEMA}.gin_trgm_ops);`
        );
    }
    return statements;
};

// ── Keeping the generated columns out of responses ──────────────────────────

/**
 * The generated column names a collection's search block adds, if any.
 *
 * These are physical columns on the table, so `SELECT *` returns them. They are
 * an index in column form — a list of lexeme positions, or a concatenation of
 * every searchable field on the row — and nothing outside the query planner has
 * any use for them. Left in, every list response carries a second, larger copy
 * of the row's text.
 */
export const searchColumnNames = (collection: CollectionConfig): string[] => {
    let spec: SearchColumnSpec | undefined;
    try {
        spec = buildSearchColumnSpec(collection);
    } catch {
        // A malformed block is reported at boot, loudly. A read is the wrong
        // place to raise it a second time, and returning the row without the
        // exclusion would be worse than returning it with.
        return [];
    }
    if (!spec) return [];
    return spec.fuzzy ? [spec.column, spec.fuzzy.column] : [spec.column];
};

/**
 * True for a column whose type only ever holds a search index.
 *
 * Independent of any collection config on purpose: an introspected database
 * (BaaS mode) can carry a `tsvector` column this framework never created —
 * Pagila's `film.fulltext` is the canonical one — and it should not be returned
 * to callers either. `isDerivedIndexColumn` already keeps such a column out of
 * the *properties*; this keeps it out of the *rows*.
 */
export const isSearchIndexColumn = (column: { getSQLType?: () => string }): boolean => {
    const sqlType = typeof column?.getSQLType === "function" ? column.getSQLType().toLowerCase() : "";
    return sqlType === "tsvector" || sqlType === "tsquery";
};

/**
 * A drizzle select projection over `table` with the search columns dropped.
 *
 * Returns undefined when nothing needs dropping, so the common case keeps using
 * a plain `select()` and this stays invisible in the generated SQL.
 */
export const visibleColumnProjection = (
    tableColumns: Record<string, { getSQLType?: () => string }> | undefined,
    collection?: CollectionConfig
): Record<string, unknown> | undefined => {
    const excluded = excludedColumnNames(tableColumns, collection);
    if (!tableColumns || excluded.length === 0) return undefined;
    const projection: Record<string, unknown> = {};
    for (const [name, column] of Object.entries(tableColumns)) {
        if (!excluded.includes(name)) projection[name] = column;
    }
    return projection;
};

/** The same exclusion as a drizzle `db.query` `columns` denylist. */
export const hiddenColumnsOption = (
    tableColumns: Record<string, { getSQLType?: () => string }> | undefined,
    collection?: CollectionConfig
): Record<string, false> | undefined => {
    const excluded = excludedColumnNames(tableColumns, collection);
    if (excluded.length === 0) return undefined;
    return Object.fromEntries(excluded.map(name => [name, false as const]));
};

/**
 * The columns to keep out of a response, by name.
 *
 * `tableColumns` is whatever `getTableColumns` returned, which is `undefined`
 * for anything that is not a real drizzle table — a stub in a test, a derived
 * or nested path with no table behind it. Nothing to exclude is the right
 * answer there, and it has to be an answer rather than a throw: this runs on
 * the read path of every collection, opted in or not.
 */
const excludedColumnNames = (
    tableColumns: Record<string, { getSQLType?: () => string }> | undefined,
    collection?: CollectionConfig
): string[] => {
    if (!tableColumns || typeof tableColumns !== "object") return [];
    const byName = new Set(collection ? searchColumnNames(collection) : []);
    return Object.keys(tableColumns).filter(
        name => byName.has(name) || isSearchIndexColumn(tableColumns[name])
    );
};
