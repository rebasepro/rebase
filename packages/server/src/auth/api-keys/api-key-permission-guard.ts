/**
 * Permission guard for Service API Keys.
 *
 * Checks whether an API key's permission set allows a specific operation
 * on a specific collection. Used by the REST API generator middleware to
 * enforce fine-grained access control.
 *
 * @module
 */

import type { ApiKeyPermission } from "./api-key-types";

/** Operations that map to HTTP methods. */
export type ApiKeyOperation = "read" | "write" | "delete";

/**
 * Map an HTTP method string to an `ApiKeyOperation`.
 *
 * - `GET`, `HEAD`, `OPTIONS` → `"read"`
 * - `POST`, `PUT`, `PATCH`  → `"write"`
 * - `DELETE`                → `"delete"`
 */
export function httpMethodToOperation(method: string): ApiKeyOperation {
    const upper = method.toUpperCase();
    switch (upper) {
        case "GET":
        case "HEAD":
        case "OPTIONS":
            return "read";
        case "POST":
        case "PUT":
        case "PATCH":
            return "write";
        case "DELETE":
            return "delete";
        default:
            return "read";
    }
}

/**
 * Check whether the given permissions array allows `operation` on `collection`.
 *
 * Supports the `"*"` wildcard for the collection field, which matches any
 * collection. Returns `true` if at least one permission entry grants access.
 *
 * @param permissions - The API key's permission entries.
 * @param collection  - The target collection slug.
 * @param operation   - The requested operation.
 * @returns `true` if the operation is permitted.
 */
export function isOperationAllowed(
    permissions: ApiKeyPermission[],
    collection: string,
    operation: ApiKeyOperation
): boolean {
    for (const perm of permissions) {
        const collectionMatch = perm.collection === "*" || perm.collection === collection;
        if (collectionMatch && perm.operations.includes(operation)) {
            return true;
        }
    }
    return false;
}

/**
 * Check whether the given permissions array allows a storage operation.
 *
 * Storage, like functions, lives outside the collection namespace: an entry
 * with collection `"storage"` grants storage access for the listed
 * operations (GET routes → `read`, upload/folder/tus → `write`,
 * DELETE routes → `delete`), and the global `"*"` wildcard also matches.
 * A collection-scoped key gets no storage access at all.
 *
 * Matching is exactly {@link isOperationAllowed} with `"storage"` as the
 * resource name — delegated so the semantics can never drift.
 */
export function isStorageAllowed(
    permissions: ApiKeyPermission[],
    operation: ApiKeyOperation
): boolean {
    return isOperationAllowed(permissions, "storage", operation);
}

/**
 * Check whether the given permissions array allows invoking a custom function.
 *
 * Functions live outside the collection namespace, so they have their own
 * resource names in the permission list:
 *
 * - `{ collection: "functions", ... }` grants every function
 * - `{ collection: "functions/<name>", ... }` grants a single function
 * - the global `"*"` wildcard (full-access keys) also matches
 *
 * The operation is derived from the HTTP method as usual (GET → read,
 * POST/PUT/PATCH → write, DELETE → delete). The functions index route is
 * checked as `functionName === ""`, which only the `"functions"` and `"*"`
 * entries can grant.
 *
 * A collection-scoped key (e.g. read-only on `events`) therefore can NOT
 * invoke functions — before this guard existed, any valid key could call
 * every function.
 */
export function isFunctionAllowed(
    permissions: ApiKeyPermission[],
    functionName: string,
    operation: ApiKeyOperation
): boolean {
    for (const perm of permissions) {
        const match = perm.collection === "*"
            || perm.collection === "functions"
            || (functionName !== "" && perm.collection === `functions/${functionName}`);
        if (match && perm.operations.includes(operation)) {
            return true;
        }
    }
    return false;
}
