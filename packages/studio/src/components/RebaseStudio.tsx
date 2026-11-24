import React, { Suspense, useLayoutEffect, useMemo } from "react";
import { useRebaseEmbedHost, useRebaseRegistryDispatch, useTranslation, type AppView, type RebaseStudioConfig } from "@rebasepro/app";
import { CircularProgressCenter, lazyChunk } from "@rebasepro/ui";

// Lazy-loaded studio tools — each fetched only when its route is visited.
// This keeps Monaco, @xyflow/react, dagre, pgsql-ast-parser etc. out of the initial bundle.
const SchemaDiagramView = lazyChunk(() => import("./SchemaVisualizer/SchemaDiagramView").then(m => ({ default: m.SchemaDiagramView })));
const TableEditorView = lazyChunk(() => import("./TableEditor/TableEditorView").then(m => ({ default: m.TableEditorView })));
const SQLEditor = lazyChunk(() => import("./SQLEditor/SQLEditorRoute").then(m => ({ default: m.SQLEditorRoute })));
const JSEditor = lazyChunk(() => import("./JSEditor/JSEditor").then(m => ({ default: m.JSEditor })));
const RLSEditor = lazyChunk(() => import("./RLSEditor/RLSEditor").then(m => ({ default: m.RLSEditor })));
const StorageView = lazyChunk(() => import("./StorageView/StorageView").then(m => ({ default: m.StorageView })));
const CronJobsView = lazyChunk(() => import("./CronJobs/CronJobsView").then(m => ({ default: m.CronJobsView })));
const BranchesView = lazyChunk(() => import("./Branches/BranchesView").then(m => ({ default: m.BranchesView })));
const BackupsView = lazyChunk(() => import("./Backups/BackupsView").then(m => ({ default: m.BackupsView })));
const ApiExplorer = lazyChunk(() => import("./ApiExplorer/ApiExplorer").then(m => ({ default: m.ApiExplorer })));
const WebhooksView = lazyChunk(() => import("./Webhooks/WebhooksView").then(m => ({ default: m.WebhooksView })));
const LogsExplorer = lazyChunk(() => import("./LogsExplorer/LogsExplorer").then(m => ({ default: m.LogsExplorer })));
const UsersAndRolesView = lazyChunk(() => import("./UsersAndRoles/UsersAndRolesView").then(m => ({ default: m.UsersAndRolesView })));
const ApiKeysView = lazyChunk(() => import("./ApiKeys/ApiKeysView").then(m => ({ default: m.ApiKeysView })));
const DatabaseView = lazyChunk(() => import("./Database/DatabaseView").then(m => ({ default: m.DatabaseView })));

import { StudioHomePage } from "./StudioHomePage";

/**
 * Declarative component to configure the Studio in Rebase.
 * Renders nothing — purely registers config into the RebaseRegistry.
 */
const DEFAULT_HOME_PAGE = <StudioHomePage/>;


/**
 * Studio: the developer tools, registered beside the admin.
 *
 * Not in an embedding (an MCP App view, `embed_host.ts` in `@rebasepro/app`):
 * there the app is shown to the person it runs as, and Studio's tools change
 * the project.
 */
export function RebaseStudio(props: RebaseStudioConfig) {
    const embed = useRebaseEmbedHost();
    return embed ? null : <RebaseStudioRegistration {...props}/>;
}

function RebaseStudioRegistration({ tools, homePage, devViews: extraViews }: RebaseStudioConfig) {
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
        const activeTools = tools ?? ["tables", "sql", "js", "rls", "storage", "cron", "schema-visualizer", "branches", "backups", "database", "api", "webhooks", "logs", "users", "api-keys"];
        const suspense = (el: React.ReactNode) => <Suspense fallback={<CircularProgressCenter/>}>{el}</Suspense>;
        const hasTables = activeTools.includes("tables");

        if (hasTables) {
            views.push({ slug: "tables",
name: t("studio_tool_tables"),
group: "Database",
icon: "Table",
description: t("studio_tool_tables_description"),
view: suspense(<TableEditorView/>) });
        }
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
        // With the Tables view, the schema diagram is one of its modes, so this
        // stays out of the navigation (its route still answers old links).
        // Without it — a host that does not serve the table editor — it is a
        // tool of its own.
        if (activeTools.includes("schema-visualizer")) {
            views.push({ slug: "schema-visualizer",
name: t("studio_tool_schema_visualizer"),
group: "Database",
icon: "Network",
hideFromNavigation: hasTables,
description: t("studio_tool_schema_visualizer_description"),
view: suspense(<SchemaDiagramView linksToTables={hasTables}/>) });
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
        if (activeTools.includes("database")) {
            views.push({ slug: "database",
name: t("studio_tool_database"),
group: "Database",
icon: "ServerCog",
description: t("studio_tool_database_description"),
view: suspense(<DatabaseView/>) });
        }
        if (activeTools.includes("api")) {
            views.push({ slug: "api",
name: t("studio_tool_api"),
group: "API",
icon: "BookOpen",
description: t("studio_tool_api_description"),
view: suspense(<ApiExplorer/>) });
        }
        if (activeTools.includes("webhooks")) {
            views.push({ slug: "webhooks",
name: t("studio_tool_webhooks"),
group: "API",
icon: "Webhook",
description: t("studio_tool_webhooks_description"),
view: suspense(<WebhooksView/>) });
        }
        // Filed under API, not Database: the server's log carries every source
        // it serves (api, auth, storage, realtime, system), not only queries.
        if (activeTools.includes("logs")) {
            views.push({ slug: "logs",
name: t("studio_tool_logs"),
group: "API",
icon: "Activity",
description: t("studio_tool_logs_description"),
view: suspense(<LogsExplorer/>) });
        }
        if (activeTools.includes("users")) {
            views.push({ slug: "users",
name: t("studio_tool_users"),
group: "Access Control",
icon: "Users",
description: t("studio_tool_users_description"),
view: suspense(<UsersAndRolesView/>) });
        }
        if (activeTools.includes("api-keys")) {
            views.push({ slug: "api-keys",
name: t("studio_tool_api_keys"),
group: "Access Control",
icon: "KeyRound",
description: t("studio_tool_api_keys_description"),
view: suspense(<ApiKeysView/>) });
        }
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
