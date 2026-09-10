/**
 * Build drizzle `relations()` for declared collections, from the collections.
 *
 * The heuristic builder in `dynamic-tables.ts` names a relation after the
 * foreign-key column (`author_id` → `author`), which is the only evidence a
 * database offers and is right for BaaS mode. It is wrong for a project that
 * declares its collections: there the relation's name is whatever the author
 * called it, `include=writer` addresses that name, and a relation whose key was
 * guessed from the column simply does not answer to it — the read returns the
 * bare foreign key and no target, silently, which is how a demo lost every
 * relation in its list view while the detail view (a different code path) kept
 * working.
 *
 * So when there are collections, they are the authority for *which* relations
 * exist and what they are called; the live catalogue is the authority for the
 * columns underneath. This is the same pairing `generate-drizzle-schema-logic`
 * emits into `schema.generated.ts` — kind for kind, key for key, and paired by
 * the same {@link sharedRelationName} — only built against tables read back from
 * `information_schema` rather than against a file.
 */
import { getTableColumns, relations, type Relations } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { CollectionConfig, ResolvedRelation } from "@rebasepro/types";
import { fieldKeyForColumn, getTableName, resolveCollectionRelations } from "@rebasepro/common";
import { logger } from "@rebasepro/server";

import { sharedRelationName } from "./relation-names";

/** A collection's table, with any schema prefix stripped — as the DDL creates it. */
export function bareTableName(name: string): string {
    return name.includes(".") ? name.split(".").pop()! : name;
}

/**
 * The field key a collection's rows are addressed by, as the generated module
 * spells it: the property marked `isId`, else `id`.
 *
 * Deliberately the config's answer rather than the catalogue's primary key —
 * `references: [users.id]` in the generated file is keyed the same way, and the
 * two have to name the same Drizzle key for a relation to compile at all.
 */
function primaryKeyFieldKey(collection: CollectionConfig): string {
    for (const [key, prop] of Object.entries(collection.properties ?? {})) {
        if (prop && typeof prop === "object" && "isId" in prop && Boolean((prop as { isId?: unknown }).isId)) {
            return key;
        }
    }
    return "id";
}

/**
 * A column of a built table, by its Drizzle key or by its column name.
 *
 * The key is the answer in the ordinary case, and the name is the fallback for
 * the one place a caller holds a column and not a field: a junction table's two
 * foreign keys, which are keyed by column *unless* the project also declares a
 * collection over that table, in which case they are keyed by its property
 * names. Looking both up costs a scan of one table and removes the difference.
 */
function columnOf(table: PgTable | undefined, key: string): unknown {
    if (!table) return undefined;
    // Drizzle's column map is keyed by the JS property name, which is exactly
    // the "keyed by its property names" case this function's docblock
    // describes — so `getTableColumns` answers it, and indexing the table
    // object (which also reaches its methods and symbols) was never needed.
    const direct = getTableColumns(table)[key];
    if (direct) return direct;
    for (const column of Object.values(getTableColumns(table))) {
        if ((column as { name?: unknown })?.name === key) return column;
    }
    return undefined;
}

interface OneSpec {
    key: string;
    target: PgTable;
    fields?: unknown[];
    references?: unknown[];
    relationName: string;
}

interface ManySpec {
    key: string;
    target: PgTable;
    relationName: string;
}

/**
 * Drizzle relations for every declared collection, keyed `<table>Relations`.
 *
 * @param collections every collection backed by a table in `tables`
 * @param tables      catalogue-built tables, keyed by bare table name
 */
export function buildDrizzleRelationsFromCollections(
    collections: CollectionConfig[],
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

    const byTable = new Map<string, CollectionConfig>();
    for (const collection of collections) {
        const table = bareTableName(getTableName(collection));
        if (table && tables[table]) byTable.set(table, collection);
    }

    for (const [tableName, collection] of byTable) {
        const table = tables[tableName];

        for (const [relationKey, relation] of Object.entries(resolveCollectionRelations(collection))) {
            let target: CollectionConfig;
            try {
                target = relation.target();
            } catch (err) {
                // Nothing to build against, and nothing to fail over: the boot
                // relation check reports an unresolvable target by name.
                logger.debug(`[schema] Relation ${collection.slug}.${relationKey} has no resolvable target`, { error: err });
                continue;
            }
            const targetTableName = bareTableName(getTableName(target));
            const targetTable = tables[targetTableName];
            const name = sharedRelationName(relation, collection);

            switch (relation.kind) {
                case "belongsTo": {
                    if (!targetTable) continue;
                    if (!claim(tableName, name, relation.kind)) continue;
                    const localKey = fieldKeyForColumn(collection, relation.localKey);
                    const referenced = primaryKeyFieldKey(target);
                    const field = columnOf(table, localKey);
                    const reference = columnOf(targetTable, referenced);
                    // A column the catalogue does not have would make drizzle
                    // throw `Cannot read properties of undefined` from inside
                    // `normalizeRelation`, three frames from anything nameable.
                    // The boot relation check reports the same defect in terms
                    // of the collection; this only declines to build it.
                    if (!field || !reference) continue;
                    addOne(tableName, {
                        key: relationKey,
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
                    // No fields/references: the foreign key lives on the target,
                    // and drizzle pairs this with the owning side by name alone.
                    // Passing them here crashes `normalizeRelation`.
                    addOne(tableName, { key: relationKey, target: targetTable, relationName: name });
                    break;
                }

                case "hasMany": {
                    if (!targetTable) continue;
                    if (!claim(tableName, name, relation.kind)) continue;
                    addMany(tableName, { key: relationKey, target: targetTable, relationName: name });
                    break;
                }

                case "manyToMany": {
                    const junctionName = bareTableName(relation.through.table);
                    const junction = tables[junctionName];
                    if (!junction) continue;
                    if (!claim(tableName, name, relation.kind)) continue;
                    addMany(tableName, { key: relationKey, target: junction, relationName: name });
                    addJunctionSides(relation, collection, target, junctionName, tables, addOne, claim);
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
    // collection happens to declare a `belongsTo` back. Where it does not, the
    // generated file synthesizes one under a `_synth_` key, and so does this.
    for (const [tableName, collection] of byTable) {
        const table = tables[tableName];
        for (const [, relation] of Object.entries(resolveCollectionRelations(collection))) {
            if (relation.kind !== "hasMany" && relation.kind !== "hasOne") continue;
            let target: CollectionConfig;
            try {
                target = relation.target();
            } catch {
                continue;
            }
            const targetTableName = bareTableName(getTableName(target));
            const targetTable = tables[targetTableName];
            if (!targetTable) continue;

            const name = sharedRelationName(relation, collection);
            if (!claim(targetTableName, name, "belongsTo")) continue;

            const fkKey = fieldKeyForColumn(target, relation.foreignKeyOnTarget);
            const referencedKey = relation.sourceKey
                ? fieldKeyForColumn(collection, relation.sourceKey)
                : primaryKeyFieldKey(collection);
            const field = columnOf(targetTable, fkKey);
            const reference = columnOf(table, referencedKey);
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
            const map: Record<string, unknown> = {};
            for (const spec of tableOnes) {
                map[spec.key] = spec.fields
                    ? one(spec.target, {
                        fields: spec.fields as never,
                        references: spec.references as never,
                        relationName: spec.relationName
                    })
                    // A `hasOne` names its counterpart and gives no columns —
                    // drizzle's own type demands `fields`/`references` here, but
                    // supplying them is what crashes `normalizeRelation`, so the
                    // config is the shape the runtime wants and the cast says so.
                    : one(spec.target, { relationName: spec.relationName } as never);
            }
            for (const spec of tableManys) {
                if (map[spec.key]) continue;
                map[spec.key] = many(spec.target, { relationName: spec.relationName });
            }
            return map as never;
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
    relation: Extract<ResolvedRelation, { kind: "manyToMany" }>,
    sourceCollection: CollectionConfig,
    targetCollection: CollectionConfig,
    junctionName: string,
    tables: Record<string, PgTable>,
    addOne: (table: string, spec: OneSpec) => void,
    claim: (table: string, name: string, kind: string) => boolean
): void {
    const junction = tables[junctionName];
    const sourceTable = tables[bareTableName(getTableName(sourceCollection))];
    const targetTable = tables[bareTableName(getTableName(targetCollection))];
    if (!junction || !sourceTable || !targetTable) return;

    const sourceName = sharedRelationName(relation, sourceCollection);
    // The far endpoint pairs with whatever *it* calls this junction, so the two
    // sides are looked up rather than assumed: an inverse declared on the target
    // owns the name, and only a junction nothing points back through needs a
    // synthesized one.
    const inverse = Object.values(resolveCollectionRelations(targetCollection))
        .find(r => r.kind === "manyToMany"
            && bareTableName(r.through.table) === junctionName);
    const targetName = inverse
        ? sharedRelationName(inverse, targetCollection)
        : `${junctionName}_${relation.through.targetColumn}`;

    const pairs: [string, PgTable, string, CollectionConfig, string][] = [
        [relation.through.sourceColumn, sourceTable, sourceName, sourceCollection, "source"],
        [relation.through.targetColumn, targetTable, targetName, targetCollection, "target"]
    ];

    for (const [column, endpointTable, relationName, endpointCollection] of pairs) {
        if (!claim(junctionName, relationName, "junction")) continue;
        const field = columnOf(junction, column);
        const reference = columnOf(endpointTable, primaryKeyFieldKey(endpointCollection));
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
