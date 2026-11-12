import { toSnakeCase } from "@rebasepro/utils";
import type { TableDescriptor } from "@rebasepro/types";

/**
 * A table as the JS editor offers it: in the sidebar, in the script's
 * `context.tables`, and as Monaco typings.
 */
export interface TableInfo {
    slug: string;
    /** The name the table was defined under. */
    name: string;
    /**
     * The property that reaches it on the editor's `client.data`, when there
     * is one — see {@link dotAccessorOf}. Without one, `data.table("<slug>")`.
     */
    accessor?: string;
    /** The column keys the server serves, in physical order. */
    columns: string[];
    /** The keys of the primary-key columns. */
    primaryKey: string[];
}

/**
 * Names `client.data` answers itself, or that every object has, rather than as
 * a table: such a table is reached with `data.table("<slug>")`.
 */
const RESERVED = new Set(["table", "batch", "then", "toJSON", "$$typeof"]);

/**
 * The property that reaches `slug` on the editor's `client.data`, or
 * `undefined` when no property does.
 *
 * The editor's clients carry no generated table dictionary, so a property is
 * read the untyped way: its snake_case is the slug (`companyMembers` →
 * `company_members`). A slug that is its own snake_case identifier (`posts`,
 * `order_items`) is reached as itself; any other slug (`blog-posts`,
 * `blogPosts`) by no property at all.
 */
export function dotAccessorOf(slug: string): string | undefined {
    if (!/^[A-Za-z_$][\w$]*$/.test(slug)) return undefined;
    if (RESERVED.has(slug) || slug in Object.prototype) return undefined;
    return toSnakeCase(slug) === slug ? slug : undefined;
}

/** How a script reaches `table`: `client.data.posts`, or `client.data.table("blog-posts")`. */
export function tableAccessExpression(table: Pick<TableInfo, "slug" | "accessor">): string {
    return table.accessor ? `client.data.${table.accessor}` : `client.data.table(${JSON.stringify(table.slug)})`;
}

/** The {@link TableInfo} of every table the server serves (views included: they are read the same way). */
export function tableInfosOf(tables: readonly TableDescriptor[]): TableInfo[] {
    return tables.map(table => {
        const accessor = dotAccessorOf(table.slug);
        return {
            slug: table.slug,
            name: table.name,
            ...(accessor ? { accessor } : {}),
            columns: table.columns.map(column => column.key),
            primaryKey: [...table.primaryKey]
        };
    });
}

/**
 * The slug a `client.data.<property>` names, as the client resolves it: a
 * table's own accessor, or else the property's snake_case.
 */
export function slugOfProperty(property: string, tables: readonly TableInfo[]): string {
    return tables.find(table => table.accessor === property)?.slug ?? toSnakeCase(property);
}
