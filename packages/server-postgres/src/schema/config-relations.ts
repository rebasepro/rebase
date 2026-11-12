/**
 * Build drizzle `relations()` for declared tables, from their descriptors.
 *
 * The heuristic builder in `dynamic-tables.ts` names a relation after the
 * foreign-key column (`author_id` → `author`), which is the only evidence a
 * database offers and is right for BaaS mode. It is wrong for a project that
 * declares its tables: there the relation's name is whatever the author
 * called it, `include=writer` addresses that name, and a relation whose key was
 * guessed from the column simply does not answer to it — the read returns the
 * bare foreign key and no target, silently, which is how a demo lost every
 * relation in its list view while the detail view (a different code path) kept
 * working.
 *
 * So when there are declared tables, they are the authority for *which* relations
 * exist and what they are called; the live catalogue is the authority for the
 * columns underneath. This is the same pairing `generate-drizzle-schema-logic`
 * emits into `schema.generated.ts` — kind for kind, key for key, and paired by
 * the same {@link tableRelationName} — only built against tables read back from
 * `information_schema` rather than against a file.
 */
import { getTableColumns, relations, type AnyColumn, type Relation, type Relations } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { RelationDescriptor, TableDescriptor } from "@rebasepro/types";

import { servedKeyOf, tableRelationName } from "./relation-names";

/** A table's name with any schema prefix stripped — as the DDL creates it. */
export function bareTableName(name: string): string {
    return name.includes(".") ? name.split(".").pop()! : name;
}

/**
 * The key a table's rows are addressed by, as the generated module spells it:
 * the first primary-key column's key, else `id`.
 *
 * Deliberately the declaration's answer rather than the catalogue's primary
 * key — `references: [users.id]` in the generated file is keyed the same way,
 * and the two have to name the same Drizzle key for a relation to compile at
 * all.
 */
function primaryKeyFieldKey(table: TableDescriptor): string {
    return table.primaryKey[0] ?? "id";
}

/**
 * The key on the source table that a `hasOne`/`hasMany` foreign key holds:
 * its `sourceKey` when the link names one, else the primary key.
 */
function sourceKeyFieldKey(
    relation: Extract<RelationDescriptor, { kind: "hasOne" | "hasMany" }>,
    source: TableDescriptor
): string {
    return relation.sourceKey
        ? servedKeyOf(source, relation.sourceKey)
        : primaryKeyFieldKey(source);
}

/**
 * A column of a built table, by its Drizzle key or by its column name.
 *
 * The key is the answer in the ordinary case, and the name is the fallback for
 * the one place a caller holds a column and not a field: a junction table's two
 * foreign keys, which are keyed by column *unless* the project also declares a
 * table over that junction, in which case they are keyed by its column keys.
 * Looking both up costs a scan of one table and removes the difference.
 */
function columnOf(table: PgTable | undefined, key: string): AnyColumn | undefined {
    if (!table) return undefined;
    // Drizzle's column map is keyed by the JS property name, which is exactly
    // the "keyed by its column keys" case this function's docblock describes
    // — so `getTableColumns` answers it, and indexing the table object (which
    // also reaches its methods and symbols) was never needed.
    const direct = getTableColumns(table)[key];
    if (direct) return direct;
    for (const column of Object.values(getTableColumns(table))) {
        if (column.name === key) return column;
    }
    return undefined;
}

interface OneSpec {
    key: string;
    target: PgTable;
    fields: [AnyColumn, ...AnyColumn[]];
    references: [AnyColumn, ...AnyColumn[]];
    relationName: string;
}

interface ManySpec {
    key: string;
    target: PgTable;
    relationName: string;
}

/**
 * Drizzle relations for every declared table, keyed `<table>Relations`.
 *
 * @param descriptors every declared table backed by a table in `tables`, and
 *                    the targets of their relations
 * @param tables      catalogue-built tables, keyed by bare table name
 */
export function buildDrizzleRelationsFromTables(
    descriptors: readonly TableDescriptor[],
    tables: Record<string, PgTable>
): Record<string, Relations> {
    const ones = new Map<string, OneSpec[]>();
    const manys = new Map<string, ManySpec[]>();
    /** `<relationName>::<kind>` already emitted on a table — the generator dedupes the same way. */
    const emitted = new Map<string, Set<string>>();

    const claim = (table: string, name: string, kind: string): boolean => {
        const seen = emitted.get(table) ?? new Set<string>();
        emitted.set(table, seen);
        const key = `${name}::${kind}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    };

    const addOne = (table: string, spec: OneSpec) => ones.set(table, [...(ones.get(table) ?? []), spec]);
    const addMany = (table: string, spec: ManySpec) => manys.set(table, [...(manys.get(table) ?? []), spec]);

    const bySlug = new Map(descriptors.map(descriptor => [descriptor.slug, descriptor]));
    // Only reached for a target that is among `descriptors`: every caller
    // looks the target up in `bySlug` first.
    const targetOf = (slug: string): TableDescriptor => {
        const target = bySlug.get(slug);
        if (!target) throw new Error(`Relation target "${slug}" is not a declared table`);
        return target;
    };

    const byTable = new Map<string, TableDescriptor>();
    for (const descriptor of descriptors) {
        const table = bareTableName(descriptor.table);
        if (tables[table]) byTable.set(table, descriptor);
    }

    for (const [tableName, source] of byTable) {
        const table = tables[tableName];

        for (const relation of source.relations) {
            // A target outside this set has nothing to build against, and
            // nothing to fail over: the boot relation check reports an
            // unresolvable target by name.
            const target = bySlug.get(relation.target);
            if (!target) continue;
            const targetTableName = bareTableName(target.table);
            const targetTable = tables[targetTableName];
            const name = tableRelationName(relation, source, targetOf);

            switch (relation.kind) {
                case "belongsTo": {
                    if (!targetTable) continue;
                    if (!claim(tableName, name, relation.kind)) continue;
                    const field = columnOf(table, servedKeyOf(source, relation.localKey));
                    const reference = columnOf(targetTable, primaryKeyFieldKey(target));
                    // A column the catalogue does not have would make drizzle
                    // throw `Cannot read properties of undefined` from inside
                    // `normalizeRelation`, three frames from anything nameable.
                    // The boot relation check reports the same defect in terms
                    // of the table; this only declines to build it.
                    if (!field || !reference) continue;
                    addOne(tableName, {
                        key: relation.name,
                        target: targetTable,
                        fields: [field],
                        references: [reference],
                        relationName: name
                    });
                    break;
                }

                case "hasOne": {
                    if (!targetTable) continue;
                    if (!claim(tableName, name, relation.kind)) continue;
                    // The foreign key lives on the target, so this side states
                    // the join from its own end: its source key against the
                    // target's foreign key. Drizzle has no `one()` that is paired
                    // by `relationName` alone — `createOne` reads
                    // `config.fields.reduce(...)` as the relations are evaluated,
                    // which is at `drizzle({ schema })` — and a bare `one(target)`
                    // is paired by table, which is ambiguous as soon as the target
                    // has two links back here or the link is to its own table.
                    // These are the columns drizzle would infer from the owning
                    // side, given outright.
                    const field = columnOf(table, sourceKeyFieldKey(relation, source));
                    const reference = columnOf(targetTable, servedKeyOf(target, relation.foreignKey));
                    if (!field || !reference) continue;
                    addOne(tableName, {
                        key: relation.name,
                        target: targetTable,
                        fields: [field],
                        references: [reference],
                        relationName: name
                    });
                    break;
                }

                case "hasMany": {
                    if (!targetTable) continue;
                    if (!claim(tableName, name, relation.kind)) continue;
                    addMany(tableName, { key: relation.name, target: targetTable, relationName: name });
                    break;
                }

                case "manyToMany": {
                    const junctionName = bareTableName(relation.through.table);
                    const junction = tables[junctionName];
                    if (!junction) continue;
                    if (!claim(tableName, name, relation.kind)) continue;
                    addMany(tableName, { key: relation.name, target: junction, relationName: name });
                    addJunctionSides(relation, source, target, junctionName, tables, targetOf, addOne, claim);
                    break;
                }

                case "via":
                    // A join chain is resolved at query time, not modelled as a
                    // drizzle relation — same as the generator.
                    break;
            }
        }
    }

    // The reciprocal a `many()` needs. A `hasMany` gives drizzle no columns to
    // join on; it finds them on the owning side, which exists only if the other
    // table happens to declare a `belongsTo` back. Where it does not, the
    // generated file synthesizes one under a `_synth_` key, and so does this.
    // A `hasOne` names its own columns, and gets the same owning side so the
    // target's table carries the link back under the same `relationName`.
    for (const [tableName, source] of byTable) {
        const table = tables[tableName];
        for (const relation of source.relations) {
            if (relation.kind !== "hasMany" && relation.kind !== "hasOne") continue;
            const target = bySlug.get(relation.target);
            if (!target) continue;
            const targetTableName = bareTableName(target.table);
            const targetTable = tables[targetTableName];
            if (!targetTable) continue;

            const name = tableRelationName(relation, source, targetOf);
            if (!claim(targetTableName, name, "belongsTo")) continue;

            const fkKey = servedKeyOf(target, relation.foreignKey);
            const field = columnOf(targetTable, fkKey);
            const reference = columnOf(table, sourceKeyFieldKey(relation, source));
            if (!field || !reference) continue;

            addOne(targetTableName, {
                key: `_synth_${targetTableName}_${fkKey}`,
                target: tables[tableName],
                fields: [field],
                references: [reference],
                relationName: name
            });
        }
    }

    const built: Record<string, Relations> = {};
    for (const tableName of new Set([...ones.keys(), ...manys.keys()])) {
        const table = tables[tableName];
        if (!table) continue;
        const tableOnes = ones.get(tableName) ?? [];
        const tableManys = manys.get(tableName) ?? [];

        built[`${tableName}Relations`] = relations(table, ({ one, many }) => {
            const map: Record<string, Relation> = {};
            for (const spec of tableOnes) {
                map[spec.key] = one(spec.target, {
                    fields: spec.fields,
                    references: spec.references,
                    relationName: spec.relationName
                });
            }
            for (const spec of tableManys) {
                if (map[spec.key]) continue;
                map[spec.key] = many(spec.target, { relationName: spec.relationName });
            }
            return map;
        });
    }

    return built;
}

/**
 * The junction table's own two `one()` sides.
 *
 * A many-to-many is a `many(junction)` on each endpoint, so the junction has to
 * carry the matching `one()` back to each — without them drizzle can join a
 * post to its `posts_tags` rows and no further, and the tags come back as
 * junction rows. Keyed by the junction's own columns, which is how the
 * generated file keys them too.
 */
function addJunctionSides(
    relation: Extract<RelationDescriptor, { kind: "manyToMany" }>,
    source: TableDescriptor,
    target: TableDescriptor,
    junctionName: string,
    tables: Record<string, PgTable>,
    targetOf: (slug: string) => TableDescriptor,
    addOne: (table: string, spec: OneSpec) => void,
    claim: (table: string, name: string, kind: string) => boolean
): void {
    const junction = tables[junctionName];
    const sourceTable = tables[bareTableName(source.table)];
    const targetTable = tables[bareTableName(target.table)];
    if (!junction || !sourceTable || !targetTable) return;

    const sourceName = tableRelationName(relation, source, targetOf);
    // The far endpoint pairs with whatever *it* calls this junction, so the two
    // sides are looked up rather than assumed: an inverse declared on the target
    // owns the name, and only a junction nothing points back through needs a
    // synthesized one.
    const inverse = target.relations
        .find(r => r.kind === "manyToMany" && bareTableName(r.through.table) === junctionName);
    const targetName = inverse
        ? tableRelationName(inverse, target, targetOf)
        : `${junctionName}_${relation.through.targetKey}`;

    const pairs: [string, PgTable, string, TableDescriptor][] = [
        [relation.through.sourceKey, sourceTable, sourceName, source],
        [relation.through.targetKey, targetTable, targetName, target]
    ];

    for (const [column, endpointTable, relationName, endpoint] of pairs) {
        if (!claim(junctionName, relationName, "junction")) continue;
        const field = columnOf(junction, column);
        const reference = columnOf(endpointTable, primaryKeyFieldKey(endpoint));
        if (!field || !reference) continue;
        addOne(junctionName, {
            key: column,
            target: endpointTable,
            fields: [field],
            references: [reference],
            relationName
        });
    }
}
