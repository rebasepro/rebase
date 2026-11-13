import type { CompiledTable, TableDescriptor, TableHooks } from "@rebasepro/types";

/**
 * What the server's request-time code reads of one table: its descriptor and
 * the server-only code compiled beside it (hooks, field-level transforms, the
 * auth table's lifecycle hooks). A {@link CompiledTable} without its
 * definition, which only the planner reads.
 *
 * @group Schema
 */
export type RegisteredTable = Pick<CompiledTable, "descriptor" | "hooks" | "transforms" | "auth">;

/**
 * The tables one backend serves, by slug: each one's compiled descriptor and,
 * for a declared table, its server-only code.
 *
 * Everything the server decides about a table reads this: `GET
 * /api/schema/tables`, the schema version, hooks' `table` argument, storage
 * limits, the auth table, the RLS simulator, the data routes, which data
 * source a path is routed to. The data drivers hold their own copy of the same
 * compiled tables, handed to them at boot.
 *
 * For a backend that introspects the database, the descriptors of the tables
 * introspection found (those that could be described; see
 * `describeIntrospectedTables`); such a table declares no hooks.
 *
 * It may change after boot: every {@link replaceAll} bumps {@link revision},
 * and what is derived from it — the schema version, the bodies
 * `GET /api/schema/tables` and `/api/meta/contract` serve — is cached per
 * revision, so it is recomputed rather than served stale.
 *
 * @group Schema
 */
export class TableRegistry {
    private readonly bySlug = new Map<string, RegisteredTable>();
    private changes = 0;
    private listed: { revision: number; descriptors: readonly TableDescriptor[]; tables: readonly RegisteredTable[] } | undefined;

    /**
     * Replace the registry's contents, in this order: compiled tables (a
     * declared schema), or bare descriptors (introspection, a test).
     */
    replaceAll(entries: readonly (TableDescriptor | RegisteredTable)[]): void {
        this.bySlug.clear();
        for (const entry of entries) {
            const table: RegisteredTable = "descriptor" in entry ? entry : { descriptor: entry };
            this.bySlug.set(table.descriptor.slug, table);
        }
        this.changes++;
    }

    /**
     * Every descriptor, in the order they were compiled. The same array until
     * the next {@link replaceAll}, so a cache keyed on it holds for a revision.
     */
    list(): readonly TableDescriptor[] {
        return this.snapshot().descriptors;
    }

    /** The descriptor of the table served at `/api/data/<slug>`, if there is one. */
    get(slug: string): TableDescriptor | undefined {
        return this.bySlug.get(slug)?.descriptor;
    }

    /**
     * The descriptor a path's first segment names: a slug, its kebab-case
     * spelling (`blog-posts` for `blog_posts`, as URLs write it), or the SQL
     * table name — the names a data path is addressed by.
     */
    named(segment: string): TableDescriptor | undefined {
        const bySlug = this.get(segment) ?? (segment.includes("-") ? this.get(segment.replace(/-/g, "_")) : undefined);
        return bySlug ?? this.list().find(table => table.table === segment);
    }

    /** Every table with its server-only code, in the order they were compiled. */
    tables(): readonly RegisteredTable[] {
        return this.snapshot().tables;
    }

    /** The table served at `/api/data/<slug>` with its server-only code, if there is one. */
    table(slug: string): RegisteredTable | undefined {
        return this.bySlug.get(slug);
    }

    /** The auth table (`defineAuthTable`): the one whose descriptor carries `auth`. */
    authTable(): RegisteredTable | undefined {
        return this.tables().find(table => table.descriptor.auth !== undefined);
    }

    /**
     * Replace a table's hooks after boot (`backend.setTableHooks`). The
     * descriptor — and so the schema version — is left as compiled: a hook
     * attached at runtime is the deployment's, not the schema's. Returns
     * whether the table is served here.
     */
    setHooks(slug: string, hooks: TableHooks): boolean {
        const table = this.bySlug.get(slug);
        if (!table) return false;
        const { hooks: _replaced, ...rest } = table;
        this.bySlug.set(slug, Object.values(hooks).some(hook => typeof hook === "function") ? { ...rest, hooks } : rest);
        this.listed = undefined;
        return true;
    }

    /**
     * How many times the contents were replaced. A cache of anything derived
     * from the registry is valid for exactly one revision.
     */
    get revision(): number {
        return this.changes;
    }

    private snapshot(): { descriptors: readonly TableDescriptor[]; tables: readonly RegisteredTable[] } {
        if (!this.listed || this.listed.revision !== this.changes) {
            const tables = [...this.bySlug.values()];
            this.listed = { revision: this.changes, tables, descriptors: tables.map(table => table.descriptor) };
        }
        return this.listed;
    }
}
