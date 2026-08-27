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
export { useUnsavedChangesDialog } from "./hooks/useUnsavedChangesDialog";
export { NavigationBlockerProvider, useNavigationBlocker } from "./hooks/useNavigationBlocker";
export type { UnsavedChangesDialogProps } from "./components/UnsavedChangesDialog";
// The element type of the `storageSources` prop on `<Rebase>`. Anyone registering a
// direct-transport backend writes this shape by hand, and the docs have always told
// them to import it from here — it was simply never exported. Type-only, so it adds
// nothing to the bundle.
export type { RebaseStorageSource } from "./core/RebaseProps";
export { UnsavedChangesDialog } from "./components/UnsavedChangesDialog";
export * from "./i18n/RebaseI18nProvider";
export * from "./locales/en";
export * from "./locales/es";

// Studio Bridge — shared context for optional admin↔Studio integration
export * from "./hooks/useStudioBridge";

// Self-assembling bridge registration hook
export { useBridgeRegistration } from "./hooks/useBridgeRegistration";
export * from "./collections";
