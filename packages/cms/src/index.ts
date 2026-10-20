// admin-specific types take priority over base types when names conflict
export * from "./types";
// Editor types only — the full ProseMirror editor (RichTextEditor) is a heavy import (~300 KB)
// and is available as a separate entry point: @rebasepro/cms/editor
export type { RichTextEditorProps, RichTextEditorTextSize, JSONContent, EditorAIController } from "./editor";
// The markdown field's AI controller, as a plugin gives it to a form (light: no editor import).
export { EditorAIControllerProvider, useProvidedEditorAIController } from "./contexts/EditorAIControllerContext";
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
    PropertyKeyHint,
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
    // The two rows the `Shell.DrawerNavigation*` overrides replace. Public so an
    // app can wrap the stock ones — pass different props, add a context — instead of
    // reimplementing a nav row and drifting from the framework's hover, active and
    // tooltip behaviour on the next release.
    DrawerNavigationItem,
    DrawerNavigationGroup,
    AdminModeSyncer,
    // ContentHomePage is lazy-loaded — not re-exported here
    RebaseCMS,
    RebaseShell,
    RebaseAuthGate,
    RebaseNavigation,
    RebaseLayout,
    RebaseRouteDefs,
    SideDialogs,
    useApp,
    CollectionPanel,
    CollectionsProvider,
    EntityFormPanel
} from "./components";
export type {
    EntityViewBindingProps,
    SelectionProps,
    SelectableTableProps,
    CollectionPanelProps,
    CollectionPanelOptions,
    CollectionsProviderProps,
    EntityFormPanelProps,
    DrawerNavigationGroupProps,
    DrawerNavigationItemProps
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
    // Property utilities (moved from @rebasepro/app — property-aware logic belongs in admin)
    isReferenceProperty,
    isRelationProperty,
    getIconForWidget,
    getIconForProperty,
    getPropertyInPath,
    getResolvedPropertyInPath,
    getBracketNotation,
    getPropertiesWithPropertiesOrder,
    getDefaultPropertiesOrder,
    // Preview utilities (moved from @rebasepro/app — property-aware logic belongs in admin)
    getEntityPreviewKeys,
    getEntityTitlePropertyKey,
    getEntityTitlePropertyKeyForEntity
} from "./util";

// Headless collection view adapters
// Map entity types to the data-agnostic CollectionView from @rebasepro/ui
export { mapPropertyToConfig, mapPropertiesToConfigs } from "./util/propertyConfigMapper";
export { useCollectionDataController, createStaticDataController } from "./util/dataControllerAdapter";

// Selecting rows across a paginated view: the banner and the select-all
// control, and `resolveSelection` — the only way to turn a query selection into
// the rows it stands for, which a custom collection action has to call.
export * from "./selection";

// Data import/export — merged from former standalone packages
export * from "./data_import";
export * from "./data_export";

// Collection editor — moved from @rebasepro/studio (admin-dependent visual schema editor)
export * from "./collection_editor";
export * from "./collection_editor/liveSchemaClient";
export * from "./collection_editor/useLiveSchemaEditing";
// `SchemaChangeDialog` is deliberately absent, like `CollectionEditorDialog`
// and `PropertyFormDialog` beside it: re-exporting it from the barrel puts it
// back in the eager bundle and undoes the `lazyChunk` in `useLiveSchemaEditing`.
// It is reachable from `@rebasepro/cms/collection_editor_ui`, with the other
// two — this used to say "import it by path", which named no path and had none
// to name.


export { CreationResultDialog } from "./components/admin/CreationResultDialog";

// Leaf parts of overridable components, public so a copy of the component
// compiles in a user's project with package imports only (see
// tooling/scripts/report-override-copyability.mjs). `HomePage.CollectionCard`
// is drawn with the two cards; `Collection.FilterField` falls back to the
// per-type fields, which a custom filter can reuse for the types it leaves alone.
export { NavigationCard } from "./components/HomePage/NavigationCard";
export type { NavigationCardProps } from "./components/HomePage/NavigationCard";
export { SmallNavigationCard } from "./components/HomePage/SmallNavigationCard";
export type { SmallNavigationCardProps } from "./components/HomePage/SmallNavigationCard";
export { StringNumberFilterField } from "./components/SelectableTable/filters/StringNumberFilterField";
export { BooleanFilterField } from "./components/SelectableTable/filters/BooleanFilterField";
export { DateTimeFilterField } from "./components/SelectableTable/filters/DateTimeFilterField";
export { ReferenceFilterField } from "./components/SelectableTable/filters/ReferenceFilterField";
export { RelationFilterField } from "./components/SelectableTable/filters/RelationFilterField";
export { getDatePropertyMode, getDatePropertyTimezone } from "./preview/util";

// The drawer's open state as a subscription: a drawer provides it, and a nav
// row reads it to mask its tooltip once the label shows, without re-rendering
// on every hover of the rail.
export { DrawerExpansionContext, useDrawerExpansion, useDrawerExpandedWhile } from "./components/drawer_expansion";
export type { DrawerExpansion } from "./components/drawer_expansion";
// The group an entry with no `group` falls under; a group header labels it.
export { NAVIGATION_DEFAULT_GROUP_NAME } from "./hooks/navigation/utils";

// The collection toolbar: whether it has room for labels, and the collection
// editor's gear, which a copy of `Collection.Actions` keeps beside its own.
export { CollectionTableToolbar, useToolbarLabels } from "./components/CollectionTableBinding/internal/CollectionTableToolbar";
export type { CollectionTableToolbarProps } from "./components/CollectionTableBinding/internal/CollectionTableToolbar";
export { EditorCollectionAction } from "./collection_editor/ui/EditorCollectionAction";

// The table's cells and columns, for a copy of `Collection.Table`: the frame
// every cell sits in, a property's cell, an `additionalFields` value, and the
// columns a collection's properties make.
export type { CollectionTableBindingProps } from "./components/CollectionTableBinding/CollectionTableBindingProps";
export { EntityTableCell } from "./components/CollectionTableBinding/internal/EntityTableCell";
export type { EntityTableCellProps, EntityTableCellOpener } from "./components/CollectionTableBinding/internal/EntityTableCell";
export { PropertyTableCell } from "./components/CollectionTableBinding/PropertyTableCell";
export type { PropertyTableCellProps } from "./components/CollectionTableBinding/PropertyTableCell";
export { AdditionalFieldValue } from "./components/AdditionalFieldValue";
export type { AdditionalFieldValueProps } from "./components/AdditionalFieldValue";
export { propertiesToColumns } from "./components/CollectionTableBinding/column_utils";
export type { PropertiesToColumnsParams } from "./components/CollectionTableBinding/column_utils";
export type { CustomFieldValidator } from "./form/validation";

// What fills a record's title, image, status and date slots, and how a slot is
// drawn — the same answer on every card, row and preview of a collection.
export { resolveCollectionSlotKeys, useCollectionSlotKeys, useEntitySlots } from "./components/CollectionViewBinding/usePreviewSlots";
export type {
    CollectionSlotKeys,
    EntityPreviewSlots,
    PreviewSlot,
    DatePreviewSlot,
    RelationChipSlot,
    RelationChipItem
} from "./components/CollectionViewBinding/usePreviewSlots";
export { SlotValue, TagChips } from "./components/CollectionViewBinding/SlotValue";
export type { SlotValueProps } from "./components/CollectionViewBinding/SlotValue";
export { useEntityTitle } from "./hooks/useEntityDisplay";
export type { UseEntityDisplayParams, ResolvedDisplayValue } from "./hooks/useEntityDisplay";
// Why a row is in a search's results: the terms marked in what it shows, and
// the match in a field it does not.
export { useSearchExplanation, MatchExplanation, fieldLabel } from "./components/CollectionViewBinding/SearchExplanation";
export { Highlighted } from "./components/CollectionViewBinding/SearchHighlight";

// A preview inside another collapses to a chip; a copy of `EntityPreview`
// marks its children so references below it do too.
export { NestedEntityPreviewBoundary } from "./components/EntityPreviewNesting";
export type { EntityPreviewLayout } from "./components/EntityPreviewNesting";
export { isEmptyPreviewValue } from "./preview/util";

// A record's actions, drawn the way the record's bar and the rows draw them,
// and what a form needs from the side dialog it sits in and the list it is in.
export { unlinkEntityAction } from "./components/common/default_entity_actions";
export { entityActionName, resolveEntityActionState } from "./util/entity_actions";
export type { EntityActionState } from "./util/entity_actions";
export { useSideDialogContext } from "./components/SideDialogs";
export type { SideDialogController } from "./components/SideDialogs";
export { useChildViewSource } from "./hooks/useChildViewSource";

// The record views `Entity.SidePanel` switches between: the edit view, and
// the `DetailView` override's default.
export { EditViewBinding } from "./components/EditViewBinding";
export type { EditViewBindingProps } from "./components/EditViewBinding";
export { DetailViewBinding } from "./components/DetailViewBinding";
export type { DetailViewBindingProps } from "./components/DetailViewBinding";

// The home page's sections, for a home page of your own: the
// `HomePage.CollectionCard` default, a group of cards, the favourites row.
export { NavigationCardBinding } from "./components/HomePage/NavigationCardBinding";
export { NavigationGroup } from "./components/HomePage/NavigationGroup";
export { FavouritesView } from "./components/HomePage/FavouritesView";

