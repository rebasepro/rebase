import type { ColumnDef, ColumnType, JoinStep } from "@rebasepro/types";
import { generateForeignKeyName, toSnakeCase, toWireKey } from "@rebasepro/utils";

/**
 * Every name the schema compiler derives, in one place.
 *
 * Each rule here is the rule today's collection pipeline applies — a deployed
 * database must not see one identifier move when its collections become
 * `defineTable`s. Where the legacy rule lives in a helper that takes a
 * `CollectionConfig` (`resolveRelation`, `getTableName`), it is mirrored here
 * over plain inputs, and `test/schema/compile-names.test.ts` feeds both the
 * same tables and compares.
 */

/** The Postgres schema a table lives in when it names none. */
export const DEFAULT_TABLE_SCHEMA = "public";

/** The schema a junction table is always created in, whatever its endpoints declare. */
export const JUNCTION_TABLE_SCHEMA = "public";

/**
 * The SQL table of a `defineTable(name, …)`: `table` when given, else the name
 * it was defined under.
 *
 * @group Schema
 */
export function deriveTableName(name: string, table: string | undefined): string {
    return table ?? name;
}

/**
 * The API slug of a `defineTable(name, …)`: `slug` when given, else the name.
 *
 * @group Schema
 */
export function deriveSlug(name: string, slug: string | undefined): string {
    return slug ?? name;
}

/**
 * The Postgres schema of a table: `schema` when given, else `public`.
 *
 * @group Schema
 */
export function deriveSchemaName(schema: string | undefined): string {
    return schema ?? DEFAULT_TABLE_SCHEMA;
}

/**
 * The SQL column of a `columns` entry: `.column(name)` when given, else the
 * snake_case of its key.
 *
 * `toSnakeCase` tokenises on case boundaries and drops every separator, so
 * `__order` becomes `order` and `photoURL` becomes `photo_url` — exactly the
 * column today's planner gives the same property.
 *
 * @group Schema
 */
export function deriveColumnName(key: string, def: Pick<ColumnDef, "column">): string {
    return def.column ?? toSnakeCase(key);
}

/**
 * The foreign-key column of a `belongsTo`: `localKey` when given, else
 * `<singular relation name>_id`.
 *
 * @group Schema
 */
export function deriveBelongsToLocalKey(relationName: string, localKey: string | undefined): string {
    return localKey ?? generateForeignKeyName(relationName);
}

/**
 * The row key a derived foreign-key column is served under: the camelCase of
 * its column (`author_id` → `authorId`).
 *
 * @group Schema
 */
export function deriveForeignKeyField(localKey: string): string {
    return toWireKey(localKey);
}

/**
 * The column on the target of a `hasOne` / `hasMany` that points back:
 * `foreignKey` when given, else `<singular source slug>_id`.
 *
 * @group Schema
 */
export function deriveTargetForeignKey(sourceSlug: string, foreignKey: string | undefined): string {
    return foreignKey ?? generateForeignKeyName(toSnakeCase(sourceSlug));
}

/**
 * The junction table of a `manyToMany`: `through` when given, else the two
 * SQL table names sorted and joined by `_`, so both sides of one link derive
 * the same table without agreeing in advance.
 *
 * @group Schema
 */
export function deriveJunctionTable(sourceTable: string, targetTable: string, through: string | undefined): string {
    return through ?? [sourceTable, targetTable].sort().join("_");
}

/**
 * The junction column pointing at the declaring table: `sourceKey` when given,
 * else `<singular source slug>_id`.
 *
 * @group Schema
 */
export function deriveJunctionSourceKey(sourceSlug: string, sourceKey: string | undefined): string {
    return sourceKey ?? generateForeignKeyName(toSnakeCase(sourceSlug));
}

/**
 * The junction column pointing at the target: `targetKey` when given, else
 * `<singular relation name>_id`.
 *
 * @group Schema
 */
export function deriveJunctionTargetKey(relationName: string, targetKey: string | undefined): string {
    return targetKey ?? generateForeignKeyName(relationName);
}

/**
 * The type a column pointing at a primary key must have: the key's own type,
 * except that a serial key's sequence is not copied — a column referencing a
 * `serial` is the plain `integer` of the same width.
 *
 * An enum key is referenced by its own enum type, so the referencing column
 * names the type the key's table created rather than deriving one of its own.
 *
 * @param keyTable The SQL table the key belongs to, which names an enum type
 *   declared without an explicit `name`.
 * @param keyColumn The key's SQL column, for the same reason.
 *
 * @group Schema
 */
export function deriveReferencingType(keyType: ColumnType, keyTable: string, keyColumn: string): ColumnType {
    switch (keyType.kind) {
        case "smallserial": return { kind: "smallint" };
        case "serial": return { kind: "integer" };
        case "bigserial": return { kind: "bigint" };
        case "enum": return { kind: "enum", values: [...keyType.values], name: keyType.name ?? `${keyTable}_${keyColumn}` };
        default: return keyType;
    }
}

/**
 * The name of the Postgres enum type an enum column uses: its explicit `name`,
 * else `<table>_<column>`.
 *
 * @group Schema
 */
export function deriveEnumTypeName(type: Extract<ColumnType, { kind: "enum" }>, table: string, column: string): string {
    return type.name ?? `${table}_${column}`;
}

/**
 * Whether a `via` chain can be written through: a to-one chain of one step, or
 * a to-many chain of two steps through one table between the ends — and every
 * step joins on one condition.
 *
 * The same answer `resolveRelation` gives a legacy `via` relation.
 *
 * @group Schema
 */
export function deriveViaWritable(cardinality: "one" | "many", steps: readonly Pick<JoinStep, "table" | "on">[]): boolean {
    if (steps.some(step => Array.isArray(step.on) && step.on.length !== 1)) return false;
    if (cardinality === "one") return steps.length === 1;
    return steps.length === 2 && steps[0].table !== steps[1].table;
}
