import { DEFAULT_FIELD_CONFIGS } from "../../../../components/field_configs";
import { PropertyConfigId, PropertyConfig } from "@rebasepro/cms-types";

export const supportedFieldsIds: PropertyConfigId[] = [
    "text_field",
    "multiline",
    "markdown",
    "url",
    "email",
    "user_select",
    "select",
    "multi_select",
    "number_input",
    "number_select",
    "multi_number_select",
    "file_upload",
    "multi_file_upload",
    "reference",
    "multi_references",
    "relation",
    "switch",
    "date_time",
    "group",
    "key_value",
    "repeat",
    "block",
    // These three have a field binding and a property editor, and were simply
    // never added to the picker — so a property of the type rendered correctly
    // once it existed, but there was no way to create one from the UI.
    "vector_input",
    "geopoint",
    "binary"
];

export const supportedFields: Record<string, PropertyConfig> = Object.entries(DEFAULT_FIELD_CONFIGS)
    .filter(([id]) => supportedFieldsIds.includes(id as PropertyConfigId))
    .map(([id, config]) => ({ [id]: config }))
    .reduce((a, b) => ({ ...a,
...b }), {});
