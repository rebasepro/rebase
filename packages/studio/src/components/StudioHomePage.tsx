import type { AppView, HomePageSection, PluginGenericProps } from "@rebasepro/cms-types";
import React, { useEffect, useMemo, useState } from "react";
import { Card, cls, Container, ExpandablePanel, Typography } from "@rebasepro/ui";
import { IconForView, useRebaseContext, useRebaseRegistry, useRestoreScroll, useSlot } from "@rebasepro/app";
import { useNavigate } from "react-router";
import { useStudioBreadcrumbs, SchemaDriftBanner } from "@rebasepro/app";

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
const GROUP_ORDER = ["Database", "Compute", "Storage", "API", "Access Control"];

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

    useEffect(() => {
        breadcrumbs.set({ breadcrumbs: [] });
    }, [breadcrumbs.set]);

    const { containerRef } = useRestoreScroll();

    const sectionProps: PluginGenericProps = { context };

    const pluginActions = useSlot("home.actions", sectionProps);

    // The collection editor ("schema") is not part of `devViews` — RebaseNavigation
    // injects it when the admin enables a collection editor. Mirror that condition so
    // the card tracks the route.
    const schemaEnabled = Boolean(registry.studioConfig && registry.cmsConfig?.collectionEditor);

    const filteredSections = useMemo(() => {
        const views: StudioViewMeta[] = [];
        if (schemaEnabled) {
            views.push({
                slug: "schema",
                name: "Collections",
                group: "Database",
                icon: "LayoutList",
                description: "Define and manage your data model and collection schemas"
            });
        }
        views.push(...(registry.studioConfig?.devViews ?? []));
        return buildSections(views).filter(s => !hiddenGroups?.includes(s.label));
    }, [registry.studioConfig?.devViews, schemaEnabled, hiddenGroups]);

    const groupNames = useMemo(
        () => filteredSections.map(s => s.label),
        [filteredSections]
    );

    const { isGroupCollapsed, toggleGroupCollapsed } = useStudioCollapsedGroups(groupNames);

    return (
        <div ref={containerRef} className="py-2 overflow-auto h-full w-full bg-surface-50 dark:bg-surface-800">
            <Container maxWidth="6xl">
                <div className="mb-4 flex flex-col gap-2">
                    <SchemaDriftBanner />
                </div>

                {(additionalActions || pluginActions) && (
                    <div className="w-full sticky py-4 transition-all duration-400 ease-in-out top-0 z-10 flex flex-row gap-4 justify-end">
                        {additionalActions}
                        {pluginActions}
                    </div>
                )}

                {additionalChildrenStart}

                {/* ── Tool sections ── */}
                {filteredSections.map((section) => {
                    const sectionCollapsed = isGroupCollapsed(section.label);

                    return (
                        <div key={section.label} className="my-10">
                            <ExpandablePanel
                                invisible
                                expanded={!sectionCollapsed}
                                onExpandedChange={(open) => {
                                    if (open !== !sectionCollapsed) {
                                        toggleGroupCollapsed(section.label);
                                    }
                                }}
                                className="mt-6"
                                titleClassName={cls(
                                    "min-h-0 p-0 border-none",
                                    "rounded flex items-center justify-between w-full",
                                    "hover:bg-transparent",
                                    "cursor-pointer select-none",
                                    sectionCollapsed && "bg-surface-100 dark:bg-surface-900/50"
                                )}
                                innerClassName="mt-4 pt-0"
                                title={
                                    <Typography
                                        variant="caption"
                                        component="h2"
                                        color="secondary"
                                        className={cls(
                                            "px-4 py-1 rounded",
                                            "font-medium text-[10px] uppercase tracking-[0.08em] text-primary/50 dark:text-primary/70"
                                        )}
                                    >
                                        {section.label}
                                    </Typography>
                                }
                            >
                                <div className="mt-4 pt-0">
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                        {section.tools.map((tool) => (
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
                                                    "hover:bg-primary/5 dark:hover:bg-primary/5"
                                                )}
                                            >
                                                <div className="flex flex-col h-full">
                                                    {/* Header: icon + title */}
                                                    <div className="flex items-center w-full justify-between mb-1">
                                                        <div className="flex items-center gap-3">
                                                            <div className="flex items-center justify-center w-5 h-5 text-surface-400 dark:text-surface-500 transition-colors duration-150 group-hover:text-primary dark:group-hover:text-primary">
                                                                <IconForView
                                                                    collectionOrView={{ slug: tool.path, name: tool.name, icon: tool.icon }}
                                                                    size="small"
                                                                />
                                                            </div>
                                                            <Typography variant="subtitle1" component="h2">
                                                                {tool.name}
                                                            </Typography>
                                                        </div>
                                                    </div>

                                                    {/* Description indented to align with title */}
                                                    <div className="pl-8">
                                                        {tool.description && (
                                                            <Typography variant="caption" color="secondary" component="div">
                                                                {tool.description}
                                                            </Typography>
                                                        )}
                                                    </div>

                                                    {/* Spacer */}
                                                    <div className="grow"/>
                                                </div>
                                            </Card>
                                        ))}
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
                            variant="caption"
                            component="h2"
                            color="secondary"
                            className={cls(
                                "px-4 py-1 rounded",
                                "font-medium text-[10px] uppercase tracking-[0.08em] text-primary/50 dark:text-primary/70"
                            )}
                        >
                            Quick Start
                        </Typography>
                    </div>

                    <Typography variant="body2" color="secondary" className="mb-4 max-w-2xl">
                        Generate a fully-typed SDK from your collections with{" "}
                        <code className="text-emerald-400 font-mono text-xs bg-emerald-400/10 px-1.5 py-0.5 rounded">
                            npx rebase generate-sdk
                        </code>
                        {" "}and start querying your data with full TypeScript autocompletion.
                    </Typography>

                    <div className="rounded-lg border border-surface-200/40 dark:border-surface-700/40 bg-white dark:bg-surface-950 overflow-hidden">
                        {/* Title bar */}
                        <div className="flex items-center justify-between px-4 py-2.5 border-b border-surface-200/40 dark:border-surface-700/40 bg-surface-50 dark:bg-surface-900/80">
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
                            <SyntaxHighlightedSnippet/>
                        </div>
                    </div>
                </div>

                {/* ── Extra sections from props ── */}
                {sections?.map((s) => (
                    <div key={s.key} className="my-10">
                        <Typography
                            variant="caption"
                            component="h2"
                            color="secondary"
                            className={cls(
                                "px-4 py-1 rounded",
                                "font-medium text-[10px] uppercase tracking-[0.08em] text-primary/50 dark:text-primary/70"
                            )}
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

function SyntaxHighlightedSnippet() {
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
            <span className={tx}> </span>
            <span className={kw}>type</span>
            <span className={tx}>{" { "}</span>
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
            <span className={str}>&apos;http://localhost:3001&apos;</span>
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
