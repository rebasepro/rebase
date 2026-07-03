import type { SnapshotCollection, Property, PropertyConfig } from "@rebasepro/types";
import { AuthController } from "@rebasepro/types";
import { isPropertyBuilder } from "@rebasepro/common";
import { isReferenceProperty, isRelationProperty } from "./property_utils";

function isHiddenProperty(property: Property | undefined): boolean {
    if (!property) return false;
    return Boolean(property.ui?.hideFromCollection);
}

/**
 * Returns true when the property holds file-storage content (single image,
 * array of images, generic upload, …).  These properties are rendered by the
 * dedicated image-slot and should NOT appear as regular preview columns.
 */
function isStorageProperty(property: Property | undefined): boolean {
    if (!property) return false;
    // Single string with storage config
    if (property.type === "string" && property.storage) return true;
    // String displayed as image URL
    if (property.type === "string" && property.ui?.url === "image") return true;
    // Array whose inner element has storage config or image URL
    if (property.type === "array" && property.of && !Array.isArray(property.of)) {
        const inner = property.of;
        if (inner.type === "string" && (inner.storage || inner.ui?.url === "image")) return true;
    }
    return false;
}

export function getSnapshotPreviewKeys(
    authController: AuthController,
    targetCollection: SnapshotCollection<any>,
    fields: Record<string, PropertyConfig>,
    previewProperties?: string[],
    limit = 3) {
    const allProperties = Object.keys(targetCollection.properties);
    let listProperties = previewProperties?.filter(p => allProperties.includes(p as string));
    if (!listProperties && targetCollection.previewProperties) {
        listProperties = targetCollection.previewProperties?.filter(p => allProperties.includes(p as string));
    }
    if (listProperties && listProperties.length > 0) {
        return listProperties;
    } else {
        const hasExplicitOrder = !!(targetCollection.propertiesOrder as string[] | undefined);
        listProperties = (targetCollection.propertiesOrder as string[]) || allProperties;
        return listProperties
            .filter(key => {
                const prop = targetCollection.properties[key];
                const isIdProp = prop && typeof prop === "object" && "isId" in prop && Boolean((prop as { isId?: boolean }).isId);
                return !isIdProp && key !== "id";
            })
            .filter(key => {
                const property = targetCollection.properties[key];
                return property && !isPropertyBuilder(property) && !isReferenceProperty(property) && !isHiddenProperty(property)
                    && !isStorageProperty(property as Property)
                    && (hasExplicitOrder || !isRelationProperty(property));
            }).slice(0, limit);
    }
}

export function getSnapshotTitlePropertyKey<M extends Record<string, unknown>>(collection: SnapshotCollection<M>, propertyConfigs: Record<string, PropertyConfig>): string | undefined {
    if (collection.titleProperty) {
        return collection.titleProperty as string;
    }

    const hasExplicitOrder = !!(collection.propertiesOrder as string[] | undefined);
    const orderToSearch = (collection.propertiesOrder as string[]) || Object.keys(collection.properties);

    // If explicit propertiesOrder is set, allow the first non-ID relation or string to be the titleKey
    if (hasExplicitOrder) {
        for (const key of orderToSearch) {
            const property = collection.properties[key];
            if (property && !isPropertyBuilder(property)) {
                const prop = property as Property;
                const isIdProp = prop && typeof prop === "object" && "isId" in prop && Boolean((prop as { isId?: boolean }).isId);
                if (isIdProp || key === "id" || isHiddenProperty(prop)) {
                    continue;
                }
                if (prop.type === "relation" || prop.type === "string") {
                    return key;
                }
            }
        }
    }

    let firstStringCandidate: string | undefined;

    for (const key of orderToSearch) {
        const property = collection.properties[key];
        if (property && !isPropertyBuilder(property)) {
            const prop = property as Property;
            if (isHiddenProperty(prop)) {
                continue;
            }
            if (prop.type === "string" && !prop.ui?.multiline && !prop.ui?.markdown && !prop.storage && !prop.isId) {
                if (!firstStringCandidate) {
                    firstStringCandidate = key;
                }
                const lowerKey = key.toLowerCase();
                if (["name", "title", "label", "displayname", "username"].includes(lowerKey)) {
                    return key; // Immediate return if it's a strong title candidate
                }
            }
        }
    }
    return firstStringCandidate;
}

/**
 * Attempt to turn a title value (which might be a relation, reference, date, array, or other complex object)
 * into a renderable, human-readable string.
 */
export function resolveTitleToString(title: any): string {
    if (title === null || title === undefined) {
        return "";
    }

    if (typeof title !== "object") {
        return String(title);
    }

    // Check if it's a relation shape: { __type: "relation", id, path, data }
    if ("__type" in title && title.__type === "relation") {
        if (title.data && title.data.values) {
            const values = title.data.values;
            // Prioritize common title fields in eagerly loaded relation data
            for (const key of ["name", "title", "label", "displayName"]) {
                if (values[key] !== undefined && values[key] !== null) {
                    return String(values[key]);
                }
            }
            // Fallback: search for first short string value in values
            for (const val of Object.values(values)) {
                if (typeof val === "string" && val.length > 0 && val.length < 200) {
                    return val;
                }
            }
        }
        if (title.id !== undefined && title.id !== null) {
            return String(title.id);
        }
    }

    // Check if it's a reference shape: { isSnapshotReference() } or similar
    if ("isSnapshotReference" in title && typeof title.isSnapshotReference === "function" && title.isSnapshotReference()) {
        return String(title.id);
    }
    if ("id" in title && "path" in title && !("__type" in title)) {
        // Flat reference/relation-like object
        return String(title.id);
    }

    // Check if it's a Date
    if (title instanceof Date) {
        return title.toLocaleDateString();
    }

    // Check if it has a string/number property like name/title/label/id
    if ("name" in title && title.name !== undefined && title.name !== null && typeof title.name !== "object") {
        return String(title.name);
    }
    if ("title" in title && title.title !== undefined && title.title !== null && typeof title.title !== "object") {
        return String(title.title);
    }
    if ("label" in title && title.label !== undefined && title.label !== null && typeof title.label !== "object") {
        return String(title.label);
    }
    if ("id" in title && title.id !== undefined && title.id !== null && typeof title.id !== "object") {
        return String(title.id);
    }

    // Fallback: try converting to string, or JSON.stringify if it looks like a generic object
    try {
        const str = String(title);
        if (str !== "[object Object]") {
            return str;
        }
        return JSON.stringify(title);
    } catch {
        return "";
    }
}


