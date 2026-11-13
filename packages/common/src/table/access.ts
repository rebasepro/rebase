import type { ColumnAccess, ColumnDescriptor, RelationDescriptor, TableDescriptor } from "@rebasepro/types";

import { canReadWithAccess, canWriteWithAccess, type FieldViewer } from "../collections/field-access";

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
    return canWriteWithAccess(access, viewer);
}

/**
 * The column a `belongsTo` is bound to on its own table — the declared (or
 * derived) column its `localKey` names — or `undefined` for any other kind, or
 * a link whose key the table does not describe.
 *
 * The two are one fact under two names: `{ reviewer: 7 }` sets the column
 * `{ reviewerId: 7 }` sets, and `?include=reviewer` hands over the value the
 * column holds. So every rule of one is a rule of the other — see
 * {@link canReadRelation} and {@link canWriteRelation}.
 *
 * @group Table
 *
 * @internal Shared with @rebasepro/server's OpenAPI generator; not part of the public API.
 */
export function boundKeyColumn(table: TableDescriptor, relation: RelationDescriptor): ColumnDescriptor | undefined {
    if (relation.kind !== "belongsTo") return undefined;
    return table.columns.find(column => column.key === relation.localField);
}

/**
 * May this caller be handed the rows of this relation?
 *
 * The relation's own rules, and — for a `belongsTo` — its key column's: a link
 * is exactly as readable as the key it is bound to. `?include=handler` embeds
 * the staff row whose key `handlerId` holds, so a caller `handlerId`'s
 * `access.read` withholds may not include `handler`, filter on it or sort by
 * it either.
 *
 * @group Table
 */
export function canReadRelation(table: TableDescriptor, relation: RelationDescriptor, viewer: FieldViewer | undefined): boolean {
    if (!canReadColumn(relation, viewer)) return false;
    const bound = boundKeyColumn(table, relation);
    return bound === undefined || canReadColumn(bound, viewer);
}

/**
 * May this caller set this relation?
 *
 * The relation's own rules, and — for a `belongsTo` — its key column's
 * (`.readOnly()`, `.private()`, `access.write`): writing a link by name sets
 * that column, so it is closed exactly when writing the column is.
 *
 * @group Table
 */
export function canWriteRelation(table: TableDescriptor, relation: RelationDescriptor, viewer: FieldViewer | undefined): boolean {
    if (!canWriteColumn(relation, viewer)) return false;
    const bound = boundKeyColumn(table, relation);
    return bound === undefined || canWriteColumn(bound, viewer);
}

/**
 * Whether the API does not have this relation at all: it is `.private()`, or
 * it is a `belongsTo` bound to a `.private()` key column — the link would
 * otherwise put the hidden column back on the surface under another name.
 *
 * @group Table
 */
export function isPrivateRelation(table: TableDescriptor, relation: RelationDescriptor): boolean {
    return relation.private === true || boundKeyColumn(table, relation)?.private === true;
}

/**
 * The names on this table a caller may not touch, in both spellings a caller
 * can write them in: `declared` holds column keys and relation names, `refused`
 * those plus the SQL names behind the columns.
 *
 * A column and the `belongsTo` bound to it are one fact under two names, so a
 * restriction on either restricts both: a restricted relation takes its foreign
 * key with it (`bandId: 7` names the band exactly as `band: 7` does), and a
 * restricted key column takes its link with it (`reviewer: 7` sets the
 * `.readOnly()` `reviewerId`; `?include=handler` reads the `access.read`-closed
 * `handlerId`).
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
 * their SQL names, the private relations, the foreign key of a private
 * `belongsTo` and the `belongsTo` bound to a private key column. A query naming
 * one is answered as a query naming nothing.
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
        const bound = boundKeyColumn(table, relation);
        if (!restricted(relation) && !(bound !== undefined && restricted(bound))) continue;
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
