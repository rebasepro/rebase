export type { EntityViewBindingProps } from "./EntityViewBinding";
export { EntityViewBinding } from "./EntityViewBinding";

export type { EntityDisplayHeaderProps } from "./EntityDisplayHeader";
export { EntityDisplayHeader, HEADER_DISPLAY_ROLES } from "./EntityDisplayHeader";

export * from "./DetailViewBinding";

export type { SelectionProps } from "./ReferenceTable/SelectionTableBinding";
export { SelectionTableBinding } from "./ReferenceTable/SelectionTableBinding";

export * from "./SelectableTable/SelectableTable";
export * from "./SelectableTable/SelectableTableContext";
export * from "./SelectableTable/filters/FilterFieldBinding";
export * from "./CollectionViewBinding/CollectionViewBinding";
export * from "./CollectionViewBinding/CollectionViewActions";
export * from "./CollectionViewBinding/CollectionCardViewBinding";
export * from "./CollectionViewBinding/EntityCardBinding";
export * from "./CollectionViewBinding/useSelectionController";

export * from "./PropertyConfigBadge";
export * from "./PropertyIdCopyTooltip";

export * from "./CollectionTableBinding";
// VirtualTable is exported from @rebasepro/ui
export * from "./ArrayContainer";
export * from "./ReferenceWidget";
export * from "./SearchIconsView";
export * from "./FieldCaption";
export * from "./EntityPreviewBinding";
export * from "./EntityPreviewNesting";
export * from "./InlineEntityPreview";

// history is lazy-loaded by EditViewBinding and resolutions.ts
// export * from "./history";
export * from "./common";
export * from "./field_configs";

export * from "./SidePanelProvider";
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
