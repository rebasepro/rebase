import {
    normalizeColumnAccess,
    type ColumnAccess,
    type ColumnStorage,
    type SearchConfig,
    type SearchWeight,
    type TableDescriptor,
    type TenantSource
} from "@rebasepro/types";
import type { QueryableClient } from "./introspect-db-queries";

/**
 * Row shape of `rebase.table_meta`: BaaS-level metadata stored in PostgreSQL
 * for tables that are served without custom `defineTable(...)` code.
 */
export interface TableMetaRow {
    schema_name: string;
    table_name: string;
    slug: string | null;
    exposed: boolean;
    description: string | null;
    soft_delete_column: string | null;
    history_enabled: boolean;
    tenant_column: string | null;
    tenant_source: TenantSource | null;
    tenant_bypass_roles: string[] | null;
    search_config: SearchConfig | null;
    column_access: Record<string, ColumnAccess> | null;
    column_storage: Record<string, ColumnStorage> | null;
    private_columns: string[] | null;
    readonly_columns: string[] | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const VALID_WEIGHTS = new Set<string>(["A", "B", "C", "D"]);

function isSearchWeight(value: unknown): value is SearchWeight {
    return typeof value === "string" && VALID_WEIGHTS.has(value);
}

function parseSearchConfig(value: unknown): SearchConfig | null {
    if (!isRecord(value) || !Array.isArray(value.fields)) return null;
    const fields: SearchConfig["fields"][number][] = [];
    for (const item of value.fields) {
        if (typeof item === "string" && item.trim() !== "") {
            fields.push(item);
        } else if (isRecord(item) && typeof item.path === "string" && item.path.trim() !== "") {
            fields.push({
                path: item.path,
                ...(isSearchWeight(item.weight) ? { weight: item.weight } : {})
            });
        }
    }
    if (fields.length === 0) return null;
    return {
        fields,
        ...(typeof value.language === "string" && value.language.trim() !== "" ? { language: value.language } : {}),
        ...(typeof value.unaccent === "boolean" ? { unaccent: value.unaccent } : {})
    };
}

function parseColumnAccessMap(value: unknown): Record<string, ColumnAccess> | null {
    if (!isRecord(value)) return null;
    const out: Record<string, ColumnAccess> = {};
    for (const [key, raw] of Object.entries(value)) {
        try {
            out[key] = normalizeColumnAccess(raw, `column "${key}"`);
        } catch {
            // Skip malformed stored entry rather than refusing the whole boot.
        }
    }
    return Object.keys(out).length > 0 ? out : null;
}

function parseColumnStorageMap(value: unknown): Record<string, ColumnStorage> | null {
    if (!isRecord(value)) return null;
    const out: Record<string, ColumnStorage> = {};
    for (const [key, raw] of Object.entries(value)) {
        if (!isRecord(raw) || typeof raw.path !== "string" || raw.path.trim() === "") continue;
        const entry: ColumnStorage = { path: raw.path };
        if (typeof raw.source === "string") entry.source = raw.source;
        if (Array.isArray(raw.accept)) {
            entry.accept = raw.accept.filter((a): a is string => typeof a === "string");
        }
        if (typeof raw.maxBytes === "number" && Number.isFinite(raw.maxBytes) && raw.maxBytes > 0) {
            entry.maxBytes = raw.maxBytes;
        }
        if (typeof raw.storeUrl === "boolean") entry.storeUrl = raw.storeUrl;
        out[key] = entry;
    }
    return Object.keys(out).length > 0 ? out : null;
}

function isTenantSource(value: unknown): value is TenantSource {
    if (!isRecord(value)) return false;
    return typeof value.claim === "string" || typeof value.userField === "string";
}

/**
 * Read `rebase.table_meta` rows for a Postgres schema.
 *
 * Returns an empty map if `rebase.table_meta` does not exist yet (e.g. a
 * database provisioned with `REBASE_PROVISION=false` or before catalog tables
 * are initialized), so introspection never fails on an older database.
 */
export async function readTableMetaOverlays(
    client: QueryableClient,
    schemaName: string
): Promise<Map<string, TableMetaRow>> {
    const result = new Map<string, TableMetaRow>();
    try {
        const res = await client.query(
            `SELECT schema_name, table_name, slug, exposed, description,
                    soft_delete_column, history_enabled, tenant_column,
                    tenant_source, tenant_bypass_roles, search_config,
                    column_access, column_storage, private_columns, readonly_columns
               FROM rebase.table_meta
              WHERE schema_name = $1`,
            [schemaName]
        );
        for (const raw of res.rows) {
            if (!isRecord(raw) || typeof raw.table_name !== "string") continue;
            result.set(raw.table_name, {
                schema_name: typeof raw.schema_name === "string" ? raw.schema_name : schemaName,
                table_name: raw.table_name,
                slug: typeof raw.slug === "string" && raw.slug.trim() !== "" ? raw.slug.trim() : null,
                exposed: raw.exposed !== false,
                description: typeof raw.description === "string" ? raw.description : null,
                soft_delete_column: typeof raw.soft_delete_column === "string" && raw.soft_delete_column.trim() !== ""
                    ? raw.soft_delete_column.trim()
                    : null,
                history_enabled: raw.history_enabled === true,
                tenant_column: typeof raw.tenant_column === "string" && raw.tenant_column.trim() !== ""
                    ? raw.tenant_column.trim()
                    : null,
                tenant_source: isTenantSource(raw.tenant_source) ? raw.tenant_source : null,
                tenant_bypass_roles: Array.isArray(raw.tenant_bypass_roles)
                    ? raw.tenant_bypass_roles.filter((r): r is string => typeof r === "string")
                    : null,
                search_config: parseSearchConfig(raw.search_config),
                column_access: parseColumnAccessMap(raw.column_access),
                column_storage: parseColumnStorageMap(raw.column_storage),
                private_columns: Array.isArray(raw.private_columns)
                    ? raw.private_columns.filter((c): c is string => typeof c === "string")
                    : null,
                readonly_columns: Array.isArray(raw.readonly_columns)
                    ? raw.readonly_columns.filter((c): c is string => typeof c === "string")
                    : null
            });
        }
    } catch (err) {
        // 42P01 (undefined_table) or 3F000 (invalid_schema_name) — table_meta not created yet.
        const code = isRecord(err) ? err.code : undefined;
        if (code !== "42P01" && code !== "3F000") {
            throw err;
        }
    }
    return result;
}

/**
 * Overlay `rebase.table_meta` configuration onto introspected {@link TableDescriptor}s.
 *
 * - Tables marked `exposed: false` are omitted from the returned list.
 * - All remaining overlays (description, softDelete, history, tenant, search,
 *   per-column access/storage/private/readOnly) are applied non-destructively
 *   only when the referenced columns actually exist on the table.
 */
export function applyTableMetaOverlays(
    descriptors: readonly TableDescriptor[],
    overlays: ReadonlyMap<string, TableMetaRow>
): TableDescriptor[] {
    if (overlays.size === 0) return [...descriptors];

    const out: TableDescriptor[] = [];
    for (const descriptor of descriptors) {
        const meta = overlays.get(descriptor.table);
        if (!meta) {
            out.push(descriptor);
            continue;
        }
        if (!meta.exposed) {
            continue;
        }

        const privateSet = new Set(meta.private_columns ?? []);
        const readonlySet = new Set(meta.readonly_columns ?? []);

        const columns = descriptor.columns.map(col => {
            const access = meta.column_access?.[col.key] ?? meta.column_access?.[col.column];
            const storage = meta.column_storage?.[col.key] ?? meta.column_storage?.[col.column];
            const isPrivate = privateSet.has(col.key) || privateSet.has(col.column);
            const isReadOnly = readonlySet.has(col.key) || readonlySet.has(col.column);

            if (!access && !storage && !isPrivate && !isReadOnly) return col;
            return {
                ...col,
                ...(access ? { access } : {}),
                ...(storage ? { storage } : {}),
                ...(isPrivate ? { private: true as const } : {}),
                ...(isReadOnly ? { readOnly: true as const } : {})
            };
        });

        const hasColumn = (name: string): string | undefined =>
            columns.find(c => c.key === name || c.column === name)?.key;

        const softDeleteKey = meta.soft_delete_column ? hasColumn(meta.soft_delete_column) : undefined;
        const tenantKey = meta.tenant_column ? hasColumn(meta.tenant_column) : undefined;

        out.push({
            ...descriptor,
            ...(meta.slug ? { slug: meta.slug } : {}),
            ...(meta.description !== null ? { description: meta.description } : {}),
            columns,
            ...(softDeleteKey ? { softDelete: { field: softDeleteKey } } : {}),
            ...(meta.history_enabled ? { history: true } : {}),
            ...(tenantKey && meta.tenant_source ? {
                tenant: {
                    field: tenantKey,
                    from: meta.tenant_source,
                    ...(meta.tenant_bypass_roles ? { bypassRoles: meta.tenant_bypass_roles } : {})
                }
            } : {}),
            ...(meta.search_config ? { search: meta.search_config } : {})
        });
    }
    return out;
}
