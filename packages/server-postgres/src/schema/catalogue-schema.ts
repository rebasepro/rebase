/**
 * The runtime's Drizzle schema, read back from the database it is about to
 * serve.
 *
 * This is the whole point of the module: **the live catalogue is the schema**.
 * Boot-ensure has already created and altered whatever the tables describe
 * by the time this runs, so `information_schema` is both current and complete,
 * and the committed `schema.generated.ts` — which is a build artefact for Atlas,
 * `db push`, `eject` and user code — never decides what the server serves.
 *
 * It used to. The default data source was handed the bundle's generated module
 * and nothing reconciled it, so a file one commit behind the database changed
 * behaviour in ways that looked nothing like "your schema file is old":
 *
 *  - a foreign-key column renamed by boot-ensure (`categorie_id` → `category_id`)
 *    left every request 500ing, because the module still declared the old name;
 *  - a property added to a collection answered `400 VALIDATION_UNKNOWN_FIELDS`
 *    on first save, because the write check reads the table and the table came
 *    from the file, while the column itself existed;
 *  - relations missing from the module were silently missing from list reads.
 *
 * The catalogue cannot drift from itself. What the generated module is still
 * good for is telling the developer their file is stale — see
 * `generated-schema-diff.ts`, which is now its only reader at boot.
 */
import type { PgTable } from "drizzle-orm/pg-core";
import type { Relations } from "drizzle-orm";
import type { TableDescriptor } from "@rebasepro/types";
import { declaredSchemaOf, keyForColumn, resolveTableJunctions } from "@rebasepro/common";
import { toWireKey } from "@rebasepro/utils";

import { buildDrizzleRelationsFromSchema, buildDrizzleTablesFromSchema, type ColumnKeyResolver } from "./dynamic-tables";
import { bareTableName, buildDrizzleRelationsFromTables } from "./config-relations";
import { introspectSchema, type Queryable } from "./introspect-runtime";
import type { TableMeta } from "./introspect-db-logic";
import { tableSearchColumnNames } from "./search-column";

/** The Postgres schema a table lives in: the one it declares, else `fallback`. */
export function schemaOfTable(table: Pick<TableDescriptor, "schema">, fallback: string): string {
    return declaredSchemaOf(table) ?? fallback;
}

/**
 * How a column of each table is keyed in the Drizzle object.
 *
 * The wire name, which is the column's key — `authorId`, never `author_id` —
 * because that is what every read and write path in this driver indexes tables
 * and rows by, and what the generated module has always emitted. Getting this
 * wrong does not throw: drizzle leaves an unknown key out of the statement and
 * the write reports success having stored nothing. A column the table does not
 * describe is keyed by the camelCase of its name, which is the key a foreign
 * key derived from it would get.
 *
 * Two exceptions, both columns no table declares:
 *
 *  - the generated search columns keep their raw names, because `search_vector`
 *    is how `searchColumnNames` excludes them from responses and how the
 *    condition builder finds the one to match against;
 *  - a table no descriptor claims (a junction) is keyed by its **key** columns'
 *    names, which is also what the generated file does for them — but a
 *    junction that declares `pivot` columns keys those payload columns by
 *    their column key, for the same reason a table does. `joinedAt` with
 *    column `joined_at` has to be one name on both sides or a `_pivot` write
 *    is silently dropped by drizzle and the read serves a key the caller never
 *    declared.
 */
export function columnKeysFromTables(
    descriptors: readonly TableDescriptor[]
): ColumnKeyResolver {
    const byTable = new Map<string, TableDescriptor>();
    const rawColumns = new Map<string, Set<string>>();
    for (const descriptor of descriptors) {
        const table = bareTableName(descriptor.table);
        byTable.set(table, descriptor);
        rawColumns.set(table, new Set(tableSearchColumnNames(descriptor)));
    }
    // The junctions' payload columns, as the pivot the planner emitted them
    // from, so the runtime table and the generated one cannot key them
    // differently.
    const junctionByTable = new Map<string, { keyColumns: Set<string>; pivot: Map<string, string> }>();
    for (const junction of resolveTableJunctions(descriptors).values()) {
        if (junction.pivot.length === 0) continue;
        junctionByTable.set(junction.table, {
            keyColumns: new Set(junction.endpoints.map(endpoint => endpoint.junctionColumn)),
            pivot: new Map(junction.pivot.map(column => [column.column, column.key]))
        });
    }
    return (tableName, columnName) => {
        const descriptor = byTable.get(tableName);
        if (!descriptor) {
            const junction = junctionByTable.get(tableName);
            if (!junction || junction.keyColumns.has(columnName)) return columnName;
            return junction.pivot.get(columnName) ?? toWireKey(columnName);
        }
        if (rawColumns.get(tableName)?.has(columnName)) return columnName;
        return keyForColumn(descriptor, columnName) ?? toWireKey(columnName);
    };
}

export interface CatalogueSchema {
    /** Drizzle tables, keyed by bare table name. */
    tables: Record<string, PgTable>;
    /** Drizzle relations, keyed `<table>Relations`. */
    relations: Record<string, Relations>;
    /** Introspected metadata per table — what the boot diff compares against. */
    meta: Map<string, TableMeta>;
    /** Tables declared for this source that the database does not have. */
    missing: string[];
}

/**
 * Read the tables this data source serves out of `information_schema`.
 *
 * Restricted to the tables handed in, because the driver is given every table
 * the project declares while each database holds only its own: an unfiltered
 * read had a second source (`database("analytics")`) reporting the default's
 * tables as its own. Junction tables come too — they back no declared table
 * and a many-to-many is unreadable without them.
 *
 * Every schema the tables name is read, not just `public`. The users table
 * lives in `rebase`, and a run restricted to `public` would leave the registry
 * with no table for it at all. A table that declares no schema is read from
 * `defaultSchema`.
 */
export async function readCatalogueSchema(options: {
    client: Queryable;
    /** This data source's tables, and the targets of their relations. */
    tables: readonly TableDescriptor[];
    defaultSchema: string;
}): Promise<CatalogueSchema> {
    const { client, tables: descriptors, defaultSchema } = options;

    /** schema → the tables wanted from it. */
    const wanted = new Map<string, Set<string>>();
    const want = (schema: string, table: string) => {
        const set = wanted.get(schema) ?? new Set<string>();
        wanted.set(schema, set);
        set.add(table);
    };

    for (const descriptor of descriptors) {
        want(schemaOfTable(descriptor, defaultSchema), bareTableName(descriptor.table));
    }
    // Junctions are created in `public`, full stop — `resolveTableJunctions`
    // hardcodes it and the three generators agree with it.
    for (const junction of resolveTableJunctions(descriptors).values()) {
        want(junction.schema, junction.table);
    }

    const columnKey = columnKeysFromTables(descriptors);
    const tables: Record<string, PgTable> = {};
    const meta = new Map<string, TableMeta>();
    const missing: string[] = [];

    for (const [schema, names] of wanted) {
        // Views too: a `defineView` reads one.
        const live = await introspectSchema(client, schema, { views: true });
        const present = new Map<string, TableMeta>();
        for (const name of names) {
            const found = live.tablesMap.get(name);
            if (!found) {
                missing.push(schema === defaultSchema ? name : `${schema}.${name}`);
                continue;
            }
            // First schema to carry a name wins. Two schemas holding a table of
            // the same name is the `search_path` hazard the drift report
            // explains; the registry is keyed by bare name either way, so this
            // only picks which one is served — the one whose table asked.
            if (tables[name]) continue;
            present.set(name, found);
            meta.set(name, found);
        }
        Object.assign(tables, buildDrizzleTablesFromSchema(present, schema, columnKey));
    }

    return {
        tables,
        relations: buildDrizzleRelationsFromTables(descriptors, tables),
        meta,
        missing
    };
}

/**
 * The BaaS variant: no tables are declared, so every table in one schema is
 * served, described from the catalogue (`descriptors`), and the relations are
 * derived from the foreign keys.
 *
 * Kept apart from {@link readCatalogueSchema} because the two answer different
 * questions. Here the database is the entire specification; there it supplies
 * the columns for a specification the project already wrote down.
 */
export function buildBaasSchema(
    tablesMap: Map<string, TableMeta>,
    pgSchemaName: string,
    descriptors: readonly TableDescriptor[]
): { tables: Record<string, PgTable>; relations: Record<string, Relations> } {
    const columnKey = columnKeysFromTables(descriptors);
    const tables = buildDrizzleTablesFromSchema(tablesMap, pgSchemaName, columnKey);
    return {
        tables,
        relations: buildDrizzleRelationsFromSchema(tablesMap, tables, columnKey)
    };
}
