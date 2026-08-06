
import type { Properties } from "@rebasepro/types";
import type { MapProperty, Property } from "@rebasepro/types";
import type { PropertyConfig, AdminCollection } from "@rebasepro/admin-types";
import React from "react";

import { isPropertyBuilder } from "@rebasepro/common";
import {
    AlignLeftIcon,
    CalendarIcon,
    CircleIcon,
    FlagIcon,
    FunctionSquareIcon,
    GlobeIcon,
    HashIcon,
    iconSize,
    LinkIcon,
    MailIcon,
    RepeatIcon,
    Rows3Icon,
    TextIcon,
    UploadIcon,
    VoteIcon
} from "@rebasepro/ui";
import type { IconSize, LucideIcon } from "@rebasepro/ui";

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
 * Returns a default Lucide icon component based on property type.
 * This provides a sensible fallback when no PropertyConfig is available.
 */
function getDefaultIconForProperty(property: Property): LucideIcon {
    switch (property.type) {
        case "string": {
            if (property.storage) return UploadIcon;
            if (property.admin?.urlPreview) return GlobeIcon;
            if (property.email) return MailIcon;
            if (property.admin?.multiline || property.admin?.markdown) return AlignLeftIcon;
            return TextIcon;
        }
        case "number":
            return HashIcon;
        case "boolean":
            return FlagIcon;
        case "date":
            return CalendarIcon;
        case "map":
            return VoteIcon;
        case "array": {
            const of = property.of;
            const oneOf = property.oneOf;
            if (oneOf) return Rows3Icon;
            if (of && !Array.isArray(of)) {
                if (of.type === "reference") return LinkIcon;
                if (of.type === "string" && of.storage) return UploadIcon;
            }
            return RepeatIcon;
        }
        case "reference":
            return LinkIcon;
        case "relation":
            return LinkIcon;
        case "vector":
            return HashIcon;
        default:
            return CircleIcon;
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
            // A path whose root is not a property at all is simply not found.
            // Reading `.type` off the miss threw a TypeError instead, which
            // turned one unresolvable column key into a crash for whatever was
            // walking the properties — see `propertiesToColumns`, where that is
            // the whole table. `getPropertyInPath` above already guards this.
            const childProperty = properties[pathSegments[0]];
            if (childProperty?.type === "map" && childProperty.properties) {
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

export function getDefaultPropertiesOrder(collection: AdminCollection): string[] {
    if (collection.propertiesOrder) return collection.propertiesOrder;
    return [...Object.keys(collection.properties), ...(collection.additionalFields ?? []).map(field => field.key)];
}
