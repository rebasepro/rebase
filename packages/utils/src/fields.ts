

/** Every `PropertyConfigId` in `@rebasepro/cms-types` (`types/property_config.tsx`): keep the two lists equal. */
export function isDefaultFieldConfigId(id: string): boolean {
    return ["text_field",
        "multiline",
        "markdown",
        "url",
        "email",
        "user_select",
        "switch",
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
        "date_time",
        "group",
        "key_value",
        "repeat",
        "custom_array",
        "block",
        "vector_input",
        "geopoint",
        "binary"
    ].includes(id);
}
