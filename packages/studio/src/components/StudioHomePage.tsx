import type { AppView, HomePageSection, PluginGenericProps } from "@rebasepro/app";
import React, { useEffect, useMemo, useState } from "react";
import { ArrowRightIcon, Card, cls, Container, ExpandablePanel, SearchBar, StatusDot, Typography } from "@rebasepro/ui";
import { IconForView, useApiConfig, useNavigationGroupLabel, useRebaseContext, useRebaseRegistry, useRestoreScroll, useSlot, useTranslation } from "@rebasepro/app";
import { useNavigate } from "react-router";
import { useStudioBreadcrumbs, SchemaDriftBanner } from "@rebasepro/app";
import { isRecord, useAdminFetch } from "../utils/adminFetch";

interface LiveSchemaStats {
    tables: number;
    columns: number;
    relations: number;
    rlsProtected: number;
    tableNames: string[];
}

const TOOL_READOUTS: Record<string, { label: string; value: string }> = {
    "/s/tables": { label: "ENGINE", value: "DDL · ROWS · INDEXES" },
    "/s/sql": { label: "QUERY", value: "SQL · EXPLAIN" },
    "/s/rls": { label: "ACCESS", value: "POLICIES · SIMULATOR" },
    "/s/schema": { label: "GRAPH", value: "ERD · RELATIONS" },
    "/s/branches": { label: "SCHEMA", value: "BRANCH · DIFF" },
    "/s/backups": { label: "SNAPSHOT", value: "DUMP · RESTORE" },
    "/s/logs": { label: "STREAM", value: "LIVE TAIL" },
    "/s/js": { label: "RUNTIME", value: "SDK · REPL" },
    "/s/crons": { label: "SCHEDULE", value: "CRON · JOBS" },
    "/s/storage": { label: "OBJECTS", value: "BUCKETS · RLS" },
    "/s/api": { label: "SPEC", value: "OPENAPI · REST" },
    "/s/webhooks": { label: "EVENTS", value: "DELIVERY · LOGS" },
    "/s/users": { label: "IDENTITY", value: "USERS · ROLES" },
    "/s/api-keys": { label: "TOKENS", value: "SCOPED · KEYS" }
};

/* ═══════════════════════════════════════════════════════════════
   Studio tool sections, derived from the registered Studio views
   ═══════════════════════════════════════════════════════════════ */

interface StudioTool {
    path: string;
    name: string;
    description: string;
    icon?: string | React.ReactNode;
}

interface StudioSection {
    label: string;
    tools: StudioTool[];
}

/** The view metadata the cards need — not the rendered `view` itself. */
type StudioViewMeta = Pick<AppView, "slug" | "name" | "group" | "description" | "icon" | "hideFromNavigation">;

/** Group order for the home page; unknown groups are appended in view order. */
export const STUDIO_GROUP_ORDER = ["Database", "Compute", "Storage", "API", "Access Control"];
const GROUP_ORDER = STUDIO_GROUP_ORDER;

const UNGROUPED_LABEL = "Tools";

/**
 * Build the home page sections from the Studio views that are actually
 * registered, so a card exists if and only if its route does. A hand-written
 * list drifts: it used to advertise Users and Roles pages that 404, while
 * omitting the Backups view that does exist.
 */
function buildSections(views: StudioViewMeta[]): StudioSection[] {
    const byGroup = new Map<string, StudioTool[]>();

    for (const view of views) {
        if (view.hideFromNavigation) continue;
        const label = view.group ?? UNGROUPED_LABEL;
        const tools = byGroup.get(label) ?? [];
        tools.push({
            path: `/${view.slug}`,
            name: view.name,
            description: view.description ?? "",
            icon: view.icon
        });
        byGroup.set(label, tools);
    }

    const ordered = [
        ...GROUP_ORDER.filter(g => byGroup.has(g)),
        ...[...byGroup.keys()].filter(g => !GROUP_ORDER.includes(g))
    ];

    return ordered.map(label => ({ label,
tools: byGroup.get(label)! }));
}

/* ═══════════════════════════════════════════════════════════════ */

const COLLAPSED_STORAGE_KEY = "rebase-studio-home-collapsed";

function useStudioCollapsedGroups(groupNames: string[]) {
    const [collapsed, setCollapsed] = useState<Set<string>>(() => {
        try {
            const stored = localStorage.getItem(COLLAPSED_STORAGE_KEY);
            return stored ? new Set(JSON.parse(stored)) : new Set<string>();
        } catch {
            return new Set<string>();
        }
    });

    const isGroupCollapsed = (name: string) => collapsed.has(name);

    const toggleGroupCollapsed = (name: string) => {
        setCollapsed(prev => {
            const next = new Set(prev);
            if (next.has(name)) {
                next.delete(name);
            } else {
                next.add(name);
            }
            try {
                localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify([...next]));
            } catch { /* noop */ }
            return next;
        });
    };

    return { isGroupCollapsed, toggleGroupCollapsed };
}

export function StudioHomePage({
    additionalActions,
    additionalChildrenStart,
    additionalChildrenEnd,
    sections,
    hiddenGroups
}: {
    additionalActions?: React.ReactNode;
    additionalChildrenStart?: React.ReactNode;
    additionalChildrenEnd?: React.ReactNode;
    sections?: HomePageSection[];
    hiddenGroups?: string[];
}) {
    const context = useRebaseContext();
    const breadcrumbs = useStudioBreadcrumbs();
    const navigate = useNavigate();
    const registry = useRebaseRegistry();
    const apiConfig = useApiConfig();
    const apiUrl = absoluteApiUrl(apiConfig?.apiUrl);
    const { t } = useTranslation();

    useEffect(() => {
        breadcrumbs.set({ breadcrumbs: [] });
    }, [breadcrumbs.set]);

    const { containerRef } = useRestoreScroll();
    const [searchQuery, setSearchQuery] = useState("");
    const [schemaStats, setSchemaStats] = useState<LiveSchemaStats | null>(null);

    // Through the admin client, which sends the session's token: a bare
    // `fetch` with cookies answered 401 wherever the session is a bearer
    // token, and the card sat on dashes.
    const { requestJson } = useAdminFetch();
    useEffect(() => {
        if (typeof fetch !== "function") return;
        let cancelled = false;
        requestJson("/schema/tables")
            .then((body: unknown) => {
                if (cancelled || !body || typeof body !== "object") return;
                const list = isRecord(body) && Array.isArray(body.tables)
                    ? body.tables
                    : (Array.isArray(body) ? body : null);
                if (!list) return;
                let tables = 0;
                let columns = 0;
                let relations = 0;
                let rlsProtected = 0;
                const tableNames: string[] = [];
                for (const item of list) {
                    if (!isRecord(item)) continue;
                    if (item.kind && item.kind !== "table") continue;
                    tables++;
                    if (typeof item.table === "string") tableNames.push(item.table);
                    else if (typeof item.name === "string") tableNames.push(item.name);
                    // A `TableDescriptor`: columns and relations are arrays,
                    // and a served table's policies are its `rls` posture —
                    // "rules" or "admin-only", never off.
                    columns += countOf(item.columns);
                    relations += countOf(item.relations);
                    const rls = isRecord(item.rls) ? item.rls : undefined;
                    if (rls?.posture === "rules" || rls?.posture === "admin-only") {
                        rlsProtected++;
                    }
                }
                if (tables > 0) {
                    setSchemaStats({ tables, columns, relations, rlsProtected, tableNames });
                }
            })
            .catch(() => { /* ignore background overview fetch errors */ });
        return () => {
            cancelled = true;
        };
    }, [requestJson, apiConfig?.apiUrl, apiConfig?.apiPath]);

    const sectionProps: PluginGenericProps = { context };

    const pluginActions = useSlot("home.actions", sectionProps);

    const allSections = useMemo(
        () => buildSections([...(registry.studioConfig?.devViews ?? [])]).filter(s => !hiddenGroups?.includes(s.label)),
        [registry.studioConfig?.devViews, hiddenGroups]
    );

    const filteredSections = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        if (!q) return allSections;
        return allSections
            .map((section) => ({
                ...section,
                tools: section.tools.filter(
                    (tool) =>
                        tool.name.toLowerCase().includes(q) ||
                        tool.description.toLowerCase().includes(q) ||
                        section.label.toLowerCase().includes(q)
                )
            }))
            .filter((section) => section.tools.length > 0);
    }, [allSections, searchQuery]);

    const totalToolsCount = useMemo(
        () => allSections.reduce((acc, s) => acc + s.tools.length, 0),
        [allSections]
    );

    const groupNames = useMemo(
        () => filteredSections.map(s => s.label),
        [filteredSections]
    );

    const { isGroupCollapsed, toggleGroupCollapsed } = useStudioCollapsedGroups(groupNames);
    // The group name is the identifier this page orders and collapses by;
    // only what the reader sees is translated.
    const groupLabel = useNavigationGroupLabel();

    const tableCount = schemaStats?.tables ?? 0;
    const apiHostLabel = useMemo(() => {
        try {
            return new URL(apiUrl).host;
        } catch {
            return apiUrl || "same-origin";
        }
    }, [apiUrl]);

    return (
        <div ref={containerRef} className="py-2 overflow-auto h-full w-full bg-surface-sheet">
            <Container maxWidth="6xl">
                <div className="mb-4 flex flex-col gap-2">
                    <SchemaDriftBanner />
                </div>

                {/* Top search bar — matches CMS Home rhythm */}
                <div className="w-full py-3 sticky top-0 z-10 bg-surface-sheet/90 backdrop-blur-md flex flex-row gap-3 items-center">
                    <div className="flex-1">
                        <SearchBar
                            onTextSearch={(v) => setSearchQuery(v ?? "")}
                            placeholder="Search Studio tools…"
                            innerClassName="w-full"
                        />
                    </div>
                    {additionalActions}
                    {pluginActions}
                </div>

                {additionalChildrenStart}

                {/* ── Live Workspace Overview Strip ── */}
                {!searchQuery && (
                    <div className="mt-4 mb-8">
                        <Typography
                            variant="micro"
                            component="h2"
                            color="secondary"
                            className="py-1 mb-3 block"
                        >
                            {t("studio_home_overview")}
                        </Typography>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                            <Card className="p-4 flex flex-col justify-between gap-2.5">
                                <div className="flex items-center justify-between">
                                    <Typography variant="micro" color="secondary">{t("studio_home_backend_runtime")}</Typography>
                                    <StatusDot tone="ok" size="small">{t("studio_home_online")}</StatusDot>
                                </div>
                                <Typography variant="h5" className="font-semibold tracking-tight">
                                    REST · WS · MCP
                                </Typography>
                                <Typography variant="mono" color="secondary" className="text-xs truncate">
                                    {apiHostLabel}
                                </Typography>
                            </Card>

                            <Card className="p-4 flex flex-col justify-between gap-2.5">
                                <div className="flex items-center justify-between">
                                    <Typography variant="micro" color="secondary">{t("studio_home_postgres_schema")}</Typography>
                                    <Typography variant="mono" color="secondary" className="text-xs">public</Typography>
                                </div>
                                <Typography variant="h4" className="font-mono tabular-nums font-semibold">
                                    {tableCount > 0 ? tableCount : "—"}
                                    <span className="text-sm font-sans font-normal text-text-secondary dark:text-text-secondary-dark ml-1.5">
                                        {t("studio_home_tables_unit", { count: tableCount })}
                                    </span>
                                </Typography>
                                <Typography variant="mono" color="secondary" className="text-xs flex items-center gap-3">
                                    <span>{t("studio_home_cols")} <strong className="text-text-primary dark:text-text-primary-dark font-medium">{schemaStats ? schemaStats.columns : "—"}</strong></span>
                                    <span>{t("studio_home_rels")} <strong className="text-text-primary dark:text-text-primary-dark font-medium">{schemaStats ? schemaStats.relations : "—"}</strong></span>
                                </Typography>
                            </Card>

                            <Card className="p-4 flex flex-col justify-between gap-2.5">
                                <div className="flex items-center justify-between">
                                    <Typography variant="micro" color="secondary">{t("studio_home_security_rls")}</Typography>
                                    <StatusDot tone={schemaStats && schemaStats.rlsProtected < schemaStats.tables ? "busy" : "ok"} size="small">
                                        {schemaStats ? t("studio_home_enforced", { protected: schemaStats.rlsProtected, total: schemaStats.tables }) : t("studio_api_keys_status_active")}
                                    </StatusDot>
                                </div>
                                <Typography variant="h4" className="font-mono tabular-nums font-semibold">
                                    {schemaStats && schemaStats.tables > 0
                                        ? `${Math.round((schemaStats.rlsProtected / schemaStats.tables) * 100)}%`
                                        : "RLS"}
                                    <span className="text-sm font-sans font-normal text-text-secondary dark:text-text-secondary-dark ml-1.5">
                                        {t("studio_home_protected")}
                                    </span>
                                </Typography>
                                <Typography variant="mono" color="secondary" className="text-xs">
                                    {t("studio_home_default_deny")}
                                </Typography>
                            </Card>

                            <Card className="p-4 flex flex-col justify-between gap-2.5">
                                <div className="flex items-center justify-between">
                                    <Typography variant="micro" color="secondary">{t("studio_home_workbench")}</Typography>
                                    <Typography variant="mono" color="secondary" className="text-xs">{t("studio_home_groups", { count: filteredSections.length })}</Typography>
                                </div>
                                <Typography variant="h4" className="font-mono tabular-nums font-semibold">
                                    {totalToolsCount}
                                    <span className="text-sm font-sans font-normal text-text-secondary dark:text-text-secondary-dark ml-1.5">
                                        {t("studio_home_tools_unit")}
                                    </span>
                                </Typography>
                                <Typography variant="mono" color="secondary" className="text-xs truncate">
                                    {schemaStats && schemaStats.tableNames.length > 0
                                        ? schemaStats.tableNames.slice(0, 4).join(" · ")
                                        : "SQL · RLS · STORAGE · API"}
                                </Typography>
                            </Card>
                        </div>
                    </div>
                )}

                {/* ── Tool sections ── */}
                {filteredSections.map((section) => {
                    const sectionCollapsed = isGroupCollapsed(section.label);

                    return (
                        <div key={section.label} className="my-8">
                            <ExpandablePanel
                                invisible
                                expanded={!sectionCollapsed}
                                onExpandedChange={(open) => {
                                    if (open !== !sectionCollapsed) {
                                        toggleGroupCollapsed(section.label);
                                    }
                                }}
                                className="mt-4"
                                titleClassName={cls(
                                    "min-h-0 p-0 px-3 -mx-3 w-auto border-none",
                                    "rounded flex items-center justify-between w-full",
                                    "hover:bg-transparent",
                                    "cursor-pointer select-none",
                                    sectionCollapsed && "bg-surface-field"
                                )}
                                innerClassName="mt-3 pt-0"
                                title={
                                    <Typography
                                        variant="micro"
                                        component="h2"
                                        color="secondary"
                                        className="py-1 rounded"
                                    >
                                        {groupLabel(section.label)}
                                    </Typography>
                                }
                            >
                                <div className="mt-3 pt-0">
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
                                        {section.tools.map((tool) => {
                                            const staticReadout = TOOL_READOUTS[tool.path];
                                            const dynamicValue =
                                                tool.path === "/s/tables" && schemaStats
                                                    ? `${schemaStats.tables} TABLES · ${schemaStats.columns} COLS`
                                                    : tool.path === "/s/rls" && schemaStats
                                                        ? `${schemaStats.rlsProtected}/${schemaStats.tables} PROTECTED`
                                                        : tool.path === "/s/schema" && schemaStats
                                                            ? `${schemaStats.tables} NODES · ${schemaStats.relations} EDGES`
                                                            : staticReadout?.value;

                                            return (
                                                <Card
                                                    key={tool.path}
                                                    onClick={() => {
                                                        navigate(tool.path);
                                                        context.analyticsController?.onAnalyticsEvent?.(
                                                            "home_navigate_to_view",
                                                            { path: tool.path }
                                                        );
                                                    }}
                                                    className={cls(
                                                        "group h-full p-4 cursor-pointer transition-colors duration-150 ease-in-out",
                                                        "hover:bg-surface-card-hover"
                                                    )}
                                                >
                                                    <div className="flex items-start gap-3.5 h-full">
                                                        {/* 36x36 raised icon well */}
                                                        <div className="shrink-0 flex items-center justify-center w-9 h-9 rounded-lg bg-surface-raised text-text-secondary dark:text-text-secondary-dark transition-colors duration-150 group-hover:bg-surface-raised-hover group-hover:text-text-primary dark:group-hover:text-text-primary-dark">
                                                            <IconForView
                                                                collectionOrView={{ slug: tool.path, name: tool.name, icon: tool.icon }}
                                                                size="small"
                                                            />
                                                        </div>

                                                        <div className="flex flex-col min-w-0 flex-1 h-full">
                                                            <div className="flex items-center justify-between gap-2">
                                                                <Typography variant="subtitle1" component="h2" className="truncate">
                                                                    {tool.name}
                                                                </Typography>
                                                                <ArrowRightIcon
                                                                    size={14}
                                                                    className="shrink-0 text-text-disabled dark:text-text-disabled-dark opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 group-hover:text-text-secondary dark:group-hover:text-text-secondary-dark transition-all duration-150"
                                                                />
                                                            </div>

                                                            {tool.description && (
                                                                <Typography variant="caption" color="secondary" component="div" className="mt-0.5 line-clamp-2">
                                                                    {tool.description}
                                                                </Typography>
                                                            )}

                                                            <div className="grow"/>

                                                            {dynamicValue && (
                                                                <div className="mt-3 pt-2.5 border-t border-hairline flex items-center justify-between gap-2">
                                                                    <Typography variant="micro" color="disabled">
                                                                        {staticReadout?.label ?? "MODULE"}
                                                                    </Typography>
                                                                    <Typography variant="mono" color="secondary" className="text-xs truncate">
                                                                        {dynamicValue}
                                                                    </Typography>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </Card>
                                            );
                                        })}
                                    </div>
                                </div>
                            </ExpandablePanel>
                        </div>
                    );
                })}

                {/* ── SDK Quick Start ── */}
                <div className="mt-10 mb-6">
                    <div className="flex items-center mb-1">
                        <Typography
                            variant="micro"
                            component="h2"
                            color="secondary"
                            className="py-1 rounded"
                        >
                            Quick Start
                        </Typography>
                    </div>

                    <Typography variant="body2" color="secondary" className="mb-4 max-w-2xl">
                        Generate a fully-typed SDK from your tables with{" "}
                        <code className="text-emerald-400 font-mono text-xs bg-emerald-400/10 px-1.5 py-0.5 rounded">
                            npx rebase generate-sdk
                        </code>
                        {" "}and start querying your data with full TypeScript autocompletion.
                    </Typography>

                    <div className="rounded-lg border border-hairline bg-surface-card overflow-hidden">
                        {/* Title bar */}
                        <div className="flex items-center justify-between px-4 py-2.5 border-b border-hairline bg-surface-sheet">
                            <div className="flex items-center gap-2.5">
                                <div className="flex gap-1.5">
                                    <span className="w-2.5 h-2.5 rounded-full bg-red-400/60"/>
                                    <span className="w-2.5 h-2.5 rounded-full bg-amber-400/60"/>
                                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/60"/>
                                </div>
                                <span className="text-xs font-mono text-surface-400 dark:text-surface-500 ml-1">
                                    app.ts
                                </span>
                            </div>
                            <span className="text-xs font-mono text-surface-400 dark:text-surface-500">
                                TypeScript
                            </span>
                        </div>

                        {/* Syntax-highlighted code */}
                        <div className="px-5 py-4 overflow-x-auto text-[13px] leading-6 font-mono">
                            <SyntaxHighlightedSnippet baseUrl={apiUrl}/>
                        </div>
                    </div>
                </div>

                {/* ── Extra sections from props ── */}
                {sections?.map((s) => (
                    <div key={s.key} className="my-10">
                        <Typography
                            variant="micro"
                            component="h2"
                            color="secondary"
                            className="py-1 rounded"
                        >
                            {s.title}
                        </Typography>
                        <div className="mt-4">{s.children}</div>
                    </div>
                ))}

                {additionalChildrenEnd}
            </Container>
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════════
   Hand-crafted syntax-highlighted code snippet.
   Uses inline spans with Tailwind color classes to avoid
   pulling in a syntax highlighting library.
   ═══════════════════════════════════════════════════════════════ */

/**
 * The address the panel's API answers on, as a script would write it: absolute
 * (a same-origin panel is configured with a relative one) and without a
 * trailing slash. It is what `baseUrl` takes — the API's path is the client's.
 */
/** How many entries a descriptor's list holds: an array's length, or an object's keys. */
function countOf(value: unknown): number {
    if (Array.isArray(value)) return value.length;
    return isRecord(value) ? Object.keys(value).length : 0;
}

function absoluteApiUrl(apiUrl: string | undefined): string {
    const page = typeof window !== "undefined" ? window.location.href : undefined;
    try {
        return new URL(apiUrl || "/", page).href.replace(/\/+$/, "");
    } catch {
        return apiUrl ?? "";
    }
}

/** The quick-start client, pointed at `baseUrl`. */
function SyntaxHighlightedSnippet({ baseUrl }: { baseUrl: string }) {
    const kw = "text-violet-600 dark:text-violet-400"; // keywords
    const str = "text-emerald-600 dark:text-emerald-400"; // strings
    const typ = "text-amber-600 dark:text-amber-300"; // types
    const fn = "text-blue-600 dark:text-blue-400"; // functions
    const cm = "text-surface-500 dark:text-surface-400 italic"; // comments
    const op = "text-surface-500 dark:text-surface-400"; // operators / punctuation
    const tx = "text-surface-950 dark:text-surface-200"; // plain text

    return (
        <pre className="m-0 whitespace-pre">
            <span className={kw}>import</span>
            <span className={tx}>{" { "}</span>
            <span className={fn}>createRebaseClient</span>
            <span className={tx}>{" } "}</span>
            <span className={kw}>from</span>
            <span className={tx}> </span>
            <span className={str}>&apos;@rebasepro/client&apos;</span>
            <span className={op}>;</span>
            {"\n"}

            <span className={kw}>import</span>
            <span className={tx}>{" { tablesDictionary, "}</span>
            <span className={kw}>type</span>
            <span className={tx}> </span>
            <span className={typ}>Database</span>
            <span className={tx}>{" } "}</span>
            <span className={kw}>from</span>
            <span className={tx}> </span>
            <span className={str}>&apos;./database.types&apos;</span>
            <span className={op}>;</span>
            {"\n\n"}

            <span className={kw}>const</span>
            <span className={tx}> rebase </span>
            <span className={op}>= </span>
            <span className={fn}>createRebaseClient</span>
            <span className={op}>{"<"}</span>
            <span className={typ}>Database</span>
            <span className={op}>{">("}</span>
            <span className={tx}>{"{"}</span>
            {"\n"}
            <span className={tx}>{"    baseUrl"}</span>
            <span className={op}>: </span>
            <span className={str}>&apos;{baseUrl}&apos;</span>
            <span className={op}>,</span>
            {"\n"}
            {/* Maps each accessor back to its slug: without it a hyphenated
                slug is not reachable from the property name, and the copied
                client 404s on that table. */}
            <span className={tx}>{"    tables"}</span>
            <span className={op}>: </span>
            <span className={tx}>tablesDictionary</span>
            <span className={op}>,</span>
            {"\n"}
            <span className={tx}>{"}"}</span>
            <span className={op}>);</span>
            {"\n\n"}

            <span className={cm}>{"// Fully typed — autocompletion for tables and columns"}</span>
            {"\n"}
            <span className={kw}>const</span>
            <span className={tx}>{" { "}</span>
            <span className={tx}>data</span>
            <span className={op}>: </span>
            <span className={tx}>users</span>
            <span className={tx}>{" } "}</span>
            <span className={op}>= </span>
            <span className={kw}>await</span>
            <span className={tx}> rebase</span>
            <span className={op}>.</span>
            <span className={tx}>data</span>
            <span className={op}>.</span>
            <span className={tx}>users</span>
            <span className={op}>.</span>
            <span className={fn}>find</span>
            <span className={op}>();</span>
            {"\n"}

            <span className={kw}>const</span>
            <span className={tx}>{" { "}</span>
            <span className={tx}>data</span>
            <span className={op}>: </span>
            <span className={tx}>posts</span>
            <span className={tx}>{" } "}</span>
            <span className={op}>= </span>
            <span className={kw}>await</span>
            <span className={tx}> rebase</span>
            <span className={op}>.</span>
            <span className={tx}>data</span>
            <span className={op}>.</span>
            <span className={fn}>collection</span>
            <span className={op}>(</span>
            <span className={str}>&apos;posts&apos;</span>
            <span className={op}>)</span>
            <span className={op}>.</span>
            <span className={fn}>find</span>
            <span className={op}>();</span>
        </pre>
    );
}
