/**
 * Compare the committed `schema.generated.ts` against the live catalogue, and
 * say so — once per difference, at boot, as a warning and nothing more.
 *
 * The runtime stopped reading that file for its tables (see
 * `catalogue-schema.ts`), which removes an entire class of production failure
 * and creates a smaller one: a stale file is now *invisible*. It is still real —
 * it is what Atlas plans migrations from, what `db push` diffs, what `eject`
 * writes out and what user code imports — so a project whose file no longer
 * describes its database will hit it later, in a tool, with no clue that boot
 * already knew.
 *
 * Hence this: a guard rather than a doc. It never fails boot and never changes
 * what is served — the previous arrangement, where the file could do both,
 * is exactly what was removed.
 *
 * `generated-schema-staleness.ts` answers a narrower question (does the file
 * name every table the collections do) from the file's *source text*. This one
 * compares the loaded module against the database, column by column.
 */
import { getTableColumns, getTableName as drizzleTableName, isTable } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { CollectionConfig } from "@rebasepro/types";
import { fieldKeyForColumn, getTableName } from "@rebasepro/common";
import { logger } from "@rebasepro/server";

import { AUTH_USERS_COLUMNS, isAuthCollection } from "./auth-users-columns";
import type { TableMeta } from "./introspect-db-logic";
import { bareTableName } from "./config-relations";

export type SchemaDifferenceKind =
    | "missing-table"
    | "missing-column"
    | "extra-column"
    | "type"
    | "nullability";

export interface SchemaDifference {
    kind: SchemaDifferenceKind;
    /** Bare table name, as both sides spell it. */
    table: string;
    /** The collection backed by that table, when one is. */
    collection?: string;
    /** The column, in database terms. */
    column?: string;
    /** The field it is served under — the property key, where there is one. */
    property?: string;
    /** What `schema.generated.ts` says. */
    generated?: string;
    /** What the database says. */
    live?: string;
}

/**
 * The families a boot warning is worth raising over.
 *
 * Deliberately coarse. `varchar(120)` and `text` are the same family because the
 * runtime treats them identically and a warning about the difference would fire
 * on every boot of a correct project — the widths still reach Postgres, which
 * enforces them. What this is looking for is the kind of drift that changes what
 * a value *is*: a number that became text, a timestamp that became a date, a
 * column that stopped existing.
 */
export function typeFamily(sqlType: string | undefined): string {
    if (!sqlType) return "unknown";
    let type = sqlType.trim().toLowerCase();
    const isArray = type.endsWith("[]") || type.startsWith("_");
    type = type.replace(/\[\]$/, "").replace(/^_/, "");
    // Strip the modifier: varchar(255), numeric(10,2), vector(1536), char(2).
    type = type.replace(/\s*\([^)]*\)\s*$/, "").trim();

    const family = FAMILIES[type] ?? type;
    return isArray ? `${family}[]` : family;
}

const FAMILIES: Record<string, string> = {
    // strings
    text: "text",
    varchar: "text",
    "character varying": "text",
    bpchar: "text",
    char: "text",
    character: "text",
    citext: "text",
    name: "text",
    // integers
    int2: "integer",
    smallint: "integer",
    smallserial: "integer",
    int4: "integer",
    int: "integer",
    integer: "integer",
    serial: "integer",
    int8: "bigint",
    bigint: "bigint",
    bigserial: "bigint",
    // approximate and exact numerics: kept apart, because one rounds
    float4: "float",
    real: "float",
    float8: "float",
    "double precision": "float",
    numeric: "numeric",
    decimal: "numeric",
    money: "numeric",
    // the rest
    bool: "boolean",
    boolean: "boolean",
    uuid: "uuid",
    json: "json",
    jsonb: "jsonb",
    date: "date",
    time: "time",
    "time without time zone": "time",
    timetz: "time",
    "time with time zone": "time",
    timestamp: "timestamp",
    "timestamp without time zone": "timestamp",
    timestamptz: "timestamptz",
    "timestamp with time zone": "timestamptz",
    interval: "interval",
    bytea: "bytea",
    tsvector: "tsvector",
    tsquery: "tsquery",
    vector: "vector"
};

/** One catalogue column, reduced to the three facts this compares. */
interface CatalogueColumn {
    name: string;
    family: string;
    notNull: boolean;
}

function catalogueColumns(meta: TableMeta): Map<string, CatalogueColumn> {
    const columns = new Map<string, CatalogueColumn>();
    for (const col of meta.columns) {
        columns.set(col.column_name, {
            name: col.column_name,
            // `udt_name` over `data_type`: the latter reports "ARRAY" and
            // "USER-DEFINED" where the former is the concrete type, and an enum
            // has to compare by its own type name against the module's pgEnum.
            family: typeFamily(col.udt_name || col.data_type),
            notNull: col.is_nullable === "NO"
        });
    }
    return columns;
}

/**
 * Every way the generated module and the database disagree, for the tables both
 * describe.
 *
 * One-directional in one respect only: a table the module has and the database
 * does not is reported (that is the stale-file case), while a table the database
 * has and the module does not is left alone — a database may hold anything, and
 * the collections-vs-file question is `generated-schema-staleness`'s.
 */
export function diffGeneratedSchemaAgainstCatalogue(options: {
    /** The `tables` export of the bundle's schema module. */
    generated: Record<string, unknown> | undefined;
    /** What was introspected for this data source, keyed by bare table name. */
    catalogue: Map<string, TableMeta>;
    /** Collections of this source, so a column can be named as a property. */
    collections: CollectionConfig[];
}): SchemaDifference[] {
    const { generated, catalogue, collections } = options;
    if (!generated) return [];

    const collectionByTable = new Map<string, CollectionConfig>();
    for (const collection of collections) {
        const table = getTableName(collection);
        if (table) collectionByTable.set(bareTableName(table), collection);
    }

    const differences: SchemaDifference[] = [];

    for (const value of Object.values(generated)) {
        if (!isTable(value)) continue;
        const table = drizzleTableName(value as PgTable);
        const collection = collectionByTable.get(table);
        const at = { table, collection: collection?.slug };

        const meta = catalogue.get(table);
        if (!meta) {
            // Only for a table a collection of this source claims: the module
            // carries every table of the project, including the ones another
            // data source holds, and those are legitimately absent here.
            if (collection) differences.push({ ...at, kind: "missing-table" });
            continue;
        }

        const live = catalogueColumns(meta);
        const seen = new Set<string>();

        // On the auth table, auth owns its own columns' contract and the
        // generated file deliberately does not carry it: `render-drizzle` drops
        // the columns a users collection does not declare (`is_anonymous`,
        // `tokens_valid_after`) because drizzle-kit creates no auth table, and
        // the collection's own property definitions say nothing about the
        // `NOT NULL DEFAULT` that `ensureAuthTablesExist` applies.
        //
        // Comparing them anyway reported seven differences on a project nobody
        // had touched yet, and prescribed `rebase schema generate` — which
        // regenerates the file from the same collection and cannot change any
        // of them. A warning that survives its own remedy teaches the reader to
        // ignore the next one, so these are not differences. A *type* mismatch
        // still is: that is the file and the database disagreeing about
        // something neither side intends.
        const authOwned = isAuthCollection(collection)
            ? new Set(AUTH_USERS_COLUMNS.map(c => c.column))
            : undefined;

        for (const [key, column] of Object.entries(getTableColumns(value as PgTable))) {
            const name = (column as { name?: string }).name ?? key;
            seen.add(name);
            const property = collection ? fieldKeyForColumn(collection, name) : key;
            const generatedFamily = typeFamily((column as { getSQLType?: () => string }).getSQLType?.());
            const generatedNotNull = Boolean((column as { notNull?: boolean }).notNull);

            const found = live.get(name);
            if (!found) {
                differences.push({ ...at, kind: "missing-column", column: name, property, generated: generatedFamily });
                continue;
            }
            if (found.family !== generatedFamily) {
                differences.push({
                    ...at,
                    kind: "type",
                    column: name,
                    property,
                    generated: generatedFamily,
                    live: found.family
                });
            }
            if (found.notNull !== generatedNotNull && !authOwned?.has(name)) {
                differences.push({
                    ...at,
                    kind: "nullability",
                    column: name,
                    property,
                    generated: generatedNotNull ? "NOT NULL" : "nullable",
                    live: found.notNull ? "NOT NULL" : "nullable"
                });
            }
        }

        for (const [name, column] of live) {
            if (seen.has(name)) continue;
            if (authOwned?.has(name)) continue;
            differences.push({
                ...at,
                kind: "extra-column",
                column: name,
                property: collection ? fieldKeyForColumn(collection, name) : name,
                live: column.family
            });
        }
    }

    return differences;
}

/** One line, in the terms the reader has: collection, property, column. */
export function describeSchemaDifference(difference: SchemaDifference): string {
    const where = difference.collection
        ? `${difference.collection} (table "${difference.table}")`
        : `table "${difference.table}"`;
    const field = difference.column
        ? `${difference.property && difference.property !== difference.column
            ? `${difference.property} → "${difference.column}"`
            : `"${difference.column}"`}`
        : undefined;

    switch (difference.kind) {
        case "missing-table":
            return `${where} is in schema.generated.ts but not in the database`;
        case "missing-column":
            return `${where}: ${field} is in schema.generated.ts but not in the database`;
        case "extra-column":
            return `${where}: ${field} is in the database but not in schema.generated.ts (${difference.live})`;
        case "type":
            return `${where}: ${field} is ${difference.generated} in schema.generated.ts and ${difference.live} in the database`;
        case "nullability":
            return `${where}: ${field} is ${difference.generated} in schema.generated.ts and ${difference.live} in the database`;
    }
}

/**
 * Report the differences, one warning each, and never throw.
 *
 * Per difference rather than one summary block on purpose: these are read out of
 * a log aggregator as often as a terminal, and a single multi-line message
 * cannot be filtered down to the one collection somebody is looking at.
 */
export function warnOnGeneratedSchemaDrift(differences: SchemaDifference[]): void {
    if (differences.length === 0) return;

    logger.warn(
        `📄 [schema] schema.generated.ts no longer describes the database (${differences.length} difference` +
        `${differences.length === 1 ? "" : "s"}). The server serves the database, so nothing here is broken — ` +
        "but Atlas, `rebase db push`, `rebase eject` and any code importing that file are all reading a stale " +
        "description. Run `rebase schema generate`."
    );

    for (const difference of differences) {
        logger.warn(`   • ${describeSchemaDifference(difference)}`, {
            schemaDrift: {
                kind: difference.kind,
                table: difference.table,
                collection: difference.collection,
                column: difference.column,
                property: difference.property,
                generated: difference.generated,
                live: difference.live
            },
            fix: "rebase schema generate"
        });
    }
}
