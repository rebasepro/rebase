import { EntityRelation } from "../types/entity_values";

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
