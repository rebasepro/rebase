import { CollectionRegistry, resolveCollectionRelations, getTableName } from "@rebasepro/common";
import { type CollectionConfig, type CompiledTable } from "@rebasepro/types";
import { PgEnum, PgTable } from "drizzle-orm/pg-core";
import { Relations } from "drizzle-orm";
import { CollectionRegistryInterface } from "../interfaces";
import { buildRuntimeTable, withCatalogueTable, type RuntimeTable } from "./runtime-table";

/**
 * The tables one Postgres driver serves.
 *
 * Holds, per table, its {@link RuntimeTable} — the compiled table the server
 * handed over, with its catalogue table and lookups — and the drizzle tables,
 * enums and relations read back from this database (junction tables
 * included, which have no runtime table of their own).
 *
 * Every entry also carries the collection its table was lowered into (the
 * inherited `CollectionRegistry` half): the subsystems not yet moved onto
 * runtime tables read it. Both are filled from the same compile, so they
 * cannot disagree about which tables exist; `buildTableRegistry` refuses an
 * entry that has one without the other.
 *
 * From a call site that holds a slug, or a lowered collection:
 * `registry.requireTable(slug)` / `registry.requireTable(collection.slug)`.
 */
export class PostgresTableRegistry extends CollectionRegistry implements CollectionRegistryInterface {

    private readonly runtimeTables = new Map<string, RuntimeTable>();
    private readonly pgTables = new Map<string, PgTable>();
    private readonly enums = new Map<string, PgEnum<[string, ...string[]]>>();
    private readonly relations = new Map<string, Relations>();

    // ── Runtime tables ──────────────────────────────────────────────────────

    /**
     * Register compiled tables. Each becomes a {@link RuntimeTable} over the
     * catalogue table of the same SQL name, when one is registered (now or
     * later, through {@link registerPgTable}). A slug registered again is
     * replaced.
     */
    registerTables(tables: readonly CompiledTable[]): void {
        for (const compiled of tables) {
            const pg = this.pgTables.get(compiled.descriptor.table);
            this.runtimeTables.set(compiled.descriptor.slug, buildRuntimeTable(compiled, pg));
        }
    }

    /** The runtime table served at `/api/data/<slug>`, or `undefined`. */
    getTable(slug: string): RuntimeTable | undefined {
        return this.runtimeTables.get(slug);
    }

    /**
     * The runtime table served at `/api/data/<slug>`. Throws, naming the slug
     * and every table this driver does serve, when there is none — a request
     * that reached the driver for a table it was never given is a wiring
     * defect, never an answer.
     */
    requireTable(slug: string): RuntimeTable {
        const table = this.runtimeTables.get(slug);
        if (table) return table;
        const served = [...this.runtimeTables.keys()];
        throw new Error(
            `The table "${slug}" is not one this driver serves. ` +
            (served.length > 0 ? `It serves: ${served.join(", ")}.` : "It serves no tables.") +
            " Every table reaches the driver compiled from backend/schema (or introspected from the database)."
        );
    }

    /**
     * The runtime table whose SQL name is `name` (unqualified), or `undefined`.
     * The name of a table, never of a junction: those have no runtime table.
     */
    getTableBySqlName(name: string): RuntimeTable | undefined {
        for (const table of this.runtimeTables.values()) {
            if (table.descriptor.table === name) return table;
        }
        return undefined;
    }

    /** Every runtime table, in registration order. */
    tables(): RuntimeTable[] {
        return [...this.runtimeTables.values()];
    }

    // ── Catalogue tables ────────────────────────────────────────────────────

    /**
     * Register a drizzle table read back from the catalogue, under its SQL
     * name. The runtime table of that name, when there is one, is rebuilt over
     * it.
     */
    registerPgTable(table: PgTable, tableName: string): void {
        this.pgTables.set(tableName, table);
        for (const [slug, runtime] of this.runtimeTables) {
            if (runtime.descriptor.table === tableName) this.runtimeTables.set(slug, withCatalogueTable(runtime, table));
        }
    }

    /** The drizzle table with this SQL name — a served table or a junction — or `undefined`. */
    getPgTable(tableName: string): PgTable | undefined {
        return this.pgTables.get(tableName);
    }

    /** Whether a drizzle table with this SQL name is registered. */
    hasPgTable(tableName: string): boolean {
        return this.pgTables.has(tableName);
    }

    /** The SQL names of every registered drizzle table. */
    getPgTableNames(): string[] {
        return Array.from(this.pgTables.keys());
    }

    /**
     * Collections assigned to a data source whose table this database does
     * not hold.
     */
    getCollectionsWithoutTables(dataSourceKey = "(default)"): CollectionConfig[] {
        const collections = this.getCollections().filter(
            c => c.dataSource === dataSourceKey || (!c.dataSource && dataSourceKey === "(default)")
        );
        return collections.filter(c => !this.pgTables.has(getTableName(c)));
    }

    registerEnums(enums: Record<string, PgEnum<[string, ...string[]]>>): void {
        Object.entries(enums).forEach(([name, value]) => this.enums.set(name, value));
    }

    registerRelations(relations: Record<string, Relations>): void {
        Object.entries(relations).forEach(([name, value]) => this.relations.set(name, value));
    }

    getEnum(name: string): PgEnum<[string, ...string[]]> | undefined {
        return this.enums.get(name);
    }

    getRelation(name: string): Relations | undefined {
        return this.relations.get(name);
    }

    getAllEnums(): Record<string, PgEnum<[string, ...string[]]>> {
        return Object.fromEntries(this.enums.entries());
    }

    getAllRelations(): Record<string, Relations> {
        return Object.fromEntries(this.relations.entries());
    }

    /**
     * Get the merged schema object (tables + relations) for use with Drizzle's
     * relational query API (`db.query`).
     */
    getMergedSchema(): Record<string, unknown> {
        const result: Record<string, unknown> = {};
        for (const [name, table] of this.pgTables.entries()) {
            result[name] = table;
        }
        for (const [name, relation] of this.relations.entries()) {
            result[name] = relation;
        }
        return result;
    }

    /**
     * Get the available Drizzle relation keys for a given collection path.
     * Maps from the collection's relation property names to the Drizzle relation names
     * defined in the schema.
     */
    getRelationKeysForCollection(collectionPath: string): string[] {
        const collection = this.getCollectionByPath(collectionPath);
        if (!collection) return [];
        // Resolved, not authored. `relationName` is optional at the authoring
        // surface and defaults to the property key or the target's slug, so
        // reading the raw field dropped every relation that relied on the
        // default — and never saw relations declared inline on a property at
        // all, since those are not in the `relations` array.
        return Object.keys(resolveCollectionRelations(collection));
    }

}
