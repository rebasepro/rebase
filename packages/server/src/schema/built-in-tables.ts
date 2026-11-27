import type { AnyTableDef, BuiltInTableSpec, CompiledTable, DefaultRls, TableDescriptor } from "@rebasepro/types";
import { compileSchemaDefs } from "./load-schema";

/**
 * The tables built-in auth serves whatever the project declares, so they are
 * collections like any other table. Today that is its users: built-in auth
 * always has exactly one auth table — the project's `defineAuthTable` when it
 * declares one, and the auth bootstrapper's own
 * (`BackendBootstrapper.defaultAuthTable`, `rebase.users`) when it does not.
 *
 * A backend whose `auth` is an `AuthAdapter` gets none of this: the adapter
 * owns its users, and the project declares whatever table holds them.
 */

/** A table built-in auth serves, and what the boot says when it cannot. */
export type BuiltInTable = BuiltInTableSpec;

const bareName = (table: string): string => (table.includes(".") ? table.split(".").pop() ?? table : table);

/**
 * The served table that takes the slug or the table name `builtIn` would be
 * served under, if one does. Both are keys a table is addressed by (the data
 * path by slug, the driver's registry by bare table name), so a project table
 * called `users` leaves no room for the built-in one. A declared
 * auth table is not a clash for the built-in users table: it replaces it.
 */
export function builtInTableClash(
    builtIn: TableDescriptor,
    served: readonly TableDescriptor[]
): TableDescriptor | undefined {
    const name = bareName(builtIn.table);
    return served.find(table => table !== builtIn
        && !(builtIn.auth !== undefined && table.auth !== undefined)
        && (table.slug === builtIn.slug || bareName(table.table) === name));
}

/** What the boot says when {@link builtInTableClash} found a table. */
export function builtInTableClashMessage(builtIn: BuiltInTable, clash: TableDescriptor): string {
    const where = clash.schema ? `${clash.schema}.${bareName(clash.table)}` : bareName(clash.table);
    const own = builtIn.table.descriptor;
    return `[Auth] ${builtIn.noun} are not served as a table: "${where}" already takes the name "${own.slug}", ` +
        `and built-in auth keeps them in ${own.schema ?? "public"}.${bareName(own.table)}. ${builtIn.remedy}`;
}

/**
 * The declared tables as served: each built-in table added unless the
 * project declares its own (an auth table, for users) or a table already
 * takes its name. Unchanged when there is nothing to add, and when nothing is
 * declared — the database is then the whole specification, and an
 * introspecting driver serves the built-in tables beside what it derives
 * (`DatabaseAdapterInitConfig.builtInTables`).
 *
 * Served, not declared: what a schema edit plans against and what generated
 * files are rendered from stays the project's own declarations, so a change
 * never plans `rebase.users` away because no source file names it.
 */
export function withBuiltInTables<T extends { tables: CompiledTable[]; descriptors: TableDescriptor[] }>(
    declared: T,
    builtIns: readonly BuiltInTable[],
    warn: (message: string) => void
): T {
    if (builtIns.length === 0 || declared.tables.length === 0) return declared;
    const added: CompiledTable[] = [];
    for (const builtIn of builtIns) {
        const own = builtIn.table.descriptor;
        if (own.auth !== undefined && declared.tables.some(table => table.descriptor.auth !== undefined)) continue;
        const clash = builtInTableClash(own, [...declared.descriptors, ...added.map(table => table.descriptor)]);
        if (clash) {
            warn(builtInTableClashMessage(builtIn, clash));
            continue;
        }
        added.push(builtIn.table);
    }
    if (added.length === 0) return declared;
    return {
        ...declared,
        tables: [...declared.tables, ...added],
        descriptors: [...declared.descriptors, ...added.map(table => table.descriptor)]
    };
}

/** A built-in table's definition, compiled as a declared one would be. */
export function compileBuiltInTable(definition: AnyTableDef, defaultRls?: DefaultRls): CompiledTable {
    const { tables } = compileSchemaDefs([definition], defaultRls);
    const [table] = tables;
    if (!table) throw new Error(`The built-in table "${definition.name}" did not compile.`);
    return table;
}

/** The auth bootstrapper's table, compiled; refused unless it is a `defineAuthTable`. */
export function compileImplicitAuthTable(definition: AnyTableDef, defaultRls?: DefaultRls): CompiledTable {
    const table = compileBuiltInTable(definition, defaultRls);
    if (table.descriptor.auth === undefined) {
        throw new Error(
            `The default auth table "${definition.name}" did not compile to an auth table. ` +
            "BackendBootstrapper.defaultAuthTable must be a defineAuthTable."
        );
    }
    return table;
}

/** The users half of the built-in tables. */
export function builtInUsersTable(table: CompiledTable): BuiltInTable {
    return {
        table,
        noun: "Users",
        remedy: "Sign-in still works. To manage users as a collection, declare the auth table yourself with a slug of " +
            "your choice: `rebase schema introspect --users` writes backend/schema/users.ts, then set its `slug`."
    };
}
