import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import {
    Alert,
    Button,
    Chip,
    CircularProgress,
    CodeIcon,
    cls,
    DatabaseIcon,
    defaultBorderMixin,
    EyeIcon,
    IconButton,
    iconSize,
    LucideIconByName,
    PlusIcon,
    RefreshCwIcon,
    SearchBar,
    ShieldIcon,
    StatusDot,
    Tab,
    TableIcon,
    Tabs,
    ToggleButtonGroup,
    Tooltip,
    Typography
} from "@rebasepro/ui";
import { useSnackbarController, useTranslation } from "@rebasepro/app";
import { asNumber, isRecord, useAdminFetch } from "../../utils/adminFetch";
import { TablesDiagram } from "../SchemaVisualizer/TablesDiagram";
import { CreateTableDialog } from "./CreateTableDialog";
import { TableDdlSheet } from "./TableDdlSheet";
import { DataTab } from "./tabs/DataTab";
import { StructureTab } from "./tabs/StructureTab";
import { PoliciesTab } from "./tabs/PoliciesTab";
import { RelationsTab } from "./tabs/RelationsTab";
import { StatsTab } from "./tabs/StatsTab";
import { SettingsTab } from "./tabs/SettingsTab";
import { SIGNED_IN_SQL } from "../RLSEditor/policy-presets";
import {
    isInspectorTab,
    notServedReasonKey,
    parseTableDetails,
    parseTablesResponse,
    TABLE_FILTER_PARAM,
    TABLE_PARAM,
    TABLE_TAB_PARAM,
    TABLES_VIEW_PARAM,
    type DbTableInfo,
    type InspectorTab,
    type TableDetails
} from "./tableModel";

/** The tabs that read the table's catalog details. */
const DETAIL_TABS: ReadonlySet<InspectorTab> = new Set(["structure", "policies", "relations", "stats"]);

/**
 * The Tables view: every table of the schema, and for the one selected its
 * rows, structure, policies, relations, statistics and settings — or the
 * whole schema as a diagram. The selection, tab and mode live in the URL
 * (`?table=schema.name&tableTab=…`, `?tablesView=diagram`), so any view can
 * link straight to them.
 */
export function TableEditorView() {
    const { requestJson } = useAdminFetch();
    const snackbar = useSnackbarController();
    const { t, i18n } = useTranslation();
    const [searchParams, setSearchParams] = useSearchParams();

    const [tables, setTables] = useState<DbTableInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState("");
    const [createOpen, setCreateOpen] = useState(false);
    const [ddlOpen, setDdlOpen] = useState(false);
    const [details, setDetails] = useState<{ key: string; value: TableDetails } | null>(null);
    const [detailsLoading, setDetailsLoading] = useState(false);
    const [detailsVersion, setDetailsVersion] = useState(0);

    const linkedKey = searchParams.get(TABLE_PARAM);
    const rawTab = searchParams.get(TABLE_TAB_PARAM);
    const activeTab: InspectorTab = isInspectorTab(rawTab) ? rawTab : "data";
    const diagramMode = searchParams.get(TABLES_VIEW_PARAM) === "diagram";

    /** Changes this view's own parameters only: the hosted console keeps its own (`?tab=`) in the same query string. */
    const updateParams = useCallback((change: Record<string, string | null>) => {
        setSearchParams(prev => {
            const params = new URLSearchParams(prev);
            for (const [key, value] of Object.entries(change)) {
                if (value === null) params.delete(key); else params.set(key, value);
            }
            return params;
        }, { replace: true });
    }, [setSearchParams]);

    /** Reads the tables again; resolves to the list read, or `null` when the read failed. */
    const loadTables = useCallback(async (): Promise<DbTableInfo[] | null> => {
        setLoading(true);
        setError(null);
        try {
            const list = parseTablesResponse(await requestJson("/admin/db/tables"));
            setTables(list);
            return list;
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : t("studio_tables_load_failed"));
            return null;
        } finally {
            setLoading(false);
        }
    }, [requestJson, t]);

    useEffect(() => {
        void loadTables();
    }, [loadTables]);

    // With nothing linked, the first table is selected.
    useEffect(() => {
        if (loading || diagramMode) return;
        if (linkedKey && tables.some(table => table.key === linkedKey)) return;
        const first = tables[0]?.key ?? null;
        if (first !== linkedKey) updateParams({ [TABLE_PARAM]: first });
    }, [loading, diagramMode, linkedKey, tables, updateParams]);

    const selectedTable = useMemo(() => tables.find(table => table.key === linkedKey) ?? null, [tables, linkedKey]);

    const selectTable = useCallback((key: string | null) => {
        // A table picked by hand starts unfiltered; a link may bring its own filters.
        updateParams({ [TABLE_PARAM]: key, [TABLE_FILTER_PARAM]: null });
    }, [updateParams]);

    const setTab = useCallback((tab: InspectorTab) => updateParams({ [TABLE_TAB_PARAM]: tab === "data" ? null : tab }), [updateParams]);

    const needsDetails = selectedTable !== null && (DETAIL_TABS.has(activeTab) || ddlOpen);
    useEffect(() => {
        if (!needsDetails || !selectedTable) return;
        let current = true;
        setDetailsLoading(true);
        requestJson(`/admin/db/tables/${encodeURIComponent(selectedTable.name)}/details?schema=${encodeURIComponent(selectedTable.schema)}`)
            .then(raw => {
                const parsed = parseTableDetails(raw);
                if (current && parsed) setDetails({ key: selectedTable.key, value: parsed });
            })
            .catch((err: unknown) => {
                if (current) snackbar.open({ type: "error", message: err instanceof Error ? err.message : t("studio_tables_details_failed") });
            })
            .finally(() => {
                if (current) setDetailsLoading(false);
            });
        return () => {
            current = false;
        };
        // Read again when the table, a detail tab or a change asks for it.
    }, [needsDetails, selectedTable?.key, detailsVersion, requestJson]); // eslint-disable-line react-hooks/exhaustive-deps

    const currentDetails = details && selectedTable && details.key === selectedTable.key ? details.value : null;

    /** After a change: the list and the selected table's details, read again. */
    const refresh = useCallback(() => {
        void loadTables();
        setDetailsVersion(version => version + 1);
    }, [loadTables]);

    /**
     * What a change that should leave `name` served actually left: served, or
     * not served and why — never "live" because the request succeeded.
     */
    const reportServed = useCallback((list: DbTableInfo[] | null, key: string, done: string) => {
        const table = list?.find(candidate => candidate.key === key);
        if (!table) {
            snackbar.open({ type: "success", message: `${done}.` });
        } else if (table.served) {
            snackbar.open({ type: "success", message: t("studio_tables_done_served", { done, path: `/api/data/${table.slug}` }) });
        } else {
            snackbar.open({ type: "warning", message: t("studio_tables_done_not_served", { done, reason: t(notServedReasonKey(table)) }) });
        }
    }, [snackbar, t]);

    const handleReloadSchema = async () => {
        try {
            const res = await requestJson("/admin/schema/reload", { method: "POST" });
            const count = isRecord(res) ? asNumber(res.tables, 0) : 0;
            snackbar.open({ type: "success", message: t("studio_tables_schema_reloaded", { count }) });
            refresh();
        } catch (err: unknown) {
            snackbar.open({ type: "error", message: err instanceof Error ? err.message : t("studio_tables_schema_reload_failed") });
        }
    };

    const handleEnableAndExpose = async (table: DbTableInfo) => {
        try {
            await requestJson(`/admin/db/tables/${encodeURIComponent(table.name)}`, {
                method: "PATCH",
                body: { schema: table.schema, rlsEnabled: true, meta: { exposed: true } }
            });
            if (table.policies.length === 0) {
                await requestJson(`/admin/db/tables/${encodeURIComponent(table.name)}/policies`, {
                    method: "POST",
                    body: { schema: table.schema, name: "authenticated_all", operation: "ALL", using: SIGNED_IN_SQL, withCheck: SIGNED_IN_SQL }
                });
            }
            reportServed(await loadTables(), table.key, t("studio_tables_protected_and_exposed", { name: table.name }));
        } catch (err: unknown) {
            snackbar.open({ type: "error", message: err instanceof Error ? err.message : t("studio_tables_expose_failed") });
        }
    };

    const filteredTables = useMemo(() => {
        const query = search.trim().toLowerCase();
        if (!query) return tables;
        return tables.filter(table => table.name.toLowerCase().includes(query) || table.slug.toLowerCase().includes(query));
    }, [tables, search]);

    const schema = tables[0]?.schema ?? "public";
    const formatter = new Intl.NumberFormat(i18n?.language);

    return (
        <div className="flex h-full w-full overflow-hidden bg-surface-card">
            <aside className={cls("w-60 shrink-0 flex flex-col border-r bg-surface-card", defaultBorderMixin)}>
                <div className={cls("h-[42px] px-3 border-b bg-surface-sheet flex items-center justify-between gap-2 shrink-0", defaultBorderMixin)}>
                    <div className="flex items-center gap-2 min-w-0">
                        <DatabaseIcon size={iconSize.smallest} className="text-text-secondary dark:text-text-secondary-dark shrink-0"/>
                        <Typography variant="caption" className="font-medium text-text-secondary dark:text-text-secondary-dark truncate">
                            {t("studio_tool_tables")}
                        </Typography>
                    </div>
                    <div className="flex items-center gap-1">
                        <Tooltip title={t("studio_tables_reload_schema")}>
                            <IconButton size="small" aria-label={t("studio_tables_reload_schema")} onClick={() => void handleReloadSchema()}>
                                <RefreshCwIcon size={iconSize.smallest}/>
                            </IconButton>
                        </Tooltip>
                        <Button size="small" variant="outlined" onClick={() => setCreateOpen(true)}>
                            <PlusIcon size={iconSize.smallest}/>
                            {t("studio_api_keys_new")}
                        </Button>
                    </div>
                </div>

                <div className="px-2 pt-2">
                    <ToggleButtonGroup
                        fullWidth
                        aria-label={t("studio_tables_view_mode")}
                        value={diagramMode ? "diagram" : "list"}
                        onValueChange={(mode) => updateParams({ [TABLES_VIEW_PARAM]: mode === "diagram" ? "diagram" : null })}
                        options={[
                            { value: "list", label: t("studio_tables_mode_tables"), icon: <TableIcon size={iconSize.smallest}/> },
                            { value: "diagram", label: t("studio_tables_mode_diagram"), icon: <LucideIconByName name="Network" size={14}/> }
                        ]}
                    />
                </div>

                <div className="p-2">
                    <SearchBar size="small" onTextSearch={(value) => setSearch(value ?? "")} placeholder={t("studio_tables_filter_placeholder")} innerClassName="w-full"/>
                </div>

                <div className="flex-1 overflow-y-auto px-2 pb-3 flex flex-col gap-0.5">
                    {loading && tables.length === 0 ? (
                        <div className="flex items-center justify-center py-8"><CircularProgress size="small"/></div>
                    ) : filteredTables.length === 0 ? (
                        <div className="px-3 py-6 text-center flex flex-col items-center gap-2">
                            <Typography variant="body2" color="secondary">
                                {tables.length === 0 ? t("studio_tables_empty") : t("studio_tables_no_match")}
                            </Typography>
                            {tables.length === 0 && (
                                <Button size="small" variant="outlined" onClick={() => setCreateOpen(true)}>
                                    <PlusIcon size={iconSize.small}/>
                                    {t("studio_tables_create_first")}
                                </Button>
                            )}
                        </div>
                    ) : filteredTables.map(table => {
                        const active = table.key === linkedKey;
                        return (
                            <button
                                key={table.key}
                                type="button"
                                onClick={() => selectTable(table.key)}
                                className={cls(
                                    "w-full text-left px-2.5 h-8 rounded-lg flex items-center justify-between gap-2 transition-colors cursor-pointer",
                                    active
                                        ? "bg-surface-active text-text-primary dark:text-text-primary-dark font-medium"
                                        : "text-text-secondary dark:text-text-secondary-dark hover:bg-surface-hover hover:text-text-primary dark:hover:text-text-primary-dark"
                                )}
                            >
                                <span className="flex items-center gap-2 min-w-0">
                                    {table.kind === "view"
                                        ? <EyeIcon size={14} className="shrink-0 text-text-disabled dark:text-text-disabled-dark"/>
                                        : <TableIcon size={14} className="shrink-0 text-text-disabled dark:text-text-disabled-dark"/>}
                                    <span className="truncate text-[13px]">{table.name}</span>
                                </span>
                                <Tooltip title={table.served ? t("studio_tables_served_tooltip") : t("studio_tables_not_exposed_tooltip")}>
                                    <span>
                                        <StatusDot tone={table.served ? "ok" : "idle"}
                                            aria-label={table.served ? t("studio_tables_served_tooltip") : t("studio_tables_not_exposed_tooltip")}/>
                                    </span>
                                </Tooltip>
                            </button>
                        );
                    })}
                </div>
            </aside>

            <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
                {error && <div className="p-4"><Alert color="error">{error}</Alert></div>}

                {diagramMode ? (
                    <div className="flex-1 min-h-0">
                        <TablesDiagram
                            catalog={tables}
                            highlightTable={selectedTable?.name ?? null}
                            onOpenTable={(name) => updateParams({
                                [TABLE_PARAM]: `${schema}.${name}`,
                                [TABLES_VIEW_PARAM]: null,
                                [TABLE_FILTER_PARAM]: null
                            })}
                        />
                    </div>
                ) : !selectedTable ? (
                    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center gap-4">
                        <DatabaseIcon className="w-10 h-10 text-text-disabled"/>
                        <div className="max-w-md flex flex-col gap-1">
                            <Typography variant="h6">{t("studio_tables_intro_title")}</Typography>
                            <Typography variant="body2" color="secondary">{t("studio_tables_intro_body")}</Typography>
                        </div>
                        <Button variant="filled" color="primary" onClick={() => setCreateOpen(true)}>
                            <PlusIcon size={iconSize.small}/>
                            {t("studio_tables_new_table")}
                        </Button>
                    </div>
                ) : (
                    <>
                        <div className="h-[42px] px-4 flex items-center justify-between gap-4 bg-surface-sheet shrink-0">
                            <div className="flex items-center gap-2.5 min-w-0">
                                <Typography variant="subtitle2" className="font-mono font-semibold truncate">
                                    {selectedTable.schema}.{selectedTable.name}
                                </Typography>
                                <Chip size="smallest" colorScheme={selectedTable.served ? "greenLight" : "orangeLight"}>
                                    {selectedTable.served ? `/api/data/${selectedTable.slug}` : t("studio_tables_not_exposed")}
                                </Chip>
                                {selectedTable.kind === "table" && (
                                    <Tooltip title={t("studio_tables_rls_chip_tooltip")}>
                                        <Chip size="smallest" colorScheme={selectedTable.rlsEnabled ? "blueLight" : "grayLight"} onClick={() => setTab("policies")}>
                                            {selectedTable.rlsEnabled ? `RLS (${selectedTable.policies.length})` : t("studio_tables_rls_off")}
                                        </Chip>
                                    </Tooltip>
                                )}
                                {selectedTable.kind === "view" && (
                                    <Chip size="smallest">{selectedTable.materialized ? t("studio_tables_kind_matview") : t("studio_tables_kind_view")}</Chip>
                                )}
                                {selectedTable.rowEstimate !== null && (
                                    <Typography variant="caption" color="secondary" className="whitespace-nowrap">
                                        {t("studio_tables_row_estimate", { count: formatter.format(selectedTable.rowEstimate) })}
                                    </Typography>
                                )}
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                                <Button size="small" variant="text" onClick={() => setDdlOpen(true)}>
                                    <CodeIcon size={iconSize.smallest}/>
                                    {t("studio_tables_view_sql")}
                                </Button>
                            </div>
                        </div>

                        <Tabs
                            value={activeTab}
                            onValueChange={(value) => { if (isInspectorTab(value)) setTab(value); }}
                            variant="boxy"
                            className="border-b border-hairline px-4 bg-surface-sheet shrink-0"
                        >
                            <Tab value="data">{t("studio_tables_tab_data_plain")}</Tab>
                            <Tab value="structure">{t("studio_tables_tab_structure")}</Tab>
                            {selectedTable.kind === "table" && <Tab value="policies">{t("studio_tables_tab_policies")}</Tab>}
                            <Tab value="relations">{t("studio_tables_tab_relations")}</Tab>
                            <Tab value="stats">{t("studio_tables_tab_stats")}</Tab>
                            <Tab value="settings">{t("settings_heading")}</Tab>
                        </Tabs>

                        {!selectedTable.served && selectedTable.kind === "table" && (
                            <div className="px-4 pt-3 shrink-0">
                                <Alert color="warning" size="small">
                                    <div className="flex items-center justify-between gap-4">
                                        <span>{t("studio_tables_not_served", { reason: t(notServedReasonKey(selectedTable)) })}</span>
                                        <Button size="small" variant="outlined" onClick={() => void handleEnableAndExpose(selectedTable)}>
                                            <ShieldIcon size={iconSize.smallest}/>
                                            {t("studio_tables_enable_and_expose")}
                                        </Button>
                                    </div>
                                </Alert>
                            </div>
                        )}

                        {activeTab === "data" ? (
                            <DataTab key={selectedTable.key} table={selectedTable}/>
                        ) : (
                            <div className="flex-1 overflow-auto p-5">
                                {detailsLoading && !currentDetails && (
                                    <div className="flex items-center justify-center py-10"><CircularProgress size="small"/></div>
                                )}
                                {activeTab === "structure" && (
                                    <StructureTab table={selectedTable} tables={tables} details={currentDetails} onChanged={refresh}/>
                                )}
                                {activeTab === "policies" && (
                                    <PoliciesTab table={selectedTable} details={currentDetails} onChanged={refresh}/>
                                )}
                                {activeTab === "relations" && (
                                    <RelationsTab table={selectedTable} tables={tables} details={currentDetails}/>
                                )}
                                {activeTab === "stats" && (
                                    <StatsTab table={selectedTable} details={currentDetails} onChanged={refresh}/>
                                )}
                                {activeTab === "settings" && (
                                    <SettingsTab
                                        table={selectedTable}
                                        onChanged={refresh}
                                        onTableReplaced={(key) => {
                                            void loadTables().then(() => selectTable(key));
                                        }}
                                    />
                                )}
                            </div>
                        )}

                        <TableDdlSheet
                            open={ddlOpen}
                            onOpenChange={setDdlOpen}
                            title={selectedTable.key}
                            ddl={currentDetails?.ddl ?? null}
                            loading={detailsLoading}
                        />
                    </>
                )}
            </main>

            <CreateTableDialog
                open={createOpen}
                onOpenChange={setCreateOpen}
                schema={schema}
                onCreated={(name) => {
                    const key = `${schema}.${name}`;
                    void loadTables().then(list => {
                        reportServed(list, key, t("studio_tables_table_created", { name }));
                        selectTable(key);
                    });
                }}
            />
        </div>
    );
}
