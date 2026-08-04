import { CollectionConfig, type ResolvedBelongsTo } from "@rebasepro/types";
import { resolveCollectionRelations, resolvePrimaryKeys } from "@rebasepro/common";
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

/**
 * Narrow response rows to the fields the caller asked for.
 *
 * `?fields=id,title` is documented in the generated OpenAPI — "Comma-separated
 * list of fields to return (field selection)" — and it is the first thing shown
 * on every endpoint in the API Explorer. It was parsed into `options.fields`
 * and then read by nothing at all: no driver referenced it, and every request
 * came back with every column. A caller asking for two fields of a `posts` row
 * still received its whole `content`.
 *
 * This shapes the *response*, which is what the parameter says it does; it is
 * not a column pushdown, so it saves bandwidth rather than database work.
 *
 * The collection's key always survives. Rows are addressed by it everywhere
 * above this layer — the admin table, realtime reconciliation, the offline
 * cache — and a row that arrives without one is not a smaller row, it is an
 * unusable one. Asking for `fields=title` and being unable to open the record
 * you clicked is a worse answer than one extra key.
 *
 * That is a statement about the key, not about the name `id`: a collection
 * keyed on `slug`, or on `user_id + role_id`, was projected down to the fields
 * asked for and nothing else, which is the very outcome the paragraph above
 * describes. `assertKnownWriteFields` one function up already has a dedicated
 * error for collections with no `id` column, so this layer had no excuse for
 * assuming one.
 */
export function projectResponseFields<T extends Record<string, unknown>>(
    rows: T[],
    fields: readonly string[] | undefined,
    collection: CollectionConfig,
    options?: { include?: readonly string[] }
): T[] {
    if (!fields || fields.length === 0) return rows;

    const declared = new Set<string>(Object.keys(collection.properties ?? {}));
    // The record is keyed by the property name the relation is reached under,
    // which is the name a caller would put in `fields`.
    for (const [key, relation] of Object.entries(resolveCollectionRelations(collection))) {
        declared.add(key);
        if (relation.kind === "belongsTo") declared.add((relation as ResolvedBelongsTo).localKey);
    }
    // `include` decides what is *loaded*; `fields` decides what is *returned*.
    // So `include=author&fields=title,author` yields both, and naming the
    // relation in `fields` without including it yields nothing for it — there
    // was nothing fetched to return. Included names are accepted here so that
    // a relation reached only through `include` (one the collection does not
    // declare as a property) is not rejected as unknown.
    for (const included of options?.include ?? []) declared.add(included);
    declared.add("id");

    // A collection that declares nothing describes nothing to check against —
    // the same reasoning `assertKnownWriteFields` applies one function up.
    if (declared.size > 1) {
        const unknown = fields.filter(field => !declared.has(field));
        if (unknown.length > 0) {
            throw ApiError.badRequest(
                `'${collection.slug}' has no field${unknown.length > 1 ? "s" : ""} ` +
                `${unknown.map(f => `'${f}'`).join(", ")} to return. ` +
                `Known fields: ${[...declared].sort().map(f => `'${f}'`).join(", ")}.`,
                "UNKNOWN_RESPONSE_FIELD",
                { fields: unknown, collection: collection.slug }
            );
        }
    }

    // Whatever addresses a row here. `resolvePrimaryKeys` returns nothing when
    // a collection declares no key at all; drivers other than Postgres still
    // serve rows with a literal `id`, so that stays the fallback.
    const primaryKeys = resolvePrimaryKeys(collection).map(key => key.fieldName);
    const keep = new Set<string>([...fields, ...(primaryKeys.length > 0 ? primaryKeys : ["id"])]);
    return rows.map(row => {
        const projected: Record<string, unknown> = {};
        for (const key of Object.keys(row)) {
            if (keep.has(key)) projected[key] = row[key];
        }
        return projected as T;
    });
}
