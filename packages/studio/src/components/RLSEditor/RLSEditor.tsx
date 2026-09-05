
import { useStudioCollectionRegistry, useStudioCapabilities, useStudioSchemaEditing } from "@rebasepro/app";
import { useApiBase, useApiConfig } from "@rebasepro/app";
import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
    Alert,
    AlertTriangleIcon,
    Button,
    Chip,
    CircularProgress,
    cls,
    DatabaseIcon,
    defaultBorderMixin,
    IconButton,
    iconSize,
    KeyIcon,
    Link2Icon,
    LockIcon,
    Paper,
    RefreshCwIcon,
    ResizablePanels,
    ShieldIcon,
    Tab,
    Tabs,
    Tooltip,
    Trash2Icon,
    Typography
} from "@rebasepro/ui";
import { useRebaseContext, useSnackbarController, ErrorView, useTranslation, ConfirmationDialog } from "@rebasepro/app";
import { isPostgresCollectionConfig } from "@rebasepro/types";
import { REBASE_INTERNAL_SCHEMAS, REBASE_INTERNAL_PREFIXES, JUNCTION_TABLES_SQL } from "@rebasepro/common";
import { getPolicyNamesForRule, getPolicyNamesForRules, getPolicyOperations } from "@rebasepro/utils";
import { resolveJunctionSpecs, getJunctionSecurityRules, getEffectiveSecurityRules } from "@rebasepro/common";
import { PolicyEditor } from "./PolicyEditor";
import { saveRules, isCancellation } from "./saveRules";

type TableCategory = "collection" | "junction" | "internal" | "other";

function classifyTableClient(
    tableName: string,
    schemaName: string,
    junctionTableNames: Set<string>,
    isMappedToCollection: boolean
): TableCategory {
    if (
        REBASE_INTERNAL_SCHEMAS.includes(schemaName) ||
        REBASE_INTERNAL_PREFIXES.some((prefix) => tableName.startsWith(prefix))
    ) {
        return "internal";
    }
    if (isMappedToCollection) return "collection";
    if (junctionTableNames.has(tableName)) return "junction";
    return "other";
}

/**
 * Validates and double-quotes a SQL identifier to prevent injection.
 * Only allows safe Postgres identifiers (letters, digits, underscores).
 * Throws if the identifier contains unsafe characters.
 */
function sanitizeSqlIdentifier(name: string): string {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
        throw new Error(`Invalid SQL identifier: "${name}". Only letters, digits, and underscores are allowed.`);
    }
    return `"${name}"`;
}

// Re-exported for the components that used to import it from here.
export type { PostgresPolicy } from "@rebasepro/types";
import type { CollectionConfig, PostgresPolicy } from "@rebasepro/types";

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
                className="flex items-center p-1.5 cursor-pointer hover:bg-surface-100 dark:hover:bg-surface-900 rounded transition-colors"
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
                    ? "bg-primary/10 text-primary dark:bg-primary/20 dark:text-primary-light"
                    : "hover:bg-surface-100 dark:hover:bg-surface-900 text-text-secondary dark:text-text-secondary-dark",
                dimmed && !isSelected && "opacity-60"
            )}
        >
            <svg className="w-3.5 h-3.5 mr-1 shrink-0 text-text-disabled dark:text-text-disabled-dark" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
            <Typography variant="body2" className="text-xs truncate flex-1 min-w-0">{table.tableName}</Typography>
            <div className="flex items-center gap-1.5 shrink-0 ml-2">
                {badge && (
                    <span className="text-[9px] uppercase tracking-wider font-semibold text-text-disabled dark:text-text-disabled-dark bg-surface-200 dark:bg-surface-800 rounded px-1 py-px">
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
    const { databaseAdmin } = useRebaseContext();
    const snackbarController = useSnackbarController();
    const collectionRegistry = useStudioCollectionRegistry();
    const { codebase: hasCodebase } = useStudioCapabilities();
    const apiConfig = useApiConfig();
    /* `apiUrl` is a bare origin; the routes live under the backend's
       `basePath`, which is `/api` only by default. */
    const apiBase = useApiBase() ?? `${apiUrl.replace(/\/+$/, "")}/api`;

    const schemaEditing = useStudioSchemaEditing();

    /** Through the plan/apply dialog when there is one — see `saveRules`. */
    const saveSecurityRules = useCallback(
        (collectionId: string, securityRules: unknown[]) =>
            saveRules(
                schemaEditing,
                { apiBase, getAuthToken: apiConfig?.getAuthToken },
                collectionId,
                securityRules
            ),
        [apiBase, apiConfig, schemaEditing]);

    /** Closing the plan dialog is an answer, not a failure — see `saveRules`. */
    const reportSaveFailure = useCallback((e: unknown) => {
        if (isCancellation(e)) return;
        snackbarController.open({ type: "error",
            message: e instanceof Error ? e.message : String(e) });
    }, [snackbarController]);

    const [editingPolicy, setEditingPolicy] = useState<PostgresPolicy | "new" | null>(null);

    /**
     * The two destructive actions used `window.confirm`, which is the browser's
     * dialog and not this app's: it cannot be styled, cannot be translated, and
     * is suppressed outright in a sandboxed iframe — where the click then did
     * the thing silently, with no confirmation at all.
     */
    const [confirmToggleRls, setConfirmToggleRls] = useState<{ table: string; schema: string; enabled: boolean } | null>(null);
    const [confirmDropPolicy, setConfirmDropPolicy] = useState<{ policyName: string; table: string; schema: string } | null>(null);
    const [confirming, setConfirming] = useState(false);

    const applyToggleRls = useCallback(async () => {
        if (!confirmToggleRls) return;
        const { table, schema, enabled } = confirmToggleRls;
        const action = enabled ? "DISABLE" : "ENABLE";
        setConfirming(true);
        try {
            await databaseAdmin!.executeSql!(
                `ALTER TABLE ${sanitizeSqlIdentifier(schema)}.${sanitizeSqlIdentifier(table)} ${action} ROW LEVEL SECURITY`
            );
            snackbarController.open({ type: "success",
                message: `RLS ${action.toLowerCase()}d on ${table}` });
            setConfirmToggleRls(null);
            fetchRLSData();
        } catch (e: unknown) {
            snackbarController.open({ type: "error",
                message: e instanceof Error ? e.message : String(e) });
        } finally {
            setConfirming(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [confirmToggleRls, databaseAdmin, snackbarController]);

    const applyDropPolicy = useCallback(async () => {
        if (!confirmDropPolicy) return;
        const { policyName, table, schema } = confirmDropPolicy;
        setConfirming(true);
        try {
            await databaseAdmin!.executeSql!(
                `DROP POLICY ${sanitizeSqlIdentifier(policyName)} ON ${sanitizeSqlIdentifier(schema)}.${sanitizeSqlIdentifier(table)}`
            );
            snackbarController.open({ type: "success",
                message: `Policy "${policyName}" dropped` });
            setConfirmDropPolicy(null);
            fetchRLSData();
        } catch (e: unknown) {
            snackbarController.open({ type: "error",
                message: e instanceof Error ? e.message : String(e) });
        } finally {
            setConfirming(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [confirmDropPolicy, databaseAdmin, snackbarController]);

    const { t } = useTranslation();

    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [tables, setTables] = useState<TableRLSStatus[]>([]);
    const [selectedTable, setSelectedTable] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState(0);
    const [junctionTableNames, setJunctionTableNames] = useState<Set<string>>(new Set());

    /**
     * Native PostgreSQL roles, for the policy editor's `TO` list.
     *
     * `fetchAvailableRoles` and not `fetchApplicationRoles`: a policy's `TO`
     * clause names database roles, and an application role put there produces a
     * policy that either fails to create or matches nothing. The editor falls
     * back to a static pair when the driver cannot answer.
     */
    const [pgRoleOptions, setPgRoleOptions] = useState<string[]>([]);

    useEffect(() => {
        let mounted = true;
        if (!databaseAdmin?.fetchAvailableRoles) return;
        databaseAdmin.fetchAvailableRoles()
            .then((roles) => { if (mounted) setPgRoleOptions(roles); })
            .catch((e) => console.error("Failed to fetch database roles", e));
        return () => { mounted = false; };
    }, [databaseAdmin]);

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
                    // Postgres roles come back as an array string like "{public}" or literal array
                    let parsedRoles: string[] = [];
                    const r = p.roles || p.ROLES;
                    if (Array.isArray(r)) {
                        parsedRoles = r;
                    } else if (typeof r === "string") {
                        parsedRoles = r.replace(/^{|}$/g, "").split(",").map(s => s.trim());
                    }

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

            if (sortedTables.length > 0 && !selectedTable) {
                // Auto-select first public/collection table, skip internal
                const firstUserTable = sortedTables.find(t => !REBASE_INTERNAL_SCHEMAS.includes(t.schemaName));
                if (firstUserTable) {
                    setSelectedTable(`${firstUserTable.schemaName}.${firstUserTable.tableName}`);
                } else {
                    setSelectedTable(`${sortedTables[0].schemaName}.${sortedTables[0].tableName}`);
                }
            }

        } catch (e: unknown) {
            console.error("RLS fetch error:", e);
            setError("Failed to fetch RLS policies: " + (e instanceof Error ? e.message : String(e)));
        } finally {
            setIsLoading(false);
        }
    }, [databaseAdmin, selectedTable]);

    useEffect(() => {
        setEditingPolicy(null);
    }, [selectedTable]);

    useEffect(() => {
        fetchRLSData();
    }, [fetchRLSData]);

    const activeTableData = useMemo(() => {
        if (!selectedTable) return null;
        return tables.find(t => `${t.schemaName}.${t.tableName}` === selectedTable) || null;
    }, [selectedTable, tables]);

    /** Categorize tables into 4 buckets for the sidebar. */
    const categorizedTables = useMemo(() => {
        const groups: Record<TableCategory, TableRLSStatus[]> = {
            collection: [],
            junction: [],
            internal: [],
            other: []
        };

        tables.forEach(table => {
            const isMapped = !!collectionRegistry.collections?.find(
                (c: { id?: string, path?: string, table?: string, slug?: string, collectionId?: string }) =>
                    c.id === table.tableName ||
                    c.path === table.tableName ||
                    c.table === table.tableName ||
                    c.slug === table.tableName ||
                    c.collectionId === table.tableName
            );
            const cat = classifyTableClient(table.tableName, table.schemaName, junctionTableNames, isMapped);
            groups[cat].push(table);
        });

        return groups;
    }, [tables, junctionTableNames, collectionRegistry.collections]);

    const activeCollection = useMemo(() => {
        if (!activeTableData) return null;
        return collectionRegistry.collections?.find((c: { id?: string, path?: string, table?: string, slug?: string, collectionId?: string }) =>
            c.id === activeTableData.tableName ||
            c.path === activeTableData.tableName ||
            c.table === activeTableData.tableName ||
            c.slug === activeTableData.tableName ||
            c.collectionId === activeTableData.tableName
        ) || null;
    }, [activeTableData, collectionRegistry.collections]);

    /** The category of the currently selected table. */
    const activeTableCategory = useMemo((): TableCategory | null => {
        if (!activeTableData) return null;
        const isMapped = !!activeCollection;
        return classifyTableClient(activeTableData.tableName, activeTableData.schemaName, junctionTableNames, isMapped);
    }, [activeTableData, activeCollection, junctionTableNames]);

    const mergedPolicies = useMemo(() => {
        if (!activeTableData) return [];

        const policiesMap: Record<string, PostgresPolicy> = {};

        // Load live policies
        (activeTableData.policies || []).forEach(p => {
            policiesMap[p.policyname] = { ...p,
status: "live" };
        });

        // Merge code-based policies.
        //
        // A rule without an explicit `name` still produces policies — Postgres gets
        // `<table>_<op>_<hash>`, one per operation. Skipping those rules left their
        // live policies looking like hand-written SQL ("DB Only"), so derive the
        // names the generator would emit and match on those.
        //
        // `getEffectiveSecurityRules` rather than `securityRules`, for the same
        // reason one step further out: the generator also injects the
        // safe-by-default baseline (`<table>_default_admin_read` and the three
        // `_default_admin_write_*`), which appears in no collection's
        // `securityRules`. Reading the declared rules alone made four policies
        // *Rebase itself wrote* look like drift on every table in the project —
        // badged "DB Only" and offered for import back into the codebase that
        // produced them. The admin panel's own RLS tab already derived them this
        // way; this view, its sibling, did not. Both start from
        // `getEffectiveSecurityRules` now — this one needs the rule bodies to
        // render a policy row, the other only the names it compiles to
        // (`getGeneratedPolicyNames`).
        if (activeCollection && isPostgresCollectionConfig(activeCollection)) {
            getEffectiveSecurityRules(activeCollection as unknown as CollectionConfig).forEach((rule) => {
                const ops = getPolicyOperations(rule);
                const policyNames = getPolicyNamesForRule(rule, activeTableData.tableName);

                policyNames.forEach((policyName, opIdx) => {
                    policiesMap[policyName] = {
                        policyname: policyName,
                        tablename: activeTableData.tableName,
                        permissive: (rule.mode || "permissive").toUpperCase() as PostgresPolicy["permissive"],
                        cmd: (ops[opIdx] ?? rule.operation ?? "ALL").toUpperCase() as PostgresPolicy["cmd"],
                        // `pgRoles`, not `roles`. This is a policy's `TO` list —
                        // database roles — while `SecurityRule.roles` holds
                        // *application* roles, which the generator compiles into
                        // the USING clause via `rebase.roles()` and never puts in
                        // the `TO` list. Reading the wrong field made every rule
                        // scoped `roles: ["admin"]` render as `TO admin`, a
                        // policy the framework has never written.
                        roles: [...(rule.pgRoles ?? ["public"])],
                        qual: rule.using || null,
                        with_check: rule.withCheck || null,
                        // "both" = defined in code and live in Postgres (potentially edited)
                        status: policiesMap[policyName] ? "both" : "code_only"
                    };
                });
            });
        }

        // Junction tables have no collection, but their policies are generated
        // too — derived from the endpoints' relations. Recognise them so they
        // don't show as hand-written SQL ("DB Only"). If the registry's
        // collections don't carry resolvable relations, they simply stay "live".
        if (!activeCollection) {
            try {
                const registryCollections = (collectionRegistry.collections ?? []) as unknown as Parameters<typeof resolveJunctionSpecs>[0];
                const spec = resolveJunctionSpecs(registryCollections).get(activeTableData.tableName);
                if (spec) {
                    const generatedNames = getPolicyNamesForRules(getJunctionSecurityRules(spec), spec.table);
                    for (const p of Object.values(policiesMap)) {
                        if (generatedNames.has(p.policyname)) p.status = "both";
                    }
                }
            } catch {
                /* serialized configs without relation closures — leave as live */
            }
        }

        return Object.values(policiesMap).sort((a, b) => a.policyname.localeCompare(b.policyname));
    }, [activeTableData, activeCollection, collectionRegistry.collections]);

    // Stats for the info tab
    const rlsStats = useMemo(() => {
        const total = tables.length;
        const enabled = tables.filter(t => t.rlsEnabled).length;
        const withPolicies = tables.filter(t => t.policies.length > 0).length;
        const totalPolicies = tables.reduce((sum, t) => sum + t.policies.length, 0);
        return { total,
enabled,
withPolicies,
totalPolicies };
    }, [tables]);

    const renderPolicyTag = (label: string, value: string) => {
        return (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-surface-100 dark:bg-surface-950 border border-surface-200 dark:border-surface-700/50">
                <span className="text-[10px] uppercase text-text-secondary dark:text-text-secondary-dark font-medium tracking-wider">
                    {label}:
                </span>
                <span className="font-mono text-xs text-text-primary dark:text-text-primary-dark break-all">
                    {value}
                </span>
            </div>
        );
    };

    return (
        <div className="flex h-full w-full bg-white dark:bg-surface-950 overflow-hidden text-text-primary dark:text-text-primary-dark">
            <ResizablePanels
                orientation="horizontal"
                panelSizePercent={sidebarSize}
                onPanelSizeChange={setSidebarSize}
                minPanelSizePx={220}
                firstPanel={
                    <div className={cls("flex flex-col h-full w-full bg-white dark:bg-surface-950 border-r", defaultBorderMixin)}>
                        <Tabs value={sidebarTab} onValueChange={(v) => setSidebarTab(v as "tables" | "info")} variant="boxy" className="border-b border-surface-200 dark:border-surface-950">
                            <Tab value="tables">Tables</Tab>
                            <Tab value="info">Info</Tab>
                        </Tabs>

                        <div className="flex-grow overflow-hidden relative">
                            {sidebarTab === "tables" && (
                                <div className="flex flex-col h-full">
                                    <div className={cls("flex items-center justify-between px-3 py-2 border-b bg-surface-50 dark:bg-surface-900 min-h-[48px]", defaultBorderMixin)}>
                                        <Typography variant="caption" className="font-semibold uppercase tracking-wider text-text-disabled dark:text-text-disabled-dark">
                                            {t("studio_schema_tables")}
                                        </Typography>
                                        <IconButton size="small" onClick={fetchRLSData} title="Refresh">
                                            <RefreshCwIcon size={iconSize.smallest}/>
                                        </IconButton>
                                    </div>
                                    <div className="flex-grow overflow-y-auto no-scrollbar p-1">
                                        {isLoading && tables.length === 0 ? (
                                            <div className="flex justify-center p-4"><CircularProgress size="small"/></div>
                                        ) : tables.length === 0 ? (
                                            <div className="p-4 text-center">
                                                <Typography variant="caption" className="text-text-disabled dark:text-text-disabled-dark italic">{t("studio_rls_no_tables")}</Typography>
                                            </div>
                                        ) : (
                                            <>
                                            {/* ── Schema Collections ── */}
                                            {categorizedTables.collection.length > 0 && (
                                                <SidebarSection
                                                    title="Schema Collections"
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
                                                </SidebarSection>
                                            )}

                                            {/* ── Other Tables (unmapped + junction) ── */}
                                            {(categorizedTables.other.length > 0 || categorizedTables.junction.length > 0) && (
                                                <SidebarSection
                                                    title="Other Tables"
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
                                    <div className={cls("flex items-center justify-between px-3 py-2 border-b bg-surface-50 dark:bg-surface-900 min-h-[48px]", defaultBorderMixin)}>
                                        <Typography variant="caption" className="font-semibold uppercase tracking-wider text-text-disabled dark:text-text-disabled-dark">
                                            Overview
                                        </Typography>
                                    </div>
                                    <div className="flex-grow overflow-y-auto p-3 space-y-3 no-scrollbar">
                                        <div className={cls("p-3 rounded-lg border bg-white dark:bg-surface-900", defaultBorderMixin)}>
                                            <div className="flex items-center gap-2 mb-2">
                                                <ShieldIcon size={iconSize.smallest} className="text-primary"/>
                                                <Typography variant="body2" className="font-semibold text-[13px]">RLS Studio</Typography>
                                            </div>
                                            <Typography variant="caption" className="text-text-secondary dark:text-text-secondary-dark text-[11px] leading-relaxed block">
                                                Manage Row Level Security policies for your PostgreSQL tables. Enable RLS and create fine-grained access policies.
                                            </Typography>
                                        </div>

                                        <div className="space-y-2">
                                            <div className={cls("p-2.5 rounded border bg-white dark:bg-surface-900 flex items-center justify-between", defaultBorderMixin)}>
                                                <Typography variant="caption" className="text-text-secondary dark:text-text-secondary-dark text-[11px]">Total tables</Typography>
                                                <Typography variant="body2" className="font-mono text-[13px] font-medium">{rlsStats.total}</Typography>
                                            </div>
                                            <div className={cls("p-2.5 rounded border bg-white dark:bg-surface-900 flex items-center justify-between", defaultBorderMixin)}>
                                                <Typography variant="caption" className="text-text-secondary dark:text-text-secondary-dark text-[11px]">RLS enabled</Typography>
                                                <div className="flex items-center gap-1.5">
                                                    <div className="w-1.5 h-1.5 rounded-full bg-green-500"/>
                                                    <Typography variant="body2" className="font-mono text-[13px] font-medium">{rlsStats.enabled}</Typography>
                                                </div>
                                            </div>
                                            <div className={cls("p-2.5 rounded border bg-white dark:bg-surface-900 flex items-center justify-between", defaultBorderMixin)}>
                                                <Typography variant="caption" className="text-text-secondary dark:text-text-secondary-dark text-[11px]">Tables with policies</Typography>
                                                <Typography variant="body2" className="font-mono text-[13px] font-medium">{rlsStats.withPolicies}</Typography>
                                            </div>
                                            <div className={cls("p-2.5 rounded border bg-white dark:bg-surface-900 flex items-center justify-between", defaultBorderMixin)}>
                                                <Typography variant="caption" className="text-text-secondary dark:text-text-secondary-dark text-[11px]">Total policies</Typography>
                                                <Typography variant="body2" className="font-mono text-[13px] font-medium">{rlsStats.totalPolicies}</Typography>
                                            </div>
                                        </div>

                                        {/* Security health indicators */}
                                        {rlsStats.total - rlsStats.enabled > 0 && (
                                            <div className={cls("p-2.5 rounded border border-yellow-200 dark:border-yellow-900/50 bg-yellow-50 dark:bg-yellow-900/20 flex items-start gap-2", defaultBorderMixin)}>
                                                <AlertTriangleIcon size={14} className="text-yellow-600 dark:text-yellow-500 mt-0.5 shrink-0"/>
                                                <div>
                                                    <Typography variant="caption" className="text-yellow-800 dark:text-yellow-400 text-[11px] font-semibold block">
                                                        {rlsStats.total - rlsStats.enabled} table{rlsStats.total - rlsStats.enabled > 1 ? "s" : ""} without RLS
                                                    </Typography>
                                                    <Typography variant="caption" className="text-yellow-700 dark:text-yellow-600 text-[10px] block mt-0.5">
                                                        These tables have no row-level access control. If auth enforcement is disabled, data may be publicly accessible.
                                                    </Typography>
                                                </div>
                                            </div>
                                        )}

                                        {rlsStats.enabled > 0 && rlsStats.enabled - rlsStats.withPolicies > 0 && (
                                            <div className={cls("p-2.5 rounded border border-blue-200 dark:border-blue-900/50 bg-blue-50 dark:bg-blue-900/20 flex items-start gap-2", defaultBorderMixin)}>
                                                <ShieldIcon size={14} className="text-blue-600 dark:text-blue-400 mt-0.5 shrink-0"/>
                                                <div>
                                                    <Typography variant="caption" className="text-blue-800 dark:text-blue-300 text-[11px] font-semibold block">
                                                        {rlsStats.enabled - rlsStats.withPolicies} table{rlsStats.enabled - rlsStats.withPolicies > 1 ? "s" : ""} with RLS but no policies
                                                    </Typography>
                                                    <Typography variant="caption" className="text-blue-700 dark:text-blue-500 text-[10px] block mt-0.5">
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
                    <div className="flex-grow flex flex-col min-w-0 h-full w-full bg-white dark:bg-surface-950">
                        {/* Toolbar Header matching SQL/JS Editor style */}
                        <div className={cls("flex items-center justify-between pr-2 border-b bg-white dark:bg-surface-950 min-h-[46px]", defaultBorderMixin)}>
                            <div className="flex items-center flex-grow overflow-hidden px-4">
                                <Typography variant="subtitle2" className="font-mono text-text-secondary dark:text-text-secondary-dark truncate">
                                    {activeTableData ? `${activeTableData.schemaName}.${activeTableData.tableName}` : t("studio_rls_select_table")}
                                </Typography>
                                {activeTableData && (
                                    <div className="ml-3">
                                        {activeTableData.rlsEnabled ? (
                                            <Chip size="smallest" className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-800">{t("studio_rls_enabled")}</Chip>
                                        ) : (
                                            <Chip size="smallest" className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800">{t("studio_rls_disabled")}</Chip>
                                        )}
                                    </div>
                                )}
                            </div>
                            <div className="flex shrink-0 items-center justify-end gap-1.5">
                                {activeTableData && (
                                    <>
                                        <Button
                                            variant="text"
                                            size="small"
                                            onClick={() => setConfirmToggleRls({
                                                table: activeTableData.tableName,
                                                schema: activeTableData.schemaName,
                                                enabled: activeTableData.rlsEnabled
                                            })}
                                        >
                                            {activeTableData.rlsEnabled ? t("studio_rls_disable_rls") : t("studio_rls_enable_rls")}
                                        </Button>

                                        <div className="h-4 w-px bg-surface-200 dark:bg-surface-950 mx-1"/>

                                        <Button
                                            variant="text"
                                            size="small"
                                            onClick={fetchRLSData}
                                            startIcon={<RefreshCwIcon size={iconSize.smallest}/>}
                                        >
                                            Refresh
                                        </Button>

                                        <div className="h-4 w-px bg-surface-200 dark:bg-surface-950 mx-1"/>

                                        <Button
                                            size="small"
                                            color="primary"
                                            onClick={() => setEditingPolicy("new")}
                                        >
                                            {t("studio_rls_create_policy")}
                                        </Button>
                                    </>
                                )}
                            </div>
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
                                <div className="text-center">
                                    <svg className="w-12 h-12 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>
                                    <Typography variant="body2">{t("studio_rls_select_table")}</Typography>
                                </div>
                            </div>
                        ) : editingPolicy ? (
                            <PolicyEditor
                                policy={editingPolicy === "new" ? undefined : editingPolicy}
                                schema={activeTableData.schemaName}
                                table={activeTableData.tableName}
                                roleOptions={pgRoleOptions}
                                onSave={async (newPolicy) => {
                                    /*
                                     * Where a policy for a *mapped* table belongs depends
                                     * on the host, not on the table.
                                     *
                                     * Beside its own source, the collection file is the
                                     * right home: the rule is checked in, and the next
                                     * migration applies it. The hosted console has no
                                     * source — the container is rebuilt from the
                                     * customer's repository on every deploy — and the
                                     * schema-editor routes it would POST to are not even
                                     * mounted, because the framework switches them off
                                     * under NODE_ENV=production, which every tenant runs.
                                     * So this branch used to make "Create Policy" and
                                     * "Edit" fail with "Failed to save policy" on every
                                     * mapped table in the console, which is most of them.
                                     * There, the database is the only place a policy can
                                     * live, so write it there — the same path unmapped
                                     * tables have always used.
                                     */
                                    if (activeCollection && hasCodebase) {
                                        // Collection-mapped table: save via schema-editor API
                                        const rule: Record<string, unknown> = {
                                            name: newPolicy.policyname,
                                            operation: newPolicy.cmd?.toLowerCase(),
                                            mode: newPolicy.permissive?.toLowerCase(),
                                            using: newPolicy.qual || undefined,
                                            withCheck: newPolicy.with_check || undefined,
                                            // The editor edits a `PostgresPolicy`, whose
                                            // `roles` is the `TO` list — so it maps to
                                            // `pgRoles`. Writing it to `roles` filed
                                            // database roles as *application* roles, and
                                            // the generator then compiled them into a
                                            // `rebase.roles()` check no user could
                                            // satisfy: the rule saved cleanly, pushed
                                            // cleanly, and matched nothing.
                                            //
                                            // Omitted at the default so a rule that
                                            // targets `public` — nearly all of them —
                                            // does not carry an advanced field it does
                                            // not need.
                                            ...(newPolicy.roles && !(newPolicy.roles.length === 1 && newPolicy.roles[0] === "public")
                                                ? { pgRoles: newPolicy.roles }
                                                : {})
                                        };

                                        const existingRules = (isPostgresCollectionConfig(activeCollection) ? activeCollection.securityRules : undefined) || [];
                                        let newRules;
                                        if (editingPolicy === "new") {
                                            newRules = [...existingRules, rule];
                                        } else {
                                            newRules = existingRules.map((r: { name?: string }) => r.name === editingPolicy.policyname ? rule : r);
                                        }

                                        try {
                                            await saveSecurityRules(
                                                (activeCollection as { id?: string, path?: string, alias?: string }).id || (activeCollection as { id?: string, path?: string, alias?: string }).path || (activeCollection as { id?: string, path?: string, alias?: string }).alias || activeTableData.tableName,
                                                newRules
                                            );

                                            snackbarController.open({ type: "success",
message: "Policy saved successfully" });
                                            setEditingPolicy(null);
                                            fetchRLSData();
                                        } catch (e: unknown) {
                                            reportSaveFailure(e);
                                        }
                                    } else {
                                        // No codebase to write to (hosted console), or an
                                        // unmapped table (internal/junction/other): apply
                                        // the policy to the database directly.
                                        try {
                                            const qualifiedTable = `${sanitizeSqlIdentifier(activeTableData.schemaName)}.${sanitizeSqlIdentifier(activeTableData.tableName)}`;
                                            const policyName = sanitizeSqlIdentifier(newPolicy.policyname || "unnamed_policy");
                                            const cmd = newPolicy.cmd || "ALL";
                                            const permissive = (newPolicy.permissive || "PERMISSIVE") === "PERMISSIVE" ? "PERMISSIVE" : "RESTRICTIVE";
                                            const roles = newPolicy.roles && newPolicy.roles.length > 0
                                                ? newPolicy.roles.map(r => sanitizeSqlIdentifier(r)).join(", ")
                                                : "public";

                                            // Drop existing policy if editing
                                            if (editingPolicy !== "new") {
                                                await databaseAdmin!.executeSql!(`DROP POLICY IF EXISTS ${policyName} ON ${qualifiedTable}`);
                                            }

                                            let sql = `CREATE POLICY ${policyName} ON ${qualifiedTable}`;
                                            sql += ` AS ${permissive}`;
                                            sql += ` FOR ${cmd}`;
                                            sql += ` TO ${roles}`;
                                            if (newPolicy.qual) sql += ` USING (${newPolicy.qual})`;
                                            if (newPolicy.with_check) sql += ` WITH CHECK (${newPolicy.with_check})`;

                                            await databaseAdmin!.executeSql!(sql);

                                            snackbarController.open({ type: "success",
message: `Policy "${newPolicy.policyname}" applied to the database` });
                                            setEditingPolicy(null);
                                            fetchRLSData();
                                        } catch (e: unknown) {
                                            snackbarController.open({ type: "error",
message: e instanceof Error ? e.message : String(e) });
                                        }
                                    }
                                }}
                                onCancel={() => setEditingPolicy(null)}
                            />
                        ) : (
                            <div className="flex-grow flex flex-col overflow-hidden">
                                <div className="p-6 pt-4 flex-grow overflow-auto bg-surface-50 dark:bg-surface-900">
                                    <div className="max-w-4xl mx-auto flex flex-col gap-6">
                                    {/* Context-aware banner based on table category */}
                                    {activeTableData && activeTableCategory === "internal" && (
                                        <Alert color="info">
                                            <div className="flex items-start gap-2">
                                                <LockIcon size={16} className="shrink-0 mt-0.5"/>
                                                <div>
                                                    <Typography variant="body2" className="mb-1 font-semibold">
                                                        Rebase System Table
                                                    </Typography>
                                                    <Typography variant="caption" className="opacity-80">
                                                        This table is managed internally by Rebase. Its security policies are configured automatically.
                                                        Editing policies on system tables is an advanced operation.
                                                    </Typography>
                                                </div>
                                            </div>
                                        </Alert>
                                    )}
                                    {activeTableData && activeTableCategory === "junction" && (
                                        <Alert color="info">
                                            <div className="flex items-start gap-2">
                                                <Link2Icon size={16} className="shrink-0 mt-0.5"/>
                                                <div>
                                                    <Typography variant="body2" className="mb-1 font-semibold">
                                                        Junction Table
                                                    </Typography>
                                                    <Typography variant="caption" className="opacity-80">
                                                        This is an auto-generated junction table for a many-to-many relation.
                                                        Rebase derives its policies: rows are readable when both related rows
                                                        are, and writable following the declaring collection&apos;s update rules
                                                        (plus the server/admin baseline). You can still add RLS policies
                                                        directly to broaden access.
                                                    </Typography>
                                                </div>
                                            </div>
                                        </Alert>
                                    )}
                                    {activeTableData && activeTableCategory === "other" && (
                                        <Alert color="warning">
                                            <div className="flex items-start gap-2">
                                                <AlertTriangleIcon size={16} className="shrink-0 mt-0.5"/>
                                                <div>
                                                    <Typography variant="body2" className="mb-1 font-semibold">
                                                        Unmapped Table
                                                    </Typography>
                                                    <Typography variant="caption" className="opacity-80">
                                                        This table exists in the database but isn&apos;t mapped to a collection definition.
                                                        Import it into a Schema configuration file to manage security policies visually.
                                                    </Typography>
                                                </div>
                                            </div>
                                        </Alert>
                                    )}

                                    {activeTableData && !activeTableData.rlsEnabled && (
                                        <div className={cls("p-4 sm:p-5 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-900/50 rounded-lg flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between", defaultBorderMixin)}>
                                            <div className="flex gap-3 items-start">
                                                <div className="mt-1 bg-yellow-100 dark:bg-yellow-900/50 p-1.5 rounded-md shrink-0 flex items-center justify-center">
                                                    <AlertTriangleIcon size={iconSize.smallest}/>
                                                </div>
                                                <div>
                                                    <Typography variant="subtitle2" className="text-yellow-800 dark:text-yellow-500">
                                                        Row Level Security (RLS) is disabled
                                                    </Typography>
                                                    <Typography variant="body2" className="text-yellow-700 dark:text-yellow-600/90 mt-1 max-w-2xl">
                                                        Your table is completely readable and writable by anyone with access privileges. Enable RLS to create policies that restrict access to specific rows.
                                                    </Typography>
                                                </div>
                                            </div>
                                            <Button
                                                size="medium"
                                                variant="filled"
                                                color="neutral"
                                                onClick={() => setEditingPolicy("new")}
                                                className="shrink-0 whitespace-nowrap"
                                                disabled={!activeCollection}
                                            >
                                                {t("studio_rls_create_policy")}
                                            </Button>
                                        </div>
                                    )}

                                    {activeTableData && mergedPolicies && mergedPolicies.length > 0 && (
                                        <div className="flex flex-col gap-3">
                                            <Typography variant="subtitle2" className="text-text-secondary dark:text-text-secondary-dark uppercase tracking-wider mb-1">{t("studio_rls_policies")}</Typography>
                                            {mergedPolicies.map(policy => (
                                                <Paper key={policy.policyname} className={cls("p-3 sm:px-4 sm:py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border rounded-lg", defaultBorderMixin)}>
                                                    <div className="flex flex-col gap-2 min-w-0">
                                                        <div className="flex items-center gap-2">
                                                            <KeyIcon size={iconSize.smallest} className="text-text-secondary dark:text-text-secondary-dark shrink-0"/>
                                                            <Typography variant="body2" className="truncate">{policy.policyname}</Typography>
                                                            {policy.status === "code_only" && (
                                                                <Tooltip title={t("studio_rls_unapplied_tooltip")}>
                                                                    <div className="px-1.5 py-0.5 rounded text-[10px] uppercase bg-primary/10 text-primary border border-primary/20 shrink-0">
                                                                        {t("studio_rls_unapplied")}
                                                                    </div>
                                                                </Tooltip>
                                                            )}
                                                            {/* "DB Only" is a *drift* signal — it means the
                                                                codebase does not declare this policy. Where
                                                                there is no codebase to compare against, every
                                                                policy trivially qualifies, so the badge said
                                                                nothing and said it about everything. */}
                                                            {policy.status === "live" && hasCodebase && (
                                                                <Tooltip title="This policy is live in the database but missing from your codebase schema.">
                                                                    <div className="px-1.5 py-0.5 rounded text-[10px] uppercase bg-orange-500/10 text-orange-600 border border-orange-500/20 shrink-0">
                                                                        DB Only
                                                                    </div>
                                                                </Tooltip>
                                                            )}
                                                        </div>
                                                        <div className="flex flex-wrap gap-1.5 text-sm">
                                                            {renderPolicyTag("Action", policy.cmd)}
                                                            {renderPolicyTag("Roles", Array.isArray(policy.roles) ? policy.roles.join(", ") : policy.roles)}
                                                        </div>
                                                    </div>
                                                    <div className="flex gap-2 shrink-0 items-center">
                                                        {/* Writes a collection source file, so it needs a
                                                            codebase on the other end. In the console the
                                                            endpoint is not mounted and the button 404'd. */}
                                                        {policy.status === "live" && activeCollection && hasCodebase && (
                                                            <Button
                                                                size="small"
                                                                variant="outlined"
                                                                color="primary"
                                                                onClick={async () => {
                                                                    const rule: Record<string, unknown> = {
                                                                        name: policy.policyname,
                                                                        operation: policy.cmd?.toLowerCase(),
                                                                        mode: policy.permissive?.toLowerCase(),
                                                                        using: policy.qual || undefined,
                                                                        withCheck: policy.with_check || undefined,
                                                                        roles: policy.roles
                                                                    };

                                                                    const existingRules = (isPostgresCollectionConfig(activeCollection) ? activeCollection.securityRules : undefined) || [];
                                                                    const newRules = [...existingRules, rule];

                                                                    try {
                                                                        await saveSecurityRules(
                                                                            (activeCollection as { id?: string, path?: string, alias?: string }).id || (activeCollection as { id?: string, path?: string, alias?: string }).path || (activeCollection as { id?: string, path?: string, alias?: string }).alias || activeTableData!.tableName,
                                                                            newRules
                                                                        );

                                                                        snackbarController.open({ type: "success",
message: "Policy imported successfully" });
                                                                        fetchRLSData();
                                                                    } catch (e: unknown) {
                                                                        reportSaveFailure(e);
                                                                    }
                                                                }}
                                                            >
                                                                Import to codebase
                                                            </Button>
                                                        )}
                                                        <Button size="small" variant="text" color="primary" onClick={() => setEditingPolicy(policy)}>
                                                            {t("studio_rls_edit")}
                                                        </Button>
                                                        {policy.status !== "code_only" && (
                                                            <Tooltip title={t("studio_rls_delete")} asChild={true}>
                                                                <IconButton
                                                                    size="small"
                                                                    onClick={() => setConfirmDropPolicy({
                                                                        policyName: policy.policyname,
                                                                        table: activeTableData!.tableName,
                                                                        schema: activeTableData!.schemaName
                                                                    })}
                                                                >
                                                                    <Trash2Icon size={iconSize.smallest}/>
                                                                </IconButton>
                                                            </Tooltip>
                                                        )}
                                                    </div>
                                                </Paper>
                                            ))}
                                        </div>
                                    )}

                                    {activeTableData && mergedPolicies.length === 0 && activeTableData.rlsEnabled && (
                                        <div className="flex flex-col items-center justify-center py-12 text-center">
                                            <ShieldIcon size={40} className="text-surface-300 dark:text-surface-600 mb-4"/>
                                            <Typography variant="subtitle2" className="text-text-secondary dark:text-text-secondary-dark mb-2">
                                                No policies defined
                                            </Typography>
                                            <Typography variant="caption" className="text-text-disabled dark:text-text-disabled-dark max-w-sm mb-4">
                                                RLS is enabled on this table but no policies exist. All access is denied by default (Postgres deny-all). Create a policy to allow specific access.
                                            </Typography>
                                            <Button
                                                size="small"
                                                variant="filled"
                                                color="primary"
                                                onClick={() => setEditingPolicy("new")}
                                            >
                                                {t("studio_rls_create_policy")}
                                            </Button>
                                        </div>
                                    )}

                                    {activeTableData && mergedPolicies.length === 0 && !activeTableData.rlsEnabled && activeCollection && (
                                        <div className="flex flex-col items-center justify-center py-12 text-center">
                                            <AlertTriangleIcon size={40} className="text-yellow-400 dark:text-yellow-600 mb-4"/>
                                            <Typography variant="subtitle2" className="text-text-secondary dark:text-text-secondary-dark mb-2">
                                                No access control
                                            </Typography>
                                            <Typography variant="caption" className="text-text-disabled dark:text-text-disabled-dark max-w-sm">
                                                This table has neither RLS nor policies. Enable RLS and create policies to restrict row-level access.
                                            </Typography>
                                        </div>
                                    )}

                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                }
            />

            <ConfirmationDialog
                open={confirmToggleRls !== null}
                loading={confirming}
                onAccept={applyToggleRls}
                onCancel={() => setConfirmToggleRls(null)}
                title={confirmToggleRls?.enabled
                    ? t("studio_rls_disable_confirm_title")
                    : t("studio_rls_enable_confirm_title")}
                body={confirmToggleRls?.enabled
                    ? t("studio_rls_disable_confirm_body", { table: confirmToggleRls?.table ?? "" })
                    : t("studio_rls_enable_confirm_body", { table: confirmToggleRls?.table ?? "" })}
            />

            <ConfirmationDialog
                open={confirmDropPolicy !== null}
                loading={confirming}
                onAccept={applyDropPolicy}
                onCancel={() => setConfirmDropPolicy(null)}
                title={t("studio_rls_drop_policy_title")}
                body={t("studio_rls_drop_policy_body", {
                    policy: confirmDropPolicy?.policyName ?? "",
                    table: confirmDropPolicy?.table ?? ""
                })}
            />
        </div>
    );
};
