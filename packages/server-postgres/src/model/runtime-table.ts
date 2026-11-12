import type { PgTable } from "drizzle-orm/pg-core";
import type { ColumnDescriptor, CompiledTable, RelationDescriptor, TableDescriptor } from "@rebasepro/types";
import { columnMaps, keyColumns, type TableKeyColumn } from "@rebasepro/common";

/**
 * One table as this driver runs it: the compiled table the server handed over
 * (`CompiledTable` — descriptor, hooks, field-level hooks, definition), the
 * drizzle table read back from this database's catalogue, and the lookups
 * every request makes, built once.
 *
 * Two sources, each the truth for its own facts:
 *
 * - the **descriptor** says what the table *is*: which columns it has and
 *   under which keys, which of them form the key, what each stamps, who may
 *   read it, which relations it has (each naming its target by slug);
 * - the **catalogue table** (`pg`) is what Postgres holds right now, and what
 *   every statement is built on — the SQL truth. It is `undefined` when this
 *   database holds no such table: a table routed to another data source, or
 *   one the schema has not been applied for yet.
 *
 * Built by the registry (`PostgresTableRegistry.registerTables`), never by
 * hand, and replaced — not mutated — when the catalogue table is registered
 * after it.
 */
export interface RuntimeTable {
    /** What the server compiled. */
    readonly compiled: CompiledTable;
    /** `compiled.descriptor`, for the overwhelmingly common read. */
    readonly descriptor: TableDescriptor;
    /** The table's slug: what the registry, the routes and scopes name it by. */
    readonly slug: string;
    /** The drizzle table read back from this database's catalogue, when it holds the table. */
    readonly pg: PgTable | undefined;
    /** Every column by key. */
    readonly columnsByKey: ReadonlyMap<string, ColumnDescriptor>;
    /** Every column by SQL name. */
    readonly columnsBySqlName: ReadonlyMap<string, ColumnDescriptor>;
    /**
     * Every relation by name. A relation's `target` is the target table's
     * slug: look it up in the registry (`requireTable(relation.target)`).
     */
    readonly relations: ReadonlyMap<string, RelationDescriptor>;
    /** The primary-key columns, in key order (`keyColumns`). Empty only for an introspected keyless table. */
    readonly keys: readonly TableKeyColumn[];
}

/**
 * The runtime record of one compiled table over its catalogue table.
 *
 * @param pg The drizzle table this database's catalogue holds for it, or
 *   `undefined` when it holds none.
 */
export function buildRuntimeTable(compiled: CompiledTable, pg: PgTable | undefined): RuntimeTable {
    const descriptor = compiled.descriptor;
    const { byKey, bySqlName } = columnMaps(descriptor);
    return {
        compiled,
        descriptor,
        slug: descriptor.slug,
        pg,
        columnsByKey: byKey,
        columnsBySqlName: bySqlName,
        relations: new Map(descriptor.relations.map(relation => [relation.name, relation])),
        keys: keyColumns(descriptor)
    };
}

/** The same runtime record over another catalogue table. */
export function withCatalogueTable(table: RuntimeTable, pg: PgTable | undefined): RuntimeTable {
    return { ...table, pg };
}
