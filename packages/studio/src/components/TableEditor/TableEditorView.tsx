import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
    Alert,
    BooleanSwitchWithLabel,
    Button,
    Card,
    Chip,
    CircularProgress,
    cls,
    defaultBorderMixin,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    IconButton,
    iconSize,
    PlusIcon,
    RefreshCwIcon,
    SearchBar,
    Select,
    SelectItem,
    ShieldIcon,
    Tab,
    Table,
    TableBody,
    TableCell,
    TableHeader,
    TableRow,
    Tabs,
    TextField,
    Tooltip,
    Trash2Icon,
    Typography,
    DatabaseIcon,
    PencilIcon,
    CheckCircleIcon,
    AlertCircleIcon,
    VirtualTable,
    type CellRendererParams,
    type VirtualTableColumn
} from "@rebasepro/ui";
import { useSnackbarController, useTranslation } from "@rebasepro/app";
import {
    asBoolean,
    asNullableString,
    asNumber,
    asString,
    asStringArray,
    isRecord,
    useAdminFetch
} from "../../utils/adminFetch";
import { FixedEditorOverlay } from "../SQLEditor/FixedEditorOverlay";
import { compilePolicyExpression } from "@rebasepro/common";
import { policy as policyExpr } from "@rebasepro/types";
import { SIGNED_IN_SQL } from "../RLSEditor/policy-presets";

/**
 * The "Owner only" preset's condition: the row's `user_id` is the signed-in
 * user. Compiled, as `SIGNED_IN_SQL` is, rather than written out: the
 * hand-written `user_id = rebase.uid()` compared a uuid column with text and
 * Postgres refused the table, and the old "signed in" clause — a bare
 * `rebase.uid() IS NOT NULL` — let anonymous visitors through.
 */
const OWNS_ROW_BY_USER_ID_SQL = compilePolicyExpression(
    policyExpr.compare(policyExpr.field("user_id"), "eq", policyExpr.authUid())
);

interface DbColumnInfo {
    name: string;
    key: string;
    dataType: string;
    udtName: string;
    nullable: boolean;
    defaultExpr: string | null;
    primaryKey: boolean;
    unique: boolean;
}

interface DbPolicyInfo {
    name: string;
    operation: string;
    roles: string[];
    using: string | null;
    withCheck: string | null;
}

interface DbIndexInfo {
    name: string;
    definition: string;
    unique: boolean;
    primary: boolean;
}

interface DbTableMeta {
    slug: string | null;
    exposed: boolean;
    description: string | null;
    softDelete: boolean;
    softDeleteColumn: string | null;
    history: boolean;
    readOnly: boolean;
    isPrivate: boolean;
}

interface DbTableInfo {
    schema: string;
    name: string;
    slug: string;
    rlsEnabled: boolean;
    rlsForced: boolean;
    exposed: boolean;
    served: boolean;
    columns: DbColumnInfo[];
    policies: DbPolicyInfo[];
    indexes: DbIndexInfo[];
    meta: DbTableMeta | null;
}

interface DraftColumn {
    name: string;
    type: string;
    primaryKey: boolean;
    nullable: boolean;
    unique: boolean;
    defaultExpr: string;
}

const SQL_TYPES = [
    "text",
    "varchar(255)",
    "integer",
    "bigint",
    "numeric",
    "double precision",
    "boolean",
    "uuid",
    "timestamptz",
    "date",
    "jsonb",
    "text[]"
] as const;

const RLS_PRESETS = [
    { value: "authenticated", labelKey: "studio_tables_preset_authenticated" },
    { value: "public-read", labelKey: "studio_tables_preset_public_read" },
    { value: "owner", labelKey: "studio_tables_preset_owner" },
    { value: "admin-only", labelKey: "studio_tables_preset_admin_only" }
] as const;

function parseColumn(raw: unknown): DbColumnInfo | null {
    if (!isRecord(raw) || typeof raw.name !== "string") return null;
    return {
        name: raw.name,
        key: asString(raw.key, raw.name),
        dataType: asString(raw.dataType, "text"),
        udtName: asString(raw.udtName, "text"),
        nullable: asBoolean(raw.nullable, true),
        defaultExpr: asNullableString(raw.default ?? raw.defaultExpr),
        primaryKey: asBoolean(raw.primaryKey, false),
        unique: asBoolean(raw.unique, false)
    };
}

function parsePolicy(raw: unknown): DbPolicyInfo | null {
    if (!isRecord(raw) || typeof raw.name !== "string") return null;
    return {
        name: raw.name,
        operation: asString(raw.operation ?? raw.command, "ALL"),
        roles: asStringArray(raw.roles),
        using: asNullableString(raw.using),
        withCheck: asNullableString(raw.withCheck)
    };
}

function parseIndex(raw: unknown): DbIndexInfo | null {
    if (!isRecord(raw) || typeof raw.name !== "string") return null;
    return {
        name: raw.name,
        definition: asString(raw.definition, ""),
        unique: asBoolean(raw.unique, false),
        primary: asBoolean(raw.primary, false)
    };
}

function parseMeta(raw: unknown): DbTableMeta | null {
    if (!isRecord(raw)) return null;
    const softDeleteColumn = asNullableString(raw.softDeleteColumn ?? raw.soft_delete_column);
    const readonlyColumns = asStringArray(raw.readonlyColumns ?? raw.readonly_columns);
    return {
        slug: asNullableString(raw.slug),
        exposed: asBoolean(raw.exposed, true),
        description: asNullableString(raw.description),
        softDelete: Boolean(softDeleteColumn) || asBoolean(raw.softDelete, false),
        softDeleteColumn,
        history: asBoolean(raw.historyEnabled ?? raw.history_enabled ?? raw.history, false),
        readOnly: readonlyColumns.length > 0 || asBoolean(raw.readOnly, false),
        isPrivate: asBoolean(raw.isPrivate, false)
    };
}

function parseTable(raw: unknown): DbTableInfo | null {
    if (!isRecord(raw) || typeof raw.name !== "string") return null;
    const columns = Array.isArray(raw.columns) ? raw.columns.map(parseColumn).filter((c): c is DbColumnInfo => c !== null) : [];
    const policies = Array.isArray(raw.policies) ? raw.policies.map(parsePolicy).filter((p): p is DbPolicyInfo => p !== null) : [];
    const indexes = Array.isArray(raw.indexes) ? raw.indexes.map(parseIndex).filter((i): i is DbIndexInfo => i !== null) : [];
    return {
        schema: asString(raw.schema, "public"),
        name: raw.name,
        slug: asString(raw.slug, raw.name),
        rlsEnabled: asBoolean(raw.rlsEnabled, false),
        rlsForced: asBoolean(raw.rlsForced, false),
        exposed: asBoolean(raw.exposed, true),
        served: asBoolean(raw.served, false),
        columns,
        policies,
        indexes,
        meta: parseMeta(raw.meta)
    };
}

function parseTablesResponse(raw: unknown): DbTableInfo[] {
    if (!isRecord(raw) || !Array.isArray(raw.tables)) return [];
    return raw.tables.map(parseTable).filter((t): t is DbTableInfo => t !== null);
}

/** The rows grid's first column: a row's edit and delete buttons. */
const ROW_ACTIONS_COLUMN = "__row_actions__";

/** The muted icon the SQL and JS editors' result grids use for a row's action. */
const ROW_ACTION_ICON = "text-surface-400 dark:text-surface-500 hover:text-surface-600 dark:hover:text-surface-300 transition-colors";

/** One empty list, so a table with no rows loaded hands the grid the same array each render. */
const NO_ROWS: Record<string, unknown>[] = [];

/** A starting width wide enough for the column's usual values; the grid lets it be resized. */
function rowColumnWidth(col: DbColumnInfo): number {
    const t = col.udtName.toLowerCase();
    if (t === "uuid") return 300;
    if (t === "timestamptz" || t === "timestamp") return 240;
    if (t === "date" || t === "bool" || t === "boolean") return 120;
    if (t === "int2" || t === "int4" || t === "int8" || t === "float4" || t === "float8" || t === "numeric") return 120;
    return 200;
}

/**
 * Why a table is not on `/api/data`, from what the server reported about it —
 * the one reason that holds, not a list of possible ones. The translation key
 * of the sentence, for the caller to hand to `t()`.
 */
function notServedReasonKey(table: DbTableInfo): string {
    if (!table.rlsEnabled) return "studio_tables_not_served_rls_off";
    if (!(table.meta?.exposed ?? table.exposed)) return "studio_tables_not_served_not_exposed";
    return "studio_tables_not_served_not_picked_up";
}

/** The text a cell's edit box opens with: empty for NULL, JSON for an object or array. */
function cellEditText(value: unknown): string {
    if (value === null || value === undefined) return "";
    return typeof value === "object" ? JSON.stringify(value) : String(value);
}

function formatCellValue(value: unknown): string {
    if (value === null || value === undefined) return "NULL";
    if (typeof value === "object") {
        try {
            return JSON.stringify(value);
        } catch {
            return String(value);
        }
    }
    return String(value);
}

function parseCellInput(raw: string, col: DbColumnInfo): unknown {
    const trimmed = raw.trim();
    if (trimmed === "" && col.nullable) return null;
    const t = col.udtName.toLowerCase();
    if (t === "bool" || t === "boolean") {
        if (trimmed.toLowerCase() === "true") return true;
        if (trimmed.toLowerCase() === "false") return false;
    }
    if (t === "int2" || t === "int4" || t === "int8" || t === "float4" || t === "float8" || t === "numeric") {
        const n = Number(trimmed);
        if (Number.isFinite(n)) return n;
    }
    if (t === "json" || t === "jsonb" || t.startsWith("_")) {
        try {
            return JSON.parse(trimmed);
        } catch {
            return raw;
        }
    }
    return raw;
}

export function TableEditorView() {
    const { requestJson } = useAdminFetch();
    const snackbar = useSnackbarController();
    const { t } = useTranslation();

    const [tables, setTables] = useState<DbTableInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState("");
    const [selectedName, setSelectedName] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<"data" | "columns" | "settings">("data");

    // Data grid state. The rows are kept with the table they were read from,
    // so switching tables never draws one table's rows under another's columns.
    const [loadedRows, setLoadedRows] = useState<{ table: string; rows: Record<string, unknown>[] } | null>(null);
    const [rowsLoading, setRowsLoading] = useState(false);
    const [rowsError, setRowsError] = useState<Error | null>(null);
    const [rowDialogOpen, setRowDialogOpen] = useState(false);
    const [editingRowId, setEditingRowId] = useState<string | null>(null);
    const [rowForm, setRowForm] = useState<Record<string, string>>({});
    const [rowSaving, setRowSaving] = useState(false);

    // Create Table Dialog state
    const [createOpen, setCreateOpen] = useState(false);
    const [newTableName, setNewTableName] = useState("");
    const [newTableRls, setNewTableRls] = useState<string>("authenticated");
    const [draftColumns, setDraftColumns] = useState<DraftColumn[]>([
        { name: "id", type: "uuid", primaryKey: true, nullable: false, unique: false, defaultExpr: "gen_random_uuid()" },
        { name: "title", type: "text", primaryKey: false, nullable: false, unique: false, defaultExpr: "" },
        { name: "created_at", type: "timestamptz", primaryKey: false, nullable: false, unique: false, defaultExpr: "now()" }
    ]);
    const [previewSql, setPreviewSql] = useState<string[] | null>(null);
    const [creating, setCreating] = useState(false);

    // Add Column Dialog state
    const [addColOpen, setAddColOpen] = useState(false);
    const [newCol, setNewCol] = useState<DraftColumn>({
        name: "",
        type: "text",
        primaryKey: false,
        nullable: true,
        unique: false,
        defaultExpr: ""
    });
    const [addingCol, setAddingCol] = useState(false);

    // Add Index Dialog state
    const [addIdxOpen, setAddIdxOpen] = useState(false);
    const [newIdxColumns, setNewIdxColumns] = useState("");
    const [newIdxUnique, setNewIdxUnique] = useState(false);
    const [addingIdx, setAddingIdx] = useState(false);

    // Drop Table Dialog state
    const [dropOpen, setDropOpen] = useState(false);
    const [dropConfirm, setDropConfirm] = useState("");
    const [dropping, setDropping] = useState(false);

    // Settings state
    const [metaSlug, setMetaSlug] = useState("");
    const [metaDescription, setMetaDescription] = useState("");
    const [metaExposed, setMetaExposed] = useState(true);
    const [metaSoftDelete, setMetaSoftDelete] = useState(false);
    const [metaHistory, setMetaHistory] = useState(false);
    const [metaReadOnly, setMetaReadOnly] = useState(false);
    const [savingMeta, setSavingMeta] = useState(false);

    /** Reads the tables again; resolves to the list read, or `null` when the read failed. */
    const loadTables = useCallback(async (): Promise<DbTableInfo[] | null> => {
        setLoading(true);
        setError(null);
        try {
            const raw = await requestJson("/admin/db/tables");
            const list = parseTablesResponse(raw);
            setTables(list);
            setSelectedName((prev) => {
                if (prev && list.some((t) => t.name === prev)) return prev;
                return list[0]?.name ?? null;
            });
            return list;
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : t("studio_tables_load_failed"));
            return null;
        } finally {
            setLoading(false);
        }
    }, [requestJson, t]);

    /**
     * What a change that should leave `name` served actually left: served, or
     * created but not served and why — never "live" because the request
     * succeeded.
     */
    const reportServed = useCallback((list: DbTableInfo[] | null, name: string, done: string) => {
        const table = list?.find((candidate) => candidate.name === name);
        if (!table) {
            snackbar.open({ type: "success", message: `${done}.` });
        } else if (table.served) {
            snackbar.open({ type: "success", message: t("studio_tables_done_served", { done, path: `/api/data/${table.slug}` }) });
        } else {
            snackbar.open({ type: "warning", message: t("studio_tables_done_not_served", { done, reason: t(notServedReasonKey(table)) }) });
        }
    }, [snackbar, t]);

    useEffect(() => {
        void loadTables();
    }, [loadTables]);

    const selectedTable = useMemo(
        () => tables.find((t) => t.name === selectedName) ?? null,
        [tables, selectedName]
    );

    const filteredTables = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return tables;
        return tables.filter((t) => t.name.toLowerCase().includes(q) || t.slug.toLowerCase().includes(q));
    }, [tables, search]);

    // Sync settings form when selected table changes
    useEffect(() => {
        if (!selectedTable) return;
        setMetaSlug(selectedTable.meta?.slug ?? selectedTable.slug);
        setMetaDescription(selectedTable.meta?.description ?? "");
        setMetaExposed(selectedTable.meta?.exposed ?? selectedTable.exposed);
        setMetaSoftDelete(selectedTable.meta?.softDelete ?? false);
        setMetaHistory(selectedTable.meta?.history ?? false);
        setMetaReadOnly(selectedTable.meta?.readOnly ?? false);
    }, [selectedTable]);

    const loadRows = useCallback(async (table: DbTableInfo) => {
        if (!table.served) {
            setLoadedRows({ table: table.name, rows: [] });
            setRowsError(null);
            return;
        }
        setRowsLoading(true);
        setRowsError(null);
        try {
            const raw = await requestJson(`/data/${encodeURIComponent(table.slug)}?limit=100`);
            setLoadedRows({
                table: table.name,
                rows: isRecord(raw) && Array.isArray(raw.data) ? raw.data.filter(isRecord) : []
            });
        } catch (err: unknown) {
            setLoadedRows({ table: table.name, rows: [] });
            setRowsError(err instanceof Error ? err : new Error(t("studio_tables_rows_load_failed")));
        } finally {
            setRowsLoading(false);
        }
    }, [requestJson, t]);

    const rows = loadedRows !== null && loadedRows.table === selectedName ? loadedRows.rows : NO_ROWS;

    useEffect(() => {
        if (selectedTable && activeTab === "data") {
            void loadRows(selectedTable);
        }
    }, [selectedTable, activeTab, loadRows]);

    const pkColumn = useMemo(
        () => selectedTable?.columns.find((c) => c.primaryKey)?.key ?? selectedTable?.columns.find((c) => c.primaryKey)?.name ?? "id",
        [selectedTable]
    );

    const handleReloadSchema = async () => {
        try {
            const res = await requestJson("/admin/schema/reload", { method: "POST" });
            const count = isRecord(res) ? asNumber(res.tables, 0) : 0;
            snackbar.open({ type: "success", message: t("studio_tables_schema_reloaded", { count }) });
            await loadTables();
        } catch (err: unknown) {
            snackbar.open({ type: "error", message: err instanceof Error ? err.message : t("studio_tables_schema_reload_failed") });
        }
    };

    const buildCreatePayload = (dryRun: boolean) => {
        const columns = draftColumns
            .filter((c) => c.name.trim() !== "")
            .map((c) => ({
                name: c.name.trim(),
                type: c.type,
                primaryKey: c.primaryKey,
                nullable: c.nullable,
                unique: c.unique,
                ...(c.defaultExpr.trim() ? { default: c.defaultExpr.trim() } : {})
            }));
        const policies: Array<{ name: string; operation: string; using?: string; withCheck?: string }> = [];
        if (newTableRls === "authenticated") {
            policies.push({ name: "authenticated_all", operation: "ALL", using: SIGNED_IN_SQL, withCheck: SIGNED_IN_SQL });
        } else if (newTableRls === "public-read") {
            policies.push({ name: "public_read", operation: "SELECT", using: "true" });
            policies.push({ name: "authenticated_write", operation: "ALL", using: SIGNED_IN_SQL, withCheck: SIGNED_IN_SQL });
        } else if (newTableRls === "owner") {
            policies.push({ name: "owner_all", operation: "ALL", using: OWNS_ROW_BY_USER_ID_SQL, withCheck: OWNS_ROW_BY_USER_ID_SQL });
        }
        return {
            name: newTableName.trim(),
            columns,
            enableRls: true,
            policies,
            dryRun
        };
    };

    const handlePreviewCreate = async () => {
        try {
            const raw = await requestJson("/admin/db/tables", {
                method: "POST",
                body: buildCreatePayload(true)
            });
            const sql = isRecord(raw) ? asStringArray(raw.statements ?? raw.sql) : [];
            setPreviewSql(sql);
        } catch (err: unknown) {
            snackbar.open({ type: "error", message: err instanceof Error ? err.message : t("studio_tables_sql_preview_failed") });
        }
    };

    const handleCreateTable = async () => {
        setCreating(true);
        try {
            const createdName = newTableName.trim();
            await requestJson("/admin/db/tables", {
                method: "POST",
                body: buildCreatePayload(false)
            });
            setCreateOpen(false);
            setNewTableName("");
            setPreviewSql(null);
            reportServed(await loadTables(), createdName, t("studio_tables_table_created", { name: createdName }));
            setSelectedName(createdName);
        } catch (err: unknown) {
            snackbar.open({ type: "error", message: err instanceof Error ? err.message : t("studio_tables_create_failed") });
        } finally {
            setCreating(false);
        }
    };

    const handleAddColumn = async () => {
        if (!selectedTable || !newCol.name.trim()) return;
        setAddingCol(true);
        try {
            await requestJson(`/admin/db/tables/${encodeURIComponent(selectedTable.name)}/columns`, {
                method: "POST",
                body: {
                    name: newCol.name.trim(),
                    type: newCol.type,
                    nullable: newCol.nullable,
                    unique: newCol.unique,
                    ...(newCol.defaultExpr.trim() ? { default: newCol.defaultExpr.trim() } : {})
                }
            });
            snackbar.open({ type: "success", message: t("studio_tables_column_added", { name: newCol.name.trim() }) });
            setAddColOpen(false);
            setNewCol({ name: "", type: "text", primaryKey: false, nullable: true, unique: false, defaultExpr: "" });
            await loadTables();
        } catch (err: unknown) {
            snackbar.open({ type: "error", message: err instanceof Error ? err.message : t("studio_tables_column_add_failed") });
        } finally {
            setAddingCol(false);
        }
    };

    const handleDropColumn = async (colName: string) => {
        if (!selectedTable) return;
        try {
            await requestJson(`/admin/db/tables/${encodeURIComponent(selectedTable.name)}/columns/${encodeURIComponent(colName)}`, {
                method: "DELETE",
                body: { confirm: colName }
            });
            snackbar.open({ type: "success", message: t("studio_tables_column_dropped", { name: colName }) });
            await loadTables();
        } catch (err: unknown) {
            snackbar.open({ type: "error", message: err instanceof Error ? err.message : t("studio_tables_column_drop_failed") });
        }
    };

    const handleAddIndex = async () => {
        if (!selectedTable) return;
        const cols = newIdxColumns.split(",").map((s) => s.trim()).filter(Boolean);
        if (cols.length === 0) return;
        setAddingIdx(true);
        try {
            await requestJson(`/admin/db/tables/${encodeURIComponent(selectedTable.name)}/indexes`, {
                method: "POST",
                body: { columns: cols, unique: newIdxUnique }
            });
            snackbar.open({ type: "success", message: t("studio_tables_index_created") });
            setAddIdxOpen(false);
            setNewIdxColumns("");
            setNewIdxUnique(false);
            await loadTables();
        } catch (err: unknown) {
            snackbar.open({ type: "error", message: err instanceof Error ? err.message : t("studio_tables_index_create_failed") });
        } finally {
            setAddingIdx(false);
        }
    };

    const handleDropIndex = async (indexName: string) => {
        if (!selectedTable) return;
        try {
            await requestJson(`/admin/db/tables/${encodeURIComponent(selectedTable.name)}/indexes/${encodeURIComponent(indexName)}`, {
                method: "DELETE"
            });
            snackbar.open({ type: "success", message: t("studio_tables_index_dropped", { name: indexName }) });
            await loadTables();
        } catch (err: unknown) {
            snackbar.open({ type: "error", message: err instanceof Error ? err.message : t("studio_tables_index_drop_failed") });
        }
    };

    const handleToggleRls = async (enabled: boolean) => {
        if (!selectedTable) return;
        try {
            await requestJson(`/admin/db/tables/${encodeURIComponent(selectedTable.name)}`, {
                method: "PATCH",
                body: { rlsEnabled: enabled }
            });
            snackbar.open({ type: "success", message: t(enabled ? "studio_tables_rls_enabled_on" : "studio_tables_rls_disabled_on", { name: selectedTable.name }) });
            await loadTables();
        } catch (err: unknown) {
            snackbar.open({ type: "error", message: err instanceof Error ? err.message : t("studio_tables_rls_update_failed") });
        }
    };

    const handleEnableAndExpose = async () => {
        if (!selectedTable) return;
        try {
            await requestJson(`/admin/db/tables/${encodeURIComponent(selectedTable.name)}`, {
                method: "PATCH",
                body: { rlsEnabled: true, meta: { exposed: true } }
            });
            if (selectedTable.policies.length === 0) {
                await requestJson(`/admin/db/tables/${encodeURIComponent(selectedTable.name)}/policies`, {
                    method: "POST",
                    body: {
                        name: "authenticated_all",
                        operation: "ALL",
                        using: SIGNED_IN_SQL,
                        withCheck: SIGNED_IN_SQL
                    }
                });
            }
            reportServed(await loadTables(), selectedTable.name, t("studio_tables_protected_and_exposed", { name: selectedTable.name }));
        } catch (err: unknown) {
            snackbar.open({ type: "error", message: err instanceof Error ? err.message : t("studio_tables_expose_failed") });
        }
    };

    const handleSaveMeta = async () => {
        if (!selectedTable) return;
        setSavingMeta(true);
        try {
            const nonPkCols = selectedTable.columns.filter((c) => !c.primaryKey).map((c) => c.name);
            await requestJson(`/admin/db/tables/${encodeURIComponent(selectedTable.name)}`, {
                method: "PATCH",
                body: {
                    meta: {
                        slug: metaSlug.trim() || null,
                        description: metaDescription.trim() || null,
                        exposed: metaExposed,
                        softDeleteColumn: metaSoftDelete ? (selectedTable.meta?.softDeleteColumn ?? "deleted_at") : null,
                        historyEnabled: metaHistory,
                        readonlyColumns: metaReadOnly ? nonPkCols : []
                    }
                }
            });
            snackbar.open({ type: "success", message: t("studio_tables_meta_saved") });
            await loadTables();
        } catch (err: unknown) {
            snackbar.open({ type: "error", message: err instanceof Error ? err.message : t("studio_tables_meta_save_failed") });
        } finally {
            setSavingMeta(false);
        }
    };

    const handleDropTable = async () => {
        if (!selectedTable || dropConfirm !== selectedTable.name) return;
        setDropping(true);
        try {
            await requestJson(`/admin/db/tables/${encodeURIComponent(selectedTable.name)}`, {
                method: "DELETE",
                body: { confirm: dropConfirm }
            });
            snackbar.open({ type: "success", message: t("studio_tables_table_dropped", { name: selectedTable.name }) });
            setDropOpen(false);
            setDropConfirm("");
            await loadTables();
        } catch (err: unknown) {
            snackbar.open({ type: "error", message: err instanceof Error ? err.message : t("studio_tables_drop_failed") });
        } finally {
            setDropping(false);
        }
    };

    const openAddRow = () => {
        if (!selectedTable) return;
        const initial: Record<string, string> = {};
        for (const col of selectedTable.columns) {
            if (col.defaultExpr) continue;
            initial[col.name] = "";
        }
        setEditingRowId(null);
        setRowForm(initial);
        setRowDialogOpen(true);
    };

    const openEditRow = useCallback((row: Record<string, unknown>) => {
        if (!selectedTable) return;
        const idVal = row[pkColumn];
        if (idVal === undefined || idVal === null) return;
        const initial: Record<string, string> = {};
        for (const col of selectedTable.columns) {
            const v = row[col.key] !== undefined ? row[col.key] : row[col.name];
            initial[col.name] = v === null || v === undefined ? "" : (typeof v === "object" ? JSON.stringify(v) : String(v));
        }
        setEditingRowId(String(idVal));
        setRowForm(initial);
        setRowDialogOpen(true);
    }, [selectedTable, pkColumn]);

    const handleSaveRow = async () => {
        if (!selectedTable) return;
        setRowSaving(true);
        try {
            const payload: Record<string, unknown> = {};
            for (const col of selectedTable.columns) {
                const rawVal = rowForm[col.name];
                if (rawVal === undefined) continue;
                if (!editingRowId && col.defaultExpr && rawVal.trim() === "") continue;
                if (editingRowId && col.primaryKey) continue;
                payload[col.key] = parseCellInput(rawVal, col);
            }
            if (editingRowId) {
                await requestJson(`/data/${encodeURIComponent(selectedTable.slug)}/${encodeURIComponent(editingRowId)}`, {
                    method: "PATCH",
                    body: payload
                });
                snackbar.open({ type: "success", message: t("studio_tables_row_updated") });
            } else {
                await requestJson(`/data/${encodeURIComponent(selectedTable.slug)}`, {
                    method: "POST",
                    body: payload
                });
                snackbar.open({ type: "success", message: t("studio_tables_row_inserted") });
            }
            setRowDialogOpen(false);
            await loadRows(selectedTable);
        } catch (err: unknown) {
            snackbar.open({ type: "error", message: err instanceof Error ? err.message : t("studio_tables_row_save_failed") });
        } finally {
            setRowSaving(false);
        }
    };

    const handleDeleteRow = useCallback(async (row: Record<string, unknown>) => {
        if (!selectedTable) return;
        const idVal = row[pkColumn];
        if (idVal === undefined || idVal === null) return;
        try {
            await requestJson(`/data/${encodeURIComponent(selectedTable.slug)}/${encodeURIComponent(String(idVal))}`, {
                method: "DELETE"
            });
            snackbar.open({ type: "success", message: t("studio_tables_row_deleted") });
            await loadRows(selectedTable);
        } catch (err: unknown) {
            snackbar.open({ type: "error", message: err instanceof Error ? err.message : t("studio_tables_row_delete_failed") });
        }
    }, [selectedTable, pkColumn, requestJson, snackbar, loadRows, t]);

    /**
     * The cell being edited in place, as in the SQL editor's result grid: the
     * table and row it is in, and the text its box opened with — what closing
     * the box unchanged is compared against.
     */
    const [editingCell, setEditingCell] = useState<{ table: string; rowIndex: number; columnKey: string; initialValue: string } | null>(null);

    const handleCellDoubleClick = useCallback((rowIndex: number, columnKey: string, rowData: Record<string, unknown>) => {
        if (!selectedTable) return;
        const col = selectedTable.columns.find((c) => c.key === columnKey);
        if (!col) return;
        if (col.primaryKey) {
            snackbar.open({ type: "error", message: t("studio_tables_pk_not_editable", { name: col.name }) });
            return;
        }
        const idVal = rowData[pkColumn];
        if (idVal === undefined || idVal === null) {
            snackbar.open({ type: "error", message: t("studio_tables_row_no_pk", { name: pkColumn }) });
            return;
        }
        setEditingCell({ table: selectedTable.name, rowIndex, columnKey, initialValue: cellEditText(rowData[columnKey]) });
    }, [selectedTable, pkColumn, snackbar, t]);

    const handleCellSave = useCallback(async (text: string, rowData: Record<string, unknown>, columnKey: string, rowIndex: number) => {
        const editing = editingCell;
        setEditingCell(null);
        // Compared as text, against what the box opened with: closing it
        // untouched is not an edit.
        if (!selectedTable || !editing || text === editing.initialValue) return;
        const col = selectedTable.columns.find((c) => c.key === columnKey);
        const idVal = rowData[pkColumn];
        if (!col || idVal === undefined || idVal === null) return;
        // An emptied box stores NULL where the column allows it, and the
        // text is read as the column's type (a number, a boolean, JSON).
        const value = parseCellInput(text, col);
        const table = selectedTable;
        try {
            const saved = await requestJson(`/data/${encodeURIComponent(table.slug)}/${encodeURIComponent(String(idVal))}`, {
                method: "PATCH",
                body: { [columnKey]: value }
            });
            // The row as stored when the API answers with it — a trigger or a
            // generated column may have changed more than the one cell.
            const row = isRecord(saved) && saved[pkColumn] === idVal ? saved : { ...rowData, [columnKey]: value };
            // Drawn into the rows the edit was made in, and only while they
            // are still on screen.
            setLoadedRows((prev) => {
                if (!prev || prev.table !== table.name || prev.rows[rowIndex]?.[pkColumn] !== idVal) return prev;
                const next = [...prev.rows];
                next[rowIndex] = row;
                return { ...prev, rows: next };
            });
            snackbar.open({ type: "success", message: t("studio_tables_row_updated") });
        } catch (err: unknown) {
            snackbar.open({ type: "error", message: err instanceof Error ? err.message : t("studio_tables_row_save_failed") });
        }
    }, [editingCell, selectedTable, pkColumn, requestJson, snackbar, t]);

    // What the rows grid is handed. `VirtualTable` holds its columns by value,
    // so a width the user dragged survives a reload of the same table.
    const rowColumns = useMemo((): VirtualTableColumn[] => selectedTable
        ? [
            {
                key: ROW_ACTIONS_COLUMN,
                title: "",
                width: 76,
                sortable: false,
                resizable: false
            },
            // `key` is the column's name on the wire, which the rows are keyed by.
            ...selectedTable.columns.map((col) => ({
                key: col.key,
                title: col.name,
                width: rowColumnWidth(col),
                sortable: false,
                resizable: true
            }))
        ]
        : [], [selectedTable]);

    const monoColumnKeys = useMemo(() => {
        const keys = new Set<string>();
        for (const col of selectedTable?.columns ?? []) {
            const udt = col.udtName.toLowerCase();
            if (
                col.primaryKey ||
                udt.includes("uuid") ||
                udt.includes("json") ||
                udt.includes("time") ||
                udt.includes("date") ||
                udt.includes("int") ||
                udt.includes("float") ||
                udt === "numeric"
            ) {
                keys.add(col.key);
            }
        }
        return keys;
    }, [selectedTable]);

    const renderRowCell = useCallback(({ rowData, column, rowIndex }: CellRendererParams<Record<string, unknown>>) => {
        if (!rowData) return null;
        if (column.key === ROW_ACTIONS_COLUMN) {
            return (
                <div className="h-full flex items-center justify-center gap-0.5">
                    <Tooltip title={t("studio_tables_edit_row")}>
                        <IconButton size="small"
                            aria-label={t("studio_tables_edit_row")}
                            className={ROW_ACTION_ICON}
                            onClick={() => openEditRow(rowData)}>
                            <PencilIcon size={iconSize.smallest}/>
                        </IconButton>
                    </Tooltip>
                    <Tooltip title={t("delete_row")}>
                        <IconButton size="small"
                            aria-label={t("delete_row")}
                            className={ROW_ACTION_ICON}
                            onClick={() => void handleDeleteRow(rowData)}>
                            <Trash2Icon size={iconSize.smallest}/>
                        </IconButton>
                    </Tooltip>
                </div>
            );
        }
        const value = rowData[column.key];
        if (editingCell !== null && editingCell.table === selectedName && editingCell.rowIndex === rowIndex && editingCell.columnKey === column.key) {
            return (
                <FixedEditorOverlay
                    displayValue={editingCell.initialValue}
                    onSave={(val) => void handleCellSave(val, rowData, column.key, rowIndex)}
                    onCancel={() => setEditingCell(null)}
                />
            );
        }
        const display = formatCellValue(value);
        const isMono = monoColumnKeys.has(String(column.key));
        return (
            <div className="px-3 h-full flex items-center whitespace-nowrap min-w-0 cursor-text"
                title={display}
                onDoubleClick={() => handleCellDoubleClick(rowIndex, column.key, rowData)}>
                {value === null || value === undefined
                    ? <Typography variant="caption" color="disabled" className="italic">NULL</Typography>
                    : isMono
                        ? <Typography variant="mono" className="truncate text-xs text-text-secondary dark:text-text-secondary-dark">{display}</Typography>
                        : <Typography variant="body2" className="truncate text-[13px]">{display}</Typography>}
            </div>
        );
    }, [openEditRow, handleDeleteRow, monoColumnKeys, t, editingCell, selectedName, handleCellSave, handleCellDoubleClick]);

    return (
        <div className="flex h-full w-full overflow-hidden bg-surface-card">
            {/* Left sidebar: Tables list */}
            <aside className={cls("w-60 shrink-0 flex flex-col border-r bg-surface-card", defaultBorderMixin)}>
                <div className={cls("h-[42px] px-3 border-b bg-surface-sheet flex items-center justify-between gap-2 shrink-0", defaultBorderMixin)}>
                    <div className="flex items-center gap-2 min-w-0">
                        <DatabaseIcon size={iconSize.smallest} className={"text-text-secondary dark:text-text-secondary-dark shrink-0"} />
                        <Typography variant="caption" className="font-semibold uppercase tracking-wider text-text-disabled dark:text-text-disabled-dark truncate">
                            {t("studio_tool_tables")}
                        </Typography>
                    </div>
                    <div className="flex items-center gap-1">
                        <Tooltip title={t("studio_tables_reload_schema")}>
                            <IconButton size="small" aria-label={t("studio_tables_reload_schema")} onClick={handleReloadSchema}>
                                <RefreshCwIcon size={iconSize.smallest} />
                            </IconButton>
                        </Tooltip>
                        <Button size="small" color="primary" variant="filled" onClick={() => setCreateOpen(true)}>
                            <PlusIcon size={iconSize.smallest} />
                            {t("studio_api_keys_new")}
                        </Button>
                    </div>
                </div>

                <div className="p-2">
                    <SearchBar
                        size="small"
                        onTextSearch={(v) => setSearch(v ?? "")}
                        placeholder={t("studio_tables_filter_placeholder")}
                        innerClassName="w-full"
                    />
                </div>

                <div className="flex-1 overflow-y-auto px-2 pb-3 flex flex-col gap-0.5">
                    {loading ? (
                        <div className="flex items-center justify-center py-8">
                            <CircularProgress size="small" />
                        </div>
                    ) : filteredTables.length === 0 ? (
                        <div className="px-3 py-6 text-center flex flex-col items-center gap-2">
                            <Typography variant="body2" color="secondary">
                                {tables.length === 0 ? t("studio_tables_empty") : t("studio_tables_no_match")}
                            </Typography>
                            {tables.length === 0 && (
                                <Button size="small" variant="outlined" onClick={() => setCreateOpen(true)}>
                                    <PlusIcon size={iconSize.small} />
                                    {t("studio_tables_create_first")}
                                </Button>
                            )}
                        </div>
                    ) : (
                        filteredTables.map((table) => {
                            const active = table.name === selectedName;
                            return (
                                <button
                                    key={`${table.schema}.${table.name}`}
                                    type="button"
                                    onClick={() => setSelectedName(table.name)}
                                    className={cls(
                                        "w-full text-left px-2.5 h-8 rounded-lg flex items-center justify-between gap-2 transition-colors cursor-pointer",
                                        active
                                            ? "bg-surface-active text-text-primary dark:text-text-primary-dark font-medium"
                                            : "text-text-secondary dark:text-text-secondary-dark hover:bg-surface-hover hover:text-text-primary dark:hover:text-text-primary-dark"
                                    )}
                                >
                                    <span className="truncate text-[13px]">{table.name}</span>
                                    <div className="flex items-center gap-1 shrink-0">
                                        {table.served ? (
                                            <Tooltip title={t("studio_tables_served_tooltip")}>
                                                <CheckCircleIcon className="w-3.5 h-3.5 text-emerald-500/80" />
                                            </Tooltip>
                                        ) : (
                                            <Tooltip title={t("studio_tables_not_exposed_tooltip")}>
                                                <AlertCircleIcon className="w-3.5 h-3.5 text-amber-500/80" />
                                            </Tooltip>
                                        )}
                                    </div>
                                </button>
                            );
                        })
                    )}
                </div>
            </aside>

            {/* Main content area */}
            <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
                {error && (
                    <div className="p-4">
                        <Alert color="error">{error}</Alert>
                    </div>
                )}

                {!selectedTable ? (
                    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center gap-4">
                        <DatabaseIcon className="w-10 h-10 text-text-disabled" />
                        <div className="max-w-md flex flex-col gap-1">
                            <Typography variant="h6">{t("studio_tables_intro_title")}</Typography>
                            <Typography variant="body2" color="secondary">
                                {t("studio_tables_intro_body")}
                            </Typography>
                        </div>
                        <Button variant="filled" onClick={() => setCreateOpen(true)}>
                            <PlusIcon size={iconSize.small} />
                            {t("studio_tables_new_table")}
                        </Button>
                    </div>
                ) : (
                    <>
                        {/* Header */}
                        <div className={cls("h-[42px] px-4 border-b flex items-center justify-between gap-4 bg-surface-sheet shrink-0", defaultBorderMixin)}>
                            <div className="flex items-center gap-2.5 min-w-0">
                                <Typography variant="subtitle2" className="font-mono font-semibold truncate">
                                    {selectedTable.schema}.{selectedTable.name}
                                </Typography>
                                <Chip size="smallest" colorScheme={selectedTable.served ? "greenLight" : "orangeLight"}>
                                    {selectedTable.served ? `/api/data/${selectedTable.slug}` : t("studio_tables_not_exposed")}
                                </Chip>
                                <Chip size="smallest" colorScheme={selectedTable.rlsEnabled ? "blueLight" : "grayLight"}>
                                    {selectedTable.rlsEnabled ? `RLS (${selectedTable.policies.length})` : t("studio_tables_rls_off")}
                                </Chip>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                                {!selectedTable.served && (
                                    <Button size="small" color="primary" variant="filled" onClick={handleEnableAndExpose}>
                                        <ShieldIcon size={iconSize.smallest} />
                                        {t("studio_tables_enable_and_expose")}
                                    </Button>
                                )}
                                {activeTab === "data" && selectedTable.served && (
                                    <>
                                        <IconButton size="small" aria-label={t("studio_tables_refresh_rows")} onClick={() => void loadRows(selectedTable)}>
                                            <RefreshCwIcon size={iconSize.smallest} />
                                        </IconButton>
                                        <Button size="small" color="primary" variant="filled" onClick={openAddRow}>
                                            <PlusIcon size={iconSize.smallest} />
                                            {t("studio_tables_add_row")}
                                        </Button>
                                    </>
                                )}
                                {activeTab === "columns" && (
                                    <>
                                        <Button size="small" variant="outlined" onClick={() => setAddIdxOpen(true)}>
                                            <PlusIcon size={iconSize.smallest} />
                                            {t("studio_tables_add_index")}
                                        </Button>
                                        <Button size="small" color="primary" variant="filled" onClick={() => setAddColOpen(true)}>
                                            <PlusIcon size={iconSize.smallest} />
                                            {t("studio_tables_add_column")}
                                        </Button>
                                    </>
                                )}
                            </div>
                        </div>

                        <Tabs
                            value={activeTab}
                            onValueChange={(v) => {
                                if (v === "data" || v === "columns" || v === "settings") setActiveTab(v);
                            }}
                            variant="boxy"
                            className="border-b border-hairline px-4 bg-surface-sheet shrink-0"
                        >
                            <Tab value="data">{t("studio_tables_tab_data", { count: rows.length })}</Tab>
                            <Tab value="columns">{t("studio_tables_tab_columns", { count: selectedTable.columns.length })}</Tab>
                            <Tab value="settings">{t("settings_heading")}</Tab>
                        </Tabs>

                        {activeTab === "data" && (selectedTable.served ? (
                            <div className="flex-1 relative min-h-0 min-w-0">
                                <VirtualTable
                                    data={rows}
                                    columns={rowColumns}
                                    rowHeight={32}
                                    headerHeight={32}
                                    loading={rowsLoading}
                                    error={rowsError ?? undefined}
                                    extraData={editingCell}
                                    cellRenderer={renderRowCell}
                                    emptyComponent={
                                        <div className="flex flex-col items-center gap-3 text-center">
                                            <Typography variant="body2" color="secondary">
                                                {t("studio_tables_no_rows", { name: selectedTable.name })}
                                            </Typography>
                                            <Button size="small" variant="filled" onClick={openAddRow}>
                                                <PlusIcon size={iconSize.small} />
                                                {t("studio_tables_insert_first_row")}
                                            </Button>
                                        </div>
                                    }
                                />
                            </div>
                        ) : (
                            <div className="flex-1 overflow-auto p-5">
                                <Alert color="warning">
                                    <div className="flex items-center justify-between gap-4">
                                        <span>
                                            {t("studio_tables_not_served", { reason: t(notServedReasonKey(selectedTable)) })}
                                        </span>
                                        <Button size="small" variant="filled" onClick={handleEnableAndExpose}>
                                            {t("studio_tables_enable_and_expose")}
                                        </Button>
                                    </div>
                                </Alert>
                            </div>
                        ))}

                        {activeTab !== "data" && (
                        <div className="flex-1 overflow-auto p-5">
                            {activeTab === "columns" && (
                                <div className="flex flex-col gap-6">
                                    <div className="flex flex-col gap-2">
                                        <Typography variant="subtitle2">{t("studio_columns")}</Typography>
                                        <div className={cls("overflow-x-auto rounded-lg border", defaultBorderMixin)}>
                                            <Table className="w-full">
                                                <TableHeader>
                                                        <TableCell header>{t("studio_branch_diff_object_column")}</TableCell>
                                                        <TableCell header>{t("type")}</TableCell>
                                                        <TableCell header>{t("studio_tables_constraints")}</TableCell>
                                                        <TableCell header>{t("studio_tables_default")}</TableCell>
                                                        <TableCell header className="text-right">{t("actions")}</TableCell>
                                                    </TableHeader>
                                                <TableBody>
                                                    {selectedTable.columns.map((col) => (
                                                        <TableRow key={col.name}>
                                                            <TableCell className="font-mono text-sm font-medium">{col.name}</TableCell>
                                                            <TableCell className="font-mono text-xs text-text-secondary">{col.dataType}</TableCell>
                                                            <TableCell>
                                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                                    {col.primaryKey && <Chip size="small" colorScheme="blueLight">PK</Chip>}
                                                                    {!col.nullable && <Chip size="small" colorScheme="grayLight">NOT NULL</Chip>}
                                                                    {col.unique && !col.primaryKey && <Chip size="small" colorScheme="purpleLight">UNIQUE</Chip>}
                                                                </div>
                                                            </TableCell>
                                                            <TableCell className="font-mono text-xs text-text-secondary">
                                                                {col.defaultExpr ?? "—"}
                                                            </TableCell>
                                                            <TableCell className="text-right">
                                                                {!col.primaryKey && (
                                                                    <Tooltip title={t("studio_tables_drop_column", { name: col.name })}>
                                                                        <IconButton
                                                                            size="small"
                                                                            aria-label={t("studio_tables_drop_column", { name: col.name })}
                                                                            onClick={() => void handleDropColumn(col.name)}
                                                                        >
                                                                            <Trash2Icon size={iconSize.small} className={"text-red-500"} />
                                                                        </IconButton>
                                                                    </Tooltip>
                                                                )}
                                                            </TableCell>
                                                        </TableRow>
                                                    ))}
                                                </TableBody>
                                            </Table>
                                        </div>
                                    </div>

                                    <div className="flex flex-col gap-2">
                                        <Typography variant="subtitle2">{t("studio_tables_indexes_heading", { count: selectedTable.indexes.length })}</Typography>
                                        <div className={cls("overflow-x-auto rounded-lg border", defaultBorderMixin)}>
                                            <Table className="w-full">
                                                <TableHeader>
                                                        <TableCell header>{t("name")}</TableCell>
                                                        <TableCell header>{t("studio_tables_definition")}</TableCell>
                                                        <TableCell header className="text-right">{t("actions")}</TableCell>
                                                    </TableHeader>
                                                <TableBody>
                                                    {selectedTable.indexes.map((idx) => (
                                                        <TableRow key={idx.name}>
                                                            <TableCell className="font-mono text-xs whitespace-nowrap">
                                                                <div className="flex items-center gap-1.5">
                                                                    <span>{idx.name}</span>
                                                                    {idx.primary && <Chip size="small" colorScheme="blueLight">PK</Chip>}
                                                                    {idx.unique && !idx.primary && <Chip size="small" colorScheme="purpleLight">UNIQUE</Chip>}
                                                                </div>
                                                            </TableCell>
                                                            <TableCell className="font-mono text-xs text-text-secondary">
                                                                {idx.definition}
                                                            </TableCell>
                                                            <TableCell className="text-right">
                                                                {!idx.primary && (
                                                                    <IconButton
                                                                        size="small"
                                                                        aria-label={t("studio_tables_drop_index", { name: idx.name })}
                                                                        onClick={() => void handleDropIndex(idx.name)}
                                                                    >
                                                                        <Trash2Icon size={iconSize.small} className={"text-red-500"} />
                                                                    </IconButton>
                                                                )}
                                                            </TableCell>
                                                        </TableRow>
                                                    ))}
                                                </TableBody>
                                            </Table>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {activeTab === "settings" && (
                                <div className="max-w-2xl flex flex-col gap-5">
                                    <Card className="p-4 flex flex-col gap-4">
                                        <Typography variant="subtitle1">{t("studio_tables_meta_heading")}</Typography>
                                        <TextField
                                            label={t("studio_tables_slug_label")}
                                            value={metaSlug}
                                            onChange={(e) => setMetaSlug(e.target.value)}
                                            placeholder={selectedTable.name}
                                        />
                                        <TextField
                                            label={t("description")}
                                            value={metaDescription}
                                            onChange={(e) => setMetaDescription(e.target.value)}
                                            placeholder={t("studio_tables_description_placeholder")}
                                        />
                                        <BooleanSwitchWithLabel
                                            label={t("studio_tables_expose_label")}
                                            value={metaExposed}
                                            onValueChange={setMetaExposed}
                                        />
                                        <BooleanSwitchWithLabel
                                            label={t("studio_tables_enable_rls_label")}
                                            value={selectedTable.rlsEnabled}
                                            onValueChange={(v) => void handleToggleRls(v)}
                                        />
                                        <BooleanSwitchWithLabel
                                            label={t("studio_tables_read_only_label")}
                                            value={metaReadOnly}
                                            onValueChange={setMetaReadOnly}
                                        />
                                        <BooleanSwitchWithLabel
                                            label={t("studio_tables_soft_delete_label")}
                                            value={metaSoftDelete}
                                            onValueChange={setMetaSoftDelete}
                                        />
                                        <BooleanSwitchWithLabel
                                            label={t("studio_tables_history_label")}
                                            value={metaHistory}
                                            onValueChange={setMetaHistory}
                                        />
                                        <div className="flex justify-end">
                                            <Button variant="filled" disabled={savingMeta} onClick={() => void handleSaveMeta()}>
                                                {savingMeta ? t("saving") : t("studio_tables_save_settings")}
                                            </Button>
                                        </div>
                                    </Card>

                                    <Card className="p-4 border border-red-500/30 flex items-center justify-between gap-4">
                                        <div>
                                            <Typography variant="subtitle2" className="text-red-500">{t("studio_tables_danger_zone")}</Typography>
                                            <Typography variant="body2" color="secondary">
                                                {t("studio_tables_drop_description", { name: selectedTable.name })}
                                            </Typography>
                                        </div>
                                        <Button variant="outlined" color="error" onClick={() => setDropOpen(true)}>
                                            {t("studio_tables_drop_table")}
                                        </Button>
                                    </Card>
                                </div>
                            )}
                        </div>
                        )}
                    </>
                )}
            </main>

            {/* Create Table Dialog */}
            <Dialog open={createOpen} onOpenChange={setCreateOpen} maxWidth="2xl" fullWidth>
                <DialogTitle>{t("studio_tables_create_table")}</DialogTitle>
                <DialogContent className="flex flex-col gap-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <TextField
                            label={t("studio_tables_name_label")}
                            value={newTableName}
                            onChange={(e) => setNewTableName(e.target.value)}
                            placeholder="projects"
                        />
                        <Select
                            label={t("studio_tables_initial_rls")}
                            value={newTableRls}
                            onValueChange={(v) => setNewTableRls(String(v))}
                        >
                            {RLS_PRESETS.map((p) => (
                                <SelectItem key={p.value} value={p.value}>{t(p.labelKey)}</SelectItem>
                            ))}
                        </Select>
                    </div>

                    <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                            <Typography variant="subtitle2">{t("studio_columns")}</Typography>
                            <Button
                                size="small"
                                variant="outlined"
                                onClick={() => setDraftColumns((cols) => [
                                    ...cols,
                                    { name: "", type: "text", primaryKey: false, nullable: true, unique: false, defaultExpr: "" }
                                ])}
                            >
                                <PlusIcon size={iconSize.small} />
                                {t("studio_tables_add_column")}
                            </Button>
                        </div>

                        <div className="flex flex-col gap-2 max-h-64 overflow-y-auto pr-1">
                            {draftColumns.map((col, idx) => (
                                <div key={idx} className={cls("grid grid-cols-12 gap-2 items-center p-2 rounded-md border", defaultBorderMixin)}>
                                    <div className="col-span-3">
                                        <TextField
                                            size="small"
                                            placeholder="column_name"
                                            value={col.name}
                                            onChange={(e) => setDraftColumns((prev) => prev.map((c, i) => i === idx ? { ...c, name: e.target.value } : c))}
                                        />
                                    </div>
                                    <div className="col-span-3">
                                        <Select
                                            size="small"
                                            value={col.type}
                                            onValueChange={(v) => setDraftColumns((prev) => prev.map((c, i) => i === idx ? { ...c, type: String(v) } : c))}
                                        >
                                            {SQL_TYPES.map((t) => (
                                                <SelectItem key={t} value={t}>{t}</SelectItem>
                                            ))}
                                        </Select>
                                    </div>
                                    <div className="col-span-3">
                                        <TextField
                                            size="small"
                                            placeholder={t("studio_tables_default_optional_placeholder")}
                                            value={col.defaultExpr}
                                            onChange={(e) => setDraftColumns((prev) => prev.map((c, i) => i === idx ? { ...c, defaultExpr: e.target.value } : c))}
                                        />
                                    </div>
                                    <div className="col-span-2 flex items-center gap-1">
                                        <Chip
                                            size="small"
                                            colorScheme={col.primaryKey ? "blueLight" : "grayLight"}
                                            onClick={() => setDraftColumns((prev) => prev.map((c, i) => i === idx ? { ...c, primaryKey: !c.primaryKey, nullable: !c.primaryKey ? false : c.nullable } : c))}
                                        >
                                            PK
                                        </Chip>
                                        <Chip
                                            size="small"
                                            colorScheme={!col.nullable ? "orangeLight" : "grayLight"}
                                            onClick={() => setDraftColumns((prev) => prev.map((c, i) => i === idx ? { ...c, nullable: !c.nullable } : c))}
                                        >
                                            NN
                                        </Chip>
                                    </div>
                                    <div className="col-span-1 flex justify-end">
                                        <IconButton
                                            size="small"
                                            aria-label={t("studio_tables_remove_draft_column")}
                                            onClick={() => setDraftColumns((prev) => prev.filter((_, i) => i !== idx))}
                                        >
                                            <Trash2Icon size={iconSize.small} />
                                        </IconButton>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {previewSql && previewSql.length > 0 && (
                        <div className={cls("rounded-md border p-3 bg-surface-frame font-mono text-xs overflow-x-auto whitespace-pre-wrap", defaultBorderMixin)}>
                            {previewSql.join("\n")}
                        </div>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button variant="text" onClick={() => setCreateOpen(false)}>{t("cancel")}</Button>
                    <Button variant="outlined" disabled={!newTableName.trim()} onClick={() => void handlePreviewCreate()}>
                        {t("studio_tables_preview_sql")}
                    </Button>
                    <Button variant="filled" disabled={creating || !newTableName.trim()} onClick={() => void handleCreateTable()}>
                        {creating ? t("studio_tables_creating") : t("studio_tables_create_table")}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Add Column Dialog */}
            <Dialog open={addColOpen} onOpenChange={setAddColOpen} maxWidth="md" fullWidth>
                <DialogTitle>{t("studio_tables_add_column_to", { name: selectedTable?.name ?? "" })}</DialogTitle>
                <DialogContent className="flex flex-col gap-3">
                    <TextField
                        label={t("studio_tables_column_name")}
                        value={newCol.name}
                        onChange={(e) => setNewCol((c) => ({ ...c, name: e.target.value }))}
                        placeholder="status"
                    />
                    <Select
                        label={t("studio_tables_sql_type")}
                        value={newCol.type}
                        onValueChange={(v) => setNewCol((c) => ({ ...c, type: String(v) }))}
                    >
                        {SQL_TYPES.map((t) => (
                            <SelectItem key={t} value={t}>{t}</SelectItem>
                        ))}
                    </Select>
                    <TextField
                        label={t("studio_tables_default_expr")}
                        value={newCol.defaultExpr}
                        onChange={(e) => setNewCol((c) => ({ ...c, defaultExpr: e.target.value }))}
                        placeholder="'draft'"
                    />
                    <BooleanSwitchWithLabel
                        label={t("studio_tables_nullable")}
                        value={newCol.nullable}
                        onValueChange={(v) => setNewCol((c) => ({ ...c, nullable: v }))}
                    />
                    <BooleanSwitchWithLabel
                        label={t("unique")}
                        value={newCol.unique}
                        onValueChange={(v) => setNewCol((c) => ({ ...c, unique: v }))}
                    />
                </DialogContent>
                <DialogActions>
                    <Button variant="text" onClick={() => setAddColOpen(false)}>{t("cancel")}</Button>
                    <Button variant="filled" disabled={addingCol || !newCol.name.trim()} onClick={() => void handleAddColumn()}>
                        {addingCol ? t("studio_tables_adding") : t("studio_tables_add_column")}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Add Index Dialog */}
            <Dialog open={addIdxOpen} onOpenChange={setAddIdxOpen} maxWidth="md" fullWidth>
                <DialogTitle>{t("studio_tables_create_index_on", { name: selectedTable?.name ?? "" })}</DialogTitle>
                <DialogContent className="flex flex-col gap-3">
                    <TextField
                        label={t("studio_tables_index_columns")}
                        value={newIdxColumns}
                        onChange={(e) => setNewIdxColumns(e.target.value)}
                        placeholder="user_id, created_at"
                    />
                    <BooleanSwitchWithLabel
                        label={t("studio_tables_unique_index")}
                        value={newIdxUnique}
                        onValueChange={setNewIdxUnique}
                    />
                </DialogContent>
                <DialogActions>
                    <Button variant="text" onClick={() => setAddIdxOpen(false)}>{t("cancel")}</Button>
                    <Button variant="filled" disabled={addingIdx || !newIdxColumns.trim()} onClick={() => void handleAddIndex()}>
                        {addingIdx ? t("studio_tables_creating") : t("create_index")}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Add / Edit Row Dialog */}
            <Dialog open={rowDialogOpen} onOpenChange={setRowDialogOpen} maxWidth="lg" fullWidth>
                <DialogTitle>{editingRowId ? t("studio_tables_edit_row_title", { id: editingRowId }) : t("studio_tables_insert_row_into", { name: selectedTable?.name ?? "" })}</DialogTitle>
                <DialogContent className="flex flex-col gap-3 max-h-[60vh] overflow-y-auto">
                    {selectedTable?.columns.map((col) => (
                        <TextField
                            key={col.name}
                            label={col.nullable ? `${col.name} (${col.dataType})` : t("studio_tables_field_required", { name: col.name, type: col.dataType })}
                            value={rowForm[col.name] ?? ""}
                            disabled={Boolean(editingRowId && col.primaryKey)}
                            placeholder={col.defaultExpr ? t("studio_tables_default_placeholder", { value: col.defaultExpr }) : ""}
                            onChange={(e) => setRowForm((prev) => ({ ...prev, [col.name]: e.target.value }))}
                        />
                    ))}
                </DialogContent>
                <DialogActions>
                    <Button variant="text" onClick={() => setRowDialogOpen(false)}>{t("cancel")}</Button>
                    <Button variant="filled" disabled={rowSaving} onClick={() => void handleSaveRow()}>
                        {rowSaving ? t("saving") : (editingRowId ? t("studio_save_changes") : t("studio_tables_insert_row"))}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Drop Table Confirmation Dialog */}
            <Dialog open={dropOpen} onOpenChange={setDropOpen} maxWidth="sm" fullWidth>
                <DialogTitle>{t("studio_tables_drop_table")}</DialogTitle>
                <DialogContent className="flex flex-col gap-3">
                    <Alert color="error">
                        {t("studio_tables_drop_warning", { name: selectedTable?.name ?? "" })}
                    </Alert>
                    <TextField
                        label={t("studio_tables_drop_confirm_label", { name: selectedTable?.name ?? "" })}
                        value={dropConfirm}
                        onChange={(e) => setDropConfirm(e.target.value)}
                    />
                </DialogContent>
                <DialogActions>
                    <Button variant="text" onClick={() => setDropOpen(false)}>{t("cancel")}</Button>
                    <Button
                        variant="filled"
                        color="error"
                        disabled={dropping || dropConfirm !== selectedTable?.name}
                        onClick={() => void handleDropTable()}
                    >
                        {dropping ? t("studio_tables_dropping") : t("studio_tables_drop_table")}
                    </Button>
                </DialogActions>
            </Dialog>
        </div>
    );
}
