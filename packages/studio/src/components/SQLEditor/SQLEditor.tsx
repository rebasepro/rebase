
import { IconForView } from "@rebasepro/app";
import { useStudioCollectionRegistry, useStudioSidePanelController } from "@rebasepro/app";
import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import {
    Alert,
    Button,
    Checkbox,
    Chip,
    CircularProgress,
    cls,
    DatabaseIcon,
    defaultBorderMixin,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    IconButton,
    iconSize,
    InputLabel,
    Menu,
    MenuIcon,
    MenuItem,
    MoreVerticalIcon,
    Paper,
    PencilIcon,
    PlayIcon,
    PlusIcon,
    ResizablePanels,
    Select,
    SelectItem,
    Tab,
    Tabs,
    TerminalIcon,
    TextareaAutosize,
    TextField,
    Tooltip,
    Typography,
    VirtualTable,
    VirtualTableColumn,
    XIcon
} from "@rebasepro/ui";

import { useRebaseContext, useSnackbarController, ConfirmationDialog, ErrorView, useTranslation } from "@rebasepro/app";
import { isArrayValue, isRecordValue, readStoredJson, readStoredString, writeStoredJson, writeStoredString } from "@rebasepro/utils";
import { MonacoEditor } from "./MonacoEditor";
import { SQLEditorSidebar, Snippet } from "./SQLEditorSidebar";
import { parseFirst } from "pgsql-ast-parser";
import { determineTableAndPK, resolveQueryCollections, ResolvedQueryCollection } from "../../utils/sql_utils";
import { ExplainVisualizer } from "./ExplainVisualizer";

import type { SQLEditorColumnInfo, TableInfo } from "./sql_editor_types";

export type { SQLEditorColumnInfo, TableInfo };

const QueryLoadingView = () => {
    const [elapsed, setElapsed] = useState(0);

    useEffect(() => {
        const start = Date.now();
        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        let cancelled = false;

        const tick = () => {
            if (cancelled) return;
            if (document.visibilityState === "visible") {
                setElapsed(Date.now() - start);
            }
            timeoutId = setTimeout(tick, 100);
        };

        tick();

        const handleVisibility = () => {
            if (document.visibilityState === "visible") {
                setElapsed(Date.now() - start);
            }
        };
        document.addEventListener("visibilitychange", handleVisibility);

        return () => {
            cancelled = true;
            if (timeoutId) clearTimeout(timeoutId);
            document.removeEventListener("visibilitychange", handleVisibility);
        };
    }, []);

    return (
        <div className="flex-grow flex items-center justify-center">
            <div className="text-center">
                <CircularProgress size="medium"/>
                <Typography variant="body2" className="mt-4 text-text-secondary dark:text-text-secondary-dark font-mono tracking-tight animate-pulse">
                    EXECUTING QUERY...
                </Typography>
                <div className="mt-2 text-xs font-mono text-text-disabled dark:text-text-disabled-dark">
                    {(elapsed / 1000).toFixed(1)}s elapsed
                </div>
            </div>
        </div>
    );
};

const STORAGE_KEY_TABS = "rebase_sql_tabs";
const STORAGE_KEY_ACTIVE_TAB = "rebase_sql_active_tab";

const FixedEditorOverlay = ({
    displayValue,
    onSave,
    onCancel
}: {
    displayValue: string,
    onSave: (val: string | null) => void,
    onCancel: () => void
}) => {
    const [rect, setRect] = useState<DOMRect | null>(null);
    const [windowSize, setWindowSize] = useState({ width: 1000,
height: 1000 });
    const anchorRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (anchorRef.current && anchorRef.current.parentElement) {
            setRect(anchorRef.current.parentElement.getBoundingClientRect());
        }
        if (typeof window !== "undefined") {
            setWindowSize({ width: window.innerWidth,
height: window.innerHeight });
            const handleResize = () => setWindowSize({ width: window.innerWidth,
height: window.innerHeight });
            window.addEventListener("resize", handleResize);
            return () => window.removeEventListener("resize", handleResize);
        }
        return undefined;
    }, []);

    if (!rect) {
        return <div ref={anchorRef} className="w-full h-full min-h-[20px]" />;
    }

    let top = rect.top - 2;
    let left = rect.left - 2;
    const minWidth = Math.max(rect.width + 4, 250);
    const minHeight = rect.height + 4;

    if (left + minWidth > windowSize.width) {
        left = Math.max(10, windowSize.width - minWidth - 10);
    }

    // Calculate a max height that doesn't overflow the bottom
    const maxAvailableHeight = Math.max(50, windowSize.height - top - 10);
    const resolvedMaxHeight = Math.min(300, maxAvailableHeight);

    // If even the min height overflows, adjust top
    if (top + minHeight > windowSize.height) {
        top = Math.max(10, windowSize.height - minHeight - 10);
    }

    return (
        <div ref={anchorRef} className="w-full h-full min-h-[20px]">
            {createPortal(
                <div
                    className="fixed z-[9999] bg-surface-50 dark:bg-surface-900 border-2 border-primary dark:border-primary-dark shadow-xl flex flex-col"
                    style={{
                        top,
                        left,
                        minWidth,
                        minHeight,
                        maxWidth: Math.min(400, windowSize.width - left - 10)
                    }}
                >
                    <TextareaAutosize
                        className="w-full h-full bg-transparent outline-none border-none ring-0 font-mono text-[13px] text-text-primary dark:text-text-primary-dark px-4 py-1.5 resize-none overflow-y-auto"
                        defaultValue={displayValue}
                        autoFocus
                        style={{ minHeight: "32px",
maxHeight: resolvedMaxHeight }}
                        onFocus={(e) => {
                            const val = e.target.value;
                            e.target.value = "";
                            e.target.value = val;
                        }}
                        onBlur={(e) => {
                            onSave(e.target.value || null);
                            onCancel();
                        }}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                onSave((e.currentTarget as HTMLTextAreaElement).value || null);
                                onCancel();
                            }
                            if (e.key === "Escape") onCancel();
                        }}
                    />
                </div>,
                document.body
            )}
        </div>
    );
};

const getStoragePrefix = (baseUrl?: string) => {
    if (!baseUrl) return "default";
    return baseUrl.replace(/^https?:\/\//, "").replace(/[^a-zA-Z0-9]/g, "_");
};

/** The part of a tab that is persisted; the rest is per-session. */
type StoredTab = {
    id: string;
    name: string;
    sql: string;
    database?: string;
    role?: string;
};

/**
 * Whether a stored entry is a tab this release can restore. Storage holds
 * whatever the last version to run wrote, so the fields are checked rather
 * than assumed.
 */
function isStoredTab(value: unknown): value is StoredTab {
    if (typeof value !== "object" || value === null) return false;
    const tab = value as Record<string, unknown>;
    return typeof tab.id === "string"
        && typeof tab.name === "string"
        && typeof tab.sql === "string";
}

export const SQLEditor = () => {
    const { databaseAdmin, client } = useRebaseContext();
    const sidePanelController = useStudioSidePanelController();
    const snackbarController = useSnackbarController();
    const collectionRegistry = useStudioCollectionRegistry();

    const { t } = useTranslation();

    const projectPrefix = useMemo(() => getStoragePrefix(client?.baseUrl), [client?.baseUrl]);

    // Schema state
    const [schemas, setSchemas] = useState<Record<string, TableInfo[]>>({});
    const [isSchemaLoading, setIsSchemaLoading] = useState(true);
    const schemaFetchedRef = useRef(false);
    const [schemaError, setSchemaError] = useState<string | null>(null);

    // Connection state
    const [selectedDatabase, setSelectedDatabase] = useState<string | undefined>(() => {
        const projectPrefixSync = client?.baseUrl ? client.baseUrl.replace(/^https?:\/\//, "").replace(/[^a-zA-Z0-9]/g, "_") : "default";
        return readStoredString(`rebase_sql_selected_db_${projectPrefixSync}`) || undefined;
    });
    const [selectedRole, setSelectedRole] = useState<string | undefined>(() => {
        const projectPrefixSync = client?.baseUrl ? client.baseUrl.replace(/^https?:\/\//, "").replace(/[^a-zA-Z0-9]/g, "_") : "default";
        return readStoredString(`rebase_sql_selected_role_${projectPrefixSync}`) || undefined;
    });

    const [availableDatabases, setAvailableDatabases] = useState<string[]>([]);
    const [availableRoles, setAvailableRoles] = useState<string[]>([]);
    const [isLoadingConfig, setIsLoadingConfig] = useState(true);
    const [connectionConfigError, setConnectionConfigError] = useState<string | null>(null);

    // Tabbed interface state
    const [tabs, setTabs] = useState<Array<{
        id: string,
        name: string,
        sql: string,
        database?: string,
        role?: string,
        results: Record<string, unknown>[] | null,
        loading: boolean,
        error: string | null,
        execTime: number | null,
        lastExecutedSql: string | null
    }>>(() => {
        const projectPrefixSync = getStoragePrefix(client?.baseUrl);
        // This runs during the first render, so anything it throws takes the
        // whole editor down — and the value that threw is still in storage on
        // reload. `readStoredJson` turns unreadable and wrong-shaped state into
        // the default set of tabs instead, and `isStoredTab` drops the
        // individual entries an older release wrote differently: a tab with no
        // `id` never matches the active tab and cannot be closed.
        const saved = readStoredJson<unknown[]>(
            `rebase_sql_tabs_${projectPrefixSync}`,
            { fallback: [], accept: isArrayValue }
        );
        const restored = saved.filter(isStoredTab).map(t => ({
            ...t,
            results: null,
            loading: false,
            error: null,
            execTime: null,
            lastExecutedSql: null
        }));
        if (restored.length > 0) return restored;
        return [{
            id: "1",
            name: "Query 1",
            sql: "SELECT * FROM ",
            database: readStoredString(`rebase_sql_selected_db_${projectPrefixSync}`) || undefined,
            role: readStoredString(`rebase_sql_selected_role_${projectPrefixSync}`) || undefined,
            results: null,
            loading: false,
            error: null,
            execTime: null,
            lastExecutedSql: null
        }];
    });
    const [activeTabId, setActiveTabId] = useState<string>(() => {
        const projectPrefixSync = client?.baseUrl ? client.baseUrl.replace(/^https?:\/\//, "").replace(/[^a-zA-Z0-9]/g, "_") : "default";
        return readStoredString(`rebase_sql_active_tab_${projectPrefixSync}`) || "1";
    });

    const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0];

    // Helper to update active tab state
    const updateActiveTab = useCallback((update: Partial<typeof activeTab>) => {
        setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t,
...update } : t));
    }, [activeTabId]);

    const sql = activeTab.sql;
    const results = activeTab.results;
    const loading = activeTab.loading;
    const error = activeTab.error;
    const execTime = activeTab.execTime;

    const setSql = (newSql: string) => updateActiveTab({ sql: newSql });
    const setResults = (newResults: Record<string, unknown>[] | null) => updateActiveTab({ results: newResults });
    const setLoading = (newLoading: boolean) => updateActiveTab({ loading: newLoading });
    const setError = (newError: string | null) => updateActiveTab({ error: newError });

    useEffect(() => {
        let mounted = true;
        const fetchConnectionConfig = async () => {
            if (!databaseAdmin?.fetchAvailableDatabases || !databaseAdmin?.fetchAvailableRoles || !databaseAdmin?.executeSql) {
                setConnectionConfigError(t("studio_sql_sql_not_supported"));
                setIsLoadingConfig(false);
                return;
            }

            try {
                const [dbs, roles, currentDbFromApi, currentUserResult] = await Promise.all([
                    databaseAdmin.fetchAvailableDatabases(),
                    databaseAdmin.fetchAvailableRoles(),
                    typeof databaseAdmin?.fetchCurrentDatabase === "function" ? databaseAdmin.fetchCurrentDatabase() : Promise.resolve(undefined),
                    databaseAdmin.executeSql("SELECT current_user AS role").catch(() => [])
                ]);

                if (mounted) {
                    setAvailableDatabases(dbs);
                    setAvailableRoles(roles);

                    const loadedDb = readStoredString(`rebase_sql_selected_db_${projectPrefix}`) || undefined;
                    const loadedRole = readStoredString(`rebase_sql_selected_role_${projectPrefix}`) || undefined;

                    const initialActiveTabId = readStoredString(`rebase_sql_active_tab_${projectPrefix}`) || "1";
                    // The old guard caught a parse failure but not a parse
                    // *success* of the wrong shape, and the `.find` below sat
                    // outside it — so an object where an array was expected
                    // still threw.
                    const initialTabs = readStoredJson<Array<{ id?: string; database?: string; role?: string }>>(
                        `rebase_sql_tabs_${projectPrefix}`,
                        { fallback: [], accept: isArrayValue }
                    );
                    const currentActiveTab = initialTabs.find(t => t.id === initialActiveTabId);

                    let actualDb = currentActiveTab?.database || loadedDb;
                    if (actualDb && !dbs.includes(actualDb)) actualDb = undefined;
                    if (!actualDb && dbs.length > 0) {
                        actualDb = currentDbFromApi && dbs.includes(currentDbFromApi) ? currentDbFromApi : dbs[0];
                    }

                    if (actualDb) {
                        setSelectedDatabase(actualDb);
                        writeStoredString(`rebase_sql_selected_db_${projectPrefix}`, actualDb);
                        setTabs(prev => prev.map(t => t.id === initialActiveTabId && (!t.database || !dbs.includes(t.database)) ? { ...t,
database: actualDb } : t));
                    }

                    const currentUser = (currentUserResult?.[0] as Record<string, unknown> | undefined)?.role as string | undefined;
                    let actualRole = currentActiveTab?.role || loadedRole;

                    if (actualRole && !roles.includes(actualRole)) actualRole = undefined;
                    if (!actualRole && roles.length > 0) {
                        if (currentUser && roles.includes(currentUser)) {
                            actualRole = currentUser;
                        } else {
                            actualRole = roles.includes("postgres") ? "postgres" : roles[0];
                        }
                    }

                    if (actualRole) {
                        setSelectedRole(actualRole);
                        writeStoredString(`rebase_sql_selected_role_${projectPrefix}`, actualRole);
                        setTabs(prev => prev.map(t => t.id === initialActiveTabId && (!t.role || !roles.includes(t.role)) ? { ...t,
role: actualRole } : t));
                    }
                }
            } catch (err: unknown) {
                console.error("Failed to fetch databases or roles:", err);
                if (mounted) {
                    const message = err instanceof Error ? err.message : String(err);
                    setConnectionConfigError(t("studio_sql_fetch_error", { message }));
                }
            } finally {
                if (mounted) {
                    setIsLoadingConfig(false);
                }
            }
        };

        fetchConnectionConfig();

        return () => { mounted = false; };
    }, [databaseAdmin, projectPrefix]);

    const handleDatabaseChange = (db: string, tabId?: string) => {
        setSelectedDatabase(db);
        writeStoredString(`rebase_sql_selected_db_${projectPrefix}`, db);
        setTabs(prev => prev.map(t => t.id === (tabId || activeTabId) ? { ...t,
database: db } : t));
        // Reset so the schema will be re-fetched for the new database
        schemaFetchedRef.current = false;
    };

    const handleRoleChange = (role: string, tabId?: string) => {
        setSelectedRole(role);
        writeStoredString(`rebase_sql_selected_role_${projectPrefix}`, role);
        setTabs(prev => prev.map(t => t.id === (tabId || activeTabId) ? { ...t,
role } : t));
    };

    const handleTabChange = useCallback((newTabId: string) => {
        setActiveTabId(newTabId);
        const newTab = tabs.find(t => t.id === newTabId);
        if (newTab) {
            if (newTab.database && newTab.database !== selectedDatabase) {
                setSelectedDatabase(newTab.database);
                writeStoredString(`rebase_sql_selected_db_${projectPrefix}`, newTab.database);
                schemaFetchedRef.current = false;
            } else if (!newTab.database && selectedDatabase) {
                setTabs(prev => prev.map(t => t.id === newTabId ? { ...t,
database: selectedDatabase } : t));
            }

            if (newTab.role && newTab.role !== selectedRole) {
                setSelectedRole(newTab.role);
                writeStoredString(`rebase_sql_selected_role_${projectPrefix}`, newTab.role);
            } else if (!newTab.role && selectedRole) {
                setTabs(prev => prev.map(t => t.id === newTabId ? { ...t,
role: selectedRole } : t));
            }
        }
    }, [tabs, selectedDatabase, selectedRole, projectPrefix]);

    const fetchSchema = useCallback(async () => {
        if (!databaseAdmin?.executeSql) {
            setSchemaError(t("studio_sql_sql_not_supported"));
            setIsSchemaLoading(false);
            return;
        }

        setIsSchemaLoading(true);
        setSchemaError(null);
        try {
            const sql = `
                SELECT 
                    c.table_schema as schema, 
                    c.table_name as "table", 
                    c.column_name as "column",
                    c.data_type as "data_type",
                    CASE WHEN kcu.column_name IS NOT NULL THEN true ELSE false END as "is_pk"
                FROM 
                    information_schema.columns c
                LEFT JOIN information_schema.table_constraints tc
                    ON tc.table_schema = c.table_schema 
                    AND tc.table_name = c.table_name 
                    AND tc.constraint_type = 'PRIMARY KEY'
                LEFT JOIN information_schema.key_column_usage kcu
                    ON kcu.constraint_name = tc.constraint_name
                    AND kcu.table_schema = tc.table_schema
                    AND kcu.table_name = tc.table_name
                    AND kcu.column_name = c.column_name
                WHERE 
                    c.table_schema NOT IN ('information_schema', 'pg_catalog')
                ORDER BY 
                    c.table_schema, c.table_name, c.ordinal_position;
            `;
            // Pass the selected database so schema introspection targets the right DB.
            const result = await databaseAdmin!.executeSql!(sql, { database: selectedDatabase });

            const processGrouped = (data: Record<string, unknown>[]) => {
                const grouped = data.reduce((acc: Record<string, TableInfo[]>, curr: Record<string, unknown>) => {
                    const schema = (curr.schema || curr.SCHEMA || curr.table_schema || "public") as string;
                    const table = (curr.table || curr.TABLE || curr.table_name) as string;
                    const column = (curr.column || curr.COLUMN || curr.column_name) as string;
                    const dataType = (curr.data_type || curr.DATA_TYPE || "") as string;
                    const isPrimaryKey = curr.is_pk === true || curr.is_pk === "true";

                    if (!acc[schema]) acc[schema] = [];
                    let tableInfo = acc[schema].find(t => t.tableName === table);
                    if (!tableInfo) {
                        tableInfo = { schemaName: schema,
tableName: table,
columns: [] };
                        acc[schema].push(tableInfo);
                    }
                    tableInfo.columns.push({ name: column,
dataType,
isPrimaryKey });
                    return acc;
                }, {});
                setSchemas(grouped);
            };

            if (!result || !Array.isArray(result)) {
                if (result && typeof result === "object" && "rows" in result && Array.isArray((result as { rows: Record<string, unknown>[] }).rows)) {
                    processGrouped((result as { rows: Record<string, unknown>[] }).rows);
                } else {
                    setSchemaError(t("studio_sql_unexpected_format", { type: typeof result }));
                    setSchemas({});
                }
            } else if (result.length === 0) {
                setSchemas({});
                setSchemaError(t("studio_sql_no_tables"));
            } else {
                processGrouped(result);
            }

            schemaFetchedRef.current = true;
        } catch (e: unknown) {
            console.error("Schema fetch error:", e);
            const message = e instanceof Error ? e.message : String(e);
            setSchemaError(t("studio_sql_schema_fetch_error", { message }));
        } finally {
            setIsSchemaLoading(false);
        }
    }, [databaseAdmin, selectedDatabase]);

    useEffect(() => {
        // Fetch schema after config finishes loading, and re-fetch when the selected database changes.
        if (!isLoadingConfig && !schemaFetchedRef.current) {
            fetchSchema();
        }
    }, [fetchSchema, isLoadingConfig, selectedDatabase]);

    const [autoLimit, setAutoLimit] = useState(true);
    const [isConfirmDialogOpen, setIsConfirmDialogOpen] = useState(false);
    const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

    // Inline editing state
    const [editingCell, setEditingCell] = useState<{ rowIndex: number, columnKey: string, initialValue: unknown } | null>(null);

    const handleDoubleClick = useCallback((rowIndex: number, columnKey: string, initialValue: unknown, rowData: Record<string, unknown>) => {
        if (!activeTab.lastExecutedSql) {
            snackbarController.open({
                type: "error",
                message: t("studio_sql_cannot_edit_missing_query")
            });
            return;
        }

        const resolution = determineTableAndPK(activeTab.lastExecutedSql, columnKey, schemas);

        if (resolution.error || !resolution.primaryKeys || resolution.primaryKeys.length === 0) {
            snackbarController.open({
                type: "error",
                message: resolution.error || t("studio_sql_cannot_resolve_table")
            });
            return;
        }

        // Check all PK values are present in the row
        const missingPKs = resolution.primaryKeys.filter(
            pk => rowData[pk.resultColumn] === undefined || rowData[pk.resultColumn] === null
        );
        if (missingPKs.length > 0) {
            snackbarController.open({
                type: "error",
                message: t("studio_sql_missing_pk", { columns: missingPKs.map(pk => `"${pk.resultColumn}"`).join(", ") })
            });
            return;
        }

        setEditingCell({ rowIndex,
columnKey,
initialValue });
    }, [activeTab.lastExecutedSql, schemas, snackbarController]);

    const handleCellSave = useCallback(async (newValue: string | null, rowData: Record<string, unknown>, columnKey: string, rowIndex: number) => {
        if (!editingCell || !activeTab.lastExecutedSql) return;

        setEditingCell(null); // Optimistically close

        if (newValue === editingCell.initialValue) return;

        const resolution = determineTableAndPK(activeTab.lastExecutedSql, columnKey, schemas);
        if (resolution.error || !resolution.tableName || !resolution.primaryKeys || resolution.primaryKeys.length === 0) {
            snackbarController.open({ type: "error",
message: resolution.error || "Resolution failed." });
            return;
        }

        const tableName = resolution.tableName;

        const formatValue = (val: unknown) => {
            if (val === null || val === undefined) return "NULL";
            if (typeof val === "number") return val;
            if (typeof val === "boolean") return val ? "TRUE" : "FALSE";
            return `'${String(val).replace(/'/g, "''")}'`;
        };

        // Resolve the actual DB column name for the edited column (may differ from the result alias)
        // e.g. if the query has `a.name AS author_name`, columnKey = "author_name" but DB column = "name"
        const resolveDbColumnName = (resultColKey: string): string => {
            try {
                const ast = parseFirst(activeTab.lastExecutedSql!);
                if (ast.type === "select" && ast.columns) {
                    for (const col of ast.columns) {
                        if (col.expr?.type === "ref") {
                            const alias = col.alias?.name;
                            const colName = col.expr.name;
                            if (alias === resultColKey || (!alias && colName === resultColKey)) {
                                return colName;
                            }
                        }
                    }
                }
            } catch { /* fall back to columnKey */ }
            return resultColKey;
        };

        const dbColumnName = resolveDbColumnName(columnKey);

        // Build composite WHERE clause
        const whereConditions = resolution.primaryKeys.map(
            pk => `"${pk.dbColumn}" = ${formatValue(rowData[pk.resultColumn])}`
        ).join(" AND ");

        const updateSql = `UPDATE "${tableName}" SET "${dbColumnName}" = ${formatValue(newValue)} WHERE ${whereConditions};`;

        try {
            if (databaseAdmin?.executeSql) {
                await databaseAdmin.executeSql(updateSql, { database: selectedDatabase,
role: selectedRole });

                const newResults = [...(activeTab.results || [])];
                if (newResults[rowIndex]) {
                    newResults[rowIndex] = { ...newResults[rowIndex],
[columnKey]: newValue };
                }
                updateActiveTab({ results: newResults });

                snackbarController.open({
                    type: "success",
                    message: t("studio_sql_row_updated")
                });
            }
        } catch (e: unknown) {
            snackbarController.open({
                type: "error",
                message: t("studio_sql_update_failed", { message: e instanceof Error ? e.message : String(e) })
            });
        }
    }, [editingCell, schemas, activeTab.lastExecutedSql, activeTab.results, databaseAdmin, updateActiveTab, snackbarController, selectedDatabase, selectedRole]);

    const [columnWidths, setColumnWidths] = useState<Record<string, Record<string, number>>>(() => {
        const projectPrefixSync = client?.baseUrl ? client.baseUrl.replace(/^https?:\/\//, "").replace(/[^a-zA-Z0-9]/g, "_") : "default";
        return readStoredJson<Record<string, Record<string, number>>>(
            `rebase_sql_column_widths_${projectPrefixSync}`,
            { fallback: {}, accept: isRecordValue }
        );
    });
    const [snippets, setSnippets] = useState<Snippet[]>([]);
    const [history, setHistory] = useState<string[]>([]);
    const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);
    const [newSnippetName, setNewSnippetName] = useState("");

    // Load from local storage
    useEffect(() => {
        setSnippets(readStoredJson<Snippet[]>(
            `rebase_sql_snippets_${projectPrefix}`,
            { fallback: [], accept: isArrayValue }
        ));
        setHistory(readStoredJson<string[]>(
            `rebase_sql_history_${projectPrefix}`,
            { fallback: [], accept: isArrayValue }
        ));
    }, [projectPrefix]);

    // Save tabs and active tab to local storage. Tab text is persisted on every
    // edit, so this is the write that reaches the origin's quota first — and a
    // `QuotaExceededError` thrown out of an effect is not something the view
    // can do anything with.
    useEffect(() => {
        const sanitizedTabs = tabs.map(t => ({
            id: t.id,
            name: t.name,
            sql: t.sql,
            database: t.database,
            role: t.role
        }));
        writeStoredJson(`rebase_sql_tabs_${projectPrefix}`, sanitizedTabs);
    }, [tabs, projectPrefix]);

    useEffect(() => {
        writeStoredString(`rebase_sql_active_tab_${projectPrefix}`, activeTabId);
    }, [activeTabId, projectPrefix]);

    const saveSnippets = (newSnippets: Snippet[]) => {
        setSnippets(newSnippets);
        writeStoredJson(`rebase_sql_snippets_${projectPrefix}`, newSnippets);
    };

    const saveHistory = (newHistory: string[]) => {
        setHistory(newHistory);
        writeStoredJson(`rebase_sql_history_${projectPrefix}`, newHistory.slice(-50));
    };

    const handleDeleteSnippet = (id: string) => {
        saveSnippets(snippets.filter(s => s.id !== id));
    };

    const handleAddTab = () => {
        const newId = Math.random().toString(36).substring(2, 9);

        // Find the next available query number
        let maxNumber = 0;
        tabs.forEach(tab => {
            const match = tab.name.match(/^Query (\d+)$/);
            if (match) {
                const num = parseInt(match[1], 10);
                if (num > maxNumber) maxNumber = num;
            }
        });
        const name = `Query ${maxNumber + 1}`;
        setTabs(prev => [...prev, {
            id: newId,
            name,
            sql: "SELECT * FROM ",
            database: selectedDatabase,
            role: selectedRole,
            results: null,
            loading: false,
            error: null,
            execTime: null,
            lastExecutedSql: null
        }]);
        setActiveTabId(newId);
    };

    const handleCloseTab = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (tabs.length === 1) return;

        const tabIndex = tabs.findIndex(t => t.id === id);
        const newTabs = tabs.filter(t => t.id !== id);
        setTabs(newTabs);

        if (activeTabId === id) {
            // Find a new active tab: the one at the same index, or the last one if we closed the last
            const nextIndex = Math.min(tabIndex, newTabs.length - 1);
            if (newTabs[nextIndex]) {
                setActiveTabId(newTabs[nextIndex].id);
            }
        }
    };

    const handleColumnResize = useCallback(({ key, width }: { key: string, width: number }) => {
        setColumnWidths(prev => {
            const newWidths = {
                ...prev,
                [activeTab.sql]: {
                    ...(prev[activeTab.sql] || {}),
                    [key]: width
                }
            };
            writeStoredJson(`rebase_sql_column_widths_${projectPrefix}`, newWidths);
            return newWidths;
        });
    }, [activeTab.sql, projectPrefix]);

    const handlePrettify = () => {
        // Simple formatting for now
        const formatted = activeTab.sql
            .replace(/\s+/g, " ")
            .replace(/\s?,\s?/g, ", ")
            .replace(/\s?=\s?/g, " = ")
            .trim();
        setSql(formatted);
    };

    const handleExplain = async () => {
        const explainSql = `EXPLAIN (FORMAT JSON, ANALYZE) ${activeTab.sql}`;
        updateActiveTab({ loading: true,
error: null,
results: null });
        const start = performance.now();
        try {
            if (databaseAdmin?.executeSql) {
                const result = await databaseAdmin.executeSql(explainSql, { database: selectedDatabase,
role: selectedRole });
                updateActiveTab({ results: result,
execTime: Math.round(performance.now() - start) });
            }
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            updateActiveTab({ error: message || t("studio_sql_error_explaining") });
        } finally {
            updateActiveTab({ loading: false });
        }
    };

    const executeRun = useCallback(async (sqlOverride?: string) => {
        let sqlToRun = sqlOverride || activeTab.sql;
        const upperSql = sqlToRun.toUpperCase();

        const isAggregate = /\b(COUNT|SUM|AVG|MIN|MAX)\s*\(/i.test(sqlToRun);
        const isExplain = /\bEXPLAIN\b/i.test(sqlToRun);

        if (autoLimit && upperSql.includes("SELECT") && !upperSql.includes("LIMIT") && !isAggregate && !isExplain) {
            // Remove trailing semicolon if present to safely append LIMIT
            sqlToRun = sqlToRun.trim().replace(/;$/, "");
            sqlToRun = `${sqlToRun} LIMIT 1000;`;
        }

        updateActiveTab({ loading: true,
error: null,
results: null });
        const start = performance.now();

        try {
            if (databaseAdmin?.executeSql) {
                const result = await databaseAdmin.executeSql(sqlToRun, { database: selectedDatabase,
role: selectedRole });
                updateActiveTab({
                    results: result,
                    execTime: Math.round(performance.now() - start),
                    lastExecutedSql: sqlToRun
                });

                if (history[history.length - 1] !== activeTab.sql) {
                    saveHistory([...history, activeTab.sql]);
                }
            } else {
                updateActiveTab({ error: t("studio_sql_execution_not_supported") });
            }
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            updateActiveTab({ error: message || t("studio_sql_error_executing") });
        } finally {
            updateActiveTab({ loading: false });
        }
    }, [activeTab.sql, autoLimit, databaseAdmin, history, updateActiveTab, selectedDatabase, selectedRole]);

    const handleRun = useCallback(async (selectedText?: string) => {
        const sqlTarget = selectedText || activeTab.sql;
        if (!sqlTarget.trim()) return;

        // Destructive operation check
        const destructiveKeywords = ["DELETE", "DROP", "TRUNCATE", "UPDATE"];
        const hasDestructive = destructiveKeywords.some(kw => sqlTarget.toUpperCase().includes(kw));
        const hasWhere = sqlTarget.toUpperCase().includes("WHERE");

        if (hasDestructive && (!hasWhere || sqlTarget.toUpperCase().includes("DROP") || sqlTarget.toUpperCase().includes("TRUNCATE"))) {
            setPendingAction(() => () => executeRun(selectedText));
            setIsConfirmDialogOpen(true);
            return;
        }

        executeRun(selectedText);
    }, [activeTab.sql, executeRun]);

    // Global keybindings
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                // If we are in an input or textarea (except the code editor which handles its own), we might not want to run
                const activeElement = document.activeElement;
                const isInput = activeElement?.tagName === "INPUT" || activeElement?.tagName === "TEXTAREA";
                // If it's the monaco editor textarea, it's fine, let's trigger handleRun
                // Actually the monaco editor already has its own action, so we don't need a global one IF focused in monaco.
                // But wait, if we have both, it might run twice.
                // Let's check if we're focused in monaco.
                const isMonaco = activeElement?.className?.includes("monaco-mouse-cursor-text");

                if (!isMonaco && !isInput) {
                    e.preventDefault();
                    handleRun();
                }
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [handleRun]);

    const handleSaveSnippet = () => {
        if (!newSnippetName.trim() || !sql.trim()) return;

        const newSnippet: Snippet = {
            id: Math.random().toString(36).substring(2, 9),
            name: newSnippetName,
            sql: sql,
            createdAt: Date.now()
        };

        saveSnippets([...snippets, newSnippet]);
        setNewSnippetName("");
        setIsSaveDialogOpen(false);
        snackbarController.open({
            type: "success",
            message: t("studio_sql_snippet_saved", { name: newSnippetName })
        });
    };

    const handleExportCSV = () => {
        if (!results || results.length === 0) return;

        const headers = Object.keys(results[0]).join(",");
        const rows = results.map(row =>
            Object.values(row).map(val => {
                const str = String(val);
                return str.includes(",") ? `"${str}"` : str;
            }).join(",")
        );
        const csv = [headers, ...rows].join("\n");
        const blob = new Blob([csv], { type: "text/csv" });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `query_results_${new Date().toISOString().slice(0, 19)}.csv`;
        a.click();
        window.URL.revokeObjectURL(url);
    };

    const handleExportJSON = () => {
        if (!results || results.length === 0) return;

        const json = JSON.stringify(results, null, 2);
        const blob = new Blob([json], { type: "application/json" });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `query_results_${new Date().toISOString().slice(0, 19)}.json`;
        a.click();
        window.URL.revokeObjectURL(url);
    };

    const handleExportMarkdown = () => {
        if (!results || results.length === 0) return;

        const headers = Object.keys(results[0]);
        const headerRow = `| ${headers.join(" | ")} |`;
        const dividerRow = `| ${headers.map(() => "---").join(" | ")} |`;
        const dataRows = results.map(row =>
            `| ${headers.map(header => {
                const val = row[header];
                if (val === null) return "null";
                if (val === undefined) return "";
                // Replace pipes and newlines to avoid breaking the markdown table
                return String(val).replace(/\|/g, "\\|").replace(/\n/g, " ");
            }).join(" | ")} |`
        );

        const markdown = [headerRow, dividerRow, ...dataRows].join("\n");
        navigator.clipboard.writeText(markdown).then(() => {
            snackbarController.open({
                type: "success",
                message: t("studio_sql_markdown_copied")
            });
        }).catch(() => {
            snackbarController.open({
                type: "error",
                message: t("studio_sql_markdown_copy_failed")
            });
        });
    };

    const renderResults = () => {
        if (loading) {
            return (
                <div className="flex-grow flex items-center justify-center">
                    <div className="text-center">
                        <CircularProgress size="medium"/>
                        <Typography variant="body2" className="mt-4 text-text-secondary dark:text-text-secondary-dark font-mono tracking-tight animate-pulse">{t("studio_sql_executing_query")}</Typography>
                    </div>
                </div>
            );
        }

        if (error) {
            return (
                <div className="flex-grow flex items-center justify-center p-6 overflow-auto">
                    <ErrorView title={t("studio_sql_query_error")} error={error}/>
                </div>
            );
        }

        if (!results) {
            return (
                <div className="flex-grow flex items-center justify-center text-text-disabled dark:text-text-disabled-dark">
                    <div className="text-center">
                        <svg className="w-12 h-12 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"/></svg>
                        <Typography variant="body2">{t("studio_sql_run_query_placeholder")}</Typography>
                    </div>
                </div>
            );
        }

        // Check for EXPLAIN (FORMAT JSON) response
        if (results.length === 1 && results[0]["QUERY PLAN"] && Array.isArray(results[0]["QUERY PLAN"])) {
            try {
                const plan = results[0]["QUERY PLAN"][0].Plan;
                if (plan) {
                    return (
                        <div className="flex-grow overflow-auto p-4 bg-surface-50 dark:bg-surface-900 flex flex-col items-start">
                            <Typography variant="caption" className="font-bold text-text-secondary mb-4 tracking-wider uppercase">{t("studio_sql_visual_execution_plan")}</Typography>
                            <div className="pb-12">
                                <ExplainVisualizer plan={plan}/>
                            </div>
                        </div>
                    );
                }
            } catch (e) {
                console.warn("Failed to parse EXPLAIN JSON output:", e);
            }
        }

        if (results.length === 0) {
            return (
                <div className="flex-grow p-6 flex flex-col items-center justify-center">
                    <Typography variant="body2" className="text-text-secondary dark:text-text-secondary-dark font-mono border-b border-surface-200 dark:border-surface-950 pb-2 mb-2">{t("studio_sql_success")}</Typography>
                    <Typography variant="caption" className="text-text-disabled dark:text-text-disabled-dark">{t("studio_sql_no_results")}</Typography>
                </div>
            );
        }

        const savedWidths = columnWidths[activeTab.sql] || {};
        const resultColumnKeys = Object.keys(results[0]);

        // Compute matched collections for this query, including PK column detection
        const matchedCollections: ResolvedQueryCollection[] = (() => {
            if (!activeTab.lastExecutedSql || !collectionRegistry.collections) return [];
            try {
                return resolveQueryCollections(activeTab.lastExecutedSql, schemas, collectionRegistry.collections, resultColumnKeys);
            } catch {
                return [];
            }
        })();

        // Only collections that have a PK column in the result set can be opened
        const actionableCollections = matchedCollections.filter(mc => mc.pkColumn && resultColumnKeys.includes(mc.pkColumn));

        // For each row, determine which entities can be opened
        const getRowEntityActions = (rowData: Record<string, unknown>): { collection: ResolvedQueryCollection, entityId: string | number }[] => {
            if (!rowData) return [];
            return actionableCollections
                .filter(mc => rowData[mc.pkColumn!] != null)
                .map(mc => ({
                    collection: mc,
                    entityId: rowData[mc.pkColumn!] as string | number
                }));
        };

        // Build the columns array. If we have actionable collections, prepend a dedicated action column.
        const dataColumns: VirtualTableColumn[] = resultColumnKeys.map(key => ({
            key,
            title: key,
            width: savedWidths[key] ?? 150,
            sortable: false,
            resizable: true
        }));

        const columns: VirtualTableColumn[] = actionableCollections.length > 0
            ? [{ key: "__cms_action__",
title: "",
width: 36,
sortable: false,
resizable: false }, ...dataColumns]
            : dataColumns;

        return (
            <div className="flex-grow flex flex-col overflow-hidden min-h-0">
                {/* Collection Badges Bar */}
                {actionableCollections.length > 0 && (
                    <div className={cls("px-4 py-1.5 border-b flex items-center gap-2 shrink-0 bg-surface-50 dark:bg-surface-900", defaultBorderMixin)}>
                        <Tooltip title={t("studio_sql_admin_collections_tooltip")}>
                            <Typography variant="caption" className="text-[10px] font-bold uppercase tracking-widest text-text-disabled dark:text-text-disabled-dark mr-1 shrink-0 cursor-help">{t("studio_sql_collections_label")}</Typography>
                        </Tooltip>
                        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                            {actionableCollections.map(mc => (
                                <Tooltip key={mc.tableName} title={`Table "${mc.tableName}" → ${mc.collection.name} (PK: ${mc.pkColumn})`}>
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-primary/10 dark:bg-primary-dark/15 text-primary dark:text-primary-dark whitespace-nowrap border border-primary/20 dark:border-primary-dark/20">
                                        {typeof mc.collection.icon === "string" && (
                                            <IconForView collectionOrView={mc.collection} className="text-[12px]"/>
                                        )}
                                        {mc.collection.name}
                                    </span>
                                </Tooltip>
                            ))}
                        </div>
                    </div>
                )}
                <div className="flex-grow relative h-full min-h-0 min-w-0">
                    <VirtualTable
                        data={results}
                        columns={columns}
                        rowHeight={32}
                        headerHeight={32}
                        extraData={editingCell}
                        onColumnResizeEnd={handleColumnResize}
                        cellRenderer={({ rowData, column, rowIndex }) => {
                            // Dedicated collection action column
                            if (column.key === "__cms_action__") {
                                const rowActions = getRowEntityActions(rowData ?? {});
                                if (rowActions.length === 0) {
                                    return <div className="h-full w-full"/>;
                                }
                                if (rowActions.length === 1) {
                                    const ra = rowActions[0];
                                    return (
                                        <div className="h-full flex items-center justify-center">
                                            <Tooltip title={t("studio_sql_edit_entity", { name: ra.collection.collection.name,
id: String(ra.entityId) })}>
                                                <IconButton
                                                    size="small"
                                                    className="text-surface-400 dark:text-surface-500 hover:text-surface-600 dark:hover:text-surface-300 transition-colors"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        sidePanelController?.open({
                                                            path: ra.collection.collection.slug,
                                                            entityId: ra.entityId,
                                                            collection: ra.collection.collection,
                                                            updateUrl: false
                                                        });
                                                    }}
                                                >
                                                    <PencilIcon size={iconSize.smallest}/>
                                                </IconButton>
                                            </Tooltip>
                                        </div>
                                    );
                                }
                                // Multiple matched collections (JOIN) — show a dropdown
                                return (
                                    <div className="h-full flex items-center justify-center">
                                        <Menu
                                            trigger={
                                                <IconButton
                                                    size="small"
                                                    className="text-surface-400 dark:text-surface-500 hover:text-surface-600 dark:hover:text-surface-300 transition-colors"
                                                    onClick={(e) => e.stopPropagation()}
                                                >
                                                    <MoreVerticalIcon size={iconSize.smallest}/>
                                                </IconButton>
                                            }
                                        >
                                            {rowActions.map(ra => (
                                                <MenuItem
                                                    key={ra.collection.tableName}
                                                    dense
                                                    onClick={() => {
                                                        sidePanelController?.open({
                                                            path: ra.collection.collection.slug,
                                                            entityId: ra.entityId,
                                                            collection: ra.collection.collection,
                                                            updateUrl: false
                                                        });
                                                    }}
                                                >
                                                    {t("studio_sql_edit_entity", { name: ra.collection.collection.name,
id: String(ra.entityId) })}
                                                </MenuItem>
                                            ))}
                                        </Menu>
                                    </div>
                                );
                            }

                            // Regular data cell
                            const isEditing = editingCell?.rowIndex === rowIndex && editingCell?.columnKey === column.key;
                            const value = rowData ? rowData[column.key] : null;
                            const displayValue = typeof value === "object" && value !== null ? JSON.stringify(value) : String(value ?? "");

                            if (isEditing) {
                                return (
                                    <FixedEditorOverlay
                                        displayValue={displayValue}
                                        onSave={(val) => handleCellSave(val, rowData ?? {}, column.key, rowIndex)}
                                        onCancel={() => setEditingCell(null)}
                                    />
                                );
                            }

                            return (
                                <div
                                    className="px-4 py-1.5 h-full flex items-center whitespace-nowrap text-[13px] text-text-primary dark:text-text-primary-dark font-mono cursor-text group/cell"
                                    onDoubleClick={() => handleDoubleClick(rowIndex, column.key, displayValue, rowData ?? {})}
                                >
                                    <div className="truncate flex-grow" title={displayValue}>
                                        {displayValue === "" ? <span className="text-text-disabled dark:text-text-disabled-dark italic text-[11px]">NULL</span> : displayValue}
                                    </div>
                                </div>
                            );
                        }}
                    />
                </div>

                <div className={cls("p-2 px-4 border-t bg-surface-50 dark:bg-surface-900 flex justify-between items-center shrink-0", defaultBorderMixin)}>
                    <div className="flex space-x-4">
                        <div className="flex items-center text-[11px]">
                            <span className="font-bold text-text-disabled dark:text-text-disabled-dark mr-2 uppercase tracking-tighter">{t("studio_sql_rows")}</span>
                            <span className="font-mono text-text-secondary dark:text-text-secondary-dark">{results.length}</span>
                        </div>
                        <div className="flex items-center text-[11px]">
                            <span className="font-bold text-text-disabled dark:text-text-disabled-dark mr-2 uppercase tracking-tighter">{t("studio_sql_time")}</span>
                            <span className="font-mono text-text-secondary dark:text-text-secondary-dark">{execTime}ms</span>
                        </div>
                    </div>
                    <div className="flex gap-2 overflow-x-auto no-scrollbar items-center px-2">
                        <Button
                            size="small"
                            variant="text"
                            className="text-[10px] uppercase font-bold text-text-secondary dark:text-text-secondary-dark whitespace-nowrap"
                            onClick={handleExportMarkdown}
                        >
                            {t("studio_sql_copy_markdown")}
                        </Button>
                        <Button
                            size="small"
                            variant="text"
                            className="text-[10px] uppercase font-bold text-text-secondary dark:text-text-secondary-dark whitespace-nowrap"
                            onClick={handleExportJSON}
                        >
                            {t("studio_sql_export_json")}
                        </Button>
                        <Button
                            size="small"
                            variant="text"
                            className="text-[10px] uppercase font-bold text-text-secondary dark:text-text-secondary-dark whitespace-nowrap"
                            onClick={handleExportCSV}
                        >
                            {t("studio_sql_export_csv")}
                        </Button>
                    </div>
                </div>
            </div>
        );
    };

    // `parseFloat` answers NaN for anything it cannot read, and a NaN pane size
    // lays the editor out to nothing — so the stored value has to be checked,
    // not just parsed.
    const readStoredSize = (key: string, fallback: number) => {
        const saved = readStoredString(`${key}_${getStoragePrefix(client?.baseUrl)}`);
        const parsed = saved === null ? NaN : parseFloat(saved);
        return Number.isFinite(parsed) ? parsed : fallback;
    };

    const [sidebarSize, setSidebarSize] = useState(() => readStoredSize("rebase_sql_editor_sidebar_size", 20));
    const [editorHeight, setEditorHeight] = useState(() => readStoredSize("rebase_sql_editor_height", 50));

    useEffect(() => {
        writeStoredString(`rebase_sql_editor_sidebar_size_${projectPrefix}`, sidebarSize.toString());
    }, [sidebarSize, projectPrefix]);

    useEffect(() => {
        writeStoredString(`rebase_sql_editor_height_${projectPrefix}`, editorHeight.toString());
    }, [editorHeight, projectPrefix]);

    const activeSnippet = snippets.find(s => s.sql === activeTab.sql);
    const isFavorite = activeSnippet?.isFavorite || false;

    return (
        <div className="flex h-full w-full bg-white dark:bg-surface-950 overflow-hidden text-text-primary dark:text-text-primary-dark">
            <ResizablePanels
                orientation="horizontal"
                panelSizePercent={sidebarSize}
                onPanelSizeChange={setSidebarSize}
                minPanelSizePx={220}
                firstPanel={
                    <SQLEditorSidebar
                        snippets={snippets}
                        history={history}
                        onSelectSnippet={setSql}
                        onTableClick={setSql}
                        onDeleteSnippet={handleDeleteSnippet}
                        schemas={schemas}
                        isSchemaLoading={isSchemaLoading}
                        schemaError={schemaError}
                        onRetrySchema={fetchSchema}
                    />
                }
                secondPanel={
                    <div className="flex-grow flex flex-col min-w-0 h-full w-full">
                        {/* Toolbar */}
                        <div className={cls("flex items-center justify-between pr-2 border-b bg-white dark:bg-surface-950", defaultBorderMixin)}>
                            <div className="flex items-center flex-grow overflow-hidden mr-4">
                                <div className="flex items-center no-scrollbar overflow-x-auto min-w-0">
                                    <Tabs value={activeTabId} onValueChange={handleTabChange} variant="boxy" className="w-[unset] flex-shrink-0" innerClassName="bg-white dark:bg-surface-950">
                                        {tabs.map(tab => (
                                            <Tab key={tab.id} value={tab.id} className="flex items-center justify-between group max-w-[200px]">
                                                <TerminalIcon size={iconSize.smallest} className="text-blue-500 mr-1.5 flex-shrink-0"/>
                                                <span className="truncate">{tab.name}</span>
                                                {tabs.length > 1 && (
                                                    <IconButton
                                                        size="smallest"
                                                        onClick={(e) => handleCloseTab(tab.id, e)}
                                                        className="ml-1 !p-0.5 opacity-0 group-hover:opacity-100 hover:text-red-500 transition-opacity"
                                                    >
                                                        <XIcon size={iconSize.smallest}/>
                                                    </IconButton>
                                                )}
                                            </Tab>
                                        ))}
                                    </Tabs>
                                    <IconButton
                                        size="small"
                                        onClick={handleAddTab}
                                        className="ml-2 flex-shrink-0"
                                    >
                                        <PlusIcon size={iconSize.smallest}/>
                                    </IconButton>
                                </div>
                            </div>
                            <div className="flex shrink-0 items-center justify-end pr-2 gap-1.5">
                                <Tooltip title={t("studio_sql_format_sql")}>
                                    <IconButton size="small" onClick={handlePrettify}>
                                        <MenuIcon size={iconSize.smallest}/>
                                    </IconButton>
                                </Tooltip>

                                <Button
                                    variant="text"
                                    size="small"
                                    onClick={handleExplain}
                                    disabled={loading}
                                >
                                    {t("studio_sql_explain")}
                                </Button>

                                <div className="h-4 w-px bg-surface-200 dark:bg-surface-950 mx-1"></div>

                                <div className="flex items-center space-x-2 px-2" onClick={(e) => {
                                    setAutoLimit(!autoLimit);
                                    e.stopPropagation();
                                }}>
                                    <Typography variant="caption" className="text-[11px] text-text-secondary cursor-pointer select-none">{t("studio_sql_limit_1000")}</Typography>
                                    <div onClick={(e) => e.stopPropagation()}>
                                        <Checkbox
                                            checked={autoLimit}
                                            onCheckedChange={setAutoLimit}
                                            size="smallest"
                                            padding={false}
                                        />
                                    </div>
                                </div>

                                <div className="h-4 w-px bg-surface-200 dark:bg-surface-950 mx-1"></div>

                                <Tooltip title={isFavorite ? t("studio_sql_remove_from_favorites") : t("studio_sql_add_to_favorites")}>
                                    <IconButton
                                        size="small"
                                        onClick={() => {
                                            if (!activeSnippet) {
                                                snackbarController.open({
                                                    type: "info",
                                                    message: t("studio_sql_save_first_to_favorite")
                                                });
                                                return;
                                            }
                                            saveSnippets(snippets.map(s => s.id === activeSnippet.id ? { ...s,
isFavorite: !s.isFavorite } : s));
                                        }}
                                    >
                                        <svg className={`w-4 h-4 ${isFavorite ? "text-red-500 fill-current" : "text-text-disabled dark:text-text-disabled-dark hover:text-text-primary"}`} fill={isFavorite ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/></svg>
                                    </IconButton>
                                </Tooltip>

                                <Button
                                    variant="text"
                                    size="small"
                                    onClick={() => setIsSaveDialogOpen(true)}
                                >
                                    {t("studio_sql_save")}
                                </Button>

                                <div className="h-4 w-px bg-surface-200 dark:bg-surface-950 mx-1"></div>

                                <Menu
                                    trigger={
                                        <Button
                                            size="small"
                                            variant="outlined"
                                            className="text-text-secondary dark:text-text-secondary-dark font-medium mr-2"
                                        >
                                            <DatabaseIcon size={iconSize.small} className="mr-1.5 text-text-disabled dark:text-text-disabled-dark"/>
                                            <span className="max-w-[160px] truncate">
                                                {isLoadingConfig
                                                    ? "..."
                                                    : `${selectedDatabase || t("studio_sql_select_db")}${selectedRole ? ` (${selectedRole})` : ""}`}
                                            </span>
                                        </Button>
                                    }
                                >
                                    <div className="max-h-64 overflow-y-auto">
                                        <div className="px-3 py-1.5 border-b border-surface-200 dark:border-surface-950 mb-1">
                                            <Typography variant="caption" className="font-bold uppercase tracking-wider text-[9px] text-text-disabled dark:text-text-disabled-dark">{t("studio_sql_database")}</Typography>
                                        </div>
                                        {isLoadingConfig ? (
                                            <div className="flex items-center justify-center p-4">
                                                <CircularProgress size="small"/>
                                            </div>
                                        ) : connectionConfigError ? (
                                            <div className="px-3 py-2 text-xs text-red-500 dark:text-red-400 max-w-[200px] break-words">
                                                {connectionConfigError}
                                            </div>
                                        ) : (
                                            <>
                                                {availableDatabases.map(db => (
                                                    <MenuItem key={db} dense onClick={() => handleDatabaseChange(db)} className={cls("text-xs", selectedDatabase === db && "text-primary dark:text-primary-dark")}>
                                                        {db}
                                                    </MenuItem>
                                                ))}

                                                <div className="px-3 py-1.5 border-y border-surface-200 dark:border-surface-950 mb-1 mt-1">
                                                    <Typography variant="caption" className="font-bold uppercase tracking-wider text-[9px] text-text-disabled dark:text-text-disabled-dark">{t("studio_sql_role")}</Typography>
                                                </div>
                                                {availableRoles.map(role => (
                                                    <MenuItem key={role} dense onClick={() => handleRoleChange(role)} className={cls("text-xs", selectedRole === role && "text-primary dark:text-primary-dark")}>
                                                        {role}{role === "postgres" ? " " + t("studio_sql_collections_label") : ""}
                                                    </MenuItem>
                                                ))}
                                            </>
                                        )}
                                    </div>
                                </Menu>

                                <Button
                                    onClick={() => handleRun()}
                                    disabled={loading}
                                    size="small"
                                    color="primary"
                                >
                                    {loading ? <CircularProgress size="smallest" className="mr-2"/> : <PlayIcon size={iconSize.smallest} className="mr-2"/>}
                                    {t("studio_sql_run")}
                                </Button>
                            </div>
                        </div>

                        <ResizablePanels
                            orientation="vertical"
                            panelSizePercent={editorHeight}
                            onPanelSizeChange={setEditorHeight}
                            minPanelSizePx={100}
                            firstPanel={
                                <div className="h-full w-full relative flex flex-col min-h-0">
                                    <MonacoEditor
                                        value={sql}
                                        onChange={(v) => setSql(v || "")}
                                        onRun={handleRun}
                                        schemas={schemas}
                                    />
                                </div>
                            }
                            secondPanel={
                                <div className="h-full w-full flex flex-col bg-surface-50 dark:bg-surface-950 overflow-hidden min-h-0">
                                    <div className={cls("p-2 px-4 bg-surface-100 dark:bg-surface-900 border-b shrink-0 flex items-center", defaultBorderMixin)}>
                                        <Typography variant="caption" className="font-bold text-text-disabled dark:text-text-disabled-dark uppercase tracking-widest text-[10px]">{t("studio_sql_query_results")}</Typography>
                                    </div>
                                    <div className="flex-grow flex flex-col min-h-0 overflow-hidden">
                                        {renderResults()}
                                    </div>
                                </div>
                            }
                        />

                    </div>
                }
            />

            <Dialog open={isSaveDialogOpen} onOpenChange={setIsSaveDialogOpen}>
                <DialogTitle>{t("studio_sql_save_snippet")}</DialogTitle>
                <DialogContent>
                    <div className="py-4 flex flex-col gap-4">
                        <TextField
                            label={t("studio_sql_snippet_name")}
                            autoFocus
                            placeholder={t("studio_sql_snippet_name_placeholder")}
                            value={newSnippetName}
                            onChange={(e) => setNewSnippetName(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                    e.preventDefault();
                                    handleSaveSnippet();
                                }
                            }}
                        />
                        <Typography variant="caption" className="text-text-disabled dark:text-text-disabled-dark block">{t("studio_sql_snippet_saved_local")}</Typography>
                    </div>
                </DialogContent>
                <DialogActions>
                    <Button variant="text" onClick={() => setIsSaveDialogOpen(false)}>{t("studio_sql_cancel")}</Button>
                    <Button onClick={handleSaveSnippet} color="primary" disabled={!newSnippetName.trim()}>{t("studio_sql_save")}</Button>
                </DialogActions>
            </Dialog>
            {/* Confirmation Dialog */}
            <ConfirmationDialog
                open={isConfirmDialogOpen}
                onCancel={() => setIsConfirmDialogOpen(false)}
                title={t("studio_sql_dangerous_operation")}
                body={t("studio_sql_dangerous_operation_body")}
                onAccept={() => {
                    if (pendingAction) pendingAction();
                    setIsConfirmDialogOpen(false);
                }}
            />
        </div>
    );
};
