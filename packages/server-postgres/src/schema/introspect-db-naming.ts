/**
 * Naming helpers shared by the introspection modules. These live apart from
 * `introspect-db-logic.ts` because the inference pass needs them too, and
 * importing them from there would close a cycle back through this module.
 */

/**
 * Convert a snake_case name to a human-readable Title Case label.
 * e.g. "created_at" -> "Created At", "customer_id" -> "Customer Id"
 */
export function humanize(snakeName: string): string {
    return snakeName
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
}
