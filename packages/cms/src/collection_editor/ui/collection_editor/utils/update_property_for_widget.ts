import { ArrayProperty, BooleanProperty, DateProperty, MapProperty, NumberProperty, Property, StringProperty } from "@rebasepro/types";
import { PropertyConfig } from "@rebasepro/cms-types";
import { mergeDeep } from "@rebasepro/utils";


export function updatePropertyFromWidget(propertyData: any,
    selectedWidgetId: string | undefined,
    propertyConfigs: Record<string, PropertyConfig>): Property {

    let updatedProperty;
    if (selectedWidgetId === "text_field") {
        updatedProperty = mergeDeep(
            propertyData,
            {
                type: "string",
                propertyConfig: "text_field",
                storage: undefined,
                admin: { multiline: undefined, markdown: undefined, urlPreview: undefined },
                email: undefined,
                enum: undefined,
                userSelect: undefined
            } as StringProperty
        );
    } else if (selectedWidgetId === "user_select") {
        updatedProperty = mergeDeep(
            propertyData,
            {
                type: "string",
                propertyConfig: "user_select",
                storage: undefined,
                admin: { multiline: undefined, markdown: undefined, urlPreview: undefined },
                email: undefined,
                enum: undefined,
                userSelect: true
            } as StringProperty
        );
    } else if (selectedWidgetId === "multiline") {
        updatedProperty = mergeDeep(
            propertyData,
            {
                type: "string",
                propertyConfig: "multiline",
                admin: { multiline: true, markdown: undefined, urlPreview: undefined },
                storage: undefined,
                email: undefined,
                enum: undefined,
                userSelect: undefined
            } as StringProperty
        );
    } else if (selectedWidgetId === "markdown") {
        updatedProperty = mergeDeep(
            propertyData,
            {
                type: "string",
                propertyConfig: "markdown",
                storage: undefined,
                admin: { multiline: undefined, markdown: true, urlPreview: undefined },
                email: undefined,
                userSelect: undefined
            } as StringProperty
        );
    } else if (selectedWidgetId === "url") {
        updatedProperty = mergeDeep(
            propertyData,
            {
                type: "string",
                propertyConfig: "url",
                storage: undefined,
                url: true,
                admin: { multiline: undefined, markdown: undefined },
                email: undefined,
                enum: undefined,
                userSelect: undefined
            } as StringProperty
        );
    } else if (selectedWidgetId === "email") {
        updatedProperty = mergeDeep(
            propertyData,
            {
                type: "string",
                propertyConfig: "email",
                storage: undefined,
                admin: { multiline: undefined, markdown: undefined, urlPreview: undefined },
                email: true,
                enum: undefined,
                userSelect: undefined
            } as StringProperty
        );
    } else if (selectedWidgetId === "select") {
        updatedProperty = mergeDeep(
            propertyData,
            {
                type: "string",
                propertyConfig: "select",
                storage: undefined,
                admin: { multiline: undefined, markdown: undefined, urlPreview: undefined },
                email: undefined,
                enum: propertyData.enum ?? [],
                userSelect: undefined
            } as StringProperty
        );
    } else if (selectedWidgetId === "multi_select") {
        updatedProperty = mergeDeep(
            propertyData,
            {
                type: "array",
                propertyConfig: "multi_select",
                of: {
                    type: "string",
                    enum: propertyData.of?.enum ?? []
                }
            } as ArrayProperty
        );
    } else if (selectedWidgetId === "number_input") {
        updatedProperty = mergeDeep(
            propertyData,
            {
                type: "number",
                propertyConfig: "number_input",
                enum: undefined
            } as NumberProperty
        );
    } else if (selectedWidgetId === "number_select") {
        updatedProperty = mergeDeep(
            propertyData,
            {
                type: "number",
                propertyConfig: "number_select",
                enum: propertyData.enum ?? []
            } as NumberProperty
        );
    } else if (selectedWidgetId === "multi_number_select") {
        updatedProperty = mergeDeep(
            propertyData,
            {
                type: "array",
                propertyConfig: "multi_number_select",
                of: {
                    type: "number",
                    enum: propertyData.of?.enum ?? []
                }
            } as ArrayProperty
        );
    } else if (selectedWidgetId === "file_upload") {
        updatedProperty = mergeDeep(
            propertyData,
            {
                type: "string",
                propertyConfig: "file_upload",
                storage: {
                    storagePath: "/"
                }
            } as StringProperty
        );
    } else if (selectedWidgetId === "multi_file_upload") {
        updatedProperty = mergeDeep(
            propertyData,
            {
                type: "array",
                propertyConfig: "multi_file_upload",
                of: {
                    type: "string",
                    storage: propertyData.of?.storage ?? {
                        storagePath: "/"
                    }
                }
            } as ArrayProperty
        );
    } else if (selectedWidgetId === "group") {
        updatedProperty = mergeDeep(
            propertyData,
            {
                type: "map",
                propertyConfig: "group",
                keyValue: false,
                properties: propertyData.properties ?? {}
            } as MapProperty
        );
    } else if (selectedWidgetId === "key_value") {
        updatedProperty = mergeDeep(
            propertyData,
            {
                type: "map",
                propertyConfig: "key_value",
                keyValue: true,
                properties: undefined
            } as MapProperty
        );
    } else if (selectedWidgetId === "reference") {
        updatedProperty = mergeDeep(
            propertyData,
            {
                type: "reference",
                propertyConfig: "reference"
            } as unknown as Property
        );
    } else if (selectedWidgetId === "multi_references") {
        updatedProperty = mergeDeep(
            propertyData,
            {
                type: "array",
                propertyConfig: "multi_references",
                of: {
                    type: "reference"
                }
            } as ArrayProperty
        );
    } else if (selectedWidgetId === "switch") {
        updatedProperty = mergeDeep(
            propertyData,
            {
                type: "boolean",
                propertyConfig: "switch"
            } as BooleanProperty
        );
    } else if (selectedWidgetId === "date_time") {
        updatedProperty = mergeDeep(
            propertyData,
            {
                type: "date",
                propertyConfig: "date_time",
                mode: "date_time"
            } as DateProperty
        );
    } else if (selectedWidgetId === "relation") {
        updatedProperty = mergeDeep(
            propertyData,
            {
                type: "relation",
                propertyConfig: "relation",
                relationName: propertyData.relationName ?? ""
            } as unknown as Property
        );
    } else if (selectedWidgetId === "repeat") {
        updatedProperty = mergeDeep(
            propertyData,
            {
                type: "array",
                propertyConfig: "repeat"
            } as ArrayProperty
        );
    } else if (selectedWidgetId === "block") {
        updatedProperty = mergeDeep(
            propertyData,
            {
                type: "array",
                propertyConfig: "block",
                oneOf: {
                    properties: {}
                }
            } as ArrayProperty
        );
    } else if (selectedWidgetId && propertyConfigs[selectedWidgetId]) {
        // Every widget without a branch of its own — vector, geopoint, binary,
        // and any registered custom one — takes its shape from the config.
        //
        // The identity fields are carried across explicitly. This used to
        // return the config's property alone, which dropped the name, the
        // description and the column mapping: switching an existing property to
        // one of these widgets silently blanked its label. The branches above
        // all merge onto `propertyData`; this one did not.
        //
        // Only those three are kept, not a full merge: the point of changing
        // widget is to change type, and a `defaultValue` or `enum` left over
        // from the previous type is not valid for the new one.
        updatedProperty = {
            ...propertyConfigs[selectedWidgetId].property,
            propertyConfig: selectedWidgetId,
            ...(propertyData?.name !== undefined ? { name: propertyData.name } : {}),
            ...(propertyData?.description !== undefined ? { description: propertyData.description } : {}),
            ...(propertyData?.columnName !== undefined ? { columnName: propertyData.columnName } : {})
        };
    }

    return updatedProperty;
}
