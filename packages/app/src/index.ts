export * from "./core";
export * from "./hooks";
export * from "./auth";
export * from "./components";
export * from "./util";
export * from "./contexts";

// @internal — framework implementation details, exported only because
// @rebasepro/cms and @rebasepro/studio consume them. Named explicitly
// (not `export *`) so this file is the single place that grows or shrinks
// the internal surface — see the JSDoc on each symbol for details.
export { CONTAINER_FULL_WIDTH, FORM_CONTAINER_WIDTH, SIDE_PANEL_DEFAULT_WIDTH } from "./internal/common";
export { useRestoreScroll } from "./internal/useRestoreScroll";
// What a collection view re-reads on where its data source cannot subscribe.
export { useDataChangeVersion } from "./hooks/data/dataChanges";
// The admin's own data, in its `Entity` view model. An app reads and writes
// rows through `useRows`, `useRow`, `useRowWrites` and `context.data`.
export { useData } from "./hooks/data/useData";
export { useFetch, populateFetchCache } from "./hooks/data/useFetch";
export type { FetchResult } from "./hooks/data/useFetch";
export { useBatchedFetch } from "./hooks/data/useBatchedFetch";
export { useRelationSelector } from "./hooks/data/useRelationSelector";
export type { RelationItem } from "./hooks/data/useRelationSelector";
export { saveEntityWithCallbacks } from "./hooks/data/save";
export type { SaveEntityWithCallbacksProps } from "./hooks/data/save";
export { deleteEntityWithCallbacks } from "./hooks/data/delete";
// Between the admin's view model and the rows an app's code is handed.
export { toWireRow, fromWireRow } from "./util/wire_row";
export { rowOfEntity, entityOfRow } from "./util/entity_row";
// A collection view's table and selection, as an app's code is handed them.
export { tableControllerOf, rowSelectionOf, selectionControllerOf, entitySelectionControllerOf } from "./util/controller_rows";
export { useUnsavedChangesDialog } from "./hooks/useUnsavedChangesDialog";
export { NavigationBlockerProvider, useNavigationBlocker } from "./hooks/useNavigationBlocker";
export type { UnsavedChangesDialogProps } from "./components/UnsavedChangesDialog";
// The element type of the `storageSources` prop on `<Rebase>`. Anyone registering a
// direct-transport backend writes this shape by hand, and the docs have always told
// them to import it from here — it was simply never exported. Type-only, so it adds
// nothing to the bundle.
export type { RebaseStorageSource } from "./core/RebaseProps";
export { UnsavedChangesDialog } from "./components/UnsavedChangesDialog";
// The embed host `@rebasepro/cms`' MCP view sets and `<Rebase>`, `<RebaseCMS>`,
// `<RebaseShell>` and `<RebaseStudio>` read.
export { setRebaseEmbedHost, useRebaseEmbedHost } from "./core/embed_host";
export type { RebaseEmbedHost } from "./core/embed_host";
export * from "./i18n/RebaseI18nProvider";
// English only: it is the fallback table and the reference for every key. The
// other languages are chunks `RebaseI18nProvider` fetches on demand; a static
// re-export here would put one back on every login screen.
export * from "./locales/en";

// Studio Bridge — shared context for optional admin↔Studio integration
export * from "./hooks/useStudioBridge";

// Self-assembling bridge registration hook
export { useBridgeRegistration } from "./hooks/useBridgeRegistration";
export * from "./collections";
