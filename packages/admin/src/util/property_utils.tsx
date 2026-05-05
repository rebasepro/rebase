
import type { Properties } from "@rebasepro/types";
import type { EntityCollection, MapProperty, Property, PropertyConfig } from "@rebasepro/types";
import React from "react";

import { isPropertyBuilder } from "@rebasepro/common";
import { iconSize } from "@rebasepro/ui";
import type { IconSize } from "@rebasepro/ui";
import { CircleIcon, FlagIcon, FunctionSquareIcon, GlobeIcon, TextIcon, Rows3Icon, LinkIcon, VoteIcon, MailIcon, HashIcon, RepeatIcon, CalendarIcon, AlignLeftIcon, UploadIcon } from "lucide-react";

/**
 * Resolve a size value (string token or number) to a numeric pixel value
 * suitable for passing to Lucide icons.
 */
function resolveSize(size: IconSize | number): number {
    if (typeof size === "number") return size;
    return iconSize[size];
}

export function isReferenceProperty(property: Property) {

    if (!property) return null;
    if (property.type === "reference") {
        return true;
    }
    if (property.type === "array") {
        if (Array.isArray(property.of)) return false;
        else return property.of?.type === "reference"
    }
    return false;
}

export function isRelationProperty(property: Property) {
    if (!property) return null;
    if (property.type === "relation") {
        return true;
    }
    if (property.type === "array") {
        if (Array.isArray(property.of)) return false;
        else return property.of?.type === "relation"
    }
    return false;
}

export function getIconForWidget(widget: PropertyConfig | undefined,
    size: IconSize | number) {
    const Icon = widget?.Icon ?? CircleIcon;
    const px = resolveSize(size);
    return <Icon size={px}/>;
}

/**
 * Returns a default icon component based on property type.
 * This provides a sensible fallback when no PropertyConfig is available.
 */
function getDefaultIconForProperty(property: Property): React.ComponentType<{ size: number }> {
    switch (property.type) {
        case "string": {
            if (property.storage) return UploadIcon as any;
            if (property.url) return GlobeIcon as any;
            if (property.email) return MailIcon as any;
            if (property.multiline || property.markdown) return AlignLeftIcon as any;
            if (property.reference) return LinkIcon as any;
            return TextIcon as any;
        }
        case "number":
            return HashIcon as any;
        case "boolean":
            return FlagIcon as any;
        case "date":
            return CalendarIcon as any;
        case "map":
            return VoteIcon as any;
        case "array": {
            const of = property.of;
            const oneOf = property.oneOf;
            if (oneOf) return Rows3Icon as any;
            if (of && !Array.isArray(of)) {
                if (of.type === "reference") return LinkIcon as any;
                if (of.type === "string" && of.storage) return UploadIcon as any;
            }
            return RepeatIcon as any;
        }
        case "reference":
            return LinkIcon as any;
        case "relation":
            return LinkIcon as any;
        default:
            return CircleIcon as any;
    }
}

export function getIconForProperty(
    property: Property,
    size: IconSize | number = "small",
    fields: Record<string, PropertyConfig> = {}
): React.ReactNode {
    const px = resolveSize(size);

    if (isPropertyBuilder(property)) {
        return <FunctionSquareIcon size={px}/>;
    }

    // Try to look up a custom PropertyConfig icon first
    const configId = property.propertyConfig || undefined;
    const widget = configId ? fields[configId] : undefined;
    if (widget?.Icon) {
        return getIconForWidget(widget, size);
    }

    // Fall back to a type-based default icon
    const Icon = getDefaultIconForProperty(property);
    return <Icon size={px}/>;
}

/**
 * Get a property in a property tree from a path like
 * `address.street`
 * @param properties
 * @param path
 */
export function getPropertyInPath(properties: Properties, path: string): Property | undefined {
    if (typeof properties === "object") {
        if (path in properties) {
            return (properties as Record<string, Property>)[path];
        }
        if (path.includes(".")) {
            const pathSegments = path.split(".");
            const childProperty = (properties as Record<string, Property>)[pathSegments[0]];
            if (typeof childProperty === "object" && childProperty.type === "map" && childProperty.properties) {
                return getPropertyInPath(childProperty.properties, pathSegments.slice(1).join("."))
            }
        }
    }
    return undefined;
}

export function getResolvedPropertyInPath(properties: Record<string, Property>, path: string): Property | undefined {
    if (typeof properties === "object") {
        if (path in properties) {
            return properties[path];
        }
        if (path.includes(".")) {
            const pathSegments = path.split(".");
            const childProperty = properties[pathSegments[0]];
            if (childProperty.type === "map" && childProperty.properties) {
                return getResolvedPropertyInPath(childProperty.properties, pathSegments.slice(1).join("."))
            }
        }
    }
    return undefined;
}

// replace the dot notation with brackets
// address.street => address[street]
export function getBracketNotation(path: string): string {
    return path.replace(/\.([^.]*)/g, "[$1]");
}

/**
 * Get properties sorted by their order, but include ALL properties.
 * Nested keys (like "data.mode") in propertiesOrder are ignored - they're for column ordering.
 * @param properties
 * @param propertiesOrder
 */
export function getPropertiesWithPropertiesOrder(properties: Properties, propertiesOrder?: string[]): Properties {
    if (!propertiesOrder) return properties;

    const propertyKeys = Object.keys(properties);

    // Filter propertiesOrder to only include top-level keys (no dots) that exist
    const validOrderKeys = (propertiesOrder as string[]).filter(
        key => !key.includes(".") && properties[key]
    );

    const result: Properties = {};

    // First add properties in the specified order
    validOrderKeys.forEach(key => {
        const property = properties[key];
        if (typeof property === "object" && property.type === "map" && (property as MapProperty).properties) {
            const mapProp = property as MapProperty;
            result[key] = {
                ...mapProp,
                properties: getPropertiesWithPropertiesOrder(mapProp.properties!, mapProp.propertiesOrder ?? [])
            } as Property;
        } else if (property) {
            result[key] = property;
        }
    });

    // Then add any missing properties (so they don't disappear!)
    propertyKeys.forEach(key => {
        if (!result[key]) {
            const property = properties[key];
            if (typeof property === "object" && property.type === "map" && (property as MapProperty).properties) {
                const mapProp = property as MapProperty;
                result[key] = {
                    ...mapProp,
                    properties: getPropertiesWithPropertiesOrder(mapProp.properties!, mapProp.propertiesOrder ?? [])
                } as Property;
            } else if (property) {
                result[key] = property;
            }
        }
    });

    return result;
}

export function getDefaultPropertiesOrder(collection: EntityCollection): string[] {
    if (collection.propertiesOrder) return collection.propertiesOrder;
    return [...Object.keys(collection.properties), ...(collection.additionalFields ?? []).map(field => field.key)];
}
