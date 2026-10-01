/**
 * A collection's `search` block, read back out of the column it built.
 *
 * A Rebase search column is `tsvector GENERATED ALWAYS AS (…) STORED`, stamped
 * with a fingerprint of the expression in its `COMMENT`. Introspection used to
 * emit it as an ordinary read-only string property, which the planner makes a
 * `text` column — so the first push after adopting a Rebase database planned
 * `ALTER COLUMN "search_vector" TYPE text … DROP EXPRESSION`, and search was
 * gone for whoever approved it.
 *
 * Reading the block back is a guess checked by the stamp: the deparsed
 * expression names each field's column, weight and language, which is enough
 * to write a candidate block; the candidate is then compiled by the very code
 * that built the column, and kept only if its fingerprint is the one the column
 * carries. A block that does not reproduce the stamp is not emitted at all —
 * the note says so — because a wrong one would rebuild the column differently.
 *
 * `mode` and `fuzzyThreshold` act at query time and are stored nowhere, so they
 * come back as their defaults.
 */
import {
    DEFAULT_SEARCH_COLUMN,
    DEFAULT_SEARCH_LANGUAGE,
    type PostgresCollectionConfig,
    type PostgresProperties,
    type PostgresProperty,
    type SearchConfig
} from "@rebasepro/types";
import { buildSearchColumnSpec, searchColumnStamps, SEARCH_STAMP_PREFIX } from "./search-column";
import type { TableColumn } from "./introspect-db-logic";

/** What introspection makes of a table's search columns. */
export interface ReconstructedSearch {
    /** The generated columns that belong to the search block — never emitted as properties. */
    columns: Set<string>;
    /** The `search: { … }` source, when the stamp confirmed it. */
    block?: string;
    note?: string;
}

/** One `setweight(to_tsvector('<lang>'::regconfig, <text>), '<W>'::"char")`, deparsed. */
const SEGMENT = /setweight\(to_tsvector\('((?:[^']|'')+)'::regconfig, ([\s\S]+?)\), '([A-D])'::"char"\)/g;

/** A property with the column's shape, for the candidate block to resolve against. */
function propertyFor(col: TableColumn): PostgresProperty | undefined {
    if (col.data_type === "text" || col.data_type === "character varying" || col.data_type === "character") {
        return { name: col.column_name, type: "string", columnName: col.column_name };
    }
    if (col.udt_name === "_text") {
        return { name: col.column_name, type: "array", columnName: col.column_name, of: { name: col.column_name, type: "string" } };
    }
    if (col.data_type === "jsonb") {
        return { name: col.column_name, type: "map", columnName: col.column_name, keyValue: true };
    }
    return undefined;
}

/**
 * The search block a table's stamped generated columns were built from, or a
 * note saying why it could not be read back.
 */
export function reconstructSearchBlock(input: {
    schema: string;
    table: string;
    columns: TableColumn[];
    /** column → `COMMENT ON COLUMN`. */
    comments: Map<string, string>;
    /** column → the property key it is generated under. */
    keyByColumn: Map<string, string>;
}): ReconstructedSearch {
    const stamped = input.columns.filter(col =>
        col.is_generated === "ALWAYS" && (input.comments.get(col.column_name) ?? "").startsWith(SEARCH_STAMP_PREFIX));
    const main = stamped.find(col => col.udt_name === "tsvector");
    if (!main) return { columns: new Set() };
    const fuzzy = stamped.find(col => col.column_name === `${main.column_name}_text`);
    const columns = new Set(stamped.map(col => col.column_name));

    const unreadable = (why: string): ReconstructedSearch => ({
        columns,
        note: `"${main.column_name}" is a Rebase search column whose \`search\` block could not be read back (${why}). ` +
            "Declare the block again before pushing — without it a push plans dropping the column."
    });

    const expression = main.generation_expression ?? "";
    const byColumn = new Map(input.columns.map(col => [col.column_name, col]));
    const fields: { path: string; weight: string }[] = [];
    let language: string | undefined;
    let unaccent = false;
    for (const [, lang, inner, weight] of expression.matchAll(SEGMENT)) {
        language ??= lang.replace(/''/g, "'");
        if (lang.replace(/''/g, "'") !== language) return unreadable("its fields use different languages");
        if (inner.includes("rebase_search_unaccent")) unaccent = true;
        // The field's column is the first identifier in it that this table has.
        const column = [...inner.matchAll(/"?([A-Za-z_][A-Za-z0-9_$]*)"?/g)]
            .map(m => m[1])
            .find(name => byColumn.has(name) && !columns.has(name));
        if (!column) return unreadable("a field reads no column of this table");
        const key = input.keyByColumn.get(column);
        if (!key) return unreadable(`the column "${column}" is not a property`);
        const jsonPath = [...inner.matchAll(/(?:->|#>)\s*'([^']+)'/g)]
            .flatMap(m => m[1].replace(/^\{|\}$/g, "").split(","));
        fields.push({ path: [key, ...jsonPath].join("."), weight });
    }
    if (fields.length === 0 || !language) return unreadable("its expression is not one Rebase writes");

    const search: SearchConfig = {
        ...(main.column_name !== DEFAULT_SEARCH_COLUMN ? { column: main.column_name } : {}),
        ...(language !== DEFAULT_SEARCH_LANGUAGE ? { language } : {}),
        ...(unaccent ? { unaccent: true } : {}),
        ...(fuzzy ? { fuzzy: true } : {}),
        fields: fields.map(f => ({ path: f.path, weight: f.weight as "A" | "B" | "C" | "D" }))
    };

    // Compiled by the code that built the column, and kept only if it is the
    // same column: the fingerprint is a hash of the exact expression.
    const properties: PostgresProperties = {};
    for (const [column, key] of input.keyByColumn) {
        const col = byColumn.get(column);
        const prop = col ? propertyFor(col) : undefined;
        if (prop) properties[key] = prop;
    }
    const candidate: PostgresCollectionConfig = {
        slug: input.table,
        name: input.table,
        table: input.table,
        ...(input.schema !== "public" ? { schema: input.schema } : {}),
        properties,
        search
    };
    let fingerprints: Map<string, string>;
    try {
        const spec = buildSearchColumnSpec(candidate);
        if (!spec) return unreadable("no block compiles from it");
        fingerprints = new Map(searchColumnStamps(spec).map(stamp => [stamp.column, stamp.fingerprint]));
    } catch (err) {
        return unreadable(err instanceof Error ? err.message : String(err));
    }
    for (const col of stamped) {
        if (fingerprints.get(col.column_name) !== input.comments.get(col.column_name)) {
            return unreadable("the block read from its expression does not reproduce the column's stamp");
        }
    }

    const lines = [
        ...(search.column ? [`column: ${JSON.stringify(search.column)}`] : []),
        ...(search.language ? [`language: ${JSON.stringify(search.language)}`] : []),
        ...(search.unaccent ? ["unaccent: true"] : []),
        ...(search.fuzzy ? ["fuzzy: true"] : []),
        `fields: [\n${fields.map(f => `            { path: ${JSON.stringify(f.path)}, weight: ${JSON.stringify(f.weight)} }`).join(",\n")}\n        ]`
    ];
    return { columns, block: `\n    search: {\n        ${lines.join(",\n        ")}\n    },` };
}
