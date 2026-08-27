// Collection Editor — moved from @rebasepro/studio
// This module provides the visual schema/collection editor for the admin.
//
// IMPORTANT: Heavy UI components (CollectionEditorDialog, CollectionStudioView,
// CollectionsStudioView, PropertyForm, PropertyFormDialog) are NOT re-exported
// here to keep the main admin bundle lean. Import them from
// "@rebasepro/cms/collection_editor_ui" instead — they live in a separate chunk
// that is loaded on demand.


export {
    useCollectionEditorController
} from "./useCollectionEditorController";
export {
    useCollectionsConfigController
} from "./useCollectionsConfigController";
export {
    useLocalCollectionsConfigController
} from "./useLocalCollectionsConfigController";
export {
    useJsonCollectionsConfigController,
    type UseJsonCollectionsConfigControllerOptions,
} from "./useJsonCollectionsConfigController";

export {
    toSerializableCollectionConfig,
    toSerializableProperty,
    toSerializableProperties,
    fromSerializableCollectionConfig,
    fromSerializableCollectionConfigs,
    fromSerializableProperty,
    fromSerializableProperties,
} from "./serializable_utils";

export type {
    SerializableCollectionConfig,
    SerializableProperty,
    SerializableProperties,
    SerializableBaseProperty,
    SerializableStringProperty,
    SerializableNumberProperty,
    SerializableBooleanProperty,
    SerializableDateProperty,
    SerializableGeopointProperty,
    SerializableReferenceProperty,
    SerializableRelationProperty,
    SerializableArrayProperty,
    SerializableMapProperty,
    SerializableVectorProperty,
    SerializableBinaryProperty,
    SerializableStorageConfig,
    SerializableStringValidation,
    SerializableDateValidation,
    JsonCollectionStore,
} from "./serializable_types";

export type {
    PropertyTypePreset,
    PropertyType,
    CollectionEditorTab,
    CollectionEditorExtensionProps,
    ExtraPropertyFieldsParams,
    ExtraCollectionFieldsParams,
} from "./extensibility_types";

export {
    validateCollectionJson,
    type CollectionValidationError,
    type CollectionValidationResult
} from "./validateCollectionJson";

export type {
    CollectionsConfigController, DeleteCollectionParams, SaveCollectionParams, UpdateCollectionParams, CollectionsSetupInfo, UpdatePropertiesOrderParams, UpdateKanbanColumnsOrderParams
} from "./types/config_controller";
export type {
    CollectionEditorController
} from "./types/collection_editor_controller";

export type {
    CollectionInference
} from "./types/collection_inference";

export {
    buildCollectionGenerationCallback,
    CollectionGenerationApiError,
    DEFAULT_COLLECTION_GENERATION_ENDPOINT
} from "./api/generateCollectionApi";

export type {
    CollectionGenerationCallback,
    GenerateCollectionRequest,
    GenerateCollectionResult,
    CollectionOperation,
    CollectionOperationType,
    BuildCollectionGenerationCallbackProps
} from "./api/generateCollectionApi";

export { MissingReferenceWidget } from "./ui/MissingReferenceWidget";

export * from "./ui/collection_editor/util";

// Re-export types only from heavy UI components (runtime code is in the separate chunk)
export type { CollectionEditorDialogProps } from "./ui/collection_editor/CollectionEditorDialog";
export type { CollectionStudioViewProps } from "./ui/collection_editor/CollectionStudioView";
export type { CollectionsStudioViewProps } from "./ui/collection_editor/CollectionsStudioView";
export type { RouterCollectionStudioViewProps } from "./ui/collection_editor/RouterCollectionStudioView";
export type { RouterCollectionsStudioViewProps } from "./ui/collection_editor/RouterCollectionsStudioView";
export type { PropertyFormProps, OnPropertyChangedParams } from "./ui/collection_editor/PropertyEditView";
