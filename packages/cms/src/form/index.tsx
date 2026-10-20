export { EntityForm } from "./EntityForm";
export type { EntityFormProps, OnUpdateParams } from "../types/components/EntityFormProps";

export { EntityFormBinding } from "./EntityFormBinding";
export type { EntityFormBindingProps } from "./EntityFormBinding";

export { SelectFieldBinding } from "./field_bindings/SelectFieldBinding";
export { MultiSelectFieldBinding } from "./field_bindings/MultiSelectFieldBinding";
export { ArrayOfReferencesFieldBinding } from "./field_bindings/ArrayOfReferencesFieldBinding";
export { StorageUploadFieldBinding } from "./field_bindings/StorageUploadFieldBinding";
export { TextFieldBinding } from "./field_bindings/TextFieldBinding";
export { SwitchFieldBinding } from "./field_bindings/SwitchFieldBinding";
export { DateTimeFieldBinding } from "./field_bindings/DateTimeFieldBinding";
export { ReferenceFieldBinding } from "./field_bindings/ReferenceFieldBinding";
export { MapFieldBinding } from "./field_bindings/MapFieldBinding";
export { KeyValueFieldBinding } from "./field_bindings/KeyValueFieldBinding";
export { RepeatFieldBinding } from "./field_bindings/RepeatFieldBinding";
export { BlockFieldBinding } from "./field_bindings/BlockFieldBinding";
export { ReadOnlyFieldBinding } from "./field_bindings/ReadOnlyFieldBinding";
export { MarkdownEditorFieldBinding } from "./field_bindings/MarkdownEditorFieldBinding";
export { ArrayCustomShapedFieldBinding } from "./field_bindings/ArrayCustomShapedFieldBinding";
export { VectorFieldBinding } from "./field_bindings/VectorFieldBinding";

export * from "./components";

export { PropertyFieldBinding } from "./PropertyFieldBinding";
export * from "./useClearRestoreValue";

// Shared form utilities
export {
    extractTouchedValues,
    removeEmptyContainers,
    getChanges,
    getInitialEntityValues,
    zodToFormErrors,
    // What `EntityFormBinding` opens with and keeps: the link a child created
    // from its parent's tab takes, and the edit it carries or backs up, whole.
    // A copy of `Entity.Form` that rebuilt these would bring back the drafts
    // that resurrected deleted items.
    getParentLinkValues,
    getTouchedPropertyValues,
    getUnappliedLocalChanges,
    overlayEdit
} from "./form_utils";
