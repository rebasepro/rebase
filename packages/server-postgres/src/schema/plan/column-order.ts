/**
 * The order a table's columns are planned in, read from its descriptor.
 *
 * `TableDescriptor.columns` lists the declared columns in physical order and
 * then the foreign keys the `belongsTo` relations derive. The plan's order —
 * which `schema.sql`, `schema.generated.ts` and every golden are written in —
 * predates the table model, and it places a link where the legacy collection
 * shape listed its relation property:
 *
 * - a declared column a `belongsTo` binds that is **nothing but the foreign
 *   key** (its key is the camelCase of the column, its type the target key's,
 *   no rule of its own, the constraint kept) is planned *as the link*, at the
 *   column's position — {@link isPlainForeignKey};
 * - any other bound column is planned as a column of its own at its position,
 *   and its link adds a constraint-only entry (`columnOwnedByProperty`);
 * - those constraint-only entries and the derived foreign keys are placed in
 *   relation order among the links: right after the link planned before them in
 *   that order, else just before the one after them, else after the declared
 *   columns;
 * - an `id` that is exactly the planner's implicit key (`id TEXT PRIMARY KEY
 *   DEFAULT gen_random_uuid()::text`, declared first) is left out: the planner
 *   adds it back as the implicit key, first in SQL and last in the Drizzle file.
 *
 * Every fact this reads is the descriptor's, and the target's key type is the
 * target descriptor's.
 */
import type { ColumnDescriptor, ColumnType, TableDescriptor } from "@rebasepro/types";
import type { RelationOfKind } from "@rebasepro/common";
import { toSnakeCase, toWireKey } from "@rebasepro/utils";

/** A `belongsTo` relation descriptor. */
export type BelongsToDescriptor = RelationOfKind<"belongsTo">;

/**
 * One entry of a table's planned columns, in order.
 *
 * - `column`: a column planned from its descriptor;
 * - `link` / `absorbed`: a bound column that is nothing but the foreign key,
 *   planned as the link at the column's position;
 * - `link` / `constraint`: the constraint of a link whose bound column is
 *   planned on its own (the entry renderers skip as a column);
 * - `link` / `derived`: a foreign-key column the relation derives.
 */
export type PlannedColumnEntry =
    | { kind: "column"; column: ColumnDescriptor }
    | { kind: "link"; form: "absorbed" | "constraint" | "derived"; relation: BelongsToDescriptor; column: ColumnDescriptor };

/** The implicit key's DEFAULT: a uuid, as text. */
export const IMPLICIT_ID_DEFAULT = "gen_random_uuid()::text";

/** The type a column pointing at this key must have: a serial read as its plain integer. */
export const referencingColumnType = (type: ColumnType): ColumnType => {
    switch (type.kind) {
        case "smallserial": return { kind: "smallint" };
        case "serial": return { kind: "integer" };
        case "bigserial": return { kind: "bigint" };
        default: return type;
    }
};

/**
 * The type of the target's key a link points at, as a column pointing at it
 * holds it; `text` for a target with no key, `undefined` for a composite key.
 */
export const targetKeyColumnType = (target: TableDescriptor): ColumnType | undefined => {
    const keys = target.columns.filter(column => column.primaryKey === true);
    if (keys.length === 0) return { kind: "text" };
    if (keys.length > 1) return undefined;
    return referencingColumnType(keys[0].type);
};

/**
 * Whether the table's first column is exactly the key the planner gives a
 * table that declares none, which it adds back itself.
 */
export function isImplicitIdColumn(descriptor: TableDescriptor): boolean {
    const first = descriptor.columns[0];
    if (!first || descriptor.primaryKey.length !== 1 || descriptor.primaryKey[0] !== first.key || first.key !== "id") return false;
    if (first.column !== "id" || first.type.kind !== "text" || first.derived) return false;
    if (first.default?.kind !== "sql" || first.default.expression !== IMPLICIT_ID_DEFAULT) return false;
    return !first.unique && !first.readOnly && !first.private && first.access === undefined && first.stamp === undefined
        && first.validate === undefined && first.oneOf === undefined && first.description === undefined
        && first.storage === undefined && first.generated === undefined && first.transforms === undefined;
}

/**
 * Whether a `belongsTo` was written `constraint: false`. The descriptor also
 * records `constraint: false` for a link into a view or out of one, where
 * Postgres refuses a foreign key — that link was not written without one.
 */
export const writtenWithoutConstraint = (
    descriptor: TableDescriptor,
    relation: BelongsToDescriptor,
    target: TableDescriptor
): boolean => !relation.constraint && descriptor.kind === "table" && target.kind === "table";

/**
 * Whether the column a `belongsTo` binds is nothing but the foreign key the
 * relation would have derived: served under the camelCase of its SQL name (and
 * no relation is named after that column), typed as the target's key, with no
 * rule of its own, and the relation keeps its constraint. Such a column is
 * planned once, as the link.
 */
export function isPlainForeignKey(
    descriptor: TableDescriptor,
    column: ColumnDescriptor,
    relation: BelongsToDescriptor,
    target: TableDescriptor
): boolean {
    if (writtenWithoutConstraint(descriptor, relation, target)) return false;
    const localKey = column.column;
    for (const other of descriptor.relations) {
        if (other.name === localKey || toSnakeCase(other.name) === localKey) return false;
    }
    if (toWireKey(localKey) !== column.key) return false;
    if (column.primaryKey || column.default !== undefined || column.generated !== undefined || column.readOnly || column.private) return false;
    if (column.access !== undefined || column.stamp !== undefined || column.validate !== undefined || column.oneOf !== undefined) return false;
    if (column.description !== undefined || column.storage !== undefined || column.semantic !== undefined) return false;
    if (column.vectorIndex !== undefined || column.json !== undefined || column.element !== undefined || column.transforms !== undefined) return false;
    const targetType = targetKeyColumnType(target);
    if (targetType === undefined || targetType.kind === "enum" || column.type.kind === "enum") return false;
    return JSON.stringify(column.type) === JSON.stringify(targetType);
}

/**
 * A table's planned column entries, in the plan's order (see the module
 * comment). `targetOf` answers a relation target's descriptor by slug.
 */
export function plannedColumnEntries(
    descriptor: TableDescriptor,
    targetOf: (slug: string) => TableDescriptor
): PlannedColumnEntry[] {
    const relationIndex = new Map(descriptor.relations.map((relation, index) => [relation.name, index]));
    const ordered: { entry: PlannedColumnEntry; relation?: number }[] = [];
    const absorbed = new Set<string>();
    const implicitId = isImplicitIdColumn(descriptor);

    descriptor.columns.forEach((column, position) => {
        if (column.derived) return;
        if (position === 0 && implicitId) return;
        const relation = column.foreignKeyOf === undefined ? undefined : belongsToNamed(descriptor, column.foreignKeyOf);
        if (relation && isPlainForeignKey(descriptor, column, relation, targetOf(relation.target))) {
            ordered.push({ entry: { kind: "link", form: "absorbed", relation, column }, relation: relationIndex.get(relation.name) });
            absorbed.add(relation.name);
            return;
        }
        ordered.push({ entry: { kind: "column", column } });
    });

    descriptor.relations.forEach((relation, index) => {
        if (relation.kind !== "belongsTo" || absorbed.has(relation.name)) return;
        const column = descriptor.columns.find(candidate => candidate.foreignKeyOf === relation.name);
        if (!column) {
            throw new Error(`Internal: the relation "${relation.name}" of table "${descriptor.slug}" has no foreign-key column in its descriptor.`);
        }
        const item = { entry: { kind: "link" as const, form: column.derived ? "derived" as const : "constraint" as const, relation, column }, relation: index };
        let after = -1;
        for (let position = ordered.length - 1; position >= 0; position--) {
            const other = ordered[position].relation;
            if (other !== undefined && other < index) {
                after = position;
                break;
            }
        }
        const before = ordered.findIndex(other => other.relation !== undefined && other.relation > index);
        if (after !== -1) ordered.splice(after + 1, 0, item);
        else if (before !== -1) ordered.splice(before, 0, item);
        else ordered.push(item);
    });

    return ordered.map(item => item.entry);
}

const belongsToNamed = (descriptor: TableDescriptor, name: string): BelongsToDescriptor | undefined => {
    const relation = descriptor.relations.find(candidate => candidate.name === name);
    return relation?.kind === "belongsTo" ? relation : undefined;
};
