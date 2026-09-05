// Collection Editor UI — separate entry point for dynamic import / code splitting.
// This file is the target of dynamic import() calls from CollectionEditorDialogs.tsx
// so that the heavy collection editor UI code is split into its own chunk.

export { CollectionEditorDialog } from "./collection_editor/ui/collection_editor/CollectionEditorDialog";
export type { CollectionEditorDialogProps } from "./collection_editor/ui/collection_editor/CollectionEditorDialog";

export { PropertyFormDialog, PropertyForm } from "./collection_editor/ui/collection_editor/PropertyEditView";
export type { PropertyFormProps, OnPropertyChangedParams } from "./collection_editor/ui/collection_editor/PropertyEditView";

export { CollectionStudioView } from "./collection_editor/ui/collection_editor/CollectionStudioView";
export type { CollectionStudioViewProps } from "./collection_editor/ui/collection_editor/CollectionStudioView";

export { CollectionsStudioView } from "./collection_editor/ui/collection_editor/CollectionsStudioView";
export type { CollectionsStudioViewProps } from "./collection_editor/ui/collection_editor/CollectionsStudioView";

export { RouterCollectionStudioView } from "./collection_editor/ui/collection_editor/RouterCollectionStudioView";
export type { RouterCollectionStudioViewProps } from "./collection_editor/ui/collection_editor/RouterCollectionStudioView";

export { RouterCollectionsStudioView } from "./collection_editor/ui/collection_editor/RouterCollectionsStudioView";
export type { RouterCollectionsStudioViewProps } from "./collection_editor/ui/collection_editor/RouterCollectionsStudioView";

// The plan/apply dialog. Reachable here for the same reason as the two above:
// the barrel would put it back in the eager bundle and undo the `lazyChunk` in
// `useLiveSchemaEditing`, and `index.ts` used to say "import it by path" about
// a path that did not exist.
export { SchemaChangeDialog } from "./collection_editor/ui/collection_editor/SchemaChangeDialog";
export type { SchemaChangeDialogProps } from "./collection_editor/ui/collection_editor/SchemaChangeDialog";
