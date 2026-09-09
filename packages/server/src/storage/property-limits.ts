import type { CollectionConfig, Property, StorageConfig } from "@rebasepro/types";
import { ApiError } from "../api/errors";

/**
 * Server-side enforcement of a storage property's own `maxSize` and
 * `acceptedFiles`.
 *
 * Both were declared per property, published in the generated types, rendered
 * by the panel's file picker — and enforced by exactly one thing: the browser.
 * `packages/server/src/storage/routes.ts` knew a single global `maxFileSize`
 * and nothing about the property a file was destined for, so
 * `storage: { maxSize: 200_000, acceptedFiles: ["image/*"] }` on an avatar was
 * a suggestion. `curl -F file=@payload.exe` past the picker put a 40 MB
 * executable in the avatar bucket, and the config that said otherwise was never
 * consulted.
 *
 * The limits are per *property*, so enforcing them needs to know which property
 * a request is for. Uploads carry that as context (a form field on `POST
 * /upload`, `Upload-Metadata` on the resumable path); when it is absent the
 * global cap is still the ceiling, exactly as before. That is the honest
 * fallback: an upload that names no property has no property limit to check,
 * and refusing every context-less upload would break every existing client.
 */

/** What a property says a file may be. */
export interface UploadConstraints {
    /** Bytes. From `StorageConfig.maxSize`. */
    maxSize?: number;
    /** MIME types or extensions. From `StorageConfig.acceptedFiles`. */
    acceptedFiles?: readonly string[];
    /** `posts.coverImage` — for the message, so the answer names the rule. */
    source: string;
}

/** Look up the constraints for a collection slug and a property path. */
export type ResolveUploadConstraints = (
    collectionSlug: string,
    propertyPath: string
) => UploadConstraints | undefined;

/**
 * The property at a dotted path, walking maps and array element types.
 *
 * `coverImage`, `meta.avatar` and `gallery` all name a storage property, and
 * the last one is an *array* of them — the file being uploaded is an element,
 * so the `of` is what carries the storage block. Array indices in the path
 * (`gallery.0`) are skipped for the same reason: every element obeys the same
 * rule.
 */
function propertyAt(properties: Record<string, Property> | undefined, path: string): Property | undefined {
    if (!properties) return undefined;
    const segments = path.split(".").filter(Boolean);
    let current: Property | undefined;
    let scope: Record<string, Property> | undefined = properties;

    for (const segment of segments) {
        if (/^\d+$/.test(segment)) continue;
        if (!scope) return undefined;
        current = scope[segment];
        if (!current) return undefined;
        // Descend through an array to its element type, then through a map to
        // its properties, so the next segment is looked up in the right place.
        let next: Property | undefined = current;
        while (next?.type === "array" && next.of && !Array.isArray(next.of)) {
            next = next.of as Property;
        }
        current = next;
        scope = current?.type === "map" ? (current.properties as Record<string, Property> | undefined) : undefined;
    }
    return current;
}

/** The `storage` block on a property, having walked into an array's element. */
function storageOf(property: Property | undefined): StorageConfig | undefined {
    let current = property;
    while (current?.type === "array" && current.of && !Array.isArray(current.of)) {
        current = current.of as Property;
    }
    return (current as { storage?: StorageConfig } | undefined)?.storage;
}

/**
 * A resolver over the collections this backend serves.
 *
 * Built from the registry rather than from the request, deliberately: the
 * limits have to be the server's, resolved by slug, or a caller could send
 * their own generous `maxSize` alongside the file and the check would be theirs
 * to choose.
 */
export function createUploadConstraintResolver(
    collections: readonly CollectionConfig[]
): ResolveUploadConstraints {
    const bySlug = new Map<string, CollectionConfig>();
    for (const collection of collections) bySlug.set(collection.slug, collection);

    return (collectionSlug, propertyPath) => {
        const collection = bySlug.get(collectionSlug);
        if (!collection) return undefined;
        const storage = storageOf(propertyAt(collection.properties as Record<string, Property>, propertyPath));
        if (!storage) return undefined;
        if (storage.maxSize === undefined && !storage.acceptedFiles?.length) return undefined;
        return {
            maxSize: storage.maxSize,
            acceptedFiles: storage.acceptedFiles,
            source: `${collectionSlug}.${propertyPath}`
        };
    };
}

/**
 * Does `contentType` (or the file's extension) satisfy one `acceptedFiles`
 * entry?
 *
 * Three spellings, because all three are in use in the wild and the panel's own
 * picker accepts all three:
 *
 * - `image/*`          — a wildcard over a type
 * - `application/pdf`  — an exact MIME type
 * - `.pdf`             — an extension, which is what `<input accept>` takes and
 *                        what people therefore write
 *
 * A browser that sends `application/octet-stream` for a `.pdf` — which happens,
 * and is the reason extension entries exist at all — is matched on the name.
 */
function matchesOne(entry: string, contentType: string | undefined, fileName: string | undefined): boolean {
    const rule = entry.trim().toLowerCase();
    if (!rule || rule === "*" || rule === "*/*") return true;

    if (rule.startsWith(".")) {
        return Boolean(fileName && fileName.toLowerCase().endsWith(rule));
    }

    const type = (contentType ?? "").toLowerCase().split(";")[0].trim();
    if (!type) return false;
    if (rule.endsWith("/*")) return type.startsWith(rule.slice(0, -1));
    return type === rule;
}

/** Is this file one the property accepts? */
export function isAcceptedFile(
    accepted: readonly string[] | undefined,
    contentType: string | undefined,
    fileName: string | undefined
): boolean {
    if (!accepted || accepted.length === 0) return true;
    return accepted.some(entry => matchesOne(entry, contentType, fileName));
}

/**
 * Refuse an upload the destination property does not accept.
 *
 * `413` for size and `400` for type, which is the distinction HTTP already
 * draws: one is "too big for this endpoint", the other is "this is not the
 * thing being asked for". Both name the property, because "file too large" with
 * no limit and no field is a message a developer cannot act on.
 */
export function assertUploadWithinPropertyLimits(
    constraints: UploadConstraints | undefined,
    file: { size?: number; type?: string; name?: string }
): void {
    if (!constraints) return;

    if (constraints.maxSize !== undefined && typeof file.size === "number" && file.size > constraints.maxSize) {
        throw new ApiError(
            413,
            "STORAGE_FILE_TOO_LARGE",
            `This file is ${file.size} bytes, and '${constraints.source}' accepts at most ${constraints.maxSize}.`,
            {
                property: constraints.source,
                maxSize: constraints.maxSize,
                size: file.size
            }
        );
    }

    if (!isAcceptedFile(constraints.acceptedFiles, file.type, file.name)) {
        throw ApiError.badRequest(
            `'${constraints.source}' accepts ${constraints.acceptedFiles!.join(", ")}` +
            `${file.type ? `, and this file is ${file.type}` : ""}.`,
            "STORAGE_FILE_TYPE_REFUSED",
            {
                property: constraints.source,
                acceptedFiles: constraints.acceptedFiles,
                contentType: file.type
            }
        );
    }
}

/**
 * The property an upload names, from a request's own fields.
 *
 * Two keys, not one: the collection is resolved against the registry, so a
 * caller cannot invent a limit — the worst they can do is name a property whose
 * rules are *stricter*, or none at all, which leaves the global cap.
 */
export function readUploadPropertyContext(
    source: Record<string, unknown> | undefined
): { collection: string; property: string } | undefined {
    const collection = source?.[UPLOAD_COLLECTION_FIELD];
    const property = source?.[UPLOAD_PROPERTY_FIELD];
    if (typeof collection !== "string" || typeof property !== "string") return undefined;
    if (!collection.trim() || !property.trim()) return undefined;
    return { collection: collection.trim(), property: property.trim() };
}

/**
 * The names the context travels under.
 *
 * Shared constants rather than three string literals, because the client
 * writes them and two servers read them (the multipart route and the TUS
 * metadata parser), and a typo in any one of the three fails silently as "no
 * context, use the global cap".
 */
export const UPLOAD_COLLECTION_FIELD = "collection";
export const UPLOAD_PROPERTY_FIELD = "property";
