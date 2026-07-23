// CMS-specific types take priority over base types when names conflict
export * from "./types";
// Editor types only — the full ProseMirror editor (RichTextEditor) is a heavy import (~300 KB)
// and is available as a separate entry point: @rebasepro/admin/editor
export type { RichTextEditorProps, RichTextEditorTextSize, JSONContent, EditorAIController } from "./editor";
export * from "./form";
export * from "./preview";
export * from "./routes";

// Components — explicitly listed to avoid conflicts with ./types re-exports
export {
    EntityViewBinding,
    SelectionTableBinding,
    SelectableTable,
    SelectableTableContext,
    CollectionViewBinding,
    CollectionViewActions,
    CollectionCardViewBinding,
    EntityCardBinding,
    useSelectionController,
    PropertyConfigBadge,
    PropertyIdCopyTooltip,
    CollectionTableBinding,
    CollectionRowActions,
    VirtualTableInput,
    ArrayContainer,
    type ArrayEntryParams,
    ReferenceWidget,
    SearchIconsView,
    FieldCaption,
    EntityPreviewBinding,
    getFieldConfig,
    getFieldId,
    getDefaultFieldConfig,
    getDefaultFieldId,
    DEFAULT_FIELD_CONFIGS,
    editEntityAction,
    copyEntityAction,
    deleteEntityAction,
    resetPasswordAction,
    SidePanelProvider,
    Scaffold,
    AppBar,
    Drawer,
    DefaultDrawer,
    DrawerFooterActions,
    AdminModeSyncer,
    // ContentHomePage is lazy-loaded — not re-exported here
    RebaseAdmin,
    RebaseShell,
    RebaseAuthGate,
    RebaseNavigation,
    RebaseLayout,
    RebaseRouteDefs,
    SideDialogs,
    useApp,
    CollectionPanel
} from "./components";
export type {
    EntityViewBindingProps,
    SelectionProps,
    SelectableTableProps,
    CollectionPanelProps
} from "./components";

export * from "./hooks";
// Util
export {
    addInitialSlash,
    removeInitialSlash,
    removeTrailingSlash,
    removeInitialAndTrailingSlashes,
    getLastSegment,
    getCollectionBySlugWithin,
    getCollectionPathsCombinations,
    resolveCollectionPathIds,
    mergeEntityActions,
    resolveEntityAction,
    resolveEntityView,
    // Property utilities (moved from @rebasepro/app — property-aware logic belongs in CMS)
    isReferenceProperty,
    isRelationProperty,
    getIconForWidget,
    getIconForProperty,
    getPropertyInPath,
    getResolvedPropertyInPath,
    getBracketNotation,
    getPropertiesWithPropertiesOrder,
    getDefaultPropertiesOrder,
    // Preview utilities (moved from @rebasepro/app — property-aware logic belongs in CMS)
    getEntityPreviewKeys,
    getEntityTitlePropertyKey,
    getEntityTitlePropertyKeyForEntity
} from "./util";

// Headless collection view adapters
// Map entity types to the data-agnostic CollectionView from @rebasepro/ui
export { mapPropertyToConfig, mapPropertiesToConfigs } from "./util/propertyConfigMapper";
export { useCollectionDataController, createStaticDataController } from "./util/dataControllerAdapter";

// Data import/export — merged from former standalone packages
export * from "./data_import";
export * from "./data_export";

// Collection editor — moved from @rebasepro/studio (CMS-dependent visual schema editor)
export * from "./collection_editor";


export { CreationResultDialog } from "./components/admin/CreationResultDialog";

