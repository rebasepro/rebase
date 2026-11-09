import { EntityRelation } from "@rebasepro/types";
import { normalizeToEntityRelation } from "@rebasepro/common";

/**
 * A relation filter's value as `EntityRelation`s. The URL decoder builds them,
 * but a saved `defaultFilter` has been through JSON and holds plain
 * `{ __type: "relation", id, path }` objects. Returns `undefined` for anything
 * that is not a relation, so the field shows no selection rather than a wrong one.
 */
export function toRelationFilterValue(value: unknown): EntityRelation | EntityRelation[] | null | undefined {
    if (value === null) return null;
    if (value === undefined) return undefined;
    if (Array.isArray(value)) {
        const relations = value.map(item => normalizeToEntityRelation(item, "relation"));
        return relations.every((r): r is EntityRelation => r !== null) ? relations : undefined;
    }
    return normalizeToEntityRelation(value, "relation") ?? undefined;
}
