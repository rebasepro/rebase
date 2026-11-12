import type { ColumnAccess, ColumnDescriptor, RelationDescriptor, TableDescriptor } from "@rebasepro/types";

import { canReadWithAccess, type FieldViewer } from "../collections/field-access";

/**
 * Column- and relation-level access over a {@link TableDescriptor}: the same
 * rules as `collections/field-access.ts`, read from the descriptor instead of
 * from `property.access` / `excludeFromApi`.
 *
 * - `.private()` (`private: true`) is `{ read: [], write: [] }`: nobody, through
 *   any API — exactly what `excludeFromApi` expanded to.
 * - A list that is absent leaves that direction to the row's policies.
 * - An empty list closes it to every caller, the admin and the trusted plane
 *   included.
 * - A non-empty list admits its roles, `admin`, and no viewer at all (the
 *   trusted server plane).
 *
 * The predicate itself is common's `canReadWithAccess`, so the two models
 * cannot answer differently while both exist.
 *
 * @module
 */

/** What carries access rules: a column, or a relation (which has no `readOnly`). */
type AccessTarget = Pick<ColumnDescriptor, "private" | "access"> & { readOnly?: true };

/** The rule `.private()` expands to. Frozen: it is shared by every caller. */
const PRIVATE_ACCESS: ColumnAccess = Object.freeze({ read: Object.freeze([]), write: Object.freeze([]) });

/**
 * What a column's or relation's access rules actually are, with `private`
 * expanded, or `undefined` when it constrains nothing.
 *
 * Replaces `effectiveAccess(property)`.
 *
 * @group Table
 */
export function columnAccess(target: Pick<ColumnDescriptor, "private" | "access">): ColumnAccess | undefined {
    if (target.private) return PRIVATE_ACCESS;
    const access = target.access;
    if (!access || (access.read === undefined && access.write === undefined)) return undefined;
    return access;
}

/**
 * May this caller receive the column's (or relation's) value?
 *
 * Replaces `canReadField(property, viewer)`.
 *
 * @group Table
 */
export function canReadColumn(target: Pick<ColumnDescriptor, "private" | "access">, viewer: FieldViewer | undefined): boolean {
    return canReadWithAccess(columnAccess(target), viewer);
}

/**
 * May this caller set the column's (or relation's) value?
 *
 * Replaces `canWriteField(property, viewer)`. The write list is judged by the
 * same predicate as a read list. A `readOnly` column (`.readOnly()`, a
 * generated column — what the lift makes of `access.write: []`) is written by
 * nobody through any API: the database or the server's own stamps fill it.
 *
 * @group Table
 */
export function canWriteColumn(target: AccessTarget, viewer: FieldViewer | undefined): boolean {
    if ("readOnly" in target && target.readOnly) return false;
    const access = columnAccess(target);
    return canReadWithAccess(access ? { read: access.write } : undefined, viewer);
}

/**
 * The names on this table a caller may not touch, in both spellings a caller
 * can write them in: `declared` holds column keys and relation names, `refused`
 * those plus the SQL names behind the columns.
 *
 * A restricted `belongsTo` relation takes its foreign key with it: `bandId: 7`
 * names the band exactly as `band: { id: 7 }` does.
 *
 * Replaces `restrictedFieldNames(collection, viewer, kind)`.
 *
 * @group Table
 */
export function restrictedKeys(
    table: TableDescriptor,
    viewer: FieldViewer | undefined,
    kind: "read" | "write"
): { declared: string[]; refused: Set<string> } {
    const allowed = kind === "read" ? canReadColumn : canWriteColumn;
    return namesWhere(table, target => !allowed(target, viewer));
}

/**
 * The names the API does not have, in every spelling: the private columns,
 * their SQL names, the private relations and the foreign key of a private
 * `belongsTo`. A query naming one is answered as a query naming nothing.
 *
 * Not {@link restrictedKeys}: a column restricted by role is public by name
 * (OpenAPI and MCP describe it); a private one is described nowhere.
 *
 * Replaces `apiHiddenFieldNames(collection)`.
 *
 * @group Table
 */
export function apiHiddenKeys(table: TableDescriptor): Set<string> {
    return namesWhere(table, target => target.private === true).refused;
}

/**
 * Whether anything on the table restricts a column or relation, either way —
 * the check a per-row strip makes before doing any work.
 *
 * Replaces `hasFieldAccessRules(collection)`.
 *
 * @group Table
 */
export function hasColumnAccessRules(table: TableDescriptor): boolean {
    return table.columns.some(column => columnAccess(column) !== undefined)
        || table.relations.some(relation => columnAccess(relation) !== undefined);
}

function namesWhere(
    table: TableDescriptor,
    restricted: (target: AccessTarget) => boolean
): { declared: string[]; refused: Set<string> } {
    const declared: string[] = [];
    const refused = new Set<string>();
    const restrict = (name: string): void => {
        if (!declared.includes(name)) declared.push(name);
        refused.add(name);
    };
    for (const column of table.columns) {
        if (!restricted(column)) continue;
        restrict(column.key);
        refused.add(column.column);
    }
    for (const relation of table.relations) {
        if (!restricted(relation)) continue;
        restrict(relation.name);
        if (relation.kind === "belongsTo") restrictForeignKey(table, relation, restrict, refused);
    }
    return { declared, refused };
}

function restrictForeignKey(
    table: TableDescriptor,
    relation: Extract<RelationDescriptor, { kind: "belongsTo" }>,
    restrict: (name: string) => void,
    refused: Set<string>
): void {
    const column = table.columns.find(candidate => candidate.key === relation.localField);
    restrict(column?.key ?? relation.localField);
    refused.add(relation.localKey);
}
