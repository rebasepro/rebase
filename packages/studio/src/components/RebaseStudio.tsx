import React, { useLayoutEffect, useMemo } from "react";
import { useRebaseRegistryDispatch } from "@rebasepro/core";
import type { RebaseStudioConfig, AppView } from "@rebasepro/types";

import { SQLEditor } from "./SQLEditor/SQLEditor";
import { JSEditor } from "./JSEditor/JSEditor";
import { RLSEditor } from "./RLSEditor/RLSEditor";
import { StorageView } from "./StorageView/StorageView";
import { CronJobsView } from "./CronJobs/CronJobsView";
import { SchemaVisualizer } from "./SchemaVisualizer/SchemaVisualizer";
import { StudioHomePage } from "./StudioHomePage";

/**
 * Declarative component to configure the Studio in Rebase.
 * Renders nothing — purely registers config into the RebaseRegistry.
 *
 * The "schema" tool (collection editor view) is now a built-in CMS feature.
 * When `<RebaseCMS collectionEditor={...}>` is used, the schema view is
 * automatically injected into Studio — no manual wiring needed.
 */
const DEFAULT_HOME_PAGE = <StudioHomePage />;

export function RebaseStudio({ tools, homePage }: RebaseStudioConfig) {
    const dispatch = useRebaseRegistryDispatch();

    const resolvedHomePage = homePage ?? DEFAULT_HOME_PAGE;
    
    const devViews: AppView[] = useMemo(() => {
        const views: AppView[] = [];
        const activeTools = tools ?? ["sql", "js", "rls", "storage", "cron", "schema-visualizer"];
        
        if (activeTools.includes("sql")) {
            views.push({ slug: "sql", name: "SQL Console", group: "Database", icon: "terminal", description: "Execute SQL queries", view: <SQLEditor /> });
        }
        if (activeTools.includes("js")) {
            views.push({ slug: "js", name: "JS Console", group: "Database", icon: "code", description: "Execute JavaScript", view: <JSEditor /> });
        }
        if (activeTools.includes("rls")) {
            views.push({ slug: "rls", name: "RLS Policies", group: "Database", icon: "security", description: "Row Level Security", view: <RLSEditor /> });
        }
        if (activeTools.includes("storage")) {
            views.push({ slug: "storage", name: "Storage", group: "Storage", icon: "cloud", description: "Manage storage files", view: <StorageView /> });
        }
        if (activeTools.includes("cron")) {
            views.push({ slug: "cron", name: "Cron Jobs", group: "Automation", icon: "schedule", description: "Manage scheduled tasks", view: <CronJobsView /> });
        }
        if (activeTools.includes("schema-visualizer")) {
            views.push({ slug: "schema-visualizer", name: "Schema Visualizer", group: "Database", icon: "account_tree", description: "Interactive database ERD", view: <SchemaVisualizer /> });
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
        dispatch.registerStudio({ tools, homePage: homePageRef.current, devViews });
        return () => dispatch.unregisterStudio();
    }, [dispatch, tools, devViews]);

    return null;
}
