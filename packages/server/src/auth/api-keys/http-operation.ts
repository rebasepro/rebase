/**
 * Which data-plane operation an HTTP request performs, for the scope it needs:
 * `data:read`, `data:write` or `data:delete` (and the same for storage).
 *
 * @module
 */

/** The operation part of a data-plane scope. */
export type DataOperation = "read" | "write" | "delete";

/**
 * Map an HTTP method to the operation it performs.
 *
 * - `GET`, `HEAD`, `OPTIONS` → `"read"`
 * - `POST`, `PUT`, `PATCH`  → `"write"`
 * - `DELETE`                → `"delete"`
 *
 * Any other method is a `"write"`: a verb this does not know is not assumed
 * to be harmless.
 */
export function httpMethodToOperation(method: string): DataOperation {
    switch (method.toUpperCase()) {
        case "GET":
        case "HEAD":
        case "OPTIONS":
            return "read";
        case "DELETE":
            return "delete";
        default:
            return "write";
    }
}
