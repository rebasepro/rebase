// ─── Bridge ─────────────────────────────────────────────────────────
// Re-export the Studio Bridge from @rebasepro/app.
// The bridge lives in core so both studio and CMS can access it
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

// ─── Direct tool imports (for advanced usage) ───────────────────────
// Consumers that need direct access to a tool should use deep imports:
//   import { SQLEditor } from "@rebasepro/studio/components/SQLEditor/SQLEditor";
// This avoids pulling all tools into their bundle.
