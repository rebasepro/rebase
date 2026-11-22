// Collection Editor — moved from @rebasepro/studio
// This module provides the visual schema/collection editor for the admin.
//
// IMPORTANT: Heavy UI components (CollectionEditorDialog, CollectionStudioView,
// CollectionsStudioView, PropertyForm, PropertyFormDialog) are NOT re-exported
// here to keep the main admin bundle lean. Import them from
// "@rebasepro/cms/collection_editor_ui" instead — they live in a separate chunk
// that is loaded on demand.


export {
    useCollectionsConfigController
} from "./useCollectionsConfigController";
export {
    useLocalCollectionsConfigController
} from "./useLocalCollectionsConfigController";

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
} from "./serializable_types";

export type {
    CollectionsConfigController, DeleteCollectionParams, SaveCollectionParams, UpdateCollectionParams, CollectionsSetupInfo, UpdatePropertiesOrderParams, UpdateKanbanColumnsOrderParams, ImportedTable
} from "./types/config_controller";
