
import type { DefaultFieldConfig } from "../types/fields";
import type { ArrayProperty, NumberProperty, Property, PropertyConfig, StringProperty, VectorProperty } from "@rebasepro/types";
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
import { isPropertyBuilder } from "@rebasepro/common";

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

export const DEFAULT_FIELD_CONFIGS: Record<DefaultFieldConfig, PropertyConfig> = {
    text_field: {
        key: "text_field",
        name: "Text field",
        description: "Simple short text",
        Icon: TextIcon,
        color: "#2d7ff9",
        property: {
            type: "string",
            ui: { Field: TextFieldBinding }
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
            ui: { multiline: true,
Field: TextFieldBinding }
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
            ui: { markdown: true,
Field: MarkdownEditorFieldBinding }
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
            ui: { url: true,
Field: TextFieldBinding }
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
            ui: { Field: TextFieldBinding }
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
            ui: { Field: SwitchFieldBinding }
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
            ui: { Field: SelectFieldBinding }
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
            ui: { Field: MultiSelectFieldBinding }
        }
    },
    user_select: {
        key: "user_select",
        name: "User select",
        description: "Select a user from the user management system. Store the user ID.",
        Icon: UserIcon,
        property: {
            type: "string",
            ui: { Field: UserSelectFieldBinding }
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
            ui: { Field: TextFieldBinding }
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
            ui: { Field: SelectFieldBinding }
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
            ui: { Field: MultiSelectFieldBinding }
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
            ui: { Field: StorageUploadFieldBinding }
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
            ui: { Field: StorageUploadFieldBinding }
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
            ui: { Field: ReferenceFieldBinding }
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
            ui: { Field: ArrayOfReferencesFieldBinding }
        }
    },
    relation: {
        key: "relation",
        name: "Relation",
        description: "Multiple values that refer to a different collection",
        Icon: LinkIcon,
        color: "#ff0042",
        property: {
            relationName: "",
            type: "relation",
            ui: { Field: RelationFieldBinding }
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
            ui: { Field: DateTimeFieldBinding }
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
            ui: { Field: MapFieldBinding }
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
            ui: { Field: KeyValueFieldBinding }
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
            ui: { Field: RepeatFieldBinding }
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
            ui: { Field: ArrayCustomShapedFieldBinding }
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
            ui: { Field: BlockFieldBinding }
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
            ui: { Field: VectorFieldBinding }
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

export function getDefaultFieldId(property: Property) {
    if (property.type === "string") {
        if (property.ui?.markdown) {
            return "markdown";
        } else if (property.ui?.multiline) {
            return "multiline";
        } else if (property.storage) {
            return "file_upload";
        } else if (property.ui?.url) {
            return "url";
        } else if (property.email) {
            return "email";
        } else if (property.enum) {
            return "select";
        } else if (property.userSelect) {
            return "user_select";
        } else {
            return "text_field";
        }
    } else if (property.type === "number") {
        if (property.enum) {
            return "number_select";
        }
        return "number_input";
    } else if (property.type === "map") {
        if (property.keyValue)
            return "key_value";
        return "group";
    } else if (property.type === "array") {
        const of = (property as ArrayProperty).of;
        const oneOf = (property as ArrayProperty).oneOf;
        if (oneOf) {
            return "block";
        } else if (Array.isArray(of)) {
            return "custom_array";
        } else if (isPropertyBuilder(of)) {
            return "repeat";
        } else if (of) {
            const ofProperty = of as Property;
            if (ofProperty.type === "string" && (ofProperty as StringProperty).enum) {
                return "multi_select";
            } else if (ofProperty.type === "number" && (ofProperty as NumberProperty).enum) {
                return "multi_number_select";
            } else if (ofProperty.type === "string" && (ofProperty as StringProperty).storage) {
                return "multi_file_upload";
            } else if (ofProperty.type === "reference") {
                return "multi_references";
            } else if (of?.type === "relation") {
                throw new Error("The 'relation' type is not supported inside arrays. Use 'reference' instead.");
            } else {
                return "repeat";
            }
        } else {
            return "repeat";
        }
    } else if (property.type === "boolean") {
        return "switch";
    } else if (property.type === "date") {
        return "date_time";
    } else if (property.type === "relation") {
        return "relation";
    } else if (property.type === "reference") {
        return "reference";
    } else if (property.type === "vector") {
        return "vector_input";
    } else if (property.type === "binary") {
        return "text_field";
    }

    console.error("Unsupported field config mapping", property);
    return undefined;
}

export function getFieldId(property: Property): string | undefined {
    if (property.propertyConfig)
        return property.propertyConfig;
    return getDefaultFieldId(property);
}
