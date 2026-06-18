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
