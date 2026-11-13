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
 * The relation's own rules, and the rules of every column its join reads
 * ({@link relationJoinColumns}): a relation is exactly as readable as what it
 * is joined on. `?include=handler` embeds the staff row whose key `handlerId`
 * holds; `staff?include=handledCases` groups each case under the staff row
 * that same key points at; a `via` over `handler_id` does both. A caller
 * `handlerId`'s `access.read` withholds may do none of them.
 *
 * `related` resolves the other tables a join passes through (by slug or SQL
 * name). Without it, only this table's join columns are judged — enough for a
 * `belongsTo`, not for a `hasMany` / `hasOne` (whose key is the target's) or a
 * `via` past its first step.
 *
 * @group Table
 */
export function canReadRelation(
    table: TableDescriptor,
    relation: RelationDescriptor,
    viewer: FieldViewer | undefined,
    related?: RelatedTables
): boolean {
    if (!canReadColumn(relation, viewer)) return false;
    return relationJoinColumns(table, relation, related).every(column => canReadColumn(column, viewer));
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
export function isPrivateRelation(table: TableDescriptor, relation: RelationDescriptor, related?: RelatedTables): boolean {
    return relation.private === true || relationJoinColumns(table, relation, related).some(column => column.private === true);
}

/**
 * Any table's descriptor, by slug or by SQL table name: what a relation's
 * target and a `via` step name. Answers `undefined` for a table it does not
 * know (an implicit junction, a table this caller is not served).
 *
 * @group Table
 *
 * @internal Shared with @rebasepro/server and @rebasepro/server-postgres; not part of the public API.
 */
export type RelatedTables = (slugOrTable: string) => TableDescriptor | undefined;

/**
 * The declared columns a relation's join condition reads, on every table it
 * passes through — the one answer every read gate asks:
 *
 * - `belongsTo` — its key column on this table;
 * - `hasMany` / `hasOne` — this table's source key (the primary key unless
 *   `sourceKey` says otherwise) and the target's `foreignKey`;
 * - `manyToMany` — this table's and the target's primary keys, and the
 *   junction's two link columns when the junction is a declared table;
 * - `via` — every column every step joins on, `from` on the table before the
 *   step and `to` on the step's table (a `table.column` spelling names its
 *   own table).
 *
 * A column a table does not describe (an implicit key, an implicit junction)
 * has no rules and is not listed; so is a table `related` cannot find.
 *
 * @group Table
 *
 * @internal Shared with @rebasepro/server and @rebasepro/server-postgres; not part of the public API.
 */
export function relationJoinColumns(table: TableDescriptor, relation: RelationDescriptor, related?: RelatedTables): ColumnDescriptor[] {
    const out: ColumnDescriptor[] = [];
    const add = (on: TableDescriptor | undefined, name: string | undefined): void => {
        if (!on || name === undefined) return;
        const column = on.columns.find(candidate => candidate.column === name || candidate.key === name);
        if (column && !out.includes(column)) out.push(column);
    };
    const target = (): TableDescriptor | undefined => related?.(relation.target);
    const primaryKey = (on: TableDescriptor | undefined): void => {
        for (const key of on?.primaryKey ?? []) add(on, key);
    };
    switch (relation.kind) {
        case "belongsTo": {
            const bound = boundKeyColumn(table, relation);
            if (bound) out.push(bound);
            break;
        }
        case "hasMany":
        case "hasOne":
            if (relation.sourceKey !== undefined) add(table, relation.sourceKey);
            else primaryKey(table);
            add(target(), relation.foreignKey);
            break;
        case "manyToMany": {
            primaryKey(table);
            const junction = related?.(relation.through.table);
            add(junction, relation.through.sourceKey);
            add(junction, relation.through.targetKey);
            primaryKey(target());
            break;
        }
        case "via": {
            const tableNamed = (name: string): TableDescriptor | undefined => {
                if (name === table.table || name === table.slug) return table;
                const found = related?.(name);
                if (found) return found;
                const end = target();
                return end && end.table === name ? end : undefined;
            };
            let previous: TableDescriptor | undefined = table;
            for (const step of relation.steps) {
                const here = tableNamed(step.table);
                for (const condition of Array.isArray(step.on) ? step.on : [step.on]) {
                    for (const name of Array.isArray(condition.from) ? condition.from : [condition.from]) {
                        const [qualifier, column] = splitQualified(name);
                        add(qualifier === undefined ? previous : tableNamed(qualifier), column);
                    }
                    for (const name of Array.isArray(condition.to) ? condition.to : [condition.to]) {
                        const [qualifier, column] = splitQualified(name);
                        add(qualifier === undefined ? here : tableNamed(qualifier), column);
                    }
                }
                previous = here;
            }
            break;
        }
    }
    return out;
}

/** `table.column` as its two parts; a bare column has no table. */
function splitQualified(name: string): [string | undefined, string] {
    const dot = name.lastIndexOf(".");
    return dot < 0 ? [undefined, name] : [name.slice(0, dot), name.slice(dot + 1)];
}

/**
 * Whether any relation of this table joins on a column with access rules —
 * on this table or, through `related`, on the others it passes through. The
 * check a read makes before it judges a relation path at all.
 *
 * @group Table
 *
 * @internal Shared with @rebasepro/server-postgres; not part of the public API.
 */
export function hasJoinAccessRules(table: TableDescriptor, related?: RelatedTables): boolean {
    return table.relations.some(relation =>
        relationJoinColumns(table, relation, related).some(column => columnAccess(column) !== undefined));
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
 * `handlerId`). On a read, a relation is listed when any column its join reads
 * is ({@link relationJoinColumns}; pass `related` to judge the other tables'
 * columns — `staff.handledCases` reads `cases.handlerId`).
 *
 * Replaces `restrictedFieldNames(collection, viewer, kind)`.
 *
 * @group Table
 */
export function restrictedKeys(
    table: TableDescriptor,
    viewer: FieldViewer | undefined,
    kind: "read" | "write",
    related?: RelatedTables
): { declared: string[]; refused: Set<string> } {
    const allowed = kind === "read" ? canReadColumn : canWriteColumn;
    // A write sets a link's own key column alone; a read reads every column
    // the join does.
    return namesWhere(table, target => !allowed(target, viewer), kind === "read" ? related ?? NO_RELATED : undefined);
}

/**
 * The names the API does not have, in every spelling: the private columns,
 * their SQL names, the private relations, the foreign key of a private
 * `belongsTo` and every relation whose join reads a private column (with
 * `related`, on the other tables too). A query naming one is answered as a
 * query naming nothing.
 *
 * Not {@link restrictedKeys}: a column restricted by role is public by name
 * (OpenAPI and MCP describe it); a private one is described nowhere.
 *
 * Replaces `apiHiddenFieldNames(collection)`.
 *
 * @group Table
 */
export function apiHiddenKeys(table: TableDescriptor, related?: RelatedTables): Set<string> {
    return namesWhere(table, target => target.private === true, related ?? NO_RELATED).refused;
}

/** No other table known: a join is judged by this table's columns alone. */
const NO_RELATED: RelatedTables = () => undefined;

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
    restricted: (target: AccessTarget) => boolean,
    /** Judge a relation by every column its join reads; absent, by its bound key column alone (a write). */
    joins?: RelatedTables
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
        const read = joins ? relationJoinColumns(table, relation, joins) : [boundKeyColumn(table, relation)];
        if (!restricted(relation) && !read.some(column => column !== undefined && restricted(column))) continue;
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
