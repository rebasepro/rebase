import { CollectionConfig, type ResolvedBelongsTo } from "@rebasepro/types";
import { resolveCollectionRelations } from "@rebasepro/common";
import { ApiError } from "../errors";

/**
 * Reject a write naming a field the collection does not have.
 *
 * Unknown keys used to travel all the way into the INSERT, where Postgres
 * rejected them — so a typo came back as `column "titel" does not exist`,
 * phrased by the database, from a stack the caller cannot see, and only if the
 * column really was absent. It is a request problem and belongs in a 400.
 *
 * What counts as known:
 * - a declared property (for an introspected BaaS collection these *are* the
 *   columns, so the set is exact);
 * - the foreign-key column behind an owning relation, which callers may write
 *   directly instead of through the relation property;
 * - anything named in `options.extraKnownFields` — for an auth collection the
 *   credential keys the auth adapter consumes before a row is ever built;
 * - nothing else. `id` in particular is not automatically known — see below.
 */
export function assertKnownWriteFields(
    values: Record<string, unknown>,
    collection: CollectionConfig,
    options?: { rowIndex?: number; extraKnownFields?: readonly string[] }
): void {
    if (collection.strictWrites === false) return;

    // A collection that declares no properties describes nothing, so there is
    // nothing to check against — "no declared fields" is not the same claim as
    // "no fields are allowed", and reading it as the latter would turn every
    // write to such a collection into a 400. Postgres still has the last word.
    if (!collection.properties || Object.keys(collection.properties).length === 0) return;

    const known = new Set<string>(Object.keys(collection.properties));

    // An owning relation stores its target in a local FK column that usually
    // has no property of its own; writing it directly is legitimate.
    for (const relation of Object.values(resolveCollectionRelations(collection))) {
        if (relation.kind === "belongsTo") known.add((relation as ResolvedBelongsTo).localKey);
    }

    for (const field of options?.extraKnownFields ?? []) known.add(field);

    const unknown = Object.keys(values).filter(key => !known.has(key));
    if (unknown.length === 0) return;

    const where = options?.rowIndex !== undefined ? `Row ${options.rowIndex}: ` : "";

    // The `id` case is worth its own sentence, because the caller almost
    // certainly did not choose to send it — `create(data, id)` puts it there,
    // which is right for a table keyed on `id` and meaningless for any other.
    if (unknown.includes("id") && !known.has("id")) {
        const keys = Object.entries(collection.properties ?? {})
            .filter(([, prop]) => "isId" in (prop as object) && Boolean((prop as { isId?: unknown }).isId))
            .map(([name]) => `'${name}'`);
        const keyDesc = keys.length > 0 ? keys.join(" + ") : "its own key column";
        throw ApiError.badRequest(
            `${where}'${collection.slug}' has no 'id' column — it is keyed on ${keyDesc}. ` +
            `The \`id\` argument of \`create(data, id)\` is written as an \`id\` column, so for this ` +
            `collection put the key in \`data\` instead.`,
            "VALIDATION_UNKNOWN_FIELDS"
        );
    }

    throw ApiError.badRequest(
        `${where}'${collection.slug}' has no field${unknown.length > 1 ? "s" : ""} ` +
        `${unknown.map(f => `'${f}'`).join(", ")}. ` +
        `Known fields: ${[...known].sort().map(f => `'${f}'`).join(", ")}.`,
        "VALIDATION_UNKNOWN_FIELDS"
    );
}
