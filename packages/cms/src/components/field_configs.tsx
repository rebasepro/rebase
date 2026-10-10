
import type { DefaultFieldConfig } from "../types/fields";
import type { Property } from "@rebasepro/types";
import type { PropertyConfig } from "@rebasepro/cms-types";
import { ArrayCustomShapedFieldBinding } from "../form/field_bindings/ArrayCustomShapedFieldBinding";
import { ArrayOfReferencesFieldBinding } from "../form/field_bindings/ArrayOfReferencesFieldBinding";
import { BlockFieldBinding } from "../form/field_bindings/BlockFieldBinding";
import { DateTimeFieldBinding } from "../form/field_bindings/DateTimeFieldBinding";
import { KeyValueFieldBinding } from "../form/field_bindings/KeyValueFieldBinding";
import { MapFieldBinding } from "../form/field_bindings/MapFieldBinding";
import { MarkdownEditorFieldBinding } from "../form/field_bindings/MarkdownEditorFieldBinding";
import { MultiSelectFieldBinding } from "../form/field_bindings/MultiSelectFieldBinding";
import { ReferenceFieldBinding } from "../form/field_bindings/ReferenceFieldBinding";
import { RepeatFieldBinding } from "../form/field_bindings/RepeatFieldBinding";
import { SelectFieldBinding } from "../form/field_bindings/SelectFieldBinding";
import { StorageUploadFieldBinding } from "../form/field_bindings/StorageUploadFieldBinding";
import { SwitchFieldBinding } from "../form/field_bindings/SwitchFieldBinding";
import { TextFieldBinding } from "../form/field_bindings/TextFieldBinding";
import { VectorFieldBinding } from "../form/field_bindings/VectorFieldBinding";
import { GeopointFieldBinding } from "../form/field_bindings/GeopointFieldBinding";
import { BinaryFieldBinding } from "../form/field_bindings/BinaryFieldBinding";

import {
    AlignLeftIcon,
    CalendarIcon,
    FlagIcon,
    FolderUpIcon,
    GlobeIcon,
    HashIcon,
    LinkIcon,
    ListIcon,
    ListOrderedIcon,
    MailIcon,
    QuoteIcon,
    RepeatIcon,
    Rows3Icon,
    TextIcon,
    UploadIcon,
    UserCheckIcon,
    UserIcon,
    VoteIcon
} from "@rebasepro/ui";
import { RelationFieldBinding } from "../form/field_bindings/RelationFieldBinding";
import { UserSelectFieldBinding } from "../form/field_bindings/UserSelectFieldBinding";
import { mergeDeep } from "@rebasepro/utils";
// Which widget a property gets is decided without the widgets: those two
// functions live in a module that imports no field binding, so code that only
// asks (the AI plugin, the import mapper) does not pull every field binding —
// and through them the whole entity form — into its bundle.
import { getDefaultFieldId, getFieldId } from "./field_ids";

export { getDefaultFieldId, getFieldId };

/**
 * Every `Field` below is a getter on purpose — do not inline it back to
 * `Field: SomeBinding`.
 *
 * This module and the field bindings form an import cycle: we import the
 * bindings, the container bindings (map, repeat, block, custom-shaped array)
 * import `PropertyFieldBinding` to render their children, and that imports
 * `getFieldConfig` from here. Enter the cycle at a binding rather than here and
 * this object is built while that binding's module is still initialising.
 *
 * As a plain value the binding would be read at that moment. It happens to
 * survive today only because every binding is declared `export function`, which
 * hoists; rewriting a single one as `export const` would make the read a
 * temporal dead zone ReferenceError at import time, surfacing as a blank screen
 * far from its cause. The getter defers the read to first access, long after
 * every module has initialised, so declaration style stops mattering.
 */
export const DEFAULT_FIELD_CONFIGS: Record<DefaultFieldConfig, PropertyConfig> = {
    text_field: {
        key: "text_field",
        name: "Text field",
        description: "Simple short text",
        Icon: TextIcon,
        color: "#2d7ff9",
        property: {
            type: "string",
            admin: { get Field() { return TextFieldBinding; } }
        }
    },
    multiline: {
        key: "multiline",
        name: "Multiline",
        description: "Text with multiple lines",
        Icon: AlignLeftIcon,
        color: "#2d7ff9",
        property: {
            type: "string",
            admin: { multiline: true,
get Field() { return TextFieldBinding; } }
        }
    },
    markdown: {
        key: "markdown",
        name: "Markdown",
        description: "Text with advanced markdown syntax",
        Icon: QuoteIcon,
        color: "#2d7ff9",
        property: {
            type: "string",
            admin: { markdown: true,
get Field() { return MarkdownEditorFieldBinding; } }
        }
    },
    url: {
        key: "url",
        name: "Url",
        description: "Text with URL validation",
        Icon: GlobeIcon,
        color: "#154fb3",
        property: {
            type: "string",
            url: true,
            admin: { get Field() { return TextFieldBinding; } }
        }
    },
    email: {
        key: "email",
        name: "Email",
        description: "Text with email validation",
        Icon: MailIcon,
        color: "#154fb3",
        property: {
            type: "string",
            email: true,
            admin: { get Field() { return TextFieldBinding; } }
        }
    },
    switch: {
        key: "switch",
        name: "Switch",
        description: "Boolean true or false field (or yes or no, 0 or 1...)",
        Icon: FlagIcon,
        color: "#20d9d2",
        property: {
            type: "boolean",
            admin: { get Field() { return SwitchFieldBinding; } }
        }
    },
    select: {
        key: "select",
        name: "Select/enum",
        description: "Select one text value from within an enumeration",
        Icon: ListIcon,
        color: "#4223c9",
        property: {
            type: "string",
            enum: [],
            admin: { get Field() { return SelectFieldBinding; } }
        }
    },
    multi_select: {
        key: "multi_select",
        name: "Multi select (enum)",
        description: "Select multiple text values from within an enumeration",
        Icon: ListIcon,
        color: "#4223c9",
        property: {
            type: "array",
            of: {
                type: "string",
                enum: []
            },
            admin: { get Field() { return MultiSelectFieldBinding; } }
        }
    },
    user_select: {
        key: "user_select",
        name: "User select",
        description: "Select a user from the user management system. Store the user ID.",
        Icon: UserIcon,
        property: {
            type: "string",
            admin: { get Field() { return UserSelectFieldBinding; } }
        }
    },
    number_input: {
        key: "number_input",
        name: "Number input",
        description: "Simple number field with validation",
        Icon: HashIcon,
        color: "#bec920",
        property: {
            type: "number",
            admin: { get Field() { return TextFieldBinding; } }
        }
    },
    number_select: {
        key: "number_select",
        name: "Number select",
        description: "Select a number value from within an enumeration",
        Icon: ListOrderedIcon,
        color: "#bec920",
        property: {
            type: "number",
            enum: [],
            admin: { get Field() { return SelectFieldBinding; } }
        }
    },
    multi_number_select: {
        key: "multi_number_select",
        name: "Multiple number select",
        description: "Select multiple number values from within an enumeration",
        Icon: ListOrderedIcon,
        color: "#bec920",
        property: {
            type: "array",
            of: {
                type: "number",
                enum: []
            },
            admin: { get Field() { return MultiSelectFieldBinding; } }
        }
    },
    file_upload: {
        key: "file_upload",
        name: "File upload",
        description: "Input for uploading single files",
        Icon: UploadIcon,
        color: "#f92d9a",
        property: {
            type: "string",
            storage: {
                storagePath: "{path}"
            },
            admin: { get Field() { return StorageUploadFieldBinding; } }
        }
    },
    multi_file_upload: {
        key: "multi_file_upload",
        name: "Multiple file upload",
        description: "Input for uploading multiple files",
        Icon: FolderUpIcon,
        color: "#f92d9a",
        property: {
            type: "array",
            of: {
                type: "string",
                storage: {
                    storagePath: "{path}"
                }
            },
            admin: { get Field() { return StorageUploadFieldBinding; } }
        }
    },
    reference: {
        key: "reference",
        name: "Reference",
        description: "The value refers to a different collection (it is saved as a reference)",
        Icon: LinkIcon,
        color: "#ff0042",
        property: {
            type: "reference",
            admin: { get Field() { return ReferenceFieldBinding; } }
        }
    },
    multi_references: {
        key: "multi_references",
        name: "Multiple references",
        description: "Multiple values that refer to a different collection",
        Icon: LinkIcon,
        color: "#ff0042",
        property: {
            type: "array",
            of: {
                type: "reference"
            },
            admin: { get Field() { return ArrayOfReferencesFieldBinding; } }
        }
    },
    relation: {
        key: "relation",
        name: "Relation",
        description: "Multiple values that refer to a different collection",
        Icon: LinkIcon,
        color: "#ff0042",
        property: {
            // relationName now lives on the link
            // relationName: "",
            type: "relation",
            admin: { get Field() { return RelationFieldBinding; } }
        }
    },
    date_time: {
        key: "date_time",
        name: "Date/time",
        description: "A date time select field",
        Icon: CalendarIcon,
        color: "#8b46ff",
        property: {
            type: "date",
            admin: { get Field() { return DateTimeFieldBinding; } }
        }
    },
    group: {
        key: "group",
        name: "Group",
        description: "Group of multiple fields",
        Icon: VoteIcon,
        color: "#ff9408",
        property: {
            type: "map",
            properties: {},
            admin: { get Field() { return MapFieldBinding; } }
        }
    },
    key_value: {
        key: "key_value",
        name: "Key-value",
        description: "Flexible field that allows the user to add multiple key-value pairs",
        Icon: VoteIcon,
        color: "#ff9408",
        property: {
            type: "map",
            keyValue: true,
            admin: { get Field() { return KeyValueFieldBinding; } }
        }
    },
    repeat: {
        key: "repeat",
        name: "Repeat/list",
        description: "A field that gets repeated multiple times (e.g. multiple text fields)",
        Icon: RepeatIcon,
        color: "#ff9408",
        property: {
            type: "array",
            of: {
                type: "string"
            },
            admin: { get Field() { return RepeatFieldBinding; } }
        }
    },
    custom_array: {
        key: "custom_array",
        name: "Custom array",
        description: "A field that saved its value as an array of custom objects",
        Icon: RepeatIcon,
        color: "#ff9408",
        property: {
            type: "array",
            admin: { get Field() { return ArrayCustomShapedFieldBinding; } }
        }
    },
    block: {
        key: "block",
        name: "Block",
        description: "A complex field that allows the user to compose different fields together, with a key/value format",
        Icon: Rows3Icon,
        color: "#ff9408",
        property: {
            type: "array",
            oneOf: {
                properties: {}
            },
            admin: { get Field() { return BlockFieldBinding; } }
        }
    },
    vector_input: {
        key: "vector_input",
        name: "Vector input",
        description: "Vector array for embeddings",
        Icon: HashIcon,
        color: "#bec920",
        property: {
            type: "vector",
            dimensions: 1536,
            admin: { get Field() { return VectorFieldBinding; } }
        }
    },
    geopoint: {
        key: "geopoint",
        name: "Location",
        description: "A latitude and longitude",
        Icon: GlobeIcon,
        color: "#3f9e5c",
        property: {
            type: "geopoint",
            admin: { get Field() { return GeopointFieldBinding; } }
        }
    },
    binary: {
        key: "binary",
        name: "Binary",
        description: "Base64-encoded bytes",
        Icon: HashIcon,
        color: "#7a6ff0",
        property: {
            type: "binary",
            admin: { get Field() { return BinaryFieldBinding; } }
        }
    }
};

export function getDefaultFieldConfig(property: Property): PropertyConfig | undefined {
    const fieldId = getDefaultFieldId(property);
    if (!fieldId) {
        console.error("No field id found for property", property);
        return undefined;
    }
    return DEFAULT_FIELD_CONFIGS[fieldId];
}

export function getFieldConfig(property: Property, propertyConfigs: Record<string, PropertyConfig>): PropertyConfig | undefined {
    const fieldId = getFieldId(property);
    const defaultFieldId = getDefaultFieldId(property);
    if (!defaultFieldId) {
        console.error("No field id found for property", property);
        return undefined;
    }
    const defaultFieldConfig = defaultFieldId ? DEFAULT_FIELD_CONFIGS[defaultFieldId] : undefined;
    const customField = fieldId && propertyConfigs ? propertyConfigs[fieldId] : undefined;
    return mergeDeep(defaultFieldConfig ?? {}, customField ?? {} as PropertyConfig);
}

