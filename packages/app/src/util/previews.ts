import type { CollectionConfig, Property, PropertyConfig } from "@rebasepro/types";
import { AuthController } from "@rebasepro/types";
import { isPropertyBuilder } from "@rebasepro/common";

function isReferenceProperty(property: Property) {
    if (!property) return null;
    if (property.type === "reference") return true;
    if (property.type === "array") {
        if (Array.isArray(property.of)) return false;
        else return property.of?.type === "reference";
    }
    return false;
}

function isRelationProperty(property: Property) {
    if (!property) return null;
    if (property.type === "relation") return true;
    if (property.type === "array") {
        if (Array.isArray(property.of)) return false;
        else return property.of?.type === "relation";
    }
    return false;
}

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

export function getEntityPreviewKeys(
    authController: AuthController,
    targetCollection: CollectionConfig<any>,
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
        listProperties = (targetCollection.propertiesOrder as string[]) || allProperties;
        return listProperties
            .filter(key => {
                const prop = targetCollection.properties[key];
                const isIdProp = prop && typeof prop === "object" && "isId" in prop && Boolean((prop as { isId?: boolean }).isId);
                return !isIdProp && key !== "id";
            })
            .filter(key => {
                const property = targetCollection.properties[key];
                return property && !isPropertyBuilder(property) && !isReferenceProperty(property) && !isRelationProperty(property) && !isHiddenProperty(property) && !isStorageProperty(property as Property);
            }).slice(0, limit);
    }
}

export function getEntityTitlePropertyKey<M extends Record<string, any>>(collection: CollectionConfig<M>, propertyConfigs: Record<string, PropertyConfig>): string | undefined {
    if (collection.titleProperty) {
        return collection.titleProperty as string;
    }

    const orderToSearch = (collection.propertiesOrder as string[]) || Object.keys(collection.properties);
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

