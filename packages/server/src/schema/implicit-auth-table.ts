import type { AnyTableDef, CompiledTable, DefaultRls, TableDescriptor } from "@rebasepro/types";
import { compileSchemaDefs } from "./load-schema";

/**
 * Built-in auth always has exactly one auth table: the project's
 * `defineAuthTable` when it declares one, and the auth bootstrapper's own
 * table (`BackendBootstrapper.defaultAuthTable`, `rebase.users`) when it does
 * not. Served either way, so a project's users are a collection like any
 * other table, whoever wrote the declaration.
 *
 * A backend whose `auth` is an `AuthAdapter` gets none of this: the adapter
 * owns its users, and the project declares whatever table holds them.
 */

const bareName = (table: string): string => (table.includes(".") ? table.split(".").pop() ?? table : table);

/**
 * The served table that takes the slug or the table name the implicit auth
 * table would be served under, if one does. Both are keys a table is
 * addressed by (the data path by slug, the driver's registry by bare table
 * name), so a project table called `users` that is not its auth table leaves
 * no room for the implicit one.
 */
export function implicitAuthTableClash(
    auth: TableDescriptor,
    served: readonly TableDescriptor[]
): TableDescriptor | undefined {
    const authName = bareName(auth.table);
    return served.find(table => table.auth === undefined
        && (table.slug === auth.slug || bareName(table.table) === authName));
}

/** What the boot says when {@link implicitAuthTableClash} found a table. */
export function implicitAuthTableClashMessage(auth: TableDescriptor, clash: TableDescriptor): string {
    const where = clash.schema ? `${clash.schema}.${bareName(clash.table)}` : bareName(clash.table);
    return `[Auth] Users are not served as a table: "${where}" already takes the name "${auth.slug}", ` +
        `and built-in auth stores its users in ${auth.schema ?? "public"}.${bareName(auth.table)}. ` +
        "Sign-in still works. To manage users as a collection, declare the auth table yourself with a slug of " +
        "your choice: `rebase schema introspect --users` writes backend/schema/users.ts, then set its `slug`.";
}

/**
 * The declared tables as served: `implicit` added when they declare no auth
 * table and none takes its name. Unchanged when there is no implicit table to
 * add, and when nothing is declared — the database is then the whole
 * specification, and an introspecting driver serves the auth table beside
 * what it derives (`DatabaseAdapterInitConfig.authTable`).
 *
 * Served, not declared: what a schema edit plans against and what generated
 * files are rendered from stays the project's own declarations, so a change
 * never plans `rebase.users` away because no source file names it.
 */
export function withImplicitAuthTable<T extends { tables: CompiledTable[]; descriptors: TableDescriptor[] }>(
    declared: T,
    implicit: CompiledTable | undefined,
    warn: (message: string) => void
): T {
    if (!implicit || declared.tables.length === 0) return declared;
    if (declared.tables.some(table => table.descriptor.auth !== undefined)) return declared;
    const clash = implicitAuthTableClash(implicit.descriptor, declared.descriptors);
    if (clash) {
        warn(implicitAuthTableClashMessage(implicit.descriptor, clash));
        return declared;
    }
    return {
        ...declared,
        tables: [...declared.tables, implicit],
        descriptors: [...declared.descriptors, implicit.descriptor]
    };
}

/** The auth bootstrapper's table, compiled as a declared one would be. */
export function compileImplicitAuthTable(definition: AnyTableDef, defaultRls?: DefaultRls): CompiledTable {
    const { tables } = compileSchemaDefs([definition], defaultRls);
    const [table] = tables;
    if (!table || table.descriptor.auth === undefined) {
        throw new Error(
            `The default auth table "${definition.name}" did not compile to an auth table. ` +
            "BackendBootstrapper.defaultAuthTable must be a defineAuthTable."
        );
    }
    return table;
}
