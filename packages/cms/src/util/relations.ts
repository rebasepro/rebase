import type { RelationProperty } from "@rebasepro/cms-types";

/**
 * The path of the collection a relation property points at, derived from the
 * property alone.
 *
 * A preview holds a property and a value and no collection, so it cannot call
 * `resolveRelationProperty`. It does not need to: both forms that carry a
 * target — the stamped `resolvedRelation` and the inline `relation` — name it
 * directly. Only the third form, a relation declared by name in the
 * collection's `relations` array, is out of reach, and that one has no target
 * to read without the collection anyway.
 *
 * This is what lets a preview render a relation column that arrived as a bare
 * foreign key: the id says *which* row, the declared target says *which
 * collection*, and `RelationPreview` fetches the rest. Without it a scalar id
 * is indistinguishable from a value of the wrong type.
 */
export function getRelationTargetPath(property: RelationProperty): string | undefined {
    const stamped = property.resolvedRelation?.targetSlug;
    if (stamped) return stamped;

    const target = property.relation?.target;
    if (typeof target !== "function") return undefined;
    try {
        return target()?.slug;
    } catch (_e) {
        // A thunk reaching into a module that has not finished initialising:
        // there is no target to name yet, and a preview is not worth throwing over.
        return undefined;
    }
}
