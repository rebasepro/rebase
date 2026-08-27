/**
 * Maps a Rebase `Property` (from @rebasepro/types) to a `CollectionPropertyConfig`
 * (from @rebasepro/ui), stripping all entity-specific fields and keeping only
 * the UI-relevant subset.
 *
 * This is the bridge between the entity-aware and headless layers.
 */

import type { Property, Properties, EnumValues, EnumValueConfig } from "@rebasepro/types";
import type { CollectionPropertyConfig, CollectionEnumValueConfig } from "@rebasepro/ui";

/**
 * Map Rebase property types to headless-supported types.
 * `vector` and `binary` are not directly renderable, so we fall back to `string`.
 */
const TYPE_MAP: Record<string, CollectionPropertyConfig["type"]> = {
    string: "string",
    number: "number",
    boolean: "boolean",
    date: "date",
    geopoint: "geopoint",
    reference: "reference",
    relation: "relation",
    array: "array",
    map: "map",
    vector: "string",   // vectors display as text
    binary: "string",   // binary displays as text
};

/**
 * Convert a single Property to a CollectionPropertyConfig.
 */
export function mapPropertyToConfig(property: Property): CollectionPropertyConfig {
    const base: CollectionPropertyConfig = {
        type: TYPE_MAP[property.type] ?? "string",
        name: property.name,
        description: property.description,
        columnWidth: property.admin?.columnWidth,
        hideFromCollection: property.admin?.hideFromCollection,
    };

    // String-specific
    if (property.type === "string") {
        if (property.enum) {
            base.enum = mapEnumValues(property.enum);
        }
        if (property.admin?.multiline) base.multiline = true;
        if (property.admin?.previewAsTag) base.previewAsTag = true;
        if (property.admin?.urlPreview) base.url = property.admin.urlPreview;
        if (property.admin?.markdown) base.markdown = true;
        if (property.storage) base.storage = true;
        if (property.email) base.email = true;
    }

    // Number-specific
    if (property.type === "number" && property.enum) {
        base.enum = mapEnumValues(property.enum);
    }

    // Array-specific
    if (property.type === "array" && property.of && !Array.isArray(property.of)) {
        base.of = mapPropertyToConfig(property.of);
    }

    // Map-specific
    if (property.type === "map" && property.properties) {
        base.properties = mapPropertiesToConfigs(property.properties);
        if (property.propertiesOrder) {
            base.propertiesOrder = property.propertiesOrder;
        }
    }

    // Date-specific
    if (property.type === "date" && property.mode) {
        base.mode = property.mode;
    }

    // Custom preview component
    if (property.admin?.Preview) {
        // The connected wrapper will handle this by injecting via cellRenderer override
        // We don't copy it here because Preview may reference entity-aware components
    }

    return base;
}

/**
 * Convert a Properties record to a CollectionPropertyConfig record.
 */
export function mapPropertiesToConfigs(
    properties: Properties
): Record<string, CollectionPropertyConfig> {
    const result: Record<string, CollectionPropertyConfig> = {};
    for (const [key, property] of Object.entries(properties)) {
        result[key] = mapPropertyToConfig(property);
    }
    return result;
}

/**
 * Convert Rebase EnumValues to CollectionEnumValueConfig format.
 * Handles both array form (EnumValueConfig[]) and record form.
 */
function mapEnumValues(
    enumValues: EnumValues | undefined
): Record<string, CollectionEnumValueConfig> | Map<string | number, CollectionEnumValueConfig> | undefined {
    if (!enumValues) return undefined;

    // Array form: EnumValueConfig[]
    if (Array.isArray(enumValues)) {
        const result: Record<string, CollectionEnumValueConfig> = {};
        for (const item of enumValues) {
            result[String(item.id)] = normalizeEnumValueConfig(item);
        }
        return result;
    }

    // Record form: Record<string | number, string | EnumValueConfig>
    const result: Record<string, CollectionEnumValueConfig> = {};
    for (const [key, value] of Object.entries(enumValues)) {
        result[key] = typeof value === "string"
            ? value
            : normalizeEnumValueConfig(value);
    }
    return result;
}

function normalizeEnumValueConfig(config: EnumValueConfig): CollectionEnumValueConfig {
    return {
        label: config.label,
        color: typeof config.color === "string" ? config.color : undefined,
        disabled: config.disabled,
    };
}
