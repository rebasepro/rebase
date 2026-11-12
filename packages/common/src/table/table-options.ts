import type { ColumnDescriptor, TableDescriptor, TenantDescriptor } from "@rebasepro/types";
import { DEFAULT_TENANT_BYPASS_ROLES } from "@rebasepro/types";
import { DEFAULT_TABLE_SCHEMA } from "../schema/derive-names";

/**
 * Table-level options read from a {@link TableDescriptor}: the schema it is
 * declared in, soft delete and tenancy. The compiler already checked them (the soft-delete column exists
 * and is temporal, the tenant column exists and has a key type), so these do
 * no defaulting of their own.
 *
 * @module
 */

/**
 * The column a soft-delete table records a deletion in — what a delete
 * stamps and a restore (an update setting it to `null`) clears — or
 * `undefined` for a table without soft delete.
 *
 * Replaces `softDeleteFieldOf(collection)` plus the `columnName ??
 * toSnakeCase(field)` that found its SQL name: both names are on the column.
 *
 * @group Table
 */
export function softDeleteColumn(table: TableDescriptor): ColumnDescriptor | undefined {
    const field = table.softDelete?.field;
    if (field === undefined) return undefined;
    return table.columns.find(column => column.key === field);
}

/**
 * Whether an update's values restore a soft-deleted row: they set the
 * soft-delete column back to `null`.
 *
 * Replaces `restoresSoftDeletedRow(collection, values)`.
 *
 * @group Table
 */
export function isSoftDeleteRestore(table: TableDescriptor, values: Record<string, unknown> | undefined): boolean {
    const field = table.softDelete?.field;
    return field !== undefined && values?.[field] === null;
}

/**
 * A table's tenancy with its defaults applied, or `undefined` for a table
 * rows of which are not scoped to a tenant.
 *
 * Replaces `getTenantConfig(collection)` and `tenantBypassRoles(tenant)`.
 *
 * @group Table
 */
export function tenantOf(table: TableDescriptor): (TenantDescriptor & { bypassRoles: readonly string[] }) | undefined {
    const tenant = table.tenant;
    if (!tenant) return undefined;
    return { ...tenant, bypassRoles: tenant.bypassRoles ?? DEFAULT_TENANT_BYPASS_ROLES };
}

/**
 * The Postgres schema a table names apart from the default one, or
 * `undefined` for a table in `public`.
 *
 * `public` is where a table lands without a qualifier, so nothing declares it:
 * no `CREATE SCHEMA`, no `pgSchema("public")` in a generated Drizzle file
 * (Drizzle refuses that one). Every other schema is created and qualified.
 *
 * @group Table
 */
export function declaredSchemaOf(table: Pick<TableDescriptor, "schema">): string | undefined {
    return table.schema === DEFAULT_TABLE_SCHEMA ? undefined : table.schema;
}
