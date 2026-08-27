import React, { Suspense, useLayoutEffect, useMemo } from "react";
import { useRebaseRegistryDispatch } from "@rebasepro/app";
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

export function RebaseStudio({ tools, homePage }: RebaseStudioConfig) {
    const dispatch = useRebaseRegistryDispatch();

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
        if (activeTools.includes("backups")) {
            views.push({ slug: "backups",
name: "Backups",
group: "Database",
icon: "Database",
description: "Download database backups",
view: suspense(<BackupsView/>) });
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
        if (activeTools.includes("api-keys")) {
            views.push({ slug: "api-keys",
name: "API Keys",
group: "Access Control",
icon: "KeyRound",
description: "Create and manage scoped API keys",
view: suspense(<ApiKeysView/>) });
        }
        // Note: "schema" tool is auto-injected by RebaseShell when collectionEditor is enabled.
        // It is NOT registered here anymore.
        return views;
        // Keyed by the tool list's *contents*; see `toolsKey`. `tools` itself is
        // read inside, and is exactly determined by the key.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [toolsKey]);

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
devViews });
        return () => dispatch.unregisterStudio();
    }, [dispatch, devViews]);

    return null;
}
