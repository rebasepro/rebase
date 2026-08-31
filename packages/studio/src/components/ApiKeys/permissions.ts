/**
 * The vocabulary of an API key's permission entries.
 *
 * A permission entry is `{ collection, operations }`, but `collection` is not
 * only a collection: the same field addresses three namespaces, and the guard
 * that enforces them lives in `@rebasepro/server`
 * (`auth/api-keys/api-key-permission-guard.ts`):
 *
 * - `"*"`               — every collection, every custom function, and storage
 * - `"storage"`         — the storage routes
 * - `"functions"`       — every custom function, including the function index
 * - `"functions/<name>"`— one named function
 * - anything else       — the collection with that slug
 *
 * The UI used to label the field "Collection slug or *", which made two of
 * those namespaces undiscoverable and made `"*"` read as "all collections"
 * when it also hands over storage and every function. This module is the one
 * place that knows the mapping, so the picker, the row description, the grant
 * summary and the detail panel cannot drift from each other.
 *
 * @module
 */

import type { ApiKeyPermission } from "@rebasepro/types";

/** Grants every collection, every function, and storage. */
export const RESOURCE_EVERYTHING = "*";
/** Grants the storage routes. */
export const RESOURCE_STORAGE = "storage";
/** Grants every custom function. */
export const RESOURCE_ALL_FUNCTIONS = "functions";
/** Prefix addressing a single custom function. */
export const FUNCTION_PREFIX = "functions/";

export type ResourceKind =
    | "everything"
    | "storage"
    | "all-functions"
    | "function"
    | "collection";

export interface ParsedResource {
    kind: ResourceKind;
    /** The function name for `"function"`, the slug for `"collection"`. */
    name: string;
}

/** Classify a raw `collection` field into the namespace it addresses. */
export function parseResource(collection: string): ParsedResource {
    const value = collection.trim();
    if (value === RESOURCE_EVERYTHING) return { kind: "everything", name: "" };
    if (value === RESOURCE_STORAGE) return { kind: "storage", name: "" };
    if (value === RESOURCE_ALL_FUNCTIONS) return { kind: "all-functions", name: "" };
    if (value.startsWith(FUNCTION_PREFIX)) {
        return { kind: "function", name: value.slice(FUNCTION_PREFIX.length) };
    }
    return { kind: "collection", name: value };
}

/**
 * Short label for a resource — what a picker or a chip shows.
 *
 * Deliberately not the raw value: `"*"` alone is the thing nobody could read.
 */
export function resourceLabel(collection: string): string {
    const { kind, name } = parseResource(collection);
    switch (kind) {
        case "everything": return "Everything";
        case "storage": return "Storage";
        case "all-functions": return "All functions";
        case "function": return name ? `${name}()` : "Function";
        case "collection": return name || "—";
    }
}

/**
 * The resource as a sentence fragment, for "this key can read <fragment>".
 *
 * `"everything"` spells out all three namespaces, because that is exactly the
 * fact the old `*` input hid.
 */
export function resourcePhrase(collection: string): string {
    const { kind, name } = parseResource(collection);
    switch (kind) {
        case "everything": return "every collection, every custom function and storage";
        case "storage": return "storage";
        case "all-functions": return "every custom function";
        case "function": return name ? `the ${name} function` : "one function";
        case "collection": return name ? `the ${name} collection` : "an unnamed collection";
    }
}

/** How each operation reads for a given namespace, so the sentence stays true. */
function operationPhrase(kind: ResourceKind, operation: string): string {
    if (kind === "all-functions" || kind === "function") {
        // Functions are invoked, not written to; the HTTP method still picks
        // the operation, so a POST-only function needs `write`.
        return operation === "read" ? "call (GET)"
            : operation === "write" ? "call (POST, PUT, PATCH)"
                : "call (DELETE)";
    }
    if (kind === "storage") {
        return operation === "read" ? "download from"
            : operation === "write" ? "upload to"
                : "delete from";
    }
    return operation;
}

/** Join with an Oxford-less "and", the way the rest of the panel reads. */
function joinPhrases(parts: string[]): string {
    if (parts.length <= 1) return parts[0] ?? "";
    return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * One plain sentence per permission entry: what the key will actually be able
 * to do. An entry with no operations selected grants nothing and says so,
 * rather than being silently dropped at submit time.
 */
export function grantSentence(perm: ApiKeyPermission): string {
    const { kind } = parseResource(perm.collection);
    const target = resourcePhrase(perm.collection);
    if (perm.operations.length === 0) return `No access to ${target}`;
    const verbs = joinPhrases(perm.operations.map(op => operationPhrase(kind, op)));
    const verb = verbs.charAt(0).toUpperCase() + verbs.slice(1);
    return `${verb} ${target}`;
}

/**
 * Dense one-line summary for list rows and the created-key confirmation.
 *
 * The wildcard wins over everything else in the array, because the guard
 * returns on the first match — a key holding `*` is a full-access key no
 * matter what else is listed beside it.
 */
export function permissionSummary(perms: ApiKeyPermission[]): string {
    if (perms.length === 0) return "No permissions";
    const wildcard = perms.find(p => p.collection === RESOURCE_EVERYTHING);
    if (wildcard) return `Everything (${wildcard.operations.join(", ")})`;
    if (perms.length === 1) {
        return `${resourceLabel(perms[0].collection)} (${perms[0].operations.join(", ")})`;
    }
    return `${perms.length} resources`;
}
