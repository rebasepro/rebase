import { RebaseApiError, type CompiledTable, type TableHooks, type TableRegistryInterface } from "@rebasepro/types";
import { PgEnum, PgTable } from "drizzle-orm/pg-core";
import { Relations } from "drizzle-orm";
import { buildRuntimeTable, withCatalogueTable, type RuntimeTable } from "./runtime-table";

/**
 * The tables one Postgres driver serves.
 *
 * Holds, per table, its {@link RuntimeTable} — the compiled table the server
 * handed over, with its catalogue table and lookups — and the drizzle tables,
 * enums and relations read back from this database (junction tables
 * included, which have no runtime table of their own).
 *
 * Tables only: nothing here holds a collection. From a call site that holds
 * a slug: `registry.requireTable(slug)`; that holds a data path (a slug, a
 * table name, or `authors/1/posts`): `registry.tableAt(path)`.
 */
export class PostgresTableRegistry implements TableRegistryInterface {

    private readonly runtimeTables = new Map<string, RuntimeTable>();
    /** Tables declared but not served, by slug: their SQL name and what a caller is told. */
    private readonly withheldTables = new Map<string, { table: string; message: string }>();
    /** {@link tables}, built once per change: callers cache on its identity. */
    private tableList?: RuntimeTable[];
    private readonly pgTables = new Map<string, PgTable>();
    private readonly enums = new Map<string, PgEnum<[string, ...string[]]>>();
    private readonly relations = new Map<string, Relations>();
    private globalTableHooks?: TableHooks;

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
        this.tableList = undefined;
    }

    /** The runtime table served at `/api/data/<slug>`, or `undefined`. */
    getTable(slug: string): RuntimeTable | undefined {
        return this.runtimeTables.get(slug);
    }

    /**
     * Stop serving a declared table: it leaves the runtime tables (so no
     * read, write, include or subscription reaches it), and a request that
     * names it — by slug, kebab-case slug or SQL name, as a root or as a
     * relation's target — is refused with `message` (503 `TABLE_WITHHELD`)
     * rather than "not found". Its catalogue table stays registered: a
     * junction or a policy subquery may still name it.
     *
     * What the boot and a live refresh do with a table the database does not
     * protect (see `security/served-table-protection`).
     */
    withhold(slug: string, message: string): void {
        const table = this.runtimeTables.get(slug);
        if (!table) return;
        this.runtimeTables.delete(slug);
        this.withheldTables.set(slug, { table: table.descriptor.table, message });
        this.tableList = undefined;
    }

    /** The slugs of the tables {@link withhold} took out, each with what a caller is told. */
    withheld(): ReadonlyMap<string, string> {
        return new Map([...this.withheldTables].map(([slug, { message }]) => [slug, message]));
    }

    /** Throw the refusal for a withheld table `name` (slug, kebab slug or SQL name) names, if it names one. */
    private refuseWithheld(name: string): void {
        const slug = name.replace(/-/g, "_");
        for (const [key, entry] of this.withheldTables) {
            if (key === name || key === slug || entry.table === name) {
                throw new RebaseApiError(entry.message, { status: 503, code: "TABLE_WITHHELD", details: { table: key } });
            }
        }
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
        this.refuseWithheld(slug);
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

    /**
     * The runtime table a root path names: its slug, the slug spelled with
     * hyphens (`blog-posts` for `blog_posts` — URLs are kebab-case), then the
     * table's SQL name. `undefined` when none matches.
     */
    tableNamed(name: string): RuntimeTable | undefined {
        const table = this.getTable(name)
            ?? (name.includes("-") ? this.getTable(name.replace(/-/g, "_")) : undefined)
            ?? this.getTableBySqlName(name);
        if (!table) this.refuseWithheld(name);
        return table;
    }

    /**
     * The runtime table a data path addresses: a root (`posts`, see
     * {@link tableNamed}) or a walk through relations (`authors/1/posts` — the
     * target of `authors`' relation `posts`). `undefined` for a root that
     * names no table; throws, naming the table and the relation, for a nested
     * path that is malformed or names a relation the table does not have.
     *
     * The walk reads every relation the table declares: whether the caller
     * may address it is the nested-path walk's question (`resolveNestedPath`),
     * not this lookup's.
     */
    tableAt(path: string): RuntimeTable | undefined {
        if (!path.includes("/")) return this.tableNamed(path);
        const segments = path.split("/").filter(segment => segment);
        if (segments.length < 3 || segments.length % 2 === 0) {
            throw new Error(`Invalid relation path: ${path}. Expected format: table/id/relation or table/id/relation/id/relation`);
        }
        let current = this.tableNamed(segments[0]);
        if (!current) throw new Error(`Root table not found: ${segments[0]}`);
        for (let i = 2; i < segments.length; i += 2) {
            const relation = current.relations.get(segments[i]);
            if (!relation) throw new Error(`Relation '${segments[i]}' not found in table '${current.slug}'`);
            current = this.requireTable(relation.target);
        }
        return current;
    }

    // ── Hooks ───────────────────────────────────────────────────────────────

    /**
     * Take the global hooks — the ones that run for every table this driver
     * serves, before each table's own (`initializeRebaseBackend({ hooks })`,
     * `openRebase({ hooks })`). Replaces any set before; `undefined` clears.
     */
    setGlobalHooks(hooks: TableHooks | undefined): void {
        this.globalTableHooks = hooks;
    }

    /** The global hooks, when any were set. */
    globalHooks(): TableHooks | undefined {
        return this.globalTableHooks;
    }

    /**
     * Replace one table's own hooks after boot (`backend.setTableHooks`).
     * Assignment, not a merge: the hooks the table was compiled with stop
     * running. The descriptor and the column transforms stay as compiled.
     *
     * @returns whether this driver serves the table.
     */
    setTableHooks(slug: string, hooks: TableHooks): boolean {
        const table = this.runtimeTables.get(slug);
        if (!table) return false;
        const compiled: CompiledTable = { ...table.compiled, hooks };
        this.runtimeTables.set(slug, { ...table, compiled });
        this.tableList = undefined;
        return true;
    }

    /**
     * Every runtime table, in registration order. The same array until a
     * table is registered or replaced, so a caller may cache on its identity.
     */
    tables(): readonly RuntimeTable[] {
        if (!this.tableList) this.tableList = [...this.runtimeTables.values()];
        return this.tableList;
    }

    /**
     * Serve what `next` holds from now on: its runtime tables, drizzle tables,
     * enums and relations replace this registry's, in one synchronous step —
     * every holder of this registry (the driver, its services, the realtime
     * service, the server's hook wiring) sees the tables before the call or
     * those after it, never a mixture. The global hooks stay: they belong to
     * the backend, not to a schema. `next` is built off to the side (by
     * `buildTableRegistry`, which checks its relations) and not used after.
     *
     * What a live schema apply calls once the driver has read the edited
     * tables back from its catalogue (`refreshTables` on the driver).
     */
    replaceWith(next: PostgresTableRegistry): void {
        refill(this.runtimeTables, next.runtimeTables);
        refill(this.withheldTables, next.withheldTables);
        refill(this.pgTables, next.pgTables);
        refill(this.enums, next.enums);
        refill(this.relations, next.relations);
        this.tableList = undefined;
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
        this.tableList = undefined;
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

    /** Every registered drizzle table, by SQL name. */
    getAllPgTables(): Record<string, PgTable> {
        return Object.fromEntries(this.pgTables.entries());
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
}

/** Replace every entry of `target` with those of `source`, keeping the map. */
function refill<K, V>(target: Map<K, V>, source: ReadonlyMap<K, V>): void {
    target.clear();
    for (const [key, value] of source) target.set(key, value);
}
