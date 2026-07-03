export type { SnapshotViewProps } from "./SnapshotView";
export { SnapshotView } from "./SnapshotView";

export * from "./SnapshotDetailView";

export type { SnapshotSelectionProps } from "./ReferenceTable/SnapshotSelectionTable";
export { SnapshotSelectionTable } from "./ReferenceTable/SnapshotSelectionTable";

export * from "./SelectableTable/SelectableTable";
export * from "./SelectableTable/SelectableTableContext";
export * from "./SnapshotCollectionView/SnapshotCollectionView";
export * from "./SnapshotCollectionView/SnapshotCollectionViewActions";
export * from "./SnapshotCollectionView/SnapshotCollectionCardView";
export * from "./SnapshotCollectionView/SnapshotCard";
export * from "./SnapshotCollectionView/useSelectionController";

export * from "./PropertyConfigBadge";
export * from "./PropertyIdCopyTooltip";

export * from "./SnapshotCollectionTable";
// VirtualTable is exported from @rebasepro/ui
export * from "./ArrayContainer";
export * from "./ReferenceWidget";
export * from "./SearchIconsView";
export * from "./FieldCaption";
export * from "./SnapshotPreview";

// history is lazy-loaded by SnapshotEditView and resolutions.ts
// export * from "./history";
export * from "./common";
export * from "./field_configs";

export * from "./SideSnapshotProvider";
export * from "./AdminModeSyncer";
// Admin views: only CreationResultDialog remains (used by resetPasswordAction)
export * from "./app/AppBar";
export * from "./app/Drawer";
export * from "./app/Scaffold";
export * from "./DefaultAppBar";
export * from "./DefaultDrawer";
export * from "./DrawerNavigationItem";
export * from "./DrawerNavigationGroup";
// ContentHomePage is lazy-loaded by RebaseRouteDefs
// export * from "./HomePage/ContentHomePage";
export * from "./SideDialogs";

export * from "./app/useApp";
export * from "./RebaseCMS";
export * from "./RebaseShell";

// Composable shell layers — each independently usable
export * from "./RebaseAuthGate";
export * from "./RebaseNavigation";
export * from "./RebaseLayout";
export * from "./RebaseRouteDefs";

export * from "./CollectionPanel";
