/**
 * The runtime's Drizzle schema, read back from the database it is about to
 * serve.
 *
 * This is the whole point of the module: **the live catalogue is the schema**.
 * Boot-ensure has already created and altered whatever the collections describe
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
import { CollectionConfig } from "@rebasepro/types";
import { fieldKeyForColumn, getJunctionCollectionConfig, getTableName, resolveJunctionSpecs } from "@rebasepro/common";

import { buildDrizzleRelationsFromSchema, buildDrizzleTablesFromSchema, type ColumnKeyResolver } from "./dynamic-tables";
import { bareTableName, buildDrizzleRelationsFromCollections } from "./config-relations";
import { introspectSchema, type Queryable } from "./introspect-runtime";
import type { TableMeta } from "./introspect-db-logic";
import { searchColumnNames } from "./search-column";

/** The Postgres schema a collection's table lives in. */
export function schemaOfCollection(collection: CollectionConfig, fallback: string): string {
    const declared = (collection as { schema?: unknown }).schema;
    return typeof declared === "string" && declared.length > 0 ? declared : fallback;
}

/**
 * How a column of each table is keyed in the Drizzle object.
 *
 * The wire name, which is the property key — `authorId`, never `author_id` —
 * because that is what every read and write path in this driver indexes tables
 * and rows by, and what the generated module has always emitted. Getting this
 * wrong does not throw: drizzle leaves an unknown key out of the statement and
 * the write reports success having stored nothing.
 *
 * Two exceptions, both columns no property declares:
 *
 *  - the generated search columns keep their raw names, because `search_vector`
 *    is how `searchColumnNames` excludes them from responses and how the
 *    condition builder finds the one to match against;
 *  - a table no collection claims (a junction) is keyed by its **key** columns'
 *    names, which is also what the generated file does for them — but a
 *    junction that declares `through.properties` keys those payload columns by
 *    their property key, for the same reason a collection does. `joinedAt` with
 *    `columnName: "joined_at"` has to be one name on both sides or a `_pivot`
 *    write is silently dropped by drizzle and the read serves a key the caller
 *    never declared.
 */
export function columnKeysFromCollections(
    collections: CollectionConfig[]
): ColumnKeyResolver {
    const byTable = new Map<string, CollectionConfig>();
    const rawColumns = new Map<string, Set<string>>();
    for (const collection of collections) {
        const table = bareTableName(getTableName(collection));
        if (!table) continue;
        byTable.set(table, collection);
        rawColumns.set(table, new Set(searchColumnNames(collection)));
    }
    // The junctions' payload columns, as the synthetic collection that owns
    // them — the same one the planner emitted the columns from, so the runtime
    // table and the generated one cannot key them differently.
    const junctionByTable = new Map<string, CollectionConfig>();
    for (const spec of resolveJunctionSpecs(collections).values()) {
        if (Object.keys(spec.properties).length === 0) continue;
        junctionByTable.set(bareTableName(spec.table), getJunctionCollectionConfig(spec));
    }
    return (tableName, columnName) => {
        const collection = byTable.get(tableName);
        if (!collection) {
            const junction = junctionByTable.get(tableName);
            return junction ? fieldKeyForColumn(junction, columnName) : columnName;
        }
        if (rawColumns.get(tableName)?.has(columnName)) return columnName;
        return fieldKeyForColumn(collection, columnName);
    };
}

export interface CatalogueSchema {
    /** Drizzle tables, keyed by bare table name. */
    tables: Record<string, PgTable>;
    /** Drizzle relations, keyed `<table>Relations`. */
    relations: Record<string, Relations>;
    /** Introspected metadata per table — what the boot diff compares against. */
    meta: Map<string, TableMeta>;
    /** Tables a collection declares that the database does not have. */
    missing: string[];
}

/**
 * Read the tables this data source serves out of `information_schema`.
 *
 * Restricted to the collections handed in, because the driver is given every
 * collection the project declares while each database holds only its own: an
 * unfiltered read had a second source (`database("analytics")`) reporting the
 * default's tables as its own. Junction tables come too — they back no
 * collection and a many-to-many is unreadable without them.
 *
 * Every schema the collections name is read, not just `public`. The users
 * collection lives in `rebase`, and a run restricted to `public` would leave the
 * registry with no table for it at all.
 */
export async function readCatalogueSchema(options: {
    client: Queryable;
    collections: CollectionConfig[];
    defaultSchema: string;
}): Promise<CatalogueSchema> {
    const { client, collections, defaultSchema } = options;

    /** schema → the tables wanted from it. */
    const wanted = new Map<string, Set<string>>();
    const want = (schema: string, table: string) => {
        const set = wanted.get(schema) ?? new Set<string>();
        wanted.set(schema, set);
        set.add(table);
    };

    for (const collection of collections) {
        const table = bareTableName(getTableName(collection));
        if (table) want(schemaOfCollection(collection, defaultSchema), table);
    }
    // Junctions are created in `public`, full stop — `resolveJunctionSpecs`
    // hardcodes it and the three generators agree with it.
    for (const spec of resolveJunctionSpecs(collections).values()) {
        want(spec.schema, bareTableName(spec.table));
    }

    const columnKey = columnKeysFromCollections(collections);
    const tables: Record<string, PgTable> = {};
    const meta = new Map<string, TableMeta>();
    const missing: string[] = [];

    for (const [schema, names] of wanted) {
        const live = await introspectSchema(client, schema);
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
            // only picks which one is served — the one whose collection asked.
            if (tables[name]) continue;
            present.set(name, found);
            meta.set(name, found);
        }
        Object.assign(tables, buildDrizzleTablesFromSchema(present, schema, columnKey));
    }

    return {
        tables,
        relations: buildDrizzleRelationsFromCollections(collections, tables),
        meta,
        missing
    };
}

/**
 * The BaaS variant: no collections are declared, so every table in one schema is
 * served and both the collections and the relations are derived from the
 * foreign keys.
 *
 * Kept apart from {@link readCatalogueSchema} because the two answer different
 * questions. Here the database is the entire specification; there it supplies
 * the columns for a specification the project already wrote down.
 */
export function buildBaasSchema(
    tablesMap: Map<string, TableMeta>,
    pgSchemaName: string,
    collections: CollectionConfig[]
): { tables: Record<string, PgTable>; relations: Record<string, Relations> } {
    const columnKey = columnKeysFromCollections(collections);
    const tables = buildDrizzleTablesFromSchema(tablesMap, pgSchemaName, columnKey);
    return {
        tables,
        relations: buildDrizzleRelationsFromSchema(tablesMap, tables, columnKey)
    };
}
