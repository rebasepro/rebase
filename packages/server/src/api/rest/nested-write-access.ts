import { type CollectionConfig, type ResolvedRelation, hasForeignKeyOnTarget, isManyToMany } from "@rebasepro/types";
import { type FieldViewer, fieldKeyForColumn, relationDeclaringProperty } from "@rebasepro/common";
import { assertNoClosedFields } from "./write-validation";

/** The last hop of a nested path: the parent, the relation it names, and that relation's target. */
export interface NestedWriteHop {
    parentCollection: CollectionConfig;
    relation: ResolvedRelation;
    targetCollection: CollectionConfig;
}

/**
 * What a write through a nested path does to the row the path addresses.
 *
 *  - `create`: a new row under the parent (`POST /bands/7/members`);
 *  - `update`: an existing row reached through the parent (`PATCH …/members/3`);
 *  - `pivot`: the columns of one many-to-many link (`PATCH …/tags/5 { _pivot }`);
 *  - `unlink`: a `DELETE` through a nested path. Through a many-to-many one it
 *    drops the link; through an owning one it deletes the row, which writes
 *    no relation and is the row's own delete rules' to answer.
 */
export type NestedWriteKind = "create" | "update" | "pivot" | "unlink";

/**
 * Refuse a write through a parent that sets a relation the caller may not write.
 *
 * A body is checked against the target's field rules, and that is all the
 * nested routes used to check. But the address writes too, and what it writes
 * is not in the body:
 *
 *  - A create under a parent whose target carries the parent's key
 *    (`hasMany`/`hasOne`) has that key stamped from the URL — `POST
 *    /bands/7/members` sets `members.band_id = 7`, which `POST /members
 *    { bandId: 7 }` answers `FIELD_NOT_WRITABLE` for when `members.band` is
 *    closed to the caller.
 *  - A create is also a new member of the parent's relation, and every write
 *    through a many-to-many path is set membership: it links on create and on
 *    update, edits the link with `_pivot`, and drops it on delete. That is a
 *    write of the parent's relation property — `PATCH /posts/1 { tags: [5] }`
 *    when `posts.tags` is closed — and its rules hold here.
 *
 * An update through an owning parent changes neither: the driver refuses it
 * unless the row is already the parent's, and does not write the key.
 *
 * One rule for every door that takes a nested path — the REST routes and the
 * realtime socket — asked of the same fields `assertNoClosedFields` judges a
 * body by, so the answer (`FIELD_NOT_WRITABLE`, or `VALIDATION_EXCLUDED_FIELDS`
 * for an `excludeFromApi` relation) is the one the root route gives.
 */
export function assertNestedWriteAllowed(
    hop: NestedWriteHop,
    kind: NestedWriteKind,
    path: string,
    viewer: FieldViewer | undefined
): void {
    const { parentCollection, relation, targetCollection } = hop;
    const where = `A write through '${path}' sets a relation: `;

    const changesMembership = kind === "create" || isManyToMany(relation);
    if (changesMembership) {
        const relationKey = declaringPropertyKey(parentCollection, relation);
        if (relationKey !== undefined) {
            assertNoClosedFields({ [relationKey]: true }, parentCollection, where, viewer);
        }
    }

    if (kind === "create" && hasForeignKeyOnTarget(relation)) {
        const foreignKey = fieldKeyForColumn(targetCollection, relation.foreignKeyOnTarget);
        assertNoClosedFields({ [foreignKey]: true }, targetCollection, where, viewer);
    }
}

/** The key of the property that declares `relation` on `collection`, if a property does. */
function declaringPropertyKey(collection: CollectionConfig, relation: ResolvedRelation): string | undefined {
    const declaring = relationDeclaringProperty(collection, relation);
    if (!declaring) return undefined;
    return Object.entries(collection.properties ?? {}).find(([, property]) => property === declaring)?.[0];
}
