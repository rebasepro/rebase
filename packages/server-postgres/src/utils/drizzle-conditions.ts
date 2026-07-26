import { and, eq, or, sql, SQL, ilike, inArray } from "drizzle-orm";
import { AnyPgColumn, PgTable, PgVarchar, PgText, PgChar } from "drizzle-orm/pg-core";
import {
    FilterValues, WhereFilterOp, JoinStep, LogicalCondition, FilterCondition,
    ResolvedRelation, ResolvedBelongsTo, ResolvedHasOne, ResolvedHasMany
} from "@rebasepro/types";
import { getColumnName, normalizeToEntityRelation, resolveCollectionRelations } from "@rebasepro/common";
import { PostgresCollectionRegistry } from "../collections/PostgresCollectionRegistry";
import { ConditionBuilderStatic } from "../interfaces";
import { logger } from "@rebasepro/server";
import { getColumnMeta } from "../services/collection-helpers";

/**
 * Filter values may arrive as relation wire objects — `EntityRelation`
 * instances or their JSON form `{ __type: "relation", id, path }` — e.g. when
 * the admin filters a relation column. SQL comparisons need the raw id, so
 * unwrap them here (element-wise for list operators like `in` / `not-in`).
 */
function unwrapRelationFilterValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(unwrapRelationFilterValue);
    const relation = normalizeToEntityRelation(value);
    return relation ? relation.id : value;
}

/** Drizzle dynamic query builder — accepts innerJoin + where chaining */

export interface DrizzleDynamicQuery {
    innerJoin(table: PgTable<any>, condition: SQL): this;
    where(condition: SQL | undefined): this;
    limit(limit: number): this;
}

/**
 * Unified condition builder for Drizzle/PostgreSQL queries.
 *
 * This class uses static methods and satisfies the ConditionBuilderStatic<SQL> type.
 * It translates Rebase filter conditions to Drizzle SQL conditions.
 *
 * @example
 * const builder: ConditionBuilderStatic<SQL> = DrizzleConditionBuilder;
 */
export class DrizzleConditionBuilder {

    /**
     * Express "reachable from this parent through this relation" as a plain
     * `WHERE` condition on the target table.
     *
     * This is the primitive that lets a relation be a *filter* rather than an
     * addressing scheme. A nested listing used to be served by its own query
     * builder — `fetchEntitiesUsingJoins`, which grew joins the root pipeline
     * did not have and lost the options the root pipeline did have (offset,
     * filter, orderBy, include). Reduced to a condition, the same listing runs
     * through the ordinary collection query, so it inherits all of them and
     * there is one read path instead of two.
     *
     * The shapes:
     *   - inverse FK  → `target.<fk> = :parentId`, a column comparison.
     *   - `through`   → `EXISTS (SELECT 1 FROM junction …)`, correlated on the
     *                   target's key, so the junction never multiplies rows the
     *                   way an `INNER JOIN` would.
     *   - `joinPath`  → the same `EXISTS`, with the path's steps joined inside
     *                   it and the final step correlating to the outer row.
     */
    static buildRelationScopeCondition(
        relation: ResolvedRelation,
        /**
         * Lazy: only `via` and `belongsTo` need the parent's own table. A
         * foreign key on the target and a junction are both expressible from
         * the parent's *id* alone, and requiring the table for them would make
         * a child listing fail on a parent whose table isn't registered.
         */
        parent: () => { table: PgTable<any>; idColumn: AnyPgColumn },
        parentId: string | number,
        targetTable: PgTable<any>,
        targetIdColumn: AnyPgColumn,
        registry: PostgresCollectionRegistry
    ): SQL {
        switch (relation.kind) {
            case "via": {
                const { table, idColumn } = parent();
                return this.buildJoinPathScopeCondition(
                    relation.joinPath, table, idColumn, parentId, targetTable, registry
                );
            }

            case "manyToMany": {
                const { table: junctionName, sourceColumn, targetColumn } = relation.through;
                const junctionTable = registry.getTable(junctionName);
                if (!junctionTable) {
                    throw new Error(`Junction table not found: ${junctionName}`);
                }
                const sourceCol = junctionTable[sourceColumn as keyof typeof junctionTable] as AnyPgColumn;
                const targetCol = junctionTable[targetColumn as keyof typeof junctionTable] as AnyPgColumn;
                if (!sourceCol || !targetCol) {
                    throw new Error(
                        `Junction columns '${sourceColumn}'/'${targetColumn}' not found in '${junctionName}'`
                    );
                }
                // Correlated, not joined: a join through a junction multiplies
                // the target rows by the number of matching links and silently
                // breaks `limit`/`offset`.
                return sql`EXISTS (SELECT 1 FROM ${junctionTable} WHERE ${targetCol} = ${targetIdColumn} AND ${sourceCol} = ${parentId})`;
            }

            case "hasOne":
            case "hasMany": {
                const fkColumn = targetTable[relation.foreignKeyOnTarget as keyof typeof targetTable] as AnyPgColumn;
                if (!fkColumn) {
                    throw new Error(
                        `Foreign key column '${relation.foreignKeyOnTarget}' not found in the target table of ` +
                        `relation '${relation.relationName}'.`
                    );
                }
                return eq(fkColumn, parentId);
            }

            case "belongsTo": {
                // The single target row the parent's foreign key points at.
                const { table, idColumn } = parent();
                return sql`${targetIdColumn} = (SELECT ${sql.identifier(relation.localKey)} FROM ${table} WHERE ${idColumn} = ${parentId})`;
            }

            default: {
                // Exhaustive. There is no "declares nothing" case to fall
                // through to any more — every kind names its own link.
                const exhaustive: never = relation;
                throw new Error(`Unknown relation kind: ${JSON.stringify(exhaustive)}`);
            }
        }
    }

    /**
     * `EXISTS` for an explicit `joinPath`.
     *
     * The path is declared source → target. The subquery replays every step but
     * the last from inside, and turns the last one into the correlation with the
     * outer target row — so the target table is never named twice and needs no
     * alias. Each intermediate table is aliased positionally, which keeps a path
     * that revisits a table (a self-referencing many-to-many) unambiguous.
     */
    private static buildJoinPathScopeCondition(
        joinPath: JoinStep[],
        parentTable: PgTable<any>,
        parentIdColumn: AnyPgColumn,
        parentId: string | number,
        targetTable: PgTable<any>,
        registry: PostgresCollectionRegistry
    ): SQL {
        const sourceAlias = "__rel_src";
        const aliasFor = (index: number) => `__rel_j${index}`;

        // Column reference against the previous hop: the aliased source for the
        // first step, the previous aliased join table after that.
        const fromRef = (stepIndex: number, column: string) =>
            sql`${sql.identifier(stepIndex === 0 ? sourceAlias : aliasFor(stepIndex - 1))}.${sql.identifier(getColumnName(column))}`;

        const pairs = (step: JoinStep): { from: string; to: string }[] => {
            const from = Array.isArray(step.on.from) ? step.on.from : [step.on.from];
            const to = Array.isArray(step.on.to) ? step.on.to : [step.on.to];
            if (from.length !== to.length) {
                throw new Error(`Join step on '${step.table}' has ${from.length} \`from\` columns and ${to.length} \`to\` columns`);
            }
            return from.map((f, i) => ({ from: f, to: to[i] }));
        };

        const inner = joinPath.slice(0, -1);
        const last = joinPath[joinPath.length - 1];

        const joins: SQL[] = inner.map((step, index) => {
            const table = registry.getTable(step.table);
            if (!table) throw new Error(`Join table not found: ${step.table}`);
            const on = pairs(step).map(({ from, to }) =>
                sql`${fromRef(index, from)} = ${sql.identifier(aliasFor(index))}.${sql.identifier(getColumnName(to))}`
            );
            return sql`JOIN ${table} AS ${sql.identifier(aliasFor(index))} ON ${sql.join(on, sql` AND `)}`;
        });

        // The last step correlates to the outer row instead of joining the
        // target table into the subquery.
        //
        // On the step's own `to` column, which is not always the target's
        // primary key: a one-step path like `{ table: "posts", on: { from:
        // "id", to: "author_id" } }` correlates through a foreign key, and
        // matching `authors.id = posts.id` there compares two unrelated
        // identifiers — which returns nothing, quietly. Referencing the Drizzle
        // column rather than a bare name also keeps it qualified, so it binds
        // to the outer target and not to a table joined inside the EXISTS.
        const targetColumn = (name: string): AnyPgColumn => {
            const column = targetTable[getColumnName(name) as keyof typeof targetTable] as AnyPgColumn;
            if (!column) {
                throw new Error(`Join step column '${name}' not found in the target table of this joinPath`);
            }
            return column;
        };

        const correlation = sql.join(
            pairs(last).map(({ from, to }) => sql`${fromRef(inner.length, from)} = ${targetColumn(to)}`),
            sql` AND `
        );

        const joinsSql = joins.length > 0 ? sql` ${sql.join(joins, sql` `)}` : sql``;

        return sql`EXISTS (SELECT 1 FROM ${parentTable} AS ${sql.identifier(sourceAlias)}${joinsSql} WHERE ${sql.identifier(sourceAlias)}.${sql.identifier(parentIdColumn.name)} = ${parentId} AND ${correlation})`;
    }

    /**
     * Build filter conditions from FilterValues
     */
    static buildFilterConditions<M extends Record<string, unknown>>(
        filter: FilterValues<Extract<keyof M, string>>,
        table: PgTable<any>,
        collectionPath: string
    ): SQL[] {
        const conditions: SQL[] = [];

        for (const [field, filterParam] of Object.entries(filter)) {
            if (!filterParam) continue;

            let fieldColumn = table[field as keyof typeof table] as AnyPgColumn;

            if (!fieldColumn) {
                // Fallback for relations (e.g. project -> project_id)
                const relationKey = `${field}_id`;
                if (relationKey in table) {
                    fieldColumn = table[relationKey as keyof typeof table] as AnyPgColumn;
                }
            }

            if (!fieldColumn) {
                logger.warn(`Filtering by field '${field}', but it does not exist in table for collection '${collectionPath}'`);
                continue;
            }

            const paramsList = Array.isArray(filterParam) && filterParam.length > 0 && Array.isArray(filterParam[0])
                ? (filterParam as [WhereFilterOp, any][])
                : [filterParam as [WhereFilterOp, any]];

            for (const [op, value] of paramsList) {
                const condition = this.buildSingleFilterCondition(fieldColumn, op, value);
                if (condition) {
                    conditions.push(condition);
                }
            }
        }

        return conditions;
    }

    /**
     * Build logical conditions recursively from LogicalCondition or FilterCondition
     */
    static buildLogicalConditions(
        cond: LogicalCondition | FilterCondition,
        table: PgTable<any>,
        collectionPath: string
    ): SQL | null {
        if ("type" in cond) {
            const subSQLs = cond.conditions
                .map(c => this.buildLogicalConditions(c, table, collectionPath))
                .filter((sql): sql is SQL => sql !== null);
            if (subSQLs.length === 0) return null;
            return (cond.type === "or" ? or(...subSQLs) : and(...subSQLs)) ?? null;
        } else {
            let fieldColumn = table[cond.column as keyof typeof table] as AnyPgColumn;
            if (!fieldColumn) {
                const relationKey = `${cond.column}_id`;
                if (relationKey in table) {
                    fieldColumn = table[relationKey as keyof typeof table] as AnyPgColumn;
                }
            }
            if (!fieldColumn) {
                logger.warn(`Filtering by field '${cond.column}', but it does not exist in table for collection '${collectionPath}'`);
                return null;
            }
            return this.buildSingleFilterCondition(fieldColumn, cond.operator as WhereFilterOp, cond.value);
        }
    }

    /**
     * Build a single filter condition for a specific operator and value
     */
    static buildSingleFilterCondition(
        column: AnyPgColumn,
        op: WhereFilterOp,
        value: unknown
    ): SQL | null {
        value = unwrapRelationFilterValue(value);
        switch (op) {
            case "==":
                if (value === null || value === undefined) {
                    return sql`${column} IS NULL`;
                }
                return eq(column, value);
            case "!=":
                if (value === null || value === undefined) {
                    return sql`${column} IS NOT NULL`;
                }
                return sql`${column} != ${value}`;
            case ">":
                return sql`${column} > ${value}`;
            case ">=":
                return sql`${column} >= ${value}`;
            case "<":
                return sql`${column} < ${value}`;
            case "<=":
                return sql`${column} <= ${value}`;
            case "in":
                if (Array.isArray(value) && value.length > 0) {
                    return inArray(column, value);
                }
                return null;
            case "array-contains": {
                const meta = getColumnMeta(column);
                if (meta.dataType === "array" || meta.columnType === "PgArray") {
                    return sql`${column} @> ARRAY[${value}]`;
                }
                // For JSONB arrays: checks if the column contains the given value
                return sql`${column} @> ${JSON.stringify([value])}`;
            }
            case "array-contains-any": {
                const meta = getColumnMeta(column);
                const isNativeArray = meta.dataType === "array" || meta.columnType === "PgArray";
                if (Array.isArray(value) && value.length > 0) {
                    if (isNativeArray) {
                        return sql`${column} && ARRAY[${sql.join(value.map(v => sql`${v}`), sql`, `)}]`;
                    } else {
                        // Use the ?| operator for JSONB overlap with text array
                        const textValues = value.map(v => String(v));
                        return sql`${column} ?| array[${sql.join(textValues.map(v => sql`${v}`), sql`, `)}]`;
                    }
                }
                // Single value fallback: treat as array-contains
                if (isNativeArray) {
                    return sql`${column} @> ARRAY[${value}]`;
                }
                return sql`${column} @> ${JSON.stringify([value])}`;
            }
            case "not-in":
                if (Array.isArray(value) && value.length > 0) {
                    return sql`${column} NOT IN (${sql.join(value.map(v => sql`${v}`), sql`, `)})`;
                }
                return null;
            case "like":
                return sql`${column} LIKE ${String(value)}`;
            case "ilike":
                return sql`${column} ILIKE ${String(value)}`;
            case "not-like":
                return sql`${column} NOT LIKE ${String(value)}`;
            case "not-ilike":
                return sql`${column} NOT ILIKE ${String(value)}`;
            case "is-null":
                return sql`${column} IS NULL`;
            case "is-not-null":
                return sql`${column} IS NOT NULL`;
            default:
                logger.warn(`Unsupported filter operation: ${op}`);
                return null;
        }
    }

    /**
     * Build relation-based conditions for different relation types
     */
    /**
     * Joins and where-conditions that reach a relation's target rows.
     *
     * One case per kind. This used to be a chain of six `else if`s over
     * `cardinality`/`direction`/`through`, ending in
     * `findCorrespondingJunctionTable` — a search through the *target's* own
     * relations to work out whether an "inverse many" was a one-to-many or the
     * far side of a junction. That search is gone: the kind says which it is.
     *
     * The owning/inverse split for junctions is gone too. Both variants built
     * the identical condition — `through` is always written from the declaring
     * side's point of view — so the second was a distinction without a
     * difference and one of the places the two could drift apart.
     */
    static buildRelationConditions(
        relation: ResolvedRelation,
        parentId: string | number | (string | number)[],
        targetTable: PgTable<any>,
        parentTable: PgTable<any>,
        parentIdColumn: AnyPgColumn,
        targetIdColumn: AnyPgColumn,
        registry: PostgresCollectionRegistry
    ): {
        joinConditions: { table: PgTable<any>; condition: SQL }[];
        whereConditions: SQL[];
    } {
        const joinConditions: { table: PgTable<any>; condition: SQL }[] = [];
        const whereConditions: SQL[] = [];

        switch (relation.kind) {
            case "via": {
                const { joins, finalCondition } = this.buildJoinPathConditions(
                    relation.joinPath, targetTable, parentTable, parentIdColumn, parentId, registry
                );
                joinConditions.push(...joins);
                whereConditions.push(finalCondition);
                break;
            }

            case "manyToMany": {
                const junctionResult = this.buildJunctionTableConditions(
                    relation.through, targetIdColumn, parentId, registry
                );
                joinConditions.push(junctionResult.join);
                whereConditions.push(junctionResult.condition);
                break;
            }

            case "hasOne":
            case "hasMany":
            case "belongsTo":
                whereConditions.push(
                    this.buildSimpleRelationCondition(relation, targetTable, parentTable, parentId)
                );
                break;

            default: {
                const exhaustive: never = relation;
                throw new Error(`Unknown relation kind: ${JSON.stringify(exhaustive)}`);
            }
        }

        return { joinConditions,
whereConditions };
    }

    /**
     * Build conditions for join path relations
     */
    private static buildJoinPathConditions(
        joinPath: JoinStep[],
        targetTable: PgTable<any>,
        parentTable: PgTable<any>,
        parentIdColumn: AnyPgColumn,
        parentId: string | number | (string | number)[],
        registry: PostgresCollectionRegistry
    ): {
        joins: { table: PgTable<any>; condition: SQL }[];
        finalCondition: SQL;
    } {
        const joins: { table: PgTable<any>; condition: SQL }[] = [];
        let currentTable = targetTable;

        // Process join steps in reverse order to build path back to parent
        for (const joinStep of [...joinPath].reverse()) {
            const fromTableName = this.getTableNamesFromColumns(joinStep.on.from)[0];
            const toTableName = this.getTableNamesFromColumns(joinStep.on.to)[0];
            const fromColName = this.getColumnNamesFromColumns(joinStep.on.from)[0];
            const toColName = this.getColumnNamesFromColumns(joinStep.on.to)[0];

            const fromTable = registry.getTable(fromTableName);
            const toTable = registry.getTable(toTableName);

            if (!fromTable || !toTable) {
                throw new Error(`Join tables not found for step: from ${fromTableName} to ${toTableName}`);
            }

            const {
                joinTable,
                condition,
                additionalJoins
            } = this.buildSingleJoinCondition(
                currentTable,
                fromTable,
                toTable,
                fromColName,
                toColName,
                fromTableName,
                toTableName,
                registry
            );

            joins.push({
                table: joinTable,
                condition
            });
            currentTable = joinTable;

            // Add any additional joins needed for many-to-many relationships
            if (additionalJoins && additionalJoins.length > 0) {
                joins.push(...additionalJoins);
            }
        }

        // Ensure we've connected back to the parent table
        // For junction tables, we might end up at the junction table instead of the parent table
        if (currentTable !== parentTable) {
            // Try to get table names from the Drizzle table objects
            let currentTableName = "unknown";
            let parentTableName = "unknown";

            // Try multiple ways to extract table names from Drizzle objects
            if (currentTable && typeof currentTable === "object") {
                // Check common Drizzle table name properties
                currentTableName = (currentTable as unknown as Record<string | symbol, unknown>)[Symbol.for("drizzle:Name")] as string ||
                    ((currentTable as unknown as Record<string, unknown>)._ as Record<string, unknown>)?.name as string ||
                    (currentTable as unknown as Record<string, unknown>).tableName as string ||
                    (currentTable as unknown as Record<string, unknown>).name as string ||
                    "unknown";
            }

            if (parentTable && typeof parentTable === "object") {
                parentTableName = (parentTable as unknown as Record<string | symbol, unknown>)[Symbol.for("drizzle:Name")] as string ||
                    ((parentTable as unknown as Record<string, unknown>)._ as Record<string, unknown>)?.name as string ||
                    (parentTable as unknown as Record<string, unknown>).tableName as string ||
                    (parentTable as unknown as Record<string, unknown>).name as string ||
                    "unknown";
            }

            // For junction table scenarios, be more lenient with validation
            // If we can't determine table names reliably, or if this looks like a junction table scenario,
            // we'll allow it and let the SQL execution validate the correctness
            const couldBeJunctionScenario = currentTableName.includes("_") ||
                currentTableName === "unknown" ||
                parentTableName === "unknown";

            if (!couldBeJunctionScenario) {
                throw new Error(`Join path did not result in connecting to parent table. Current: ${currentTableName}, Parent: ${parentTableName}`);
            }
        }

        // Handle both single ID and array of IDs
        const finalCondition = Array.isArray(parentId)
            ? inArray(parentIdColumn, parentId)
            : eq(parentIdColumn, parentId);

        return {
            joins,
            finalCondition
        };
    }

    /**
     * Build a single join condition between tables
     */
    private static buildSingleJoinCondition(
        currentTable: PgTable<any>,
        fromTable: PgTable<any>,
        toTable: PgTable<any>,
        fromColName: string,
        toColName: string,
        fromTableName: string,
        toTableName: string,
        registry?: PostgresCollectionRegistry
    ): { joinTable: PgTable<any>; condition: SQL; additionalJoins?: { table: PgTable<any>; condition: SQL }[] } {
        let joinTable: PgTable<any>;
        let condition: SQL;
        const additionalJoins: { table: PgTable<any>; condition: SQL }[] = [];

        if (currentTable === toTable) {
            // current -> toTable, so join the fromTable
            const left = fromTable[fromColName as keyof typeof fromTable] as AnyPgColumn;
            const right = (currentTable as unknown as Record<string, unknown>)[toColName] as AnyPgColumn;

            if (!left || !right) {
                // Check if this might be a many-to-many relationship requiring a junction table
                if (registry) {
                    const junctionResult = this.tryBuildJunctionJoin(
                        currentTable,
                        fromTable,
                        fromColName,
                        toColName,
                        fromTableName,
                        toTableName,
                        registry
                    );
                    if (junctionResult) {
                        return junctionResult;
                    }
                }
                throw new Error(`Join columns not found: ${fromTableName}.${fromColName} = ${toTableName}.${toColName}`);
            }

            joinTable = fromTable;
            condition = eq(left, right);
        } else if (currentTable === fromTable) {
            // current -> fromTable, so join the toTable
            const left = toTable[toColName as keyof typeof toTable] as AnyPgColumn;
            const right = (currentTable as unknown as Record<string, unknown>)[fromColName] as AnyPgColumn;

            if (!left || !right) {
                // Check if this might be a many-to-many relationship requiring a junction table
                if (registry) {
                    const junctionResult = this.tryBuildJunctionJoin(
                        currentTable,
                        toTable,
                        fromColName,
                        toColName,
                        fromTableName,
                        toTableName,
                        registry
                    );
                    if (junctionResult) {
                        return junctionResult;
                    }
                }
                throw new Error(`Join columns not found: ${toTableName}.${toColName} = ${fromTableName}.${fromColName}`);
            }

            joinTable = toTable;
            condition = eq(left, right);
        } else {
            throw new Error(`Join step does not match current table. Current table does not match from: ${fromTableName} or to: ${toTableName}`);
        }

        return {
            joinTable,
            condition,
            additionalJoins
        };
    }

    /**
     * Try to build a junction table join when direct foreign key relationship is not found
     */
    private static tryBuildJunctionJoin(
        currentTable: PgTable<any>,
        targetTable: PgTable<any>,
        fromColName: string,
        toColName: string,
        fromTableName: string,
        toTableName: string,
        registry: PostgresCollectionRegistry
    ): { joinTable: PgTable<any>; condition: SQL; additionalJoins: { table: PgTable<any>; condition: SQL }[] } | null {
        // Try to find a junction table that connects these two tables
        // Common naming patterns: table1_table2, table1Table2, etc.
        const possibleJunctionNames = [
            `${fromTableName}_${toTableName}`,
            `${toTableName}_${fromTableName}`,
            `${fromTableName}${toTableName.charAt(0).toUpperCase() + toTableName.slice(1)}`,
            `${toTableName}${fromTableName.charAt(0).toUpperCase() + fromTableName.slice(1)}`
        ];

        for (const junctionName of possibleJunctionNames) {
            const junctionTable = registry.getTable(junctionName);
            if (junctionTable) {
                // Try to find the appropriate columns in the junction table
                const sourceColName = `${fromTableName.slice(0, -1)}_id`; // Remove 's' and add '_id'
                const targetColName = `${toTableName.slice(0, -1)}_id`;

                const junctionSourceCol = junctionTable[sourceColName as keyof typeof junctionTable] as AnyPgColumn;
                const junctionTargetCol = junctionTable[targetColName as keyof typeof junctionTable] as AnyPgColumn;

                if (junctionSourceCol && junctionTargetCol) {
                    // Found a valid junction table setup
                    const currentTableIdCol = Object.values(currentTable).find((col: Record<string, unknown>) => col.primary) as AnyPgColumn;
                    const targetTableIdCol = Object.values(targetTable).find((col: Record<string, unknown>) => col.primary) as AnyPgColumn;

                    if (!currentTableIdCol || !targetTableIdCol) {
                        continue; // Skip if we can't find primary keys
                    }

                    // Determine which direction to join
                    if (currentTable === targetTable) {
                        // We're joining through junction to reach the other table
                        return {
                            joinTable: targetTable,
                            condition: eq(targetTableIdCol, junctionTargetCol),
                            additionalJoins: [
                                {
                                    table: junctionTable,
                                    condition: eq(currentTableIdCol, junctionSourceCol)
                                }
                            ]
                        };
                    } else {
                        // Standard junction join
                        return {
                            joinTable: junctionTable,
                            condition: eq(currentTableIdCol, junctionSourceCol),
                            additionalJoins: [
                                {
                                    table: targetTable,
                                    condition: eq(targetTableIdCol, junctionTargetCol)
                                }
                            ]
                        };
                    }
                }
            }
        }

        return null; // No junction table found
    }

    /**
     * Build conditions for junction table (many-to-many) relations
     */
    private static buildJunctionTableConditions(
        through: { table: string; sourceColumn: string; targetColumn: string },
        targetIdColumn: AnyPgColumn,
        parentId: string | number | (string | number)[],
        registry: PostgresCollectionRegistry
    ): { join: { table: PgTable<any>; condition: SQL }; condition: SQL } {
        const junctionTable = registry.getTable(through.table);
        if (!junctionTable) {
            throw new Error(`Junction table not found: ${through.table}`);
        }

        const junctionSourceCol = junctionTable[through.sourceColumn as keyof typeof junctionTable] as AnyPgColumn;
        const junctionTargetCol = junctionTable[through.targetColumn as keyof typeof junctionTable] as AnyPgColumn;

        if (!junctionSourceCol) {
            throw new Error(`Source column '${through.sourceColumn}' not found in junction table '${through.table}'`);
        }
        if (!junctionTargetCol) {
            throw new Error(`Target column '${through.targetColumn}' not found in junction table '${through.table}'`);
        }

        // Handle both single ID and array of IDs
        const condition = Array.isArray(parentId)
            ? inArray(junctionSourceCol, parentId)
            : eq(junctionSourceCol, parentId);

        return {
            join: {
                table: junctionTable,
                condition: eq(targetIdColumn, junctionTargetCol)
            },
            condition
        };
    }


    /**
     * The condition for a relation whose link is a single column.
     *
     * Two cases. It had five: two of them existed only to throw ("should not be
     * called directly", "lacks proper configuration"), and one guessed a column
     * name by appending `_id` to `inverseRelationName` when no foreign key had
     * been resolved. All three were reachable only because the old type let a
     * relation arrive here under-specified. It cannot now.
     */
    private static buildSimpleRelationCondition(
        relation: ResolvedBelongsTo | ResolvedHasOne | ResolvedHasMany,
        targetTable: PgTable<any>,
        parentTable: PgTable<any>,
        parentId: string | number | (string | number)[]
    ): SQL {
        const match = (column: AnyPgColumn) =>
            Array.isArray(parentId) ? inArray(column, parentId) : eq(column, parentId);

        if (relation.kind === "belongsTo") {
            // `parentId` is the foreign key's value, matched against the
            // target's own key.
            const targetIdCol =
                (Object.values(targetTable).find((col: Record<string, unknown>) => col.primary)
                    ?? Object.values(targetTable).find((col: Record<string, unknown>) => col.name === "id")) as AnyPgColumn | undefined;
            if (!targetIdCol) {
                throw new Error(
                    `No primary key or "id" column in the target table of relation '${relation.relationName}'.`
                );
            }
            return match(targetIdCol);
        }

        const foreignKeyCol = targetTable[relation.foreignKeyOnTarget as keyof typeof targetTable] as AnyPgColumn;
        if (!foreignKeyCol) {
            throw new Error(
                `Foreign key column '${relation.foreignKeyOnTarget}' not found in the target table of relation ` +
                `'${relation.relationName}'. A link through a junction is \`kind: "manyToMany"\`.`
            );
        }
        return match(foreignKeyCol);
    }

    /**
     * Combine multiple conditions with AND operator
     */
    static combineConditionsWithAnd(conditions: SQL[]): SQL | undefined {
        if (conditions.length === 0) return undefined;
        if (conditions.length === 1) return conditions[0];
        return and(...conditions);
    }

    /**
     * Combine multiple conditions with OR operator
     */
    static combineConditionsWithOr(conditions: SQL[]): SQL | undefined {
        if (conditions.length === 0) return undefined;
        if (conditions.length === 1) return conditions[0];
        return or(...conditions);
    }

    /**
     * Build search conditions for text fields
     */
    static buildSearchConditions(
        searchString: string,
        properties: Record<string, unknown>,
        table: PgTable<any>
    ): SQL[] {
        const searchConditions: SQL[] = [];

        for (const [key, prop] of Object.entries(properties)) {
            const p = prop as Record<string, unknown>;
            // Only include string properties that don't have enum defined
            // PostgreSQL enum and uuid columns don't support ILIKE, so we skip them
            if (p.type === "string" && !p.enum && p.isId !== "uuid") {
                const fieldColumn = table[key as keyof typeof table] as AnyPgColumn;
                if (fieldColumn) {
                    // Verify that the underlying database column supports string pattern-matching
                    const supportsILike =
                        fieldColumn instanceof PgVarchar ||
                        fieldColumn instanceof PgText ||
                        fieldColumn instanceof PgChar ||
                        (fieldColumn && typeof fieldColumn === "object" && !("columnType" in fieldColumn));
                    if (supportsILike) {
                        searchConditions.push(ilike(fieldColumn, `%${searchString}%`));
                    }
                }
            }
        }

        return searchConditions;
    }

    /**
     * Build a unique field check condition
     */
    static buildUniqueFieldCondition(
        fieldColumn: AnyPgColumn,
        value: unknown,
        idColumn?: AnyPgColumn,
        excludeId?: string | number
    ): SQL[] {
        const conditions: SQL[] = [eq(fieldColumn, value)];

        if (excludeId && idColumn) {
            conditions.push(sql`${idColumn} != ${excludeId}`);
        }

        return conditions;
    }

    /**
     * Build relation-based query with joins and conditions
     */
    static buildRelationQuery<T extends DrizzleDynamicQuery>(
        baseQuery: T,
        relation: ResolvedRelation,
        parentId: string | number | (string | number)[],
        targetTable: PgTable<any>,
        parentTable: PgTable<any>,
        parentIdColumn: AnyPgColumn,
        targetIdColumn: AnyPgColumn,
        registry: PostgresCollectionRegistry,
        additionalFilters?: SQL[]
    ): T {
        const { joinConditions, whereConditions } = this.buildRelationConditions(
            relation,
            parentId,
            targetTable,
            parentTable,
            parentIdColumn,
            targetIdColumn,
            registry
        );

        let query = baseQuery;

        // Apply joins
        for (const { table, condition } of joinConditions) {
            query = query.innerJoin(table, condition);
        }

        // Combine all conditions
        const allConditions = [...whereConditions];
        if (additionalFilters) {
            allConditions.push(...additionalFilters);
        }

        // Apply where conditions
        if (allConditions.length > 0) {
            query = query.where(and(...allConditions));
        }

        return query;
    }

    /**
     * A count over a relation's target rows.
     *
     * The junction case counts `distinct` because the caller's query joins the
     * junction; the owning/inverse pair that used to sit here built the same
     * query twice.
     */
    static buildRelationCountQuery<T extends DrizzleDynamicQuery>(
        baseCountQuery: T,
        relation: ResolvedRelation,
        parentId: string | number,
        targetTable: PgTable<any>,
        parentTable: PgTable<any>,
        parentIdColumn: AnyPgColumn,
        targetIdColumn: AnyPgColumn,
        registry: PostgresCollectionRegistry,
        additionalFilters?: SQL[]
    ): T {
        switch (relation.kind) {
            case "via":
                return this.buildJoinPathCountQuery(
                    baseCountQuery, relation.joinPath, targetTable, parentTable,
                    parentIdColumn, parentId, registry, additionalFilters
                );

            case "manyToMany":
                return this.buildJunctionCountQuery(
                    baseCountQuery, relation.through, targetIdColumn, parentId, registry, additionalFilters
                );

            case "belongsTo":
            case "hasOne":
            case "hasMany": {
                const allConditions = [
                    this.buildSimpleRelationCondition(relation, targetTable, parentTable, parentId),
                    ...(additionalFilters ?? [])
                ];
                return baseCountQuery.where(and(...allConditions));
            }

            default: {
                const exhaustive: never = relation;
                throw new Error(`Unknown relation kind: ${JSON.stringify(exhaustive)}`);
            }
        }
    }

    /**
     * Build join path conditions for count queries
     */
    private static buildJoinPathCountQuery<T extends DrizzleDynamicQuery>(
        baseCountQuery: T,
        joinPath: JoinStep[],
        targetTable: PgTable<any>,
        parentTable: PgTable<any>,
        parentIdColumn: AnyPgColumn,
        parentId: string | number,
        registry: PostgresCollectionRegistry,
        additionalFilters?: SQL[]
    ): T {
        let query = baseCountQuery;
        let currentTable = targetTable;

        // Process join steps in reverse order
        for (const joinStep of [...joinPath].reverse()) {
            const fromTableName = this.getTableNamesFromColumns(joinStep.on.from)[0];
            const toTableName = this.getTableNamesFromColumns(joinStep.on.to)[0];
            const fromColName = this.getColumnNamesFromColumns(joinStep.on.from)[0];
            const toColName = this.getColumnNamesFromColumns(joinStep.on.to)[0];

            const fromTable = registry.getTable(fromTableName);
            const toTable = registry.getTable(toTableName);

            if (!fromTable || !toTable) {
                throw new Error(`Join tables not found for step: from ${fromTableName} to ${toTableName}`);
            }

            const { joinTable, condition } = this.buildSingleJoinCondition(
                currentTable,
                fromTable,
                toTable,
                fromColName,
                toColName,
                fromTableName,
                toTableName
            );

            query = query.innerJoin(joinTable, condition);
            currentTable = joinTable;
        }

        if (currentTable !== parentTable) {
            throw new Error("Join path did not result in connecting to parent table");
        }

        const allConditions = [eq(parentIdColumn, parentId)];
        if (additionalFilters) {
            allConditions.push(...additionalFilters);
        }

        return query.where(and(...allConditions));
    }

    /**
     * Build junction table conditions for count queries
     */
    private static buildJunctionCountQuery<T extends DrizzleDynamicQuery>(
        baseCountQuery: T,
        through: { table: string; sourceColumn: string; targetColumn: string },
        targetIdColumn: AnyPgColumn,
        parentId: string | number,
        registry: PostgresCollectionRegistry,
        additionalFilters?: SQL[]
    ): T {
        const junctionTable = registry.getTable(through.table);
        if (!junctionTable) {
            throw new Error(`Junction table not found: ${through.table}`);
        }

        const junctionSourceCol = junctionTable[through.sourceColumn as keyof typeof junctionTable] as AnyPgColumn;
        const junctionTargetCol = junctionTable[through.targetColumn as keyof typeof junctionTable] as AnyPgColumn;

        if (!junctionSourceCol) {
            throw new Error(`Source column '${through.sourceColumn}' not found in junction table '${through.table}'`);
        }
        if (!junctionTargetCol) {
            throw new Error(`Target column '${through.targetColumn}' not found in junction table '${through.table}'`);
        }

        const baseConditions = [eq(junctionSourceCol, parentId)];
        if (additionalFilters && additionalFilters.length > 0) {
            baseConditions.push(...additionalFilters);
        }

        return baseCountQuery
            .innerJoin(junctionTable, eq(targetIdColumn, junctionTargetCol))
            .where(and(...baseConditions));
    }


    /**
     * Helper method to extract table names from columns
     */
    static getTableNamesFromColumns(columns: string | string[]): string[] {
        if (Array.isArray(columns)) {
            return columns.map(col => col.includes(".") ? col.split(".")[0] : "");
        }
        return [columns.includes(".") ? columns.split(".")[0] : ""];
    }

    /**
     * Helper method to extract column names from columns
     */
    static getColumnNamesFromColumns(columns: string | string[]): string[] {
        if (Array.isArray(columns)) {
            return columns.map(col => getColumnName(col));
        }
        return [getColumnName(columns)];
    }


    /**
     * Build vector similarity search expressions for pgvector.
     *
     * Returns:
     * - `orderBy`: SQL expression to ORDER BY distance (ascending = closest first)
     * - `filter`: optional WHERE clause for distance threshold
     * - `distanceSelect`: SQL expression for selecting the distance as `_distance`
     */
    static buildVectorSearchConditions(
        table: PgTable<any>,
        vectorSearch: {
            property: string;
            vector: number[];
            distance?: "cosine" | "l2" | "inner_product";
            threshold?: number;
        }
    ): { orderBy: SQL; filter?: SQL; distanceSelect: SQL } {
        const column = table[vectorSearch.property as keyof typeof table] as AnyPgColumn;
        if (!column) {
            throw new Error(`Vector column '${vectorSearch.property}' not found in table`);
        }

        // The vector is interpolated as a raw SQL literal below (pgvector has no
        // bind form for the `::vector` cast), so every element must be a finite
        // number. The REST query parser already enforces this, but this builder
        // is a shared entry point — validate here too so no future caller can
        // turn an unchecked value into SQL injection.
        if (
            !Array.isArray(vectorSearch.vector) ||
            vectorSearch.vector.length === 0 ||
            !vectorSearch.vector.every((n) => typeof n === "number" && Number.isFinite(n))
        ) {
            throw new Error("Vector search requires a non-empty array of finite numbers");
        }

        const vectorLiteral = `'[${vectorSearch.vector.join(",")}]'::vector`;
        const distanceFn = vectorSearch.distance || "cosine";

        let operator: string;
        switch (distanceFn) {
            case "cosine":
                operator = "<=>";
                break;
            case "l2":
                operator = "<->";
                break;
            case "inner_product":
                operator = "<#>";
                break;
        }

        const distanceExpr = sql`${column} ${sql.raw(operator)} ${sql.raw(vectorLiteral)}`;

        return {
            orderBy: distanceExpr,
            filter: vectorSearch.threshold != null
                ? sql`(${column} ${sql.raw(operator)} ${sql.raw(vectorLiteral)}) < ${vectorSearch.threshold}`
                : undefined,
            distanceSelect: sql`(${column} ${sql.raw(operator)} ${sql.raw(vectorLiteral)})`
        };
    }
}

/**
 * Alias for DrizzleConditionBuilder for consistent naming with other database implementations.
 * This allows code to use PostgresConditionBuilder alongside future MongoConditionBuilder, etc.
 */
export const PostgresConditionBuilder = DrizzleConditionBuilder;

