// ─── Bridge ─────────────────────────────────────────────────────────
// Re-export the Studio Bridge from @rebasepro/app.
// The bridge lives in core so both studio and admin can access it
// without circular dependencies.
export {
    StudioBridgeProvider,
    StudioBridgeContext,
    useStudioCollectionRegistry,
    useStudioSidePanelController,
    useStudioUrlController,
    useStudioNavigationState,
    useStudioBreadcrumbs
} from "@rebasepro/app";
export type {
    StudioBridge,
    BreadcrumbEntry,
    BreadcrumbsController
} from "@rebasepro/app";

// ─── Studio Entry Point ─────────────────────────────────────────────
// Only export the lightweight orchestrator & home page.
// Individual tools (SQLEditor, JSEditor, RLSEditor, StorageView, etc.)
// are lazy-loaded by RebaseStudio.tsx — DO NOT re-export them here
// or they'll be pulled into the main bundle, defeating code splitting.
export * from "./components/RebaseStudio";
export * from "./components/StudioHomePage";

// ─── The tools themselves are not importable ────────────────────────
// This used to recommend `@rebasepro/studio/components/SQLEditor/SQLEditor`,
// which is not a path this package exports: following it fails at resolution
// with ERR_PACKAGE_PATH_NOT_EXPORTED, and there is nothing to configure that
// would make it work.
//
// Nor should there be. A tool is reached by opening it — `RebaseStudio`
// registers a route per tool and lazy-loads the chunk when that route is
// visited, and an importable `SQLEditor` would put Monaco in the initial
// bundle of anyone who touched it. To ship a tool of your own beside them,
// pass an `AppView` to `<RebaseStudio devViews>`.
