import { CollectionConfig } from "@rebasepro/types";
import type { AdminCollection } from "@rebasepro/admin-types";
import { getDisplayPropertyKey } from "./entity-display";

/**
 * The property that fills a record's image slot.
 *
 * `admin.display.image` first, then six fallbacks in descending confidence —
 * the first image-typed storage property, an array of them, a URL rendered as an
 * image, and so on. The ladder stays for collections that say nothing; a
 * collection that names its picture is not guessed at.
 */
export function getEntityImagePreviewPropertyKey<M extends Record<string, unknown>>(collection: CollectionConfig<M>): string | undefined {

    const declared = getDisplayPropertyKey(collection as AdminCollection<M>, "image");
    if (declared) return declared;

    // find first storage property of type image
    for (const key in collection.properties) {
        const property = collection.properties[key];
        if (property.type === "string" && property.storage?.acceptedFiles?.includes("image/*")) {
            return key;
        }
    }
    // alternatively, look for the first array of images
    for (const key in collection.properties) {
        const property = collection.properties[key];
        if (property.type === "array" && !Array.isArray(property.of) && property.of?.type === "string" && property.of.storage?.acceptedFiles?.includes("image/*")) {
            return key;
        }
    }
    // also check for URL properties with image preview type
    for (const key in collection.properties) {
        const property = collection.properties[key];
        if (property.type === "string" && property.admin?.urlPreview === "image") {
            return key;
        }
    }
    // and arrays of URL properties with image preview type
    for (const key in collection.properties) {
        const property = collection.properties[key];
        if (property.type === "array" && property.of && !Array.isArray(property.of) && property.of.type === "string" && property.of.admin?.urlPreview === "image") {
            return key;
        }
    }
    // fallback: any storage property without explicit acceptedFiles (e.g. a generic "picture" field)
    for (const key in collection.properties) {
        const property = collection.properties[key];
        if (property.type === "string" && property.storage && !property.storage.acceptedFiles) {
            return key;
        }
    }
    // fallback: any array of storage properties without explicit acceptedFiles
    for (const key in collection.properties) {
        const property = collection.properties[key];
        if (property.type === "array" && !Array.isArray(property.of) && property.of?.type === "string" && property.of.storage && !property.of.storage.acceptedFiles) {
            return key;
        }
    }
    return undefined;
}
