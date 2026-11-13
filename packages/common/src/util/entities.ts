import { EntityRelation } from "@rebasepro/types";

/**
 * Normalize a value into a proper EntityRelation instance.
 * Handles EntityRelation class instances, and plain objects
 * with `__type === "relation"` or an `isEntityRelation()` method.
 *
 * When `propertyType` is `"relation"`, also accepts plain objects that
 * have `id` and `path` fields — these are relation-shaped objects from
 * edge cases in the data pipeline (REST fallback, stale cache, custom data source).
 *
 * When `targetPath` is given, also accepts a bare id. A relation column is a
 * foreign key, and the REST layer returns it as the scalar it is; only some
 * fetch paths hydrate it into an object. Which form a caller sees therefore
 * depends on how the row was loaded, and a caller that only accepted objects
 * reported half of its own data as a type error. The declared target is the
 * missing half: with it, an id is a relation that has not been fetched yet.
 *
 * Returns null if the value cannot be coerced.
 */
export function normalizeToEntityRelation(value: unknown, propertyType?: string, targetPath?: string): EntityRelation | null {
    if (value instanceof EntityRelation) return value;

    if (targetPath && (typeof value === "string" || typeof value === "number")) {
        // An empty string is an unset foreign key, not row "".
        if (value === "") return null;
        return new EntityRelation(value, targetPath);
    }

    if (!value || typeof value !== "object" || Array.isArray(value)) return null;

    const obj = value as Record<string, unknown>;
    const isRelationLike =
        obj.__type === "relation" ||
        obj.__type === "reference" ||
        (typeof obj.isEntityRelation === "function" && (obj.isEntityRelation as () => boolean)()) ||
        (typeof obj.isEntityReference === "function" && (obj.isEntityReference as () => boolean)()) ||
        (propertyType === "relation" && typeof obj.id !== "undefined" && typeof obj.path === "string");

    if (!isRelationLike) return null;

    return new EntityRelation(
        obj.id as string | number,
        obj.path as string,
        obj.data as Record<string, unknown> | undefined
    );
}


/**
 * A row snapshot with every relation in it reduced to its reference — target
 * path and id, `__type` kept — and the related row's values dropped.
 *
 * What a history entry stores and serves. The history route is gated on
 * reading the row, not the rows it points at, so a snapshot that embedded the
 * admin's `{ __type: "relation", data: { values } }` envelope handed whoever
 * may read `posts` history the `authors` columns too. Entries are written as
 * the stored row now, which holds no envelope; this keeps it that way for any
 * path that hands one in, and reads entries recorded before.
 *
 * Walks maps and arrays, since a relation can sit inside either. Anything that
 * is not an envelope comes back as it was.
 */
export function withRelationReferencesOnly<T>(value: T): T {
    if (Array.isArray(value)) return value.map(item => withRelationReferencesOnly(item)) as T;
    if (value === null || typeof value !== "object" || value instanceof Date) return value;
    const obj = value as Record<string, unknown>;
    if (obj.__type === "relation" || obj.__type === "reference") {
        const { data: _related, ...reference } = obj;
        return reference as T;
    }
    if (Object.getPrototypeOf(obj) !== Object.prototype && Object.getPrototypeOf(obj) !== null) return value;
    return Object.fromEntries(
        Object.entries(obj).map(([key, item]) => [key, withRelationReferencesOnly(item)])
    ) as T;
}

