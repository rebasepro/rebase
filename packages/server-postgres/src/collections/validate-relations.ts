import { getTableColumns } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { CollectionConfig, ResolvedRelation } from "@rebasepro/types";
import { getTableName, resolveCollectionRelations } from "@rebasepro/common";

import { PostgresCollectionRegistry } from "./PostgresCollectionRegistry";

/**
 * Check every relation against the schema it actually runs on, at boot.
 *
 * The tagged union made the *shape* of a relation impossible to get wrong: a
 * `manyToMany` cannot carry a `foreignKeyOnTarget`, a to-many cannot carry a
 * `localKey`. What it cannot know is whether any of the names are real —
 * whether `posts_tags` is a table, whether `author_id` is a column, whether a
 * `joinPath` connects the tables it claims to. Those are facts about the
 * database, and the type system never sees them.
 *
 * Until now nothing checked them until a query ran, and the failures were the
 * quiet kind. A missing junction table logged a warning and returned no rows,
 * so `posts/1/tags` answered `[]` — indistinguishable from a post with no tags.
 * The relation looked configured, the admin drew the tab, the tab was empty,
 * and nothing anywhere said why.
 *
 * The junction default is the sharp edge this exists for. `through.table`
 * defaults to the two table names sorted and joined, so renaming a table
 * silently re-points the relation at a name that was never created. It is the
 * one default whose output changes when you edit something that looks
 * unrelated.
 */
export interface RelationDefect {
    /** Slug of the collection declaring the relation. */
    collection: string;
    relationName: string;
    kind: ResolvedRelation["kind"];
    /** What is wrong, in terms of the schema. */
    problem: string;
    /** The edit that fixes it. */
    fix: string;
}

/**
 * Every name a column answers to: the key in the drizzle schema and the real
 * column name in Postgres. A relation may legitimately be written with either,
 * and reporting a working relation as broken is worse than not checking.
 */
function columnNames(table: PgTable): Set<string> {
    const names = new Set<string>();
    for (const [key, col] of Object.entries(getTableColumns(table))) {
        names.add(key);
        const dbName = (col as { name?: string })?.name;
        if (dbName) names.add(dbName);
    }
    return names;
}

const quote = (xs: Iterable<string>) => Array.from(xs).map(s => `\`${s}\``).join(", ");

/** `on.from` / `on.to` accept a single column or a composite tuple. */
const asColumns = (value: string | string[]): string[] => Array.isArray(value) ? value : [value];

/**
 * Relations whose names do not resolve against the registered schema.
 *
 * Fails open wherever it cannot see enough to be sure — an unregistered source
 * table, a target belonging to another backend — because a false alarm here
 * costs more than a missed one: it would block boot on a working app.
 */
export function findRelationDefects(
    collections: CollectionConfig[],
    registry: PostgresCollectionRegistry
): RelationDefect[] {
    const defects: RelationDefect[] = [];
    const registeredSlugs = new Set(registry.getCollections().map(c => c.slug));

    for (const collection of collections) {
        const sourceTableName = getTableName(collection);
        const sourceTable = registry.getTable(sourceTableName);
        // Nothing to check against. Another boot warning already covers this.
        if (!sourceTable) continue;

        const sourceColumns = columnNames(sourceTable);
        const relations = resolveCollectionRelations(collection);

        for (const relation of Object.values(relations)) {
            const at = { collection: collection.slug,
relationName: relation.relationName,
kind: relation.kind };

            let targetCollection: CollectionConfig;
            try {
                targetCollection = relation.target();
            } catch (e) {
                defects.push({
                    ...at,
                    problem: `its \`target()\` threw: ${e instanceof Error ? e.message : String(e)}`,
                    fix: "a target thunk usually throws because of a circular import — make sure it is `() => otherCollection` and not evaluated at module load"
                });
                continue;
            }

            // A target this registry has never heard of belongs to another
            // backend; its tables are not ours to check.
            if (!registeredSlugs.has(targetCollection.slug)) continue;

            const targetTableName = getTableName(targetCollection);
            const targetTable = registry.getTable(targetTableName);
            if (!targetTable) {
                defects.push({
                    ...at,
                    problem: `it points at collection \`${targetCollection.slug}\`, which has no table \`${targetTableName}\` in the schema`,
                    fix: `create the \`${targetTableName}\` table, or correct \`table\` on the \`${targetCollection.slug}\` collection`
                });
                continue;
            }
            const targetColumns = columnNames(targetTable);

            switch (relation.kind) {
                case "belongsTo": {
                    if (!sourceColumns.has(relation.localKey)) {
                        defects.push({
                            ...at,
                            problem: `\`localKey: "${relation.localKey}"\` is not a column on \`${sourceTableName}\``,
                            fix: `add the column, or set \`localKey\` to one of: ${quote(sourceColumns)}`
                        });
                    }
                    break;
                }

                case "hasOne":
                case "hasMany": {
                    if (!targetColumns.has(relation.foreignKeyOnTarget)) {
                        defects.push({
                            ...at,
                            problem: `\`foreignKeyOnTarget: "${relation.foreignKeyOnTarget}"\` is not a column on the target table \`${targetTableName}\``,
                            fix: `add the column, or set \`foreignKeyOnTarget\` to one of: ${quote(targetColumns)}`
                        });
                    }
                    // `sourceKey` is the easiest of the two to put on the wrong
                    // side — it is the only column in a `hasMany` that lives
                    // here rather than on the target, and naming a target column
                    // reads perfectly well right next to `foreignKeyOnTarget`.
                    if (relation.sourceKey && !sourceColumns.has(relation.sourceKey)) {
                        defects.push({
                            ...at,
                            problem: `\`sourceKey: "${relation.sourceKey}"\` is not a column on \`${sourceTableName}\``,
                            fix: targetColumns.has(relation.sourceKey)
                                ? `it is a column on the *target* table \`${targetTableName}\` — \`sourceKey\` names ` +
                                  "the column on this collection that the target's foreign key points at, so it " +
                                  `must be one of: ${quote(sourceColumns)}`
                                : `add the column, or set \`sourceKey\` to one of: ${quote(sourceColumns)}`
                        });
                    }
                    break;
                }

                case "manyToMany": {
                    const { table, sourceColumn, targetColumn } = relation.through;
                    const junction = registry.getTable(table);
                    if (!junction) {
                        defects.push({
                            ...at,
                            problem: `its junction table \`${table}\` does not exist`,
                            fix: `create \`${table}\`, or name the real one with \`through: { table: "..." }\`. ` +
                                "Note that an omitted `through.table` is derived from the two table names sorted " +
                                "and joined, so renaming a table changes it"
                        });
                        break;
                    }
                    const junctionColumns = columnNames(junction);
                    for (const [label, column] of [["sourceColumn", sourceColumn], ["targetColumn", targetColumn]] as const) {
                        if (!junctionColumns.has(column)) {
                            defects.push({
                                ...at,
                                problem: `\`through.${label}: "${column}"\` is not a column on the junction table \`${table}\``,
                                fix: `set \`through.${label}\` to one of: ${quote(junctionColumns)}` +
                                    (label === "sourceColumn" ? " — it is the column naming *this* collection" : "")
                            });
                        }
                    }
                    break;
                }

                case "via": {
                    if (relation.joinPath.length === 0) {
                        defects.push({
                            ...at,
                            problem: "its `joinPath` is empty, so it joins nothing",
                            fix: "add at least one step, ending at the target's table"
                        });
                        break;
                    }

                    // Walk the chain: each step's `from` names columns on the
                    // previous table, its `to` names columns on its own.
                    let prevName = sourceTableName;
                    let prevColumns = sourceColumns;
                    let broken = false;

                    for (const [i, step] of relation.joinPath.entries()) {
                        const stepTable = registry.getTable(step.table);
                        if (!stepTable) {
                            defects.push({
                                ...at,
                                problem: `step ${i + 1} of its \`joinPath\` joins \`${step.table}\`, which is not a table in the schema`,
                                fix: `correct \`joinPath[${i}].table\``
                            });
                            broken = true;
                            break;
                        }
                        const stepColumns = columnNames(stepTable);

                        for (const column of asColumns(step.on.from)) {
                            if (!prevColumns.has(column)) {
                                defects.push({
                                    ...at,
                                    problem: `step ${i + 1} joins \`${prevName}.${column}\` → \`${step.table}\`, but \`${column}\` is not a column on \`${prevName}\``,
                                    fix: `\`joinPath[${i}].on.from\` names columns on ${i === 0 ? "this collection's table" : `the previous step's table (\`${prevName}\`)`}: ${quote(prevColumns)}`
                                });
                            }
                        }
                        for (const column of asColumns(step.on.to)) {
                            if (!stepColumns.has(column)) {
                                defects.push({
                                    ...at,
                                    problem: `step ${i + 1} joins into \`${step.table}.${column}\`, but \`${column}\` is not a column on \`${step.table}\``,
                                    fix: `\`joinPath[${i}].on.to\` names columns on \`${step.table}\`: ${quote(stepColumns)}`
                                });
                            }
                        }

                        if (asColumns(step.on.from).length !== asColumns(step.on.to).length) {
                            defects.push({
                                ...at,
                                problem: `step ${i + 1} compares ${asColumns(step.on.from).length} column(s) against ${asColumns(step.on.to).length}`,
                                fix: `\`from\` and \`to\` must name the same number of columns in \`joinPath[${i}]\``
                            });
                        }

                        prevName = step.table;
                        prevColumns = stepColumns;
                    }

                    // The chain has to end where the relation says it points,
                    // or the rows it returns are not the target's rows.
                    if (!broken && prevName !== targetTableName) {
                        defects.push({
                            ...at,
                            problem: `its \`joinPath\` ends at \`${prevName}\`, but it targets \`${targetCollection.slug}\` (table \`${targetTableName}\`)`,
                            fix: `make the last step join \`${targetTableName}\`, or point \`target\` at the collection backed by \`${prevName}\``
                        });
                    }
                    break;
                }

                default: {
                    const exhaustive: never = relation;
                    throw new Error(`Unhandled relation kind: ${JSON.stringify(exhaustive)}`);
                }
            }
        }
    }

    return defects;
}

/**
 * Fail boot on any relation that cannot resolve, listing all of them at once.
 *
 * Deliberately fatal rather than a warning. Every one of these produces an
 * empty result at query time and nothing else — an empty tab, an empty
 * `include`, a subcollection that looks like it has no rows. A server that
 * refuses to start is recoverable in a minute; a relation that quietly answers
 * "nothing" is the kind of bug found in production, weeks later, by a user
 * asking where their data went.
 */
export function assertRelationsResolve(
    collections: CollectionConfig[],
    registry: PostgresCollectionRegistry
): void {
    const defects = findRelationDefects(collections, registry);
    if (defects.length === 0) return;

    const lines = defects.map(d =>
        `  • ${d.collection}.${d.relationName} (${d.kind})\n` +
        `      ${d.problem}\n` +
        `      fix: ${d.fix}`
    );

    throw new Error(
        `${defects.length} relation${defects.length === 1 ? "" : "s"} cannot resolve against ` +
        "`backend/src/schema.generated.ts`.\n\n" +
        "Each of these would return no rows at query time rather than reporting an error, " +
        "so they are fatal at boot instead.\n\n" +
        // This reads the *generated file*, not the database, and the difference
        // is the whole diagnosis after an upgrade. Boot-ensure renames columns
        // in the database — a 0.12 → 0.13 upgrade singularises a junction key,
        // `categorie_id` → `category_id` — and the checked-in file still
        // declares the old name. The config is then correct and the file is
        // stale, so the per-defect advice below, which lists the columns this
        // file has, names a column that no longer exists in the database.
        // Following it turns a recoverable state into a broken config.
        //
        // Hence the ordering: regenerate first, and only then consider that the
        // collection might be the thing that is wrong.
        "If the database was migrated recently — an upgrade, a `db push`, a restore — this file is\n" +
        "probably older than the schema it describes. Regenerate it before changing anything else:\n\n" +
        "    rebase schema generate\n\n" +
        "If it is already current, then the collection is what disagrees with it:\n\n" +
        lines.join("\n\n") + "\n"
    );
}
