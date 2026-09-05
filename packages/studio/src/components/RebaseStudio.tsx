import React, { Suspense, useLayoutEffect, useMemo } from "react";
import { useRebaseRegistryDispatch, useTranslation } from "@rebasepro/app";
import type { RebaseStudioConfig, AppView } from "@rebasepro/cms-types";
import { CircularProgressCenter, lazyChunk } from "@rebasepro/ui";

// Lazy-loaded studio tools — each fetched only when its route is visited.
// This keeps Monaco, @xyflow/react, dagre, pgsql-ast-parser etc. out of the initial bundle.
const SQLEditor = lazyChunk(() => import("./SQLEditor/SQLEditor").then(m => ({ default: m.SQLEditor })));
const JSEditor = lazyChunk(() => import("./JSEditor/JSEditor").then(m => ({ default: m.JSEditor })));
const RLSEditor = lazyChunk(() => import("./RLSEditor/RLSEditor").then(m => ({ default: m.RLSEditor })));
const StorageView = lazyChunk(() => import("./StorageView/StorageView").then(m => ({ default: m.StorageView })));
const CronJobsView = lazyChunk(() => import("./CronJobs/CronJobsView").then(m => ({ default: m.CronJobsView })));
const SchemaVisualizer = lazyChunk(() => import("./SchemaVisualizer/SchemaVisualizer").then(m => ({ default: m.SchemaVisualizer })));
const BranchesView = lazyChunk(() => import("./Branches/BranchesView").then(m => ({ default: m.BranchesView })));
const BackupsView = lazyChunk(() => import("./Backups/BackupsView").then(m => ({ default: m.BackupsView })));
const ApiExplorer = lazyChunk(() => import("./ApiExplorer/ApiExplorer").then(m => ({ default: m.ApiExplorer })));
const LogsExplorer = lazyChunk(() => import("./LogsExplorer/LogsExplorer").then(m => ({ default: m.LogsExplorer })));
const ApiKeysView = lazyChunk(() => import("./ApiKeys/ApiKeysView").then(m => ({ default: m.ApiKeysView })));

import { StudioHomePage } from "./StudioHomePage";

/**
 * Declarative component to configure the Studio in Rebase.
 * Renders nothing — purely registers config into the RebaseRegistry.
 *
 * The "schema" tool (collection editor view) is a Studio tool, but it is not
 * registered here: it ships from the panel package because it needs the project's
 * collection source to write back to. When `<RebaseCMS collectionEditor={...}>`
 * is used, the schema view is automatically injected into Studio — no manual
 * wiring needed. Where it is mounted from is an implementation detail; it is a
 * schema-editing tool and belongs beside SQL and RLS.
 */
const DEFAULT_HOME_PAGE = <StudioHomePage/>;

export function RebaseStudio({ tools, homePage, devViews: extraViews }: RebaseStudioConfig) {
    const dispatch = useRebaseRegistryDispatch();
    const { t, i18n } = useTranslation();

    const resolvedHomePage = homePage ?? DEFAULT_HOME_PAGE;

    /**
     * The tool list reduced to a value, so that re-rendering the host does not
     * republish the registry.
     *
     * `tools` is an array, and callers write it inline — `tools={[...TOOLS]}`
     * in the hosted console. A fresh array every render meant a fresh
     * `devViews` every render, which meant the effect below unregistered and
     * re-registered on every render. Because each registration builds *new*
     * `<Suspense><SQLEditor/></Suspense>` elements, whatever view was on screen
     * was torn down and remounted each time: a half-typed SQL query, a storage
     * folder you had navigated into, an open policy editor — all discarded, and
     * every mount reissued the view's initial requests.
     */
    const toolsKey = tools ? tools.join(",") : "";

    const devViews: AppView[] = useMemo(() => {
        const views: AppView[] = [];
        const activeTools = tools ?? ["sql", "js", "rls", "storage", "cron", "schema-visualizer", "branches", "backups", "api", "logs", "api-keys"];
        const suspense = (el: React.ReactNode) => <Suspense fallback={<CircularProgressCenter/>}>{el}</Suspense>;

        if (activeTools.includes("sql")) {
            views.push({ slug: "sql",
name: t("studio_tool_sql"),
group: "Database",
icon: "terminal",
description: t("studio_tool_sql_description"),
view: suspense(<SQLEditor/>) });
        }
        if (activeTools.includes("js")) {
            views.push({ slug: "js",
name: t("studio_tool_js"),
group: "Compute",
icon: "code",
description: t("studio_tool_js_description"),
view: suspense(<JSEditor/>) });
        }
        if (activeTools.includes("rls")) {
            views.push({ slug: "rls",
name: t("studio_tool_rls"),
group: "Database",
icon: "ShieldCheck",
description: t("studio_tool_rls_description"),
view: suspense(<RLSEditor/>) });
        }
        if (activeTools.includes("storage")) {
            views.push({ slug: "storage",
name: t("studio_tool_storage"),
group: "Storage",
icon: "HardDrive",
description: t("studio_tool_storage_description"),
view: suspense(<StorageView/>) });
        }
        if (activeTools.includes("cron")) {
            views.push({ slug: "cron",
name: t("studio_tool_cron"),
group: "Compute",
icon: "Clock",
description: t("studio_tool_cron_description"),
view: suspense(<CronJobsView/>) });
        }
        if (activeTools.includes("schema-visualizer")) {
            views.push({ slug: "schema-visualizer",
name: t("studio_tool_schema_visualizer"),
group: "Database",
icon: "Network",
description: t("studio_tool_schema_visualizer_description"),
view: suspense(<SchemaVisualizer/>) });
        }
        if (activeTools.includes("branches")) {
            views.push({ slug: "branches",
name: t("studio_tool_branches"),
group: "Database",
icon: "GitBranch",
description: t("studio_tool_branches_description"),
view: suspense(<BranchesView/>) });
        }
        if (activeTools.includes("backups")) {
            views.push({ slug: "backups",
name: t("studio_tool_backups"),
group: "Database",
icon: "Database",
description: t("studio_tool_backups_description"),
view: suspense(<BackupsView/>) });
        }
        if (activeTools.includes("api")) {
            views.push({ slug: "api",
name: t("studio_tool_api"),
group: "API",
icon: "BookOpen",
description: t("studio_tool_api_description"),
view: suspense(<ApiExplorer/>) });
        }
        if (activeTools.includes("logs")) {
            views.push({ slug: "logs",
name: t("studio_tool_logs"),
group: "Database",
icon: "Activity",
description: t("studio_tool_logs_description"),
view: suspense(<LogsExplorer/>) });
        }
        if (activeTools.includes("api-keys")) {
            views.push({ slug: "api-keys",
name: t("studio_tool_api_keys"),
group: "Access Control",
icon: "KeyRound",
description: t("studio_tool_api_keys_description"),
view: suspense(<ApiKeysView/>) });
        }
        // Note: "schema" tool is auto-injected by RebaseShell when collectionEditor is enabled.
        // It is NOT registered here anymore.
        return views;
        // Keyed by the tool list's *contents*; see `toolsKey`. `tools` itself is
        // read inside, and is exactly determined by the key.
        // The strings are now translated, so the active language is part of
        // what this list is.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [toolsKey, t, i18n.language]);

    /**
     * Your own tools, keyed the same way `tools` is and for the same reason:
     * callers write `devViews={[…]}` inline, so the array is new on every
     * render. Re-registering would tear down and remount whichever Studio view
     * was on screen — a half-typed SQL query, an open policy editor.
     *
     * The key is the identity of each view, not its element: a view's `view` is
     * resolved by the router at render time, so a fresh element for the same
     * slug is not a configuration change.
     */
    const extraViewsKey = (extraViews ?? [])
        .map((v) => `${v.slug}|${v.name}|${v.group ?? ""}|${v.hideFromNavigation ?? false}`)
        .join(",");
    const extraViewsRef = React.useRef(extraViews);
    extraViewsRef.current = extraViews;

    const allDevViews: AppView[] = useMemo(
        () => [...devViews, ...(extraViewsRef.current ?? [])],
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [devViews, extraViewsKey]
    );

    // Use a ref for homePage so it never destabilizes the effect.
    // homePage is a React element — its identity doesn't matter for registration.
    const homePageRef = React.useRef(resolvedHomePage);
    homePageRef.current = resolvedHomePage;

    // Same reasoning for `tools`: it is registered as config, but a new array
    // with the same contents must not count as a change.
    const toolsRef = React.useRef(tools);
    toolsRef.current = tools;

    useLayoutEffect(() => {
        dispatch.registerStudio({ tools: toolsRef.current,
homePage: homePageRef.current,
devViews: allDevViews });
        return () => dispatch.unregisterStudio();
    }, [dispatch, allDevViews]);

    return null;
}
