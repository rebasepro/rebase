import type { Property } from "@rebasepro/types";
import type { PropertyConfig, AdminCollection } from "@rebasepro/admin-types";
import { AuthController } from "@rebasepro/admin-types";
import { isPropertyBuilder } from "@rebasepro/common";
import { getTitlePropertyKey } from "@rebasepro/app";

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
    return Boolean(property.admin?.hideFromCollection);
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
    if (property.type === "string" && property.admin?.urlPreview === "image") return true;
    // Array whose inner element has storage config or image URL
    if (property.type === "array" && property.of && !Array.isArray(property.of)) {
        const inner = property.of;
        if (inner.type === "string" && (inner.storage || inner.admin?.urlPreview === "image")) return true;
    }
    return false;
}

export function getEntityPreviewKeys(
    authController: AuthController,
    targetCollection: AdminCollection<any>,
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

// Returned as-is rather than rebuilt per call, so the result is referentially
// stable and safe to use as a hook dependency.
const INCLUDE_ALL_RELATIONS: string[] = ["*"];

/**
 * The `include` params that eager-load a collection's relations in the same
 * request as its rows, so previews never fetch once per relation cell.
 *
 * Only the REST transport reads `include`; the realtime transport embeds
 * relation data unconditionally and ignores it. Passing it either way keeps a
 * realtime-less deployment rendering the same cells as a realtime one.
 */
export function getRelationIncludeParams(collection: AdminCollection<any>): string[] | undefined {
    if (!collection.properties) return undefined;
    const hasRelations = Object.values(collection.properties).some(property =>
        property && !isPropertyBuilder(property) &&
        (isRelationProperty(property as Property) || isReferenceProperty(property as Property)));
    return hasRelations ? INCLUDE_ALL_RELATIONS : undefined;
}

/**
 * The property that fills the title slot for a collection. Ranking lives in
 * `@rebasepro/common`, shared with the admin package so both agree on what an
 * entity is called.
 */
export function getEntityTitlePropertyKey<M extends Record<string, any>>(collection: AdminCollection<M>, propertyConfigs: Record<string, PropertyConfig>): string | undefined {
    return getTitlePropertyKey(collection as AdminCollection<Record<string, unknown>>);
}

