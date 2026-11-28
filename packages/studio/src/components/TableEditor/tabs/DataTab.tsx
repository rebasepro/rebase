import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import {
    Alert,
    Button,
    Checkbox,
    ChevronLeftIcon,
    ChevronRightIcon,
    cls,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    DownloadIcon,
    FilterChip,
    FilterIcon,
    IconButton,
    iconSize,
    Maximize2Icon,
    PencilIcon,
    PlusIcon,
    Popover,
    RefreshCwIcon,
    Select,
    SelectItem,
    Sheet,
    TextField,
    ToggleButtonGroup,
    Tooltip,
    Trash2Icon,
    Typography,
    UploadIcon,
    VirtualTable,
    XIcon,
    type CellRendererParams,
    type VirtualTableColumn,
    type VirtualTableSortKey
} from "@rebasepro/ui";
import { ConfirmationDialog, UserSelectPopover, useSnackbarController, useTranslation, type SelectableUser } from "@rebasepro/app";
import { IMPERSONATE_HEADER } from "@rebasepro/types";
import { isRecord, useAdminFetch } from "../../../utils/adminFetch";
import { parseCsvWithHeader } from "../../../utils/csv_parse";
import { FixedEditorOverlay } from "../../SQLEditor/FixedEditorOverlay";
import { useRunAsUsers } from "../../useRunAsUsers";
import { AuthUserRowActions, useIsAuthTable } from "./AuthUserActions";
import {
    parseFilterParam,
    parseRowsPage,
    ROW_FILTER_OPERATORS,
    TABLE_FILTER_PARAM,
    tablesLink,
    type CatalogColumn,
    type DbForeignKey,
    type DbTableInfo,
    type RowFilterOperator,
    type RowFilterValue,
    type RowsPage,
    type TableRow
} from "../tableModel";

const PAGE_SIZES = [50, 100, 500] as const;
/** One empty list each, so a page not loaded yet hands the memos the same arrays every render. */
const NO_COLUMNS: CatalogColumn[] = [];
const NO_ROWS: TableRow[] = [];
const NO_KEY: string[] = [];
const SELECT_COLUMN = "__select__";
const ACTIONS_COLUMN = "__actions__";
const IMPORT_CHUNK = 500;
const ROW_ACTION_ICON = "text-text-secondary dark:text-text-secondary-dark hover:text-text-primary dark:hover:text-text-primary-dark transition-colors";

const OPERATOR_LABEL: Record<RowFilterOperator, string> = {
    eq: "=",
    neq: "≠",
    lt: "<",
    lte: "≤",
    gt: ">",
    gte: "≥",
    like: "LIKE",
    ilike: "ILIKE",
    in: "IN",
    is_null: "IS NULL",
    not_null: "IS NOT NULL"
};

/** A starting width wide enough for the column's usual values; the grid lets it be resized. */
function columnWidth(column: CatalogColumn): number {
    const udt = column.udt.toLowerCase();
    if (udt === "uuid") return 300;
    if (udt === "timestamptz" || udt === "timestamp") return 240;
    if (udt === "date" || udt === "bool") return 120;
    if (column.category === "N") return 130;
    if (udt === "json" || udt === "jsonb") return 280;
    return 200;
}

function isMonospace(column: CatalogColumn): boolean {
    return column.primaryKey || column.category === "N" || column.category === "D"
        || column.udt === "uuid" || column.udt === "json" || column.udt === "jsonb";
}

/** The text a long or structured value is shown with in the viewer: JSON pretty-printed when it parses. */
function prettyValue(value: string, column: CatalogColumn | undefined): string {
    if (column && (column.udt === "json" || column.udt === "jsonb")) {
        try {
            return JSON.stringify(JSON.parse(value), null, 2);
        } catch {
            return value;
        }
    }
    return value;
}

/** A row's key: its primary key columns' text, which the admin API casts back to their types. */
function rowKey(row: TableRow, primaryKey: readonly string[]): Record<string, string | null> {
    const key: Record<string, string | null> = {};
    for (const column of primaryKey) key[column] = row[column] ?? null;
    return key;
}

function rowKeyString(row: TableRow, primaryKey: readonly string[]): string {
    return JSON.stringify(primaryKey.map(column => row[column]));
}

/** A data-API value as the text the admin API would have printed. */
function apiValueText(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    return typeof value === "object" ? JSON.stringify(value) : String(value);
}

interface DataTabProps {
    table: DbTableInfo;
}

/**
 * The table's rows, read as the database owner through `/api/admin/db`
 * (unserved tables and views included), or — "View as" — through the data
 * API as one user, under the row level security that user gets.
 */
export function DataTab({ table }: DataTabProps) {
    const { t, i18n } = useTranslation();
    const { requestJson, requestRaw } = useAdminFetch();
    const snackbar = useSnackbarController();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const filters = useMemo(() => parseFilterParam(searchParams.get(TABLE_FILTER_PARAM)), [searchParams]);

    const setFilters = useCallback((next: RowFilterValue[]) => {
        setSearchParams(prev => {
            const params = new URLSearchParams(prev);
            if (next.length > 0) params.set(TABLE_FILTER_PARAM, JSON.stringify(next)); else params.delete(TABLE_FILTER_PARAM);
            return params;
        }, { replace: true });
    }, [setSearchParams]);

    const [sort, setSort] = useState<{ column: string; direction: "asc" | "desc" } | null>(null);
    const [pageSize, setPageSize] = useState<number>(100);
    const [offset, setOffset] = useState(0);
    const [page, setPage] = useState<RowsPage | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [editingCell, setEditingCell] = useState<{ rowIndex: number; column: string; initialValue: string } | null>(null);
    const [viewing, setViewing] = useState<{ column: string; value: string } | null>(null);
    const [rowDialog, setRowDialog] = useState<{ mode: "insert" } | { mode: "edit"; row: TableRow } | null>(null);
    const [confirmDelete, setConfirmDelete] = useState<TableRow[] | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [importOpen, setImportOpen] = useState(false);

    // "View as": the database owner (the admin API) or a user through the data API.
    const [readAs, setReadAs] = useState<"owner" | "api">("owner");
    const [viewAsUser, setViewAsUser] = useState<SelectableUser | null>(null);
    const runAs = useRunAsUsers();
    const throughApi = readAs === "api";
    const isAuthTable = useIsAuthTable(table);

    const loadRequest = useRef(0);
    const filterKey = JSON.stringify(filters);

    useEffect(() => {
        setOffset(0);
        setSelected(new Set());
    }, [filterKey, sort, pageSize, readAs, viewAsUser]);

    const load = useCallback(async () => {
        const request = ++loadRequest.current;
        setLoading(true);
        setError(null);
        try {
            let next: RowsPage;
            if (throughApi) {
                const headers: Record<string, string> = {};
                if (viewAsUser && viewAsUser.uid !== runAs.currentUser?.uid) headers[IMPERSONATE_HEADER] = viewAsUser.uid;
                const raw = await requestJson(
                    `/data/${encodeURIComponent(table.slug)}?limit=${pageSize}&offset=${offset}`,
                    { headers }
                );
                const records = isRecord(raw) && Array.isArray(raw.data) ? raw.data.filter(isRecord) : [];
                const byKey = new Map(table.columns.map(column => [column.key, column.name]));
                const rows = records.map(record => {
                    const row: TableRow = {};
                    for (const [key, value] of Object.entries(record)) row[byKey.get(key) ?? key] = apiValueText(value);
                    return row;
                });
                const total = isRecord(raw) && isRecord(raw.meta) && typeof raw.meta.total === "number" ? raw.meta.total : null;
                next = {
                    columns: page?.columns ?? [],
                    rows,
                    count: { value: total ?? offset + rows.length, exact: total !== null },
                    primaryKey: page?.primaryKey ?? [],
                    readOnly: true,
                    readOnlyReason: null
                };
            } else {
                const params = new URLSearchParams({
                    schema: table.schema,
                    limit: String(pageSize),
                    offset: String(offset)
                });
                if (sort) {
                    params.set("orderBy", sort.column);
                    params.set("direction", sort.direction);
                }
                if (filters.length > 0) params.set("filters", JSON.stringify(filters));
                next = parseRowsPage(await requestJson(`/admin/db/tables/${encodeURIComponent(table.name)}/rows?${params.toString()}`));
            }
            if (request === loadRequest.current) setPage(next);
        } catch (err: unknown) {
            if (request === loadRequest.current) setError(err instanceof Error ? err : new Error(t("studio_tables_rows_load_failed")));
        } finally {
            if (request === loadRequest.current) setLoading(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `page` is read only for the column list a data-API page borrows; `filterKey` stands for `filters`
    }, [throughApi, viewAsUser, runAs.currentUser?.uid, requestJson, table, pageSize, offset, sort, filterKey, t]);

    useEffect(() => {
        void load();
    }, [load]);

    const columns = page?.columns ?? NO_COLUMNS;
    const rows = page?.rows ?? NO_ROWS;
    const primaryKey = page?.primaryKey ?? NO_KEY;
    const writable = !throughApi && page !== null && !page.readOnly;
    const columnByName = useMemo(() => new Map(columns.map(column => [column.name, column])), [columns]);

    /** A column that is the whole of a foreign key opens the row it points at. */
    const foreignKeyByColumn = useMemo(() => {
        const map = new Map<string, DbForeignKey>();
        for (const fk of table.foreignKeys) {
            if (fk.fromColumns.length === 1) map.set(fk.fromColumns[0], fk);
        }
        return map;
    }, [table.foreignKeys]);

    const openForeignRow = useCallback((fk: DbForeignKey, value: string) => {
        navigate(tablesLink(`${fk.toSchema}.${fk.toTable}`, "data", [{ column: fk.toColumns[0], op: "eq", value }]));
    }, [navigate]);

    const saveCell = useCallback(async (text: string, row: TableRow, column: CatalogColumn, rowIndex: number) => {
        const editing = editingCell;
        setEditingCell(null);
        if (!editing || text === editing.initialValue) return;
        // An emptied box stores NULL where the column allows it.
        const value = text === "" && !column.notNull ? null : text;
        try {
            const saved = await requestJson(`/admin/db/tables/${encodeURIComponent(table.name)}/rows`, {
                method: "PATCH",
                body: { schema: table.schema, key: rowKey(row, primaryKey), values: { [column.name]: value } }
            });
            const savedRow = isRecord(saved) && isRecord(saved.row) ? parseRowsPage({ rows: [saved.row] }).rows[0] : null;
            setPage(prev => {
                if (!prev || !savedRow) return prev;
                const nextRows = [...prev.rows];
                if (rowKeyString(nextRows[rowIndex] ?? {}, primaryKey) !== rowKeyString(row, primaryKey)) return prev;
                nextRows[rowIndex] = savedRow;
                return { ...prev, rows: nextRows };
            });
            snackbar.open({ type: "success", message: t("studio_tables_row_updated") });
        } catch (err: unknown) {
            snackbar.open({ type: "error", message: err instanceof Error ? err.message : t("studio_tables_row_save_failed") });
        }
    }, [editingCell, requestJson, table, primaryKey, snackbar, t]);

    const deleteRows = async () => {
        if (!confirmDelete) return;
        setDeleting(true);
        try {
            const result = await requestJson(`/admin/db/tables/${encodeURIComponent(table.name)}/rows`, {
                method: "DELETE",
                body: { schema: table.schema, keys: confirmDelete.map(row => rowKey(row, primaryKey)) }
            });
            const count = isRecord(result) && typeof result.deleted === "number" ? result.deleted : confirmDelete.length;
            snackbar.open({ type: "success", message: t("studio_tables_rows_deleted", { count }) });
            setConfirmDelete(null);
            setSelected(new Set());
            await load();
        } catch (err: unknown) {
            snackbar.open({ type: "error", message: err instanceof Error ? err.message : t("studio_tables_row_delete_failed") });
        } finally {
            setDeleting(false);
        }
    };

    const exportCsv = async () => {
        try {
            const params = new URLSearchParams({ schema: table.schema, format: "csv" });
            if (sort) {
                params.set("orderBy", sort.column);
                params.set("direction", sort.direction);
            }
            if (filters.length > 0) params.set("filters", JSON.stringify(filters));
            const res = await requestRaw(`/admin/db/tables/${encodeURIComponent(table.name)}/rows?${params.toString()}`);
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = `${table.schema}.${table.name}.csv`;
            link.click();
            URL.revokeObjectURL(url);
        } catch (err: unknown) {
            snackbar.open({ type: "error", message: err instanceof Error ? err.message : t("studio_tables_export_failed") });
        }
    };

    const sortBy = useMemo((): VirtualTableSortKey[] | undefined => (sort ? [[sort.column, sort.direction]] : undefined), [sort]);

    const gridColumns = useMemo((): VirtualTableColumn[] => [
        ...(writable ? [
            { key: SELECT_COLUMN, title: "", width: 40, sortable: false, resizable: false },
            // The auth table's rows are accounts: three more actions on each.
            { key: ACTIONS_COLUMN, title: "", width: isAuthTable ? 148 : 76, sortable: false, resizable: false }
        ] : []),
        ...columns.map(column => ({
            key: column.name,
            title: column.name,
            width: columnWidth(column),
            sortable: !throughApi,
            resizable: true
        }))
    ], [columns, writable, throughApi, isAuthTable]);

    const pageKeys = useMemo(() => rows.map(row => rowKeyString(row, primaryKey)), [rows, primaryKey]);
    const allSelected = pageKeys.length > 0 && pageKeys.every(key => selected.has(key));

    const renderCell = useCallback(({ rowData, column, rowIndex }: CellRendererParams<TableRow>) => {
        if (!rowData) return null;
        if (column.key === SELECT_COLUMN) {
            const key = rowKeyString(rowData, primaryKey);
            return (
                <div className="h-full flex items-center justify-center">
                    <Checkbox
                        size="smallest"
                        checked={selected.has(key)}
                        onCheckedChange={(checked) => setSelected(prev => {
                            const next = new Set(prev);
                            if (checked) next.add(key); else next.delete(key);
                            return next;
                        })}
                    />
                </div>
            );
        }
        if (column.key === ACTIONS_COLUMN) {
            return (
                <div className="h-full flex items-center justify-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-150">
                    <Tooltip title={t("studio_tables_edit_row")}>
                        <IconButton size="smallest" aria-label={t("studio_tables_edit_row")} className={ROW_ACTION_ICON}
                            onClick={() => setRowDialog({ mode: "edit", row: rowData })}>
                            <PencilIcon size={iconSize.smallest}/>
                        </IconButton>
                    </Tooltip>
                    <Tooltip title={t("delete_row")}>
                        <IconButton size="smallest" aria-label={t("delete_row")} className={cls(ROW_ACTION_ICON, "hover:text-red-500")}
                            onClick={() => setConfirmDelete([rowData])}>
                            <Trash2Icon size={iconSize.smallest}/>
                        </IconButton>
                    </Tooltip>
                    {isAuthTable && primaryKey.length === 1 && rowData[primaryKey[0]] !== undefined && (
                        <AuthUserRowActions row={rowData} uid={String(rowData[primaryKey[0]])}
                            iconClassName={ROW_ACTION_ICON} onChanged={() => void load()}/>
                    )}
                </div>
            );
        }
        const catalogColumn = columnByName.get(column.key);
        const value = rowData[column.key] ?? null;
        if (editingCell && editingCell.rowIndex === rowIndex && editingCell.column === column.key && catalogColumn) {
            return (
                <FixedEditorOverlay
                    displayValue={editingCell.initialValue}
                    onSave={(text) => void saveCell(text, rowData, catalogColumn, rowIndex)}
                    onCancel={() => setEditingCell(null)}
                />
            );
        }
        const fk = foreignKeyByColumn.get(column.key);
        const long = value !== null && (value.length > 60 || value.includes("\n") || catalogColumn?.udt === "json" || catalogColumn?.udt === "jsonb");
        const editable = writable && catalogColumn && !catalogColumn.generated && !catalogColumn.primaryKey;
        return (
            <div
                className={cls("group px-3 h-full flex items-center gap-1 whitespace-nowrap min-w-0", editable && "cursor-text")}
                title={value ?? "NULL"}
                onDoubleClick={() => {
                    if (!editable) return;
                    setEditingCell({ rowIndex, column: column.key, initialValue: value ?? "" });
                }}
            >
                <div className="min-w-0 flex-1 truncate">
                    {value === null
                        ? <Typography variant="caption" color="disabled" className="italic">NULL</Typography>
                        : fk
                            ? (
                                <button type="button" className="text-primary hover:underline truncate font-mono text-xs"
                                    onClick={() => openForeignRow(fk, value)}>
                                    {value}
                                </button>
                            )
                            : catalogColumn && isMonospace(catalogColumn)
                                ? <Typography variant="mono" className="truncate text-xs text-text-secondary dark:text-text-secondary-dark">{value}</Typography>
                                : <Typography variant="body2" className="truncate text-[13px]">{value}</Typography>}
                </div>
                {long && value !== null && (
                    <IconButton size="smallest" aria-label={t("studio_tables_view_value")} className={ROW_ACTION_ICON}
                        onClick={() => setViewing({ column: column.key, value })}>
                        <Maximize2Icon size={12}/>
                    </IconButton>
                )}
            </div>
        );
    }, [primaryKey, selected, t, columnByName, editingCell, saveCell, foreignKeyByColumn, writable, openForeignRow, isAuthTable, load]);

    const count = page?.count ?? { value: 0, exact: true };
    const firstRow = rows.length === 0 ? 0 : offset + 1;
    const lastRow = offset + rows.length;
    const formatter = new Intl.NumberFormat(i18n?.language);
    const totalLabel = count.exact ? formatter.format(count.value) : `~${formatter.format(count.value)}`;
    const hasNext = count.exact ? lastRow < count.value : rows.length === pageSize;
    const selectedRows = rows.filter(row => selected.has(rowKeyString(row, primaryKey)));

    return (
        <div className="flex-1 flex flex-col min-h-0 min-w-0">
            <div className="px-4 py-2 flex items-center justify-between gap-3 flex-wrap shrink-0">
                <div className="flex items-center gap-2 flex-wrap min-w-0">
                    {!throughApi && (
                        <FilterBar
                            columns={columns}
                            filters={filters}
                            onChange={setFilters}
                        />
                    )}
                    {throughApi && (
                        <Typography variant="caption" color="secondary">{t("studio_tables_view_as_hint")}</Typography>
                    )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    {table.served && (
                        <div className="flex items-center gap-2">
                            <ToggleButtonGroup
                                aria-label={t("studio_tables_view_as")}
                                value={readAs}
                                onValueChange={setReadAs}
                                options={[
                                    { value: "owner", label: t("studio_tables_view_as_owner") },
                                    { value: "api", label: t("studio_tables_view_as_user") }
                                ]}
                            />
                            {throughApi && (
                                <UserSelectPopover
                                    selectedUser={viewAsUser}
                                    onUserSelected={setViewAsUser}
                                    users={runAs.users}
                                    loading={runAs.loading}
                                    onSearchTextChange={runAs.onSearchTextChange}
                                    totalCount={runAs.totalCount}
                                    currentUser={runAs.currentUser}
                                />
                            )}
                        </div>
                    )}
                    {writable && selectedRows.length > 0 && (
                        <Button size="small" variant="outlined" color="error" onClick={() => setConfirmDelete(selectedRows)}>
                            <Trash2Icon size={iconSize.smallest}/>
                            {t("studio_tables_delete_selected", { count: selectedRows.length })}
                        </Button>
                    )}
                    <Tooltip title={t("studio_tables_refresh_rows")}>
                        <IconButton size="small" aria-label={t("studio_tables_refresh_rows")} onClick={() => void load()}>
                            <RefreshCwIcon size={iconSize.smallest}/>
                        </IconButton>
                    </Tooltip>
                    {!throughApi && (
                        <Tooltip title={t("studio_tables_export_csv")}>
                            <IconButton size="small" aria-label={t("studio_tables_export_csv")} onClick={() => void exportCsv()}>
                                <DownloadIcon size={iconSize.smallest}/>
                            </IconButton>
                        </Tooltip>
                    )}
                    {writable && (
                        <Tooltip title={t("studio_tables_import_csv")}>
                            <IconButton size="small" aria-label={t("studio_tables_import_csv")} onClick={() => setImportOpen(true)}>
                                <UploadIcon size={iconSize.smallest}/>
                            </IconButton>
                        </Tooltip>
                    )}
                    {writable && (
                        <Button size="small" color="primary" variant="filled" onClick={() => setRowDialog({ mode: "insert" })}>
                            <PlusIcon size={iconSize.smallest}/>
                            {t("studio_tables_add_row")}
                        </Button>
                    )}
                </div>
            </div>

            {page?.readOnlyReason === "no_primary_key" && !throughApi && (
                <div className="px-4 pb-2 shrink-0">
                    <Alert color="info" size="small">{t("studio_tables_read_only_no_pk")}</Alert>
                </div>
            )}

            <div className="flex-1 relative min-h-0 min-w-0">
                <VirtualTable
                    data={rows}
                    columns={gridColumns}
                    rowHeight={32}
                    headerHeight={32}
                    loading={loading}
                    error={error ?? undefined}
                    extraData={{ editingCell, selected }}
                    cellRenderer={renderCell}
                    sortBy={sortBy}
                    onSortByUpdate={(next) => {
                        const first = next?.[0];
                        setSort(first ? { column: first[0], direction: first[1] } : null);
                    }}
                    emptyComponent={
                        <div className="flex flex-col items-center gap-3 text-center">
                            <Typography variant="body2" color="secondary">
                                {filters.length > 0 ? t("studio_tables_no_matching_rows") : t("studio_tables_no_rows", { name: table.name })}
                            </Typography>
                            {writable && filters.length === 0 && (
                                <Button size="small" variant="outlined" onClick={() => setRowDialog({ mode: "insert" })}>
                                    <PlusIcon size={iconSize.small}/>
                                    {t("studio_tables_insert_first_row")}
                                </Button>
                            )}
                        </div>
                    }
                />
            </div>

            <div className="px-4 h-10 border-t border-hairline flex items-center justify-between gap-3 shrink-0">
                <div className="flex items-center gap-2">
                    {writable && (
                        <Checkbox
                            size="smallest"
                            checked={allSelected}
                            indeterminate={!allSelected && selectedRows.length > 0}
                            onCheckedChange={(checked) => setSelected(checked ? new Set(pageKeys) : new Set())}
                        />
                    )}
                    <Typography variant="caption" color="secondary" className="tabular-nums">
                        {t("studio_tables_rows_range", { first: formatter.format(firstRow), last: formatter.format(lastRow), total: totalLabel })}
                    </Typography>
                </div>
                <div className="flex items-center gap-1.5">
                    <Select
                        size="small"
                        value={String(pageSize)}
                        onValueChange={(value) => setPageSize(Number(value))}
                        renderValue={(value) => t("studio_tables_page_size", { count: Number(value) })}
                    >
                        {PAGE_SIZES.map(size => (
                            <SelectItem key={size} value={String(size)}>{t("studio_tables_page_size", { count: size })}</SelectItem>
                        ))}
                    </Select>
                    <IconButton size="small" aria-label={t("studio_tables_previous_page")} disabled={offset === 0 || loading}
                        onClick={() => setOffset(Math.max(0, offset - pageSize))}>
                        <ChevronLeftIcon size={iconSize.smallest}/>
                    </IconButton>
                    <IconButton size="small" aria-label={t("studio_tables_next_page")} disabled={!hasNext || loading}
                        onClick={() => setOffset(offset + pageSize)}>
                        <ChevronRightIcon size={iconSize.smallest}/>
                    </IconButton>
                </div>
            </div>

            <Sheet open={viewing !== null} onOpenChange={(open) => { if (!open) setViewing(null); }} title={viewing?.column}>
                <div className="w-[min(640px,100vw)] h-full flex flex-col gap-3 p-5 bg-surface-card">
                    <div className="flex items-center justify-between gap-2">
                        <Typography variant="subtitle2" className="font-mono">{viewing?.column}</Typography>
                        <IconButton size="small" aria-label={t("close")} onClick={() => setViewing(null)}>
                            <XIcon size={iconSize.smallest}/>
                        </IconButton>
                    </div>
                    <pre className="flex-1 overflow-auto rounded-lg bg-surface-well border border-hairline p-3 font-mono text-xs whitespace-pre-wrap break-all">
                        {viewing ? prettyValue(viewing.value, columnByName.get(viewing.column)) : ""}
                    </pre>
                </div>
            </Sheet>

            {rowDialog && (
                <RowDialog
                    table={table}
                    columns={columns}
                    primaryKey={primaryKey}
                    row={rowDialog.mode === "edit" ? rowDialog.row : null}
                    onClose={() => setRowDialog(null)}
                    onSaved={() => {
                        setRowDialog(null);
                        void load();
                    }}
                />
            )}

            {importOpen && (
                <ImportDialog
                    table={table}
                    columns={columns}
                    onClose={() => setImportOpen(false)}
                    onImported={() => {
                        setImportOpen(false);
                        void load();
                    }}
                />
            )}

            <ConfirmationDialog
                open={confirmDelete !== null}
                loading={deleting}
                onAccept={() => void deleteRows()}
                onCancel={() => setConfirmDelete(null)}
                title={t("studio_tables_delete_rows_title", { count: confirmDelete?.length ?? 0 })}
                body={t("studio_tables_delete_rows_body", { count: confirmDelete?.length ?? 0, name: table.name })}
            />
        </div>
    );
}

// ── filters ────────────────────────────────────────────────────────────────

function FilterBar({ columns, filters, onChange }: {
    columns: readonly CatalogColumn[];
    filters: readonly RowFilterValue[];
    onChange: (filters: RowFilterValue[]) => void;
}) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [column, setColumn] = useState<string>("");
    const [op, setOp] = useState<RowFilterOperator>("eq");
    const [value, setValue] = useState("");

    useEffect(() => {
        if (open && !column && columns[0]) setColumn(columns[0].name);
    }, [open, column, columns]);

    const needsValue = op !== "is_null" && op !== "not_null";
    const add = () => {
        if (!column || (needsValue && value === "")) return;
        const filter: RowFilterValue = op === "in"
            ? { column, op, value: value.split(",").map(item => item.trim()).filter(Boolean) }
            : needsValue ? { column, op, value } : { column, op };
        onChange([...filters, filter]);
        setValue("");
        setOpen(false);
    };

    const describe = (filter: RowFilterValue) => {
        const shown = Array.isArray(filter.value) ? `(${filter.value.join(", ")})` : filter.value ?? "";
        return `${filter.column} ${OPERATOR_LABEL[filter.op]} ${shown}`.trim();
    };

    return (
        <>
            {filters.map((filter, index) => (
                <FilterChip
                    key={`${filter.column}-${index}`}
                    active
                    size="small"
                    icon={<XIcon size={12}/>}
                    aria-label={t("studio_tables_remove_filter", { filter: describe(filter) })}
                    onClick={() => onChange(filters.filter((_, i) => i !== index))}
                >
                    <span className="font-mono">{describe(filter)}</span>
                </FilterChip>
            ))}
            <Popover
                open={open}
                onOpenChange={setOpen}
                align="start"
                trigger={
                    <Button size="small" variant="text">
                        <FilterIcon size={iconSize.smallest}/>
                        {t("studio_tables_add_filter")}
                    </Button>
                }
            >
                <div className="p-3 flex flex-col gap-3 w-80">
                    <Select size="small" fullWidth label={t("studio_branch_diff_object_column")} value={column}
                        onValueChange={(next) => setColumn(String(next))}>
                        {columns.map(candidate => (
                            <SelectItem key={candidate.name} value={candidate.name}>
                                <span className="font-mono">{candidate.name}</span>
                            </SelectItem>
                        ))}
                    </Select>
                    {/* Operator beside the value, as the CMS filter lays them out: one reads "= 42", not two stacked fields. */}
                    <div className="flex gap-2">
                        <div className={needsValue ? "w-32 shrink-0" : "w-full"}>
                            <Select size="small" fullWidth label={t("studio_tables_filter_operator")} value={op}
                                onValueChange={(next) => {
                                    const found = ROW_FILTER_OPERATORS.find(candidate => candidate === next);
                                    if (found) setOp(found);
                                }}>
                                {ROW_FILTER_OPERATORS.map(candidate => (
                                    <SelectItem key={candidate} value={candidate}>{OPERATOR_LABEL[candidate]}</SelectItem>
                                ))}
                            </Select>
                        </div>
                        {needsValue && (
                            <TextField
                                size="small"
                                className="grow min-w-0"
                                label={op === "in" ? t("studio_tables_filter_values") : t("studio_tables_filter_value")}
                                value={value}
                                onChange={(event) => setValue(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                        event.preventDefault();
                                        add();
                                    }
                                }}
                            />
                        )}
                    </div>
                    <div className="flex justify-end">
                        <Button size="small" onClick={add} disabled={!column || (needsValue && value === "")}>
                            {t("studio_tables_apply_filter")}
                        </Button>
                    </div>
                </div>
            </Popover>
            {filters.length > 0 && (
                <Button size="small" variant="text" onClick={() => onChange([])}>{t("studio_tables_clear_filters")}</Button>
            )}
        </>
    );
}

// ── insert / edit a row ────────────────────────────────────────────────────

function RowDialog({ table, columns, primaryKey, row, onClose, onSaved }: {
    table: DbTableInfo;
    columns: readonly CatalogColumn[];
    primaryKey: readonly string[];
    row: TableRow | null;
    onClose: () => void;
    onSaved: () => void;
}) {
    const { t } = useTranslation();
    const { requestJson } = useAdminFetch();
    const snackbar = useSnackbarController();
    const editable = columns.filter(column => !column.generated);
    const [values, setValues] = useState<Record<string, string>>(() => {
        const initial: Record<string, string> = {};
        for (const column of editable) initial[column.name] = row ? row[column.name] ?? "" : "";
        return initial;
    });
    /** Columns the user explicitly set to NULL (an empty box otherwise means "default" on insert). */
    const [nulls, setNulls] = useState<Set<string>>(() => new Set(row ? editable.filter(column => row[column.name] === null).map(column => column.name) : []));
    const [saving, setSaving] = useState(false);

    const save = async () => {
        setSaving(true);
        try {
            const payload: Record<string, string | null> = {};
            for (const column of editable) {
                const text = values[column.name] ?? "";
                const isNull = nulls.has(column.name);
                if (row) {
                    const before = row[column.name] ?? null;
                    const after = isNull ? null : text;
                    if (after !== before && !column.primaryKey) payload[column.name] = after;
                } else if (isNull) {
                    payload[column.name] = null;
                } else if (text !== "") {
                    payload[column.name] = text;
                }
            }
            if (row) {
                if (Object.keys(payload).length === 0) {
                    onClose();
                    return;
                }
                await requestJson(`/admin/db/tables/${encodeURIComponent(table.name)}/rows`, {
                    method: "PATCH",
                    body: { schema: table.schema, key: rowKey(row, primaryKey), values: payload }
                });
                snackbar.open({ type: "success", message: t("studio_tables_row_updated") });
            } else {
                await requestJson(`/admin/db/tables/${encodeURIComponent(table.name)}/rows`, {
                    method: "POST",
                    body: { schema: table.schema, rows: [payload] }
                });
                snackbar.open({ type: "success", message: t("studio_tables_row_inserted") });
            }
            onSaved();
        } catch (err: unknown) {
            snackbar.open({ type: "error", message: err instanceof Error ? err.message : t("studio_tables_row_save_failed") });
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open onOpenChange={(open) => { if (!open) onClose(); }} maxWidth="lg" fullWidth>
            <DialogTitle>{row ? t("studio_tables_edit_row_title", { id: primaryKey.map(column => row[column]).join(", ") }) : t("studio_tables_insert_row_into", { name: table.name })}</DialogTitle>
            <DialogContent className="flex flex-col gap-3 max-h-[60vh] overflow-y-auto">
                {editable.map(column => {
                    const isNull = nulls.has(column.name);
                    const locked = Boolean(row && column.primaryKey) || (column.identity === "always" && !row);
                    const placeholder = column.identity
                        ? t("studio_tables_identity_placeholder")
                        : column.default ? t("studio_tables_default_placeholder", { value: column.default }) : "";
                    return (
                        <div key={column.name} className="flex items-start gap-2">
                            <TextField
                                className="flex-1"
                                label={`${column.name} · ${column.type}${column.notNull ? " *" : ""}`}
                                value={isNull ? "" : values[column.name] ?? ""}
                                disabled={locked || isNull}
                                multiline={column.udt === "json" || column.udt === "jsonb" || column.udt === "text"}
                                placeholder={isNull ? "NULL" : placeholder}
                                onChange={(event) => setValues(prev => ({ ...prev, [column.name]: event.target.value }))}
                            />
                            {!column.notNull && !locked && (
                                <FilterChip size="small" active={isNull} className="mt-2.5 shrink-0 font-mono text-[11px]"
                                    onClick={() => setNulls(prev => {
                                        const next = new Set(prev);
                                        if (next.has(column.name)) next.delete(column.name); else next.add(column.name);
                                        return next;
                                    })}>
                                    NULL
                                </FilterChip>
                            )}
                        </div>
                    );
                })}
            </DialogContent>
            <DialogActions>
                <Button variant="text" onClick={onClose}>{t("cancel")}</Button>
                <Button variant="filled" color="primary" disabled={saving} onClick={() => void save()}>
                    {saving ? t("saving") : row ? t("studio_save_changes") : t("studio_tables_insert_row")}
                </Button>
            </DialogActions>
        </Dialog>
    );
}

// ── CSV import ─────────────────────────────────────────────────────────────

function ImportDialog({ table, columns, onClose, onImported }: {
    table: DbTableInfo;
    columns: readonly CatalogColumn[];
    onClose: () => void;
    onImported: () => void;
}) {
    const { t } = useTranslation();
    const { requestJson } = useAdminFetch();
    const snackbar = useSnackbarController();
    const [parsed, setParsed] = useState<{ columns: string[]; rows: Record<string, string | null>[] } | null>(null);
    const [fileName, setFileName] = useState<string | null>(null);
    const [importing, setImporting] = useState(false);
    const [progress, setProgress] = useState(0);
    const [failure, setFailure] = useState<string | null>(null);

    const known = new Set(columns.filter(column => !column.generated).map(column => column.name));
    const matched = parsed ? parsed.columns.filter(column => known.has(column)) : [];
    const ignored = parsed ? parsed.columns.filter(column => column && !known.has(column)) : [];

    const readFile = async (file: File) => {
        setFailure(null);
        setFileName(file.name);
        setParsed(parseCsvWithHeader(await file.text()));
    };

    const run = async () => {
        if (!parsed) return;
        setImporting(true);
        setFailure(null);
        let done = 0;
        try {
            for (let start = 0; start < parsed.rows.length; start += IMPORT_CHUNK) {
                const chunk = parsed.rows.slice(start, start + IMPORT_CHUNK).map(row => {
                    const out: Record<string, string | null> = {};
                    for (const column of matched) out[column] = row[column] ?? null;
                    return out;
                });
                try {
                    await requestJson(`/admin/db/tables/${encodeURIComponent(table.name)}/rows`, {
                        method: "POST",
                        body: { schema: table.schema, rows: chunk }
                    });
                } catch (err: unknown) {
                    const message = err instanceof Error ? err.message : String(err);
                    setFailure(t("studio_tables_import_failed_at", { first: start + 1, last: start + chunk.length, done, message }));
                    return;
                }
                done += chunk.length;
                setProgress(done);
            }
            snackbar.open({ type: "success", message: t("studio_tables_imported_rows", { count: done }) });
            onImported();
        } finally {
            setImporting(false);
        }
    };

    return (
        <Dialog open onOpenChange={(open) => { if (!open && !importing) onClose(); }} maxWidth="lg" fullWidth>
            <DialogTitle>{t("studio_tables_import_into", { name: table.name })}</DialogTitle>
            <DialogContent className="flex flex-col gap-3">
                <Typography variant="body2" color="secondary">{t("studio_tables_import_help")}</Typography>
                <Button variant="outlined" component="label" className="self-start">
                    <UploadIcon size={iconSize.smallest}/>
                    {fileName ?? t("studio_tables_import_choose")}
                    <input type="file" accept=".csv,text/csv" className="hidden"
                        onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (file) void readFile(file);
                        }}/>
                </Button>
                {parsed && (
                    <div className="flex flex-col gap-2">
                        <Typography variant="body2">
                            {t("studio_tables_import_summary", { rows: parsed.rows.length, columns: matched.length })}
                        </Typography>
                        {matched.length > 0 && (
                            <Typography variant="caption" color="secondary" className="font-mono">{matched.join(", ")}</Typography>
                        )}
                        {ignored.length > 0 && (
                            <Alert color="warning" size="small">{t("studio_tables_import_ignored", { columns: ignored.join(", ") })}</Alert>
                        )}
                    </div>
                )}
                {importing && (
                    <Typography variant="caption" color="secondary">
                        {t("studio_tables_import_progress", { done: progress, total: parsed?.rows.length ?? 0 })}
                    </Typography>
                )}
                {failure && <Alert color="error">{failure}</Alert>}
            </DialogContent>
            <DialogActions>
                <Button variant="text" disabled={importing} onClick={onClose}>{t("cancel")}</Button>
                <Button variant="filled" color="primary"
                    disabled={importing || !parsed || parsed.rows.length === 0 || matched.length === 0}
                    onClick={() => void run()}>
                    {importing ? t("studio_tables_importing") : t("studio_tables_import_rows", { count: parsed?.rows.length ?? 0 })}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
