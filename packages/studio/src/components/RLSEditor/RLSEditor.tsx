import { useTableDescriptors } from "@rebasepro/app";
import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useSearchParams } from "react-router";
import {
    AlertTriangleIcon,
    Chip,
    CircularProgress,
    cls,
    DatabaseIcon,
    defaultBorderMixin,
    IconButton,
    iconSize,
    LockIcon,
    RefreshCwIcon,
    ResizablePanels,
    ShieldIcon,
    Tab,
    Tabs,
    Tooltip,
    Typography
} from "@rebasepro/ui";
import { useRebaseContext, ErrorView, useTranslation } from "@rebasepro/app";
import { REBASE_INTERNAL_SCHEMAS, JUNCTION_TABLES_SQL } from "@rebasepro/common";
import { readPolicyRoles } from "./policyListing";
import { DirectRlsPoliciesPanel } from "./DirectRlsPoliciesPanel";
import { classifyTableClient, mapsTable, servedJunctionsOf, TablePolicies, type TableCategory } from "./TablePolicies";

/** The query parameter that names the selected table, `schema.table`, so another view can link straight to it. */
export const RLS_TABLE_PARAM = "table";

// Re-exported for the components that used to import it from here.
export type { PostgresPolicy } from "@rebasepro/types";
import type { PostgresPolicy } from "@rebasepro/types";

interface TableRLSStatus {
    schemaName: string;
    tableName: string;
    rlsEnabled: boolean;
    policies: PostgresPolicy[];
}

// ─── Sidebar helper components ──────────────────────────────────────

function SidebarSection({ title, icon, expanded, onToggle, count, children }: {
    title: string;
    icon: React.ReactNode;
    expanded: boolean;
    onToggle: () => void;
    count?: number;
    children: React.ReactNode;
}) {
    return (
        <div className="mb-2">
            <div
                className="flex items-center p-1.5 cursor-pointer hover:bg-surface-hover rounded transition-colors"
                onClick={onToggle}
            >
                <svg className={cls("w-3 h-3 mr-1.5 transition-transform text-text-disabled dark:text-text-disabled-dark", expanded ? "rotate-90" : "")} fill="currentColor" viewBox="0 0 20 20"><path d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"/></svg>
                {icon}
                <Typography variant="body2" className="text-text-primary dark:text-text-primary-dark font-medium text-xs truncate flex-grow ml-1.5">{title}</Typography>
                {count !== undefined && (
                    <span className="text-[10px] text-text-disabled dark:text-text-disabled-dark font-medium tabular-nums mr-1">{count}</span>
                )}
            </div>
            {expanded && (
                <div className="ml-3 mt-0.5 space-y-0.5">
                    {children}
                </div>
            )}
        </div>
    );
}

function SidebarTableRow({ table, isSelected, onSelect, badge, dimmed, t }: {
    table: TableRLSStatus;
    isSelected: boolean;
    onSelect: () => void;
    badge?: string;
    dimmed?: boolean;
    t: (key: string) => string;
}) {
    return (
        <div
            onClick={onSelect}
            className={cls(
                "flex items-center p-1 cursor-pointer rounded transition-colors group relative",
                isSelected
                    ? "bg-surface-active text-text-primary dark:text-text-primary-dark font-medium"
                    : "hover:bg-surface-hover text-text-secondary dark:text-text-secondary-dark",
                dimmed && !isSelected && "opacity-60"
            )}
        >
            <svg className="w-3.5 h-3.5 mr-1 shrink-0 text-text-disabled dark:text-text-disabled-dark" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
            <Typography variant="body2" className="text-xs truncate flex-1 min-w-0">{table.tableName}</Typography>
            <div className="flex items-center gap-1.5 shrink-0 ml-2">
                {badge && (
                    <span className="text-[9px] uppercase tracking-wider font-semibold text-text-disabled dark:text-text-disabled-dark bg-surface-raised rounded px-1 py-px">
                        {badge}
                    </span>
                )}
                {table.rlsEnabled ? (
                    <Tooltip title={t("studio_rls_enabled")}>
                        <div className="w-1.5 h-1.5 rounded-full bg-green-500"/>
                    </Tooltip>
                ) : (
                    <Tooltip title={t("studio_rls_disabled")}>
                        <div className="w-1.5 h-1.5 rounded-full bg-orange-400 opacity-50"/>
                    </Tooltip>
                )}
                <span className="text-[10px] opacity-40 group-hover:opacity-100 min-w-[1.2rem] text-right font-medium">
                    {table.policies.length}
                </span>
            </div>
        </div>
    );
}

export const RLSEditor = ({ apiUrl = "" }: { apiUrl?: string }) => {
    const [mode, setMode] = useState<"inspector" | "direct">("inspector");
    const { t } = useTranslation();

    return (
        <div className="flex flex-col h-full w-full overflow-hidden">
            <Tabs
                value={mode}
                onValueChange={(v) => { if (v === "inspector" || v === "direct") setMode(v); }}
                variant="boxy"
                className="border-b border-hairline px-4 bg-surface-sheet shrink-0"
            >
                <Tab value="inspector">{t("studio_rls_tab_inspector")}</Tab>
                <Tab value="direct">{t("studio_rls_tab_direct")}</Tab>
            </Tabs>
            <div className="flex-1 min-h-0 overflow-hidden">
                {mode === "direct" ? <DirectRlsPoliciesPanel /> : <RLSEditorInspector apiUrl={apiUrl} />}
            </div>
        </div>
    );
};

const RLSEditorInspector = ({ apiUrl: _apiUrl = "" }: { apiUrl?: string }) => {
    const { databaseAdmin } = useRebaseContext();
    const descriptors = useTableDescriptors();
    const declaredTables = descriptors.tables;
    const { t } = useTranslation();

    const [searchParams, setSearchParams] = useSearchParams();
    const linkedTable = searchParams.get(RLS_TABLE_PARAM);

    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [tables, setTables] = useState<TableRLSStatus[]>([]);
    // The selection is the link itself, so another view can open a table here
    // and a selection made here can be shared. Only this view's own parameter
    // is touched: the hosted console keeps its own in the same query string.
    const selectedTable = linkedTable;
    const setSelectedTable = useCallback((next: string | null | ((previous: string | null) => string | null)) => {
        setSearchParams(prev => {
            const current = prev.get(RLS_TABLE_PARAM);
            const value = typeof next === "function" ? next(current) : next;
            if (value === current) return prev;
            const params = new URLSearchParams(prev);
            if (value) params.set(RLS_TABLE_PARAM, value); else params.delete(RLS_TABLE_PARAM);
            return params;
        }, { replace: true });
    }, [setSearchParams]);
    const [junctionTableNames, setJunctionTableNames] = useState<Set<string>>(new Set());
    // Read by the catalogue fetch through a ref: react-router hands out a new
    // `setSearchParams` whenever the query changes, and the fetch must not run
    // again because a table was picked.
    const setSelectedTableRef = useRef(setSelectedTable);
    setSelectedTableRef.current = setSelectedTable;

    const [sidebarSize, setSidebarSize] = useState(() => {
        try {
            const saved = localStorage.getItem("rebase_rls_editor_sidebar_size");
            return saved !== null ? parseFloat(saved) : 20;
        } catch (e) {
            return 20;
        }
    });

    const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
        collection: true,
        other: true,
        internal: false
    });

    // Sidebar tab: "tables" or "info"
    const [sidebarTab, setSidebarTab] = useState<"tables" | "info">("tables");

    useEffect(() => {
        try {
            localStorage.setItem("rebase_rls_editor_sidebar_size", sidebarSize.toString());
        } catch (e) { /* ignore */ }
    }, [sidebarSize]);

    const fetchRLSData = useCallback(async () => {
        if (!databaseAdmin?.executeSql) {
            setError(t("studio_sql_sql_not_supported"));
            setIsLoading(false);
            return;
        }

        setIsLoading(true);
        setError(null);
        try {
            // 1. Fetch tables and whether RLS is enabled
            const tablesSql = `
                SELECT 
                    schemaname, 
                    tablename, 
                    rowsecurity 
                FROM pg_tables 
                WHERE schemaname NOT IN ('information_schema', 'pg_catalog')
                ORDER BY schemaname, tablename;
            `;
            const tablesResult = await databaseAdmin!.executeSql!(tablesSql);

            // 2. Fetch all policies
            const policiesSql = `
                SELECT 
                    schemaname,
                    tablename,
                    policyname,
                    permissive,
                    roles,
                    cmd,
                    qual,
                    with_check
                FROM pg_policies
                WHERE schemaname NOT IN ('information_schema', 'pg_catalog');
            `;
            const policiesResult = await databaseAdmin!.executeSql!(policiesSql);

            const extractRows = (result: unknown): Record<string, unknown>[] => {
                if (result && typeof result === "object" && "rows" in result && Array.isArray((result as { rows: Record<string, unknown>[] }).rows)) {
                    return (result as { rows: Record<string, unknown>[] }).rows;
                }
                if (Array.isArray(result)) return result as Record<string, unknown>[];
                return [];
            };

            const tRows = extractRows(tablesResult);
            const pRows = extractRows(policiesResult);

            const tableMap: Record<string, TableRLSStatus> = {};

            tRows.forEach((tRow: Record<string, unknown>) => {
                const t = tRow as { schemaname?: string, SCHEMANAME?: string, tablename?: string, TABLENAME?: string, rowsecurity?: boolean, ROWSECURITY?: boolean };
                const schema = t.schemaname || t.SCHEMANAME || "public";
                const table = t.tablename || t.TABLENAME || "";
                const rlsEnabled = t.rowsecurity || t.ROWSECURITY || false;

                const key = `${schema}.${table}`;
                tableMap[key] = {
                    schemaName: schema,
                    tableName: table,
                    rlsEnabled: rlsEnabled,
                    policies: []
                };
            });

            pRows.forEach((pRow: Record<string, unknown>) => {
                const p = pRow as { schemaname?: string, SCHEMANAME?: string, tablename?: string, TABLENAME?: string, roles?: string | string[], ROLES?: string | string[], policyname?: string, POLICYNAME?: string, permissive?: "PERMISSIVE" | "RESTRICTIVE", PERMISSIVE?: "PERMISSIVE" | "RESTRICTIVE", cmd?: "SELECT" | "INSERT" | "UPDATE" | "DELETE" | "ALL", CMD?: "SELECT" | "INSERT" | "UPDATE" | "DELETE" | "ALL", qual?: string | null, QUAL?: string | null, with_check?: string | null, WITH_CHECK?: string | null };
                const schema = p.schemaname || p.SCHEMANAME || "public";
                const table = p.tablename || p.TABLENAME || "";
                const key = `${schema}.${table}`;

                if (tableMap[key]) {
                    const parsedRoles = readPolicyRoles(p.roles || p.ROLES);

                    tableMap[key].policies.push({
                        policyname: p.policyname || p.POLICYNAME || "",
                        tablename: table,
                        permissive: p.permissive || p.PERMISSIVE || "PERMISSIVE",
                        roles: parsedRoles,
                        cmd: p.cmd || p.CMD || "ALL",
                        qual: p.qual || p.QUAL || null,
                        with_check: p.with_check || p.WITH_CHECK || null
                    });
                }
            });

            const sortedTables = Object.values(tableMap).sort((a, b) => a.tableName.localeCompare(b.tableName));
            setTables(sortedTables);

            // Detect junction tables (where all columns are FKs)
            try {
                const junctionResult = await databaseAdmin!.executeSql!(JUNCTION_TABLES_SQL);
                const jRows = extractRows(junctionResult);
                setJunctionTableNames(new Set(
                    jRows.map((r: Record<string, unknown>) => r.table_name as string).filter(Boolean)
                ));
            } catch {
                // Junction detection is best-effort
            }

            if (sortedTables.length > 0) {
                // Auto-select first public/collection table, skip internal —
                // when nothing is selected yet. Read through the updater, not
                // a dependency: depending on the selection made picking a
                // table re-read the whole catalogue, and the first load (which
                // picks one) run twice.
                const firstUserTable = sortedTables.find(t => !REBASE_INTERNAL_SCHEMAS.includes(t.schemaName)) ?? sortedTables[0];
                setSelectedTableRef.current(previous => previous ?? `${firstUserTable.schemaName}.${firstUserTable.tableName}`);
            }

        } catch (e: unknown) {
            console.error("RLS fetch error:", e);
            setError("Failed to fetch RLS policies: " + (e instanceof Error ? e.message : String(e)));
        } finally {
            setIsLoading(false);
        }
    }, [databaseAdmin, t]);

    useEffect(() => {
        fetchRLSData();
    }, [fetchRLSData]);

    const activeTableData = useMemo(() => {
        if (!selectedTable) return null;
        return tables.find(t => `${t.schemaName}.${t.tableName}` === selectedTable) || null;
    }, [selectedTable, tables]);

    const servedJunctions = useMemo(() => servedJunctionsOf(declaredTables), [declaredTables]);

    /** Categorize tables into 4 buckets for the sidebar. */
    const categorizedTables = useMemo(() => {
        const groups: Record<TableCategory, TableRLSStatus[]> = {
            collection: [],
            junction: [],
            internal: [],
            other: []
        };
        tables.forEach(table => {
            const isMapped = declaredTables.some(descriptor => mapsTable(descriptor, table));
            const isJunction = junctionTableNames.has(table.tableName) || servedJunctions.has(`${table.schemaName}.${table.tableName}`);
            groups[classifyTableClient(table.tableName, table.schemaName, isJunction, isMapped)].push(table);
        });
        return groups;
    }, [tables, junctionTableNames, servedJunctions, declaredTables]);

    // Stats for the info tab
    const rlsStats = useMemo(() => {
        const total = tables.length;
        const enabled = tables.filter(t => t.rlsEnabled).length;
        const withPolicies = tables.filter(t => t.policies.length > 0).length;
        const totalPolicies = tables.reduce((sum, t) => sum + t.policies.length, 0);
        return { total, enabled, withPolicies, totalPolicies };
    }, [tables]);

    return (
        <div className="flex h-full w-full bg-surface-card overflow-hidden text-text-primary dark:text-text-primary-dark">
            <ResizablePanels
                dividerAriaLabel={t("resize_sidebar")}
                orientation="horizontal"
                panelSizePercent={sidebarSize}
                onPanelSizeChange={setSidebarSize}
                minPanelSizePx={220}
                firstPanel={
                    <div className={cls("flex flex-col h-full w-full bg-surface-card border-r", defaultBorderMixin)}>
                        <div className={cls("flex items-center justify-between pl-2 pr-2 border-b bg-surface-sheet shrink-0", defaultBorderMixin)}>
                            <Tabs value={sidebarTab} onValueChange={(v) => setSidebarTab(v as "tables" | "info")} variant="boxy" className="w-[unset] flex-shrink-0">
                                <Tab value="tables">Tables</Tab>
                                <Tab value="info">Info</Tab>
                            </Tabs>
                            <IconButton aria-label={t("refresh")} size="small" onClick={fetchRLSData} title={t("refresh")}>
                                <RefreshCwIcon size={iconSize.smallest}/>
                            </IconButton>
                        </div>

                        <div className="flex-grow overflow-hidden relative">
                            {sidebarTab === "tables" && (
                                <div className="flex flex-col h-full">
                                    <div className="flex-grow overflow-y-auto no-scrollbar p-1">
                                        {isLoading && tables.length === 0 ? (
                                            <div className="flex justify-center p-4"><CircularProgress size="small"/></div>
                                        ) : tables.length === 0 ? (
                                            <div className="p-4 text-center">
                                                <Typography variant="caption" className="text-text-disabled dark:text-text-disabled-dark italic">{t("studio_rls_no_tables")}</Typography>
                                            </div>
                                        ) : (
                                            <>
                                            {/* ── Served tables: what the API serves, and the junction
                                                tables its relations read through. Declared or read
                                                from the database, the server's answer is the same. ── */}
                                            {(categorizedTables.collection.length > 0 || categorizedTables.junction.length > 0) && (
                                                <SidebarSection
                                                    title={t("studio_rls_served_tables")}
                                                    icon={<DatabaseIcon size={12} className="text-primary dark:text-primary-light"/>}
                                                    expanded={expandedSections.collection ?? true}
                                                    onToggle={() => setExpandedSections(prev => ({ ...prev, collection: !(prev.collection ?? true) }))}
                                                >
                                                    {categorizedTables.collection.map(table => (
                                                        <SidebarTableRow
                                                            key={`${table.schemaName}.${table.tableName}`}
                                                            table={table}
                                                            isSelected={selectedTable === `${table.schemaName}.${table.tableName}`}
                                                            onSelect={() => setSelectedTable(`${table.schemaName}.${table.tableName}`)}
                                                            t={t}
                                                        />
                                                    ))}
                                                    {categorizedTables.junction.map(table => (
                                                        <SidebarTableRow
                                                            key={`${table.schemaName}.${table.tableName}`}
                                                            table={table}
                                                            isSelected={selectedTable === `${table.schemaName}.${table.tableName}`}
                                                            onSelect={() => setSelectedTable(`${table.schemaName}.${table.tableName}`)}
                                                            badge="Junction"
                                                            dimmed
                                                            t={t}
                                                        />
                                                    ))}
                                                </SidebarSection>
                                            )}

                                            {/* ── Not served: in the database, but the API does not serve
                                                them (no row-level security, or not declared). The one
                                                section that warrants the warning. ── */}
                                            {categorizedTables.other.length > 0 && (
                                                <SidebarSection
                                                    title="Not served"
                                                    icon={<AlertTriangleIcon size={12} className="text-yellow-500 dark:text-yellow-400"/>}
                                                    expanded={expandedSections.other ?? true}
                                                    onToggle={() => setExpandedSections(prev => ({ ...prev, other: !(prev.other ?? true) }))}
                                                >
                                                    {categorizedTables.other.map(table => (
                                                        <SidebarTableRow
                                                            key={`${table.schemaName}.${table.tableName}`}
                                                            table={table}
                                                            isSelected={selectedTable === `${table.schemaName}.${table.tableName}`}
                                                            onSelect={() => setSelectedTable(`${table.schemaName}.${table.tableName}`)}
                                                            t={t}
                                                        />
                                                    ))}
                                                </SidebarSection>
                                            )}

                                            {/* ── Rebase Internal ── */}
                                            {categorizedTables.internal.length > 0 && (
                                                <SidebarSection
                                                    title="Rebase Internal"
                                                    icon={<LockIcon size={12} className="text-text-disabled dark:text-text-disabled-dark"/>}
                                                    expanded={expandedSections.internal ?? false}
                                                    onToggle={() => setExpandedSections(prev => ({ ...prev, internal: !(prev.internal ?? false) }))}
                                                    count={categorizedTables.internal.length}
                                                >
                                                    {categorizedTables.internal.map(table => (
                                                        <SidebarTableRow
                                                            key={`${table.schemaName}.${table.tableName}`}
                                                            table={table}
                                                            isSelected={selectedTable === `${table.schemaName}.${table.tableName}`}
                                                            onSelect={() => setSelectedTable(`${table.schemaName}.${table.tableName}`)}
                                                            dimmed
                                                            t={t}
                                                        />
                                                    ))}
                                                </SidebarSection>
                                            )}
                                            </>
                                        )}
                                    </div>
                                </div>
                            )}

                            {sidebarTab === "info" && (
                                <div className="flex flex-col h-full">
                                    <div className="flex-grow overflow-y-auto p-3 space-y-3 no-scrollbar">
                                        <div className={cls("p-3 rounded-lg border bg-surface-card", defaultBorderMixin)}>
                                            <div className="flex items-center gap-2 mb-2">
                                                <ShieldIcon size={iconSize.smallest} className="text-primary"/>
                                                <Typography variant="body2" className="font-semibold text-[13px]">RLS Studio</Typography>
                                            </div>
                                            <Typography variant="caption" className="text-text-secondary dark:text-text-secondary-dark text-xs leading-relaxed block">
                                                Manage Row Level Security policies for your PostgreSQL tables. Enable RLS and create fine-grained access policies.
                                            </Typography>
                                        </div>

                                        <div className="space-y-2">
                                            <div className={cls("p-2.5 rounded border bg-surface-card flex items-center justify-between", defaultBorderMixin)}>
                                                <Typography variant="caption" className="text-text-secondary dark:text-text-secondary-dark text-xs">Total tables</Typography>
                                                <Typography variant="body2" className="font-mono text-[13px] font-medium">{rlsStats.total}</Typography>
                                            </div>
                                            <div className={cls("p-2.5 rounded border bg-surface-card flex items-center justify-between", defaultBorderMixin)}>
                                                <Typography variant="caption" className="text-text-secondary dark:text-text-secondary-dark text-xs">{t("studio_rls_enabled")}</Typography>
                                                <div className="flex items-center gap-1.5">
                                                    <div className="w-1.5 h-1.5 rounded-full bg-green-500"/>
                                                    <Typography variant="body2" className="font-mono text-[13px] font-medium">{rlsStats.enabled}</Typography>
                                                </div>
                                            </div>
                                            <div className={cls("p-2.5 rounded border bg-surface-card flex items-center justify-between", defaultBorderMixin)}>
                                                <Typography variant="caption" className="text-text-secondary dark:text-text-secondary-dark text-xs">Tables with policies</Typography>
                                                <Typography variant="body2" className="font-mono text-[13px] font-medium">{rlsStats.withPolicies}</Typography>
                                            </div>
                                            <div className={cls("p-2.5 rounded border bg-surface-card flex items-center justify-between", defaultBorderMixin)}>
                                                <Typography variant="caption" className="text-text-secondary dark:text-text-secondary-dark text-xs">Total policies</Typography>
                                                <Typography variant="body2" className="font-mono text-[13px] font-medium">{rlsStats.totalPolicies}</Typography>
                                            </div>
                                        </div>

                                        {/* Security health indicators */}
                                        {rlsStats.total - rlsStats.enabled > 0 && (
                                            <div className={cls("p-2.5 rounded border border-yellow-200 dark:border-yellow-900/50 bg-yellow-50 dark:bg-yellow-900/20 flex items-start gap-2", defaultBorderMixin)}>
                                                <AlertTriangleIcon size={14} className="text-yellow-600 dark:text-yellow-500 mt-0.5 shrink-0"/>
                                                <div>
                                                    <Typography variant="caption" className="text-yellow-800 dark:text-yellow-400 text-xs font-semibold block">
                                                        {rlsStats.total - rlsStats.enabled} table{rlsStats.total - rlsStats.enabled > 1 ? "s" : ""} without RLS
                                                    </Typography>
                                                    <Typography variant="caption" className="text-yellow-700 dark:text-yellow-600 text-xs block mt-0.5">
                                                        These tables have no row-level access control. If auth enforcement is disabled, data may be publicly accessible.
                                                    </Typography>
                                                </div>
                                            </div>
                                        )}

                                        {rlsStats.enabled > 0 && rlsStats.enabled - rlsStats.withPolicies > 0 && (
                                            <div className={cls("p-2.5 rounded border border-blue-200 dark:border-blue-900/50 bg-blue-50 dark:bg-blue-900/20 flex items-start gap-2", defaultBorderMixin)}>
                                                <ShieldIcon size={14} className="text-blue-600 dark:text-blue-400 mt-0.5 shrink-0"/>
                                                <div>
                                                    <Typography variant="caption" className="text-blue-800 dark:text-blue-300 text-xs font-semibold block">
                                                        {rlsStats.enabled - rlsStats.withPolicies} table{rlsStats.enabled - rlsStats.withPolicies > 1 ? "s" : ""} with RLS but no policies
                                                    </Typography>
                                                    <Typography variant="caption" className="text-blue-700 dark:text-blue-500 text-xs block mt-0.5">
                                                        RLS is enabled but no permissive policies exist. All access is denied by default (Postgres deny-all).
                                                    </Typography>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                }
                secondPanel={
                    <div className="flex-grow flex flex-col min-w-0 h-full w-full bg-surface-card">
                        <div className={cls("flex items-center justify-between pr-2 border-b bg-surface-sheet h-[42px] shrink-0", defaultBorderMixin)}>
                            <div className="flex items-center flex-grow overflow-hidden px-4 gap-3">
                                <Typography variant="subtitle2" className="font-mono text-text-secondary dark:text-text-secondary-dark truncate">
                                    {activeTableData ? `${activeTableData.schemaName}.${activeTableData.tableName}` : t("studio_rls_select_table")}
                                </Typography>
                                {activeTableData && (
                                    <Chip size="smallest" colorScheme={activeTableData.rlsEnabled ? "greenLight" : "orangeLight"}>
                                        {activeTableData.rlsEnabled ? t("studio_rls_enabled") : t("studio_rls_disabled")}
                                    </Chip>
                                )}
                            </div>
                            <IconButton aria-label={t("refresh")} size="small" onClick={fetchRLSData}>
                                <RefreshCwIcon size={iconSize.smallest}/>
                            </IconButton>
                        </div>

                        {isLoading && !activeTableData ? (
                            <div className="flex-grow flex items-center justify-center h-full">
                                <CircularProgress size="small"/>
                            </div>
                        ) : error ? (
                            <div className="p-6 h-full flex items-center justify-center">
                                <ErrorView title={t("studio_rls_error")} error={error} onRetry={fetchRLSData}/>
                            </div>
                        ) : !activeTableData ? (
                            <div className="flex-grow flex items-center justify-center text-text-disabled h-full">
                                <Typography variant="body2">{t("studio_rls_select_table")}</Typography>
                            </div>
                        ) : (
                            <div className="p-6 pt-4 flex-grow overflow-auto bg-surface-sheet">
                                <div className="max-w-4xl mx-auto">
                                    <TablePolicies
                                        key={`${activeTableData.schemaName}.${activeTableData.tableName}`}
                                        schemaName={activeTableData.schemaName}
                                        tableName={activeTableData.tableName}
                                        rlsEnabled={activeTableData.rlsEnabled}
                                        policies={activeTableData.policies}
                                        isJunction={junctionTableNames.has(activeTableData.tableName)}
                                        onChanged={fetchRLSData}
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                }
            />
        </div>
    );
};
