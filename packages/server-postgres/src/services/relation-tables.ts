import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import type { OrderByTuple, RelationDescriptor } from "@rebasepro/types";
import { relationOf, type PrimaryKeyInfo } from "@rebasepro/common";
import { toWireKey } from "@rebasepro/utils";
import { ApiError } from "@rebasepro/server";

import type { RuntimeTable } from "../model/runtime-table";
import type { PostgresTableRegistry } from "../model/PostgresTableRegistry";
import { columnAtKey, requireTableKeys } from "./collection-helpers";

/**
 * The relation half of the driver's table model: every question the relation
 * services ask of a {@link RelationDescriptor} and the {@link RuntimeTable}s
 * at its two ends, answered once.
 *
 * A relation names its target by slug (`relation.target`); the target's SQL
 * table, key and columns are the target runtime table's. Nothing here reads a
 * lowered collection.
 *
 * @module
 */

/** A relation whose link is a column on the target pointing back here: `hasOne` / `hasMany`. */
export type PointsBackRelation = Extract<RelationDescriptor, { kind: "hasOne" | "hasMany" }>;

/** Whether the link is a column on the target that points back at this table. */
export function pointsBack(relation: RelationDescriptor): relation is PointsBackRelation {
    return relation.kind === "hasOne" || relation.kind === "hasMany";
}

/**
 * The table a relation points at. Throws, naming the slug, when this driver
 * does not serve it — boot refused such a relation already
 * (`assertRelationsResolve`), so reaching one here is a wiring defect.
 */
export function relationTarget(registry: PostgresTableRegistry, relation: RelationDescriptor): RuntimeTable {
    return registry.requireTable(relation.target);
}

/**
 * The drizzle table this database holds for `table`: the catalogue table
 * registered under its SQL name, else the runtime table's own. Throws, naming
 * the slug and the table, when there is none.
 */
export function catalogueTableOf(registry: PostgresTableRegistry, table: RuntimeTable): PgTable {
    const pg = registry.getPgTable(table.descriptor.table) ?? table.pg;
    if (!pg) {
        throw new Error(
            `No registered table "${table.descriptor.table}" for the table "${table.slug}". ` +
            "The database holds no such table yet: run `rebase db push` (or `rebase schema generate` " +
            "if the generated schema predates it) and restart."
        );
    }
    return pg;
}

/** The key columns of `table`, for a caller that cannot work without one (`requireTableKeys`). */
export function keysOfTable(registry: PostgresTableRegistry, table: RuntimeTable): PrimaryKeyInfo[] {
    return requireTableKeys(table, registry.getPgTable(table.descriptor.table) ?? table.pg);
}

/**
 * The row key of the column whose SQL name is `sqlName` on `table` — what the
 * catalogue drizzle table and every row it returns are keyed by.
 *
 * A relation states its links in SQL terms (`localKey`, `foreignKey`,
 * `sourceKey`, `through.*`). A column the descriptor declares answers with
 * its key; a name that already is a key answers with itself; anything else is
 * the column's wire name (`toWireKey`), which is how the catalogue keys a
 * column nobody declared.
 */
export function columnKeyOf(table: RuntimeTable | undefined, sqlName: string): string {
    const declared = table?.columnsBySqlName.get(sqlName);
    if (declared) return declared.key;
    if (table?.columnsByKey.has(sqlName)) return sqlName;
    return toWireKey(sqlName);
}

/** The catalogue column `pg` holds for the SQL column `sqlName` of `table`, or `undefined`. */
export function columnOfTable(pg: PgTable, table: RuntimeTable | undefined, sqlName: string): AnyPgColumn | undefined {
    return columnAtKey(pg, columnKeyOf(table, sqlName));
}

/**
 * The row key of the column on the *source* table that a `hasOne`/`hasMany`
 * link points at: its `sourceKey`, else the source's (first) key column.
 *
 * The one reader of `sourceKey`'s absence, so no caller re-derives "or else
 * the primary key" for itself.
 */
export function sourceKeyField(registry: PostgresTableRegistry, owner: RuntimeTable, relation: PointsBackRelation): string {
    if (relation.sourceKey) return columnKeyOf(owner, relation.sourceKey);
    return keysOfTable(registry, owner)[0].fieldName;
}

/**
 * Whether this link joins on something other than the source's key — a
 * natural key (`sourceKey` naming another column). A caller holding a parent
 * *id* must then translate it to the source key's value first.
 */
export function joinsOnNaturalKey(registry: PostgresTableRegistry, owner: RuntimeTable, relation: PointsBackRelation): boolean {
    if (!relation.sourceKey) return false;
    return columnKeyOf(owner, relation.sourceKey) !== keysOfTable(registry, owner)[0].fieldName;
}

/**
 * Whether a link can be written through the relation. Every kind but `via`
 * is; a `via` is when it is a single hop joining on one condition
 * (`writable`, decided by the compiler).
 */
export function relationWritable(relation: RelationDescriptor): boolean {
    return relation.kind === "via" ? relation.writable : true;
}

/**
 * A relation whose target rows are shared with other parents — a
 * `manyToMany`, or any `via` chain — so writing "through" it addresses the
 * link, not the row.
 */
export function isSharedRelation(relation: RelationDescriptor): boolean {
    return relation.kind === "manyToMany" || relation.kind === "via";
}

/**
 * The relation `name` of `table`, or a **404 `UNKNOWN_RELATION`** naming the
 * relations the caller may know of. `hidden` are names this caller must not
 * learn (private relations, relations withheld from their roles): answered
 * as undeclared, and never listed.
 */
export function requireRelation(table: RuntimeTable, name: string, hidden: ReadonlySet<string> = new Set()): RelationDescriptor {
    const relation = hidden.has(name) ? undefined : relationOf(table.descriptor, name);
    if (relation) return relation;
    const available = table.descriptor.relations
        .filter(candidate => candidate.private !== true && !hidden.has(candidate.name))
        .map(candidate => candidate.name)
        .join(", ") || "(none)";
    // A path segment naming a relation the table does not declare is a bad
    // URL, not a server fault: 404, like an unknown table. The available
    // relations stay in the message because reaching this point means the
    // caller could already read the parent table, and `?include=` would list
    // the same names.
    throw ApiError.notFound(
        `Relation '${name}' not found in table '${table.slug}'. Available relations: [${available}]`,
        "UNKNOWN_RELATION"
    );
}

/**
 * The order a relation's rows come back in: the caller's, when it names one
 * (an include's `orderBy`, a nested listing's `orderBy`), else the order the
 * relation declares (`rel.hasMany(target, { orderBy })`), else none.
 *
 * The caller's order **replaces** the declared one rather than extending it:
 * an include that says `orderBy: [["title", "asc"]]` gets exactly that, as a
 * top-level read does. Whichever applies, the loaders end it with the
 * target's key ascending, so rows that tie come back in a stable order, and a
 * per-parent `limit` (and a nested listing's paging) keeps the first rows of
 * that same order.
 */
export function relatedRowsOrder(relation: RelationDescriptor, callerOrder?: readonly OrderByTuple[]): OrderByTuple[] | undefined {
    if (callerOrder && callerOrder.length > 0) return [...callerOrder];
    return relation.kind === "hasMany" && relation.orderBy && relation.orderBy.length > 0 ? relation.orderBy : undefined;
}
