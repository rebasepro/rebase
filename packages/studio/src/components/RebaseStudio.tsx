import React, { lazy, Suspense, useLayoutEffect, useMemo } from "react";
import { useRebaseRegistryDispatch } from "@rebasepro/core";
import type { RebaseStudioConfig, AppView } from "@rebasepro/types";
import { CircularProgressCenter } from "@rebasepro/ui";

// Lazy-loaded studio tools — each fetched only when its route is visited.
// This keeps Monaco, @xyflow/react, dagre, pgsql-ast-parser etc. out of the initial bundle.
const SQLEditor = lazy(() => import("./SQLEditor/SQLEditor").then(m => ({ default: m.SQLEditor })));
const JSEditor = lazy(() => import("./JSEditor/JSEditor").then(m => ({ default: m.JSEditor })));
const RLSEditor = lazy(() => import("./RLSEditor/RLSEditor").then(m => ({ default: m.RLSEditor })));
const StorageView = lazy(() => import("./StorageView/StorageView").then(m => ({ default: m.StorageView })));
const CronJobsView = lazy(() => import("./CronJobs/CronJobsView").then(m => ({ default: m.CronJobsView })));
const SchemaVisualizer = lazy(() => import("./SchemaVisualizer/SchemaVisualizer").then(m => ({ default: m.SchemaVisualizer })));
const BranchesView = lazy(() => import("./Branches/BranchesView").then(m => ({ default: m.BranchesView })));
const ApiExplorer = lazy(() => import("./ApiExplorer/ApiExplorer").then(m => ({ default: m.ApiExplorer })));
const LogsExplorer = lazy(() => import("./LogsExplorer/LogsExplorer").then(m => ({ default: m.LogsExplorer })));

import { StudioHomePage } from "./StudioHomePage";

/**
 * Declarative component to configure the Studio in Rebase.
 * Renders nothing — purely registers config into the RebaseRegistry.
 *
 * The "schema" tool (collection editor view) is now a built-in CMS feature.
 * When `<RebaseCMS collectionEditor={...}>` is used, the schema view is
 * automatically injected into Studio — no manual wiring needed.
 */
const DEFAULT_HOME_PAGE = <StudioHomePage/>;

export function RebaseStudio({ tools, homePage }: RebaseStudioConfig) {
    const dispatch = useRebaseRegistryDispatch();

    const resolvedHomePage = homePage ?? DEFAULT_HOME_PAGE;

    const devViews: AppView[] = useMemo(() => {
        const views: AppView[] = [];
        const activeTools = tools ?? ["sql", "js", "rls", "storage", "cron", "schema-visualizer", "branches", "api", "logs"];
        const suspense = (el: React.ReactNode) => <Suspense fallback={<CircularProgressCenter/>}>{el}</Suspense>;

        if (activeTools.includes("sql")) {
            views.push({ slug: "sql",
name: "SQL Console",
group: "Database",
icon: "terminal",
description: "Execute SQL queries",
view: suspense(<SQLEditor/>) });
        }
        if (activeTools.includes("js")) {
            views.push({ slug: "js",
name: "JS Console",
group: "Compute",
icon: "code",
description: "Execute JavaScript",
view: suspense(<JSEditor/>) });
        }
        if (activeTools.includes("rls")) {
            views.push({ slug: "rls",
name: "RLS Policies",
group: "Database",
icon: "ShieldCheck",
description: "Row Level Security",
view: suspense(<RLSEditor/>) });
        }
        if (activeTools.includes("storage")) {
            views.push({ slug: "storage",
name: "Storage",
group: "Storage",
icon: "HardDrive",
description: "Manage storage files",
view: suspense(<StorageView/>) });
        }
        if (activeTools.includes("cron")) {
            views.push({ slug: "cron",
name: "Cron Jobs",
group: "Compute",
icon: "Clock",
description: "Manage scheduled tasks",
view: suspense(<CronJobsView/>) });
        }
        if (activeTools.includes("schema-visualizer")) {
            views.push({ slug: "schema-visualizer",
name: "Schema Visualizer",
group: "Database",
icon: "Network",
description: "Interactive database ERD",
view: suspense(<SchemaVisualizer/>) });
        }
        if (activeTools.includes("branches")) {
            views.push({ slug: "branches",
name: "Branches",
group: "Database",
icon: "GitBranch",
description: "Create and manage database branches",
view: suspense(<BranchesView/>) });
        }
        if (activeTools.includes("api")) {
            views.push({ slug: "api",
name: "API Explorer",
group: "API",
icon: "BookOpen",
description: "Interactive API documentation and testing",
view: suspense(<ApiExplorer/>) });
        }
        if (activeTools.includes("logs")) {
            views.push({ slug: "logs",
name: "Logs Explorer",
group: "Database",
icon: "Activity",
description: "Real-time system and query logs",
view: suspense(<LogsExplorer/>) });
        }
        // Note: "schema" tool is auto-injected by RebaseShell when collectionEditor is enabled.
        // It is NOT registered here anymore.
        return views;
    }, [tools]);

    // Use a ref for homePage so it never destabilizes the effect.
    // homePage is a React element — its identity doesn't matter for registration.
    const homePageRef = React.useRef(resolvedHomePage);
    homePageRef.current = resolvedHomePage;

    useLayoutEffect(() => {
        dispatch.registerStudio({ tools,
homePage: homePageRef.current,
devViews });
        return () => dispatch.unregisterStudio();
    }, [dispatch, tools, devViews]);

    return null;
}
