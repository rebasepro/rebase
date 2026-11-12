import { getTableColumns } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import type { RelationDescriptor } from "@rebasepro/types";
import { generateForeignKeyName, legacyForeignKeyName } from "@rebasepro/utils";

import type { PostgresTableRegistry } from "./PostgresTableRegistry";
import type { RuntimeTable } from "./runtime-table";

/**
 * Check every relation against the schema it actually runs on, at boot.
 *
 * "Actually runs on" is literal: the registry's catalogue tables are read back
 * from `information_schema` (see `catalogue-schema.ts`), so this compares each
 * table's relation descriptors against the database. It used to compare them against the
 * committed `schema.generated.ts`, which made a *stale file* able to refuse a
 * boot — the exact incident class from 0.13, where boot-ensure had already
 * renamed the column and the file had not caught up.
 *
 * The tagged union made the *shape* of a relation impossible to get wrong: a
 * `manyToMany` cannot carry a `foreignKey`, a to-many cannot carry a
 * `localKey`. What it cannot know is whether any of the names are real —
 * whether `posts_tags` is a table, whether `author_id` is a column, whether a
 * `via` relation's steps connect the tables it claims to. Those are facts about the
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
    /** Slug of the table declaring the relation. */
    table: string;
    relationName: string;
    kind: RelationDescriptor["kind"];
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

/** The table a `table.column` spelling names, or `undefined` for a bare column. */
const tablePart = (column: string | undefined): string | undefined =>
    column?.includes(".") ? column.split(".")[0] : undefined;

/**
 * A one-column link into a key of several columns, or `undefined`.
 *
 * A `localKey`, a `foreignKey` and a junction column are each one column, and
 * one column cannot reference a composite key: Postgres refuses
 * `REFERENCES t (a)` when `a` alone is not unique, and a lookup on `a` matches
 * every row that shares it, so the related row served is whichever came first.
 * Compiling refuses such a link in a declared table; this refuses to serve one
 * in a table introspected from a database.
 *
 * `via` is exempt — its steps name every column they compare — and so is a
 * `hasOne`/`hasMany` with a `sourceKey`, which names the one column it points
 * at instead of the key.
 */
function compositeKeyDefect(
    relation: RelationDescriptor,
    source: RuntimeTable,
    target: RuntimeTable
): Pick<RelationDefect, "problem" | "fix"> | undefined {
    const viaFix = "or express the link as `rel.via(...)`, whose steps compare every key column";
    const refuse = (linkColumn: string, keyed: RuntimeTable, fix: string) => {
        if (keyed.keys.length < 2) return undefined;
        return {
            problem: `${linkColumn} is one column, and \`${keyed.slug}\` is keyed on ` +
                `${quote(keyed.keys.map(key => key.key))} together — one column cannot reference a composite key`,
            fix
        };
    };

    switch (relation.kind) {
        case "belongsTo":
            return refuse(`\`localKey: "${relation.localKey}"\``, target,
                `point the relation at a table with a single-column key, ${viaFix}`);
        case "hasOne":
        case "hasMany":
            if (relation.sourceKey) return undefined;
            return refuse(`\`foreignKey: "${relation.foreignKey}"\``, source,
                `give the relation a \`sourceKey\` naming a single unique column of \`${source.slug}\` to point at, ${viaFix}`);
        case "manyToMany":
            return refuse(`\`sourceKey: "${relation.through.sourceKey}"\``, source, `a junction column points at a single-column key; ${viaFix}`)
                ?? refuse(`\`targetKey: "${relation.through.targetKey}"\``, target, `a junction column points at a single-column key; ${viaFix}`);
        case "via":
            return undefined;
    }
}

/**
 * Distinguish "this column name is wrong" from "this database was never
 * migrated".
 *
 * They present identically here — a relation asks for a column the table does
 * not have — but they are opposite problems with opposite fixes, and getting
 * them the wrong way round is how the 0.12 → 0.13 upgrade bricked projects.
 *
 * 0.13 changed the rule that derives foreign-key names: `categories` yields
 * `category_id` where it used to yield `categorie_id`. Boot-ensure renames the
 * database column to match — but only in a process that provisions. Where
 * nothing has, the database still carries the old spelling while the config
 * derives the new one, and the generic fix ("set `through.targetColumn` to one
 * of: …", listing the legacy name because that is what the table still has)
 * talks the reader into pinning a column that is about to be renamed out from
 * under them.
 *
 * So when the wanted name is what the current rule derives, and the table
 * carries what the *previous* rule would have derived from the same source, say
 * that instead.
 *
 * @param wanted   the column the relation asks for
 * @param available every column the registered table has
 * @param sources  names the default could have been derived from (a slug, a
 *                 relation name) — checking against these rather than guessing
 *                 backwards from `wanted` keeps the match exact
 */
function staleCodegenRename(
    wanted: string,
    available: Set<string>,
    sources: string[]
): { legacy: string; current: string } | null {
    for (const source of sources) {
        if (!source) continue;
        const current = generateForeignKeyName(source);
        const legacy = legacyForeignKeyName(source);
        // Only a name that actually moved, and only when the table still has the
        // old spelling and not the new one.
        if (current !== wanted || legacy === current) continue;
        if (available.has(legacy) && !available.has(current)) return { legacy, current };
    }
    return null;
}

/** The shared explanation, so every relation kind reports it identically. */
function staleCodegenDefect(
    table: string,
    { legacy, current }: { legacy: string; current: string }
): Pick<RelationDefect, "problem" | "fix"> {
    return {
        problem:
            `the database still has \`${legacy}\` on \`${table}\`, but this release derives ` +
            `\`${current}\` — the column predates the foreign-key naming fix and nothing has ` +
            "renamed it yet",
        fix:
            "let boot-ensure rename it (redeploy, or start with schema provisioning enabled), or " +
            "run `rebase db push`. Then run `rebase schema generate` so the committed schema file " +
            `agrees. To keep \`${legacy}\` instead, name it explicitly on the relation.`
    };
}

/**
 * Relations whose names do not resolve against the registered schema.
 *
 * Fails open wherever it cannot see enough to be sure — a table this database
 * does not hold, a target this driver does not serve — because a false alarm
 * here costs more than a missed one: it would block boot on a working app.
 */
export function findRelationDefects(registry: PostgresTableRegistry): RelationDefect[] {
    const defects: RelationDefect[] = [];

    for (const source of registry.tables()) {
        const sourceTableName = source.descriptor.table;
        const sourceTable = source.pg;
        // Nothing to check against. Another boot warning already covers this.
        if (!sourceTable) continue;

        const sourceColumns = columnNames(sourceTable);

        for (const relation of source.descriptor.relations) {
            const at = { table: source.slug, relationName: relation.name, kind: relation.kind };

            // A target this driver does not serve is another backend's; its
            // tables are not ours to check.
            const target = registry.getTable(relation.target);
            if (!target) continue;

            const targetTableName = target.descriptor.table;
            const targetTable = target.pg;
            if (!targetTable) {
                defects.push({
                    ...at,
                    problem: `it points at table \`${target.slug}\`, which has no table \`${targetTableName}\` in this database`,
                    fix: `apply the schema to this database (\`rebase db push\`, or boot with provisioning), or point the relation at a table that exists`
                });
                continue;
            }
            const targetColumns = columnNames(targetTable);

            // A single-column link into a composite key, whichever side the
            // key is on.
            const composite = compositeKeyDefect(relation, source, target);
            if (composite) {
                defects.push({ ...at, ...composite });
                continue;
            }

            switch (relation.kind) {
                case "belongsTo": {
                    if (!sourceColumns.has(relation.localKey)) {
                        // `localKey` defaults to the relation name run through
                        // the foreign-key rule, so it moves with that rule.
                        const stale = staleCodegenRename(
                            relation.localKey,
                            sourceColumns,
                            [relation.name, target.slug]
                        );
                        defects.push(stale
                            ? { ...at, ...staleCodegenDefect(sourceTableName, stale) }
                            : {
                                ...at,
                                problem: `\`localKey: "${relation.localKey}"\` is not a column on \`${sourceTableName}\``,
                                fix: `add the column, or set \`localKey\` to one of: ${quote(sourceColumns)}`
                            });
                    }
                    break;
                }

                case "hasOne":
                case "hasMany": {
                    if (!targetColumns.has(relation.foreignKey)) {
                        // The default is derived from *this* table's slug —
                        // the column on the target that points back here.
                        const stale = staleCodegenRename(
                            relation.foreignKey,
                            targetColumns,
                            [source.slug]
                        );
                        defects.push(stale
                            ? { ...at, ...staleCodegenDefect(targetTableName, stale) }
                            : {
                                ...at,
                                problem: `\`foreignKey: "${relation.foreignKey}"\` is not a column on the target table \`${targetTableName}\``,
                                fix: `add the column, or set \`foreignKey\` to one of: ${quote(targetColumns)}`
                            });
                    }
                    // `sourceKey` is the easiest of the two to put on the wrong
                    // side — it is the only column in a `hasMany` that lives
                    // here rather than on the target, and naming a target column
                    // reads perfectly well right next to `foreignKey`.
                    if (relation.sourceKey && !sourceColumns.has(relation.sourceKey)) {
                        defects.push({
                            ...at,
                            problem: `\`sourceKey: "${relation.sourceKey}"\` is not a column on \`${sourceTableName}\``,
                            fix: targetColumns.has(relation.sourceKey)
                                ? `it is a column on the *target* table \`${targetTableName}\` — \`sourceKey\` names ` +
                                  "the column of this table that the target's foreign key points at, so it " +
                                  `must be one of: ${quote(sourceColumns)}`
                                : `add the column, or set \`sourceKey\` to one of: ${quote(sourceColumns)}`
                        });
                    }
                    break;
                }

                case "manyToMany": {
                    const { table, sourceKey, targetKey } = relation.through;
                    const junction = registry.getPgTable(table);
                    if (!junction) {
                        defects.push({
                            ...at,
                            problem: `its junction table \`${table}\` does not exist`,
                            fix: `create \`${table}\`, or name the real one with \`through: "..."\`. ` +
                                "Note that an omitted `through` is derived from the two table names sorted " +
                                "and joined, so renaming a table changes it"
                        });
                        break;
                    }
                    const junctionColumns = columnNames(junction);
                    // Junction columns are the ones that actually moved in 0.13:
                    // each defaults to its endpoint table's *slug* run through
                    // the foreign-key rule, and slugs are plural.
                    const derivedFrom = {
                        sourceKey: [source.slug],
                        targetKey: [target.slug]
                    } as const;
                    for (const [label, column] of [["sourceKey", sourceKey], ["targetKey", targetKey]] as const) {
                        if (!junctionColumns.has(column)) {
                            const stale = staleCodegenRename(column, junctionColumns, [...derivedFrom[label]]);
                            defects.push(stale
                                ? { ...at, ...staleCodegenDefect(table, stale) }
                                : {
                                    ...at,
                                    problem: `\`${label}: "${column}"\` is not a column on the junction table \`${table}\``,
                                    fix: `set \`${label}\` to one of: ${quote(junctionColumns)}` +
                                        (label === "sourceKey" ? " — it is the column naming *this* table" : "")
                                });
                        }
                    }
                    break;
                }

                case "via": {
                    if (relation.steps.length === 0) {
                        defects.push({
                            ...at,
                            problem: "its `steps` are empty, so it joins nothing",
                            fix: "add at least one step, ending at the target's table"
                        });
                        break;
                    }

                    // Walk the chain: each step's `from` names columns on the
                    // previous table, its `to` names columns on its own.
                    let prevName = sourceTableName;
                    let prevColumns = sourceColumns;
                    let broken = false;

                    for (const [i, step] of relation.steps.entries()) {
                        const stepTable = registry.getPgTable(step.table);
                        if (!stepTable) {
                            defects.push({
                                ...at,
                                problem: `step ${i + 1} of its \`steps\` joins \`${step.table}\`, which is not a table in the schema`,
                                fix: `correct \`steps[${i}].table\``
                            });
                            broken = true;
                            break;
                        }
                        const stepColumns = columnNames(stepTable);

                        // A step may list alternatives (any one joins); each is
                        // checked as a plain step would be, and named by its place.
                        const alternatives = Array.isArray(step.on) ? step.on : [step.on];

                        // An empty list joins on nothing: the reader would build
                        // an `ON` with no condition, a syntax error at query time.
                        if (alternatives.length === 0) {
                            defects.push({
                                ...at,
                                problem: `\`steps[${i}].on\` lists no conditions, so step ${i + 1} joins \`${prevName}\` → \`${step.table}\` on nothing`,
                                fix: `give \`steps[${i}].on\` at least one \`{ from, to }\`, or write the one condition as an object`
                            });
                        }

                        // Alternatives are several ways to match one pair of
                        // tables, not several paths: a `table.column` spelling
                        // naming another table makes the step a different join.
                        if (alternatives.length > 1) {
                            const pairs = alternatives.map(on => ({
                                from: tablePart(asColumns(on.from)[0]) ?? prevName,
                                to: tablePart(asColumns(on.to)[0]) ?? step.table
                            }));
                            if (pairs.some(p => p.from !== pairs[0].from || p.to !== pairs[0].to)) {
                                defects.push({
                                    ...at,
                                    problem: `the alternatives of step ${i + 1} join different tables: ` +
                                        pairs.map((p, j) => `alternative ${j + 1} joins \`${p.from}\` → \`${p.to}\``).join(", "),
                                    fix: `every entry of \`steps[${i}].on\` joins \`${prevName}\` to \`${step.table}\`; a path through other tables is a step, or a relation, of its own`
                                });
                            }
                        }

                        for (const [j, on] of alternatives.entries()) {
                            const where = Array.isArray(step.on) ? `steps[${i}].on[${j}]` : `steps[${i}].on`;
                            const alt = Array.isArray(step.on) ? ` (alternative ${j + 1})` : "";
                            for (const column of asColumns(on.from)) {
                                if (!prevColumns.has(column)) {
                                    defects.push({
                                        ...at,
                                        problem: `step ${i + 1}${alt} joins \`${prevName}.${column}\` → \`${step.table}\`, but \`${column}\` is not a column on \`${prevName}\``,
                                        fix: `\`${where}.from\` names columns on ${i === 0 ? "this table" : `the previous step's table (\`${prevName}\`)`}: ${quote(prevColumns)}`
                                    });
                                }
                            }
                            for (const column of asColumns(on.to)) {
                                if (!stepColumns.has(column)) {
                                    defects.push({
                                        ...at,
                                        problem: `step ${i + 1}${alt} joins into \`${step.table}.${column}\`, but \`${column}\` is not a column on \`${step.table}\``,
                                        fix: `\`${where}.to\` names columns on \`${step.table}\`: ${quote(stepColumns)}`
                                    });
                                }
                            }

                            if (asColumns(on.from).length !== asColumns(on.to).length) {
                                defects.push({
                                    ...at,
                                    problem: `step ${i + 1}${alt} compares ${asColumns(on.from).length} column(s) against ${asColumns(on.to).length}`,
                                    fix: `\`from\` and \`to\` must name the same number of columns in \`${where}\``
                                });
                            }
                        }

                        prevName = step.table;
                        prevColumns = stepColumns;
                    }

                    // The chain has to end where the relation says it points,
                    // or the rows it returns are not the target's rows.
                    if (!broken && prevName !== targetTableName) {
                        defects.push({
                            ...at,
                            problem: `its \`steps\` end at \`${prevName}\`, but it targets \`${target.slug}\` (table \`${targetTableName}\`)`,
                            fix: `make the last step join \`${targetTableName}\`, or point the relation at the table backed by \`${prevName}\``
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
export function assertRelationsResolve(registry: PostgresTableRegistry): void {
    const defects = findRelationDefects(registry);
    if (defects.length === 0) return;

    const lines = defects.map(d =>
        `  • ${d.table}.${d.relationName} (${d.kind})\n` +
        `      ${d.problem}\n` +
        `      fix: ${d.fix}`
    );

    throw new Error(
        `${defects.length} relation${defects.length === 1 ? "" : "s"} cannot resolve against ` +
        "the database this server is connected to.\n\n" +
        "Each of these would return no rows at query time rather than reporting an error, " +
        "so they are fatal at boot instead.\n\n" +
        // The columns listed below were read from `information_schema`, not from
        // `schema.generated.ts`. That distinction is the whole diagnosis after an
        // upgrade: this check used to read the committed file, so a file older
        // than the database refused a boot that was fine, and its advice named
        // columns that no longer existed. What is left is a real disagreement
        // between the tables and the database — either the schema has not
        // been applied here, or the relation names something that was never
        // there.
        "If the schema has not been applied to this database yet, apply it — `rebase db push`\n" +
        "(dev), `rebase db migrate` (prod), or a redeploy, which creates tables at boot. If it\n" +
        "has, then the table definition is what disagrees with the database:\n\n" +
        lines.join("\n\n") + "\n"
    );
}
