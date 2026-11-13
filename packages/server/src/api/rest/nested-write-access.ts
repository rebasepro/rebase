import type { RelationDescriptor, TableDescriptor } from "@rebasepro/types";
import { type FieldViewer, keyForColumn } from "@rebasepro/common";
import { assertJunctionWritable, assertNoClosedFields, type RelatedTableLookup } from "./write-validation";

/** The last hop of a nested path: the parent table, the relation it names, and that relation's target table. */
export interface NestedWriteHop {
    parent: TableDescriptor;
    relation: RelationDescriptor;
    target: TableDescriptor;
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
 *    write of the parent's relation — `PATCH /posts/1 { tags: [5] }` when
 *    `posts.tags` is closed — and its rules hold here.
 *
 * An update through an owning parent changes neither: the driver refuses it
 * unless the row is already the parent's, and does not write the key.
 *
 *  - Linking or unlinking through a many-to-many writes the junction's link
 *    columns: through a declared junction table they are held to its column
 *    rules ({@link assertJunctionWritable}, the rule a body write obeys). A
 *    `_pivot` edit's fields are judged by the route that reads them, through
 *    the same function.
 *
 * One rule for every door that takes a nested path — the REST routes and the
 * realtime socket — asked of the same fields `assertNoClosedFields` judges a
 * body by, so the answer (`FIELD_NOT_WRITABLE`, or `VALIDATION_EXCLUDED_FIELDS`
 * for a private relation) is the one the root route gives.
 *
 * @param relatedTables - the served tables by slug or SQL name: where a
 *   declared junction's rules are read from.
 */
export function assertNestedWriteAllowed(
    hop: NestedWriteHop,
    kind: NestedWriteKind,
    path: string,
    viewer: FieldViewer | undefined,
    relatedTables: RelatedTableLookup
): void {
    const { parent, relation, target } = hop;
    const where = `A write through '${path}' sets a relation: `;

    const changesMembership = kind === "create" || relation.kind === "manyToMany";
    if (changesMembership) {
        assertNoClosedFields({ [relation.name]: true }, parent, where, viewer);
    }

    if (relation.kind === "manyToMany" && kind !== "pivot") {
        assertJunctionWritable(parent, relation, { link: true }, { where, viewer, relatedTables });
    }

    if (kind === "create" && (relation.kind === "hasOne" || relation.kind === "hasMany")) {
        const foreignKey = keyForColumn(target, relation.foreignKey) ?? relation.foreignKey;
        assertNoClosedFields({ [foreignKey]: true }, target, where, viewer);
    }
}
