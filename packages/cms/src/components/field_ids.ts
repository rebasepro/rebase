import type { ArrayProperty, NumberProperty, Property, StringProperty } from "@rebasepro/types";
import { isPropertyBuilder } from "@rebasepro/common";

/**
 * The id of the widget a property is edited with, decided from the property
 * alone. Kept apart from `field_configs.tsx`, which maps those ids to the
 * field binding components: importing that module imports every binding, and
 * with them the entity form, so a caller that only needs the id — the AI
 * plugin asks it for every property on every page — paid for the whole form
 * on the login screen.
 */
export function getDefaultFieldId(property: Property) {
    if (property.type === "string") {
        if (property.admin?.markdown) {
            return "markdown";
        } else if (property.admin?.multiline) {
            return "multiline";
        } else if (property.storage) {
            return "file_upload";
        } else if (property.admin?.urlPreview) {
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
                // Genuinely unsupported — a relation is a join, not a value, so
                // there is nothing sensible to put in an array cell. But this
                // used to `throw`, and it is called during render: an array of
                // relations took down the whole property dialog with an error
                // boundary instead of showing which property was at fault.
                // Returning undefined routes it to the "no editor" notice.
                console.error(
                    "A `relation` cannot go inside an array — a relation is a join, not a stored value. " +
                    "Use a `reference` for an array of links, or declare a to-many relation on the collection.",
                    property
                );
                return undefined;
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
        // Was "text_field": a binary column rendered as a string input, and the
        // string widget's editor merges `type: "string"`, so touching the widget
        // silently changed the property's type.
        return "binary";
    } else if (property.type === "geopoint") {
        // Was missing entirely — this fell through to the console.error below,
        // returned undefined, and the field never rendered at all.
        return "geopoint";
    }

    console.error("Unsupported field config mapping", property);
    return undefined;
}

export function getFieldId(property: Property): string | undefined {
    if (property.propertyConfig)
        return property.propertyConfig;
    return getDefaultFieldId(property);
}
