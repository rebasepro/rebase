import { and, eq, inArray, or, sql, SQL } from "drizzle-orm";
import { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { DrizzleClient } from "../interfaces";
import { CollectionConfig, FilterValues, Relation } from "@rebasepro/types";
import { getTableName, resolveCollectionRelations, findRelation } from "@rebasepro/common";
import { DrizzleConditionBuilder } from "../utils/drizzle-conditions";
import {
    getCollectionByPath,
    getTableForCollection,
    requirePrimaryKeys,
    parseIdValues,
    buildCompositeId,
    type PrimaryKeyInfo
} from "./collection-helpers";
import { parseDataFromServer } from "../data-transformer";
import { PostgresCollectionRegistry } from "../collections/PostgresCollectionRegistry";
import { logger } from "@rebasepro/server";
import type { NestedPathHop } from "./nested-path";

/**
 * Typed wrapper for Drizzle dynamic query innerJoin.
 * Drizzle's `$dynamic()` queries lose the `innerJoin` method from
 * their static type, but it exists at runtime. This helper bridges
 * the gap with a single confined cast.
 */
function applyDynamicJoin<T>(query: T, joinTable: PgTable, condition: SQL): T {
    return (query as unknown as { innerJoin(t: PgTable, c: SQL): T }).innerJoin(joinTable, condition) as T;
}

/**
 * Typed wrapper for DrizzleConditionBuilder.buildRelationQuery on dynamic queries.
 * The method returns a widened generic that doesn't reassign cleanly;
 * this helper confines the cast.
 */
function applyDynamicRelationQuery<T>(
    query: T,
    ...args: Parameters<typeof DrizzleConditionBuilder.buildRelationQuery>
): T {
    return DrizzleConditionBuilder.buildRelationQuery(...args) as unknown as T;
}

/**
 * Service for handling all relation-related operations.
 * Handles fetching, updating, and managing row relations.
 */
/**
 * A related record resolved by {@link RelationService}: the target row's
 * values plus the identity (`id`) and originating collection (`path`)
 * needed to build relation references. Internal to the postgres driver —
 * flattened to plain rows at the fetch-service boundary.
 */
export interface RelatedRow<M extends Record<string, unknown> = Record<string, unknown>> {
    id: string | number;
    path: string;
    values: M;
}

export class RelationService {
    constructor(private db: DrizzleClient, private registry: PostgresCollectionRegistry) { }

    /**
     * One target row, as the {@link RelatedRow} everything here returns.
     *
     * Eight sites built this by hand, which is how the address came to be the
     * target's first key column in all eight — one edit, eight places to miss.
     *
     * `resolveNested` is the one thing they did not agree on, and the
     * disagreement was invisible: the single-parent fetches pass `db` and
     * `registry` to `parseDataFromServer`, so the target's *own* relations get
     * resolved too, while the batch paths deliberately do not — a query per
     * target row is the N+1 the batching exists to avoid. Naming the parameter
     * makes that a decision rather than a difference between two call sites
     * nobody was comparing.
     */
    private async toRelatedRow<M extends Record<string, unknown>>(
        targetRow: Record<string, unknown>,
        targetCollection: CollectionConfig,
        targetPks: PrimaryKeyInfo[],
        options?: { resolveNested?: boolean }
    ): Promise<RelatedRow<M>> {
        const values = options?.resolveNested
            ? await parseDataFromServer(targetRow, targetCollection, this.db, this.registry)
            : await parseDataFromServer(targetRow, targetCollection);

        return {
            // The whole key: a composite target addressed by its first column
            // names every row that shares it.
            id: buildCompositeId(targetRow, targetPks),
            path: targetCollection.slug,
            values: values as M
        };
    }

    /**
     * A WHERE matching any of `parentIds`, by the whole key.
     *
     * A single key is an `IN (…)`. A composite one cannot be: matching
     * `tenant_id IN (1, 1)` collects every row of tenant 1, so two parents that
     * share their first column each receive the other's relations. It becomes
     * an OR of ANDs — one exact address per parent — which Postgres indexes the
     * same way it would a multi-column key lookup.
     */
    private parentKeyCondition(
        parentTable: PgTable,
        parentPks: PrimaryKeyInfo[],
        parentIds: (string | number)[]
    ): SQL {
        const columnFor = (fieldName: string) => {
            const col = parentTable[fieldName as keyof typeof parentTable] as AnyPgColumn;
            if (!col) throw new Error(`Key column '${fieldName}' not found in parent table`);
            return col;
        };

        if (parentPks.length === 1) {
            const values = parentIds.map(id => parseIdValues(id, parentPks)[parentPks[0].fieldName]);
            return inArray(columnFor(parentPks[0].fieldName), values);
        }

        const perParent = parentIds.map(id => {
            const values = parseIdValues(id, parentPks);
            return and(...parentPks.map(pk => eq(columnFor(pk.fieldName), values[pk.fieldName])));
        });
        return or(...perParent) as SQL;
    }

    /**
     * Reject a relation that cannot express a composite-keyed parent.
     *
     * `localKey` and `foreignKeyOnTarget` are single column names: one column
     * cannot reference a two-column key, so such a relation has no correct
     * reading. Left alone it would silently match on the first key column and
     * hand a tenant's rows to its neighbour — say so instead.
     */
    private assertSingleKeyAddressable(
        parentCollection: CollectionConfig,
        parentPks: PrimaryKeyInfo[],
        via: string
    ): void {
        if (parentPks.length > 1) {
            throw new Error(
                `Relation on '${parentCollection.slug}' uses '${via}', a single foreign-key column, but ` +
                `'${parentCollection.slug}' is keyed on ${parentPks.map(k => `'${k.fieldName}'`).join(" + ")}. ` +
                `One column cannot reference a composite key — express this relation with \`joinPath\`, whose ` +
                `\`on.from\`/\`on.to\` take every key column.`
            );
        }
    }

    /**
     * Fetch rows related to a parent row through a specific relation
     */
    async fetchRelatedEntities<M extends Record<string, unknown>>(
        parentCollectionPath: string,
        parentId: string | number,
        relationKey: string,
        options: {
            filter?: FilterValues<Extract<keyof M, string>>;
            orderBy?: string;
            order?: "desc" | "asc";
            limit?: number;
            startAfter?: Record<string, unknown>;
            searchString?: string;
            databaseId?: string;
        } = {}
    ): Promise<RelatedRow<M>[]> {
        const parentCollection = getCollectionByPath(parentCollectionPath, this.registry);
        const resolvedRelations = resolveCollectionRelations(parentCollection);
        const relation = findRelation(resolvedRelations, relationKey);

        if (!relation) {
            const available = Object.keys(resolvedRelations).join(", ") || "(none)";
            throw new Error(`Relation '${relationKey}' not found in collection '${parentCollectionPath}'. Available relations: [${available}]`);
        }

        return this.fetchEntitiesUsingJoins<M>(parentCollection, parentId, relation, options);
    }

    /**
     * Fetch rows using join paths for complex relations
     */
    async fetchEntitiesUsingJoins<M extends Record<string, unknown>>(
        parentCollection: CollectionConfig,
        parentId: string | number,
        relation: Relation,
        options: {
            filter?: FilterValues<Extract<keyof M, string>>;
            orderBy?: string;
            order?: "desc" | "asc";
            limit?: number;
            startAfter?: Record<string, unknown>;
            searchString?: string;
            databaseId?: string;
        } = {}
    ): Promise<RelatedRow<M>[]> {
        const targetCollection = relation.target();
        const targetTable = getTableForCollection(targetCollection, this.registry);
        const idInfo = requirePrimaryKeys(targetCollection, this.registry);
        const idField = targetTable[idInfo[0].fieldName as keyof typeof targetTable] as AnyPgColumn;

        const parentPks = requirePrimaryKeys(parentCollection, this.registry);
        const parentIdInfo = parentPks[0];
        const parsedParentIdObj = parseIdValues(parentId, parentPks);
        const parsedParentId = parsedParentIdObj[parentIdInfo.fieldName];
        const parentTable = this.registry.getTable(getTableName(parentCollection));
        if (!parentTable) throw new Error("Parent table not found");
        const parentIdCol = parentTable[parentIdInfo.fieldName as keyof typeof parentTable] as AnyPgColumn;

        // Handle join path relations
        if (relation.joinPath && relation.joinPath.length > 0) {
            let query = this.db.select().from(parentTable).$dynamic();
            let currentTable = parentTable;

            // Apply each join in the path
            for (const join of relation.joinPath) {
                const joinTable = this.registry.getTable(join.table);
                if (!joinTable) {
                    throw new Error(`Join table not found: ${join.table}`);
                }

                const fromColumn = Array.isArray(join.on.from) ? join.on.from[0] : join.on.from;
                const toColumn = Array.isArray(join.on.to) ? join.on.to[0] : join.on.to;

                const fromParts = fromColumn.split(".");
                const toParts = toColumn.split(".");

                const fromColName = fromParts[fromParts.length - 1];
                const toColName = toParts[toParts.length - 1];

                const fromCol = currentTable[fromColName as keyof typeof currentTable] as AnyPgColumn;
                const toCol = joinTable[toColName as keyof typeof joinTable] as AnyPgColumn;

                if (!fromCol || !toCol) {
                    throw new Error(`Join columns not found: ${fromColumn} -> ${toColumn}`);
                }

                query = applyDynamicJoin(query, joinTable, eq(fromCol, toCol));
                currentTable = joinTable;
            }

            // Add where condition for the parent row
            const parentIdField = parentTable[requirePrimaryKeys(parentCollection, this.registry)[0].fieldName as keyof typeof parentTable] as AnyPgColumn;
            query = query.where(eq(parentIdField, parsedParentId));

            if (options.limit) {
                query = query.limit(options.limit);
            }

            const results = await query;
            const targetTableName = relation.joinPath[relation.joinPath.length - 1].table;

            // Process results
            const rows: RelatedRow<M>[] = [];
            for (const row of results as Array<Record<string, unknown>>) {
                const targetRow = (row[targetTableName] as Record<string, unknown>) || row;
                rows.push(await this.toRelatedRow<M>(targetRow, targetCollection, idInfo, { resolveNested: true }));
            }

            return rows;
        }

        // Handle other relation types
        let query = this.db.select().from(targetTable).$dynamic();

        // Build additional filter conditions
        const additionalFilters: SQL[] = [];

        // Handle search conditions if searchString is provided
        if (options.searchString) {
            const searchConditions = DrizzleConditionBuilder.buildSearchConditions(
                options.searchString,
                targetCollection.properties,
                targetTable
            );

            if (searchConditions.length === 0) {
                // No searchable fields found, return empty results
                return [];
            }

            const searchCombined = DrizzleConditionBuilder.combineConditionsWithOr(searchConditions);
            if (searchCombined) {
                additionalFilters.push(searchCombined);
            }
        }

        // Use unified relation query builder
        query = applyDynamicRelationQuery(
            query,
            query,
            relation,
            parsedParentId,
            targetTable,
            parentTable,
            parentIdCol,
            idField,
            this.registry,
            additionalFilters
        );

        if (options.limit) {
            query = query.limit(options.limit);
        }

        const results = await query;

        // Process results - ensure results is iterable
        if (!results || !Array.isArray(results)) {
            return [];
        }

        const rows: RelatedRow<M>[] = [];
        for (const row of results) {
            const targetRow = row[getTableName(targetCollection)] || row;
            rows.push(await this.toRelatedRow<M>(targetRow as Record<string, unknown>, targetCollection, idInfo, { resolveNested: true }));
        }

        return rows;
    }

    /**
     * Count related rows for a parent row
     */
    async countRelatedEntities<M extends Record<string, unknown>>(
        parentCollectionPath: string,
        parentId: string | number,
        relationKey: string,
        options: { filter?: FilterValues<Extract<keyof M, string>>; databaseId?: string } = {}
    ): Promise<number> {
        const parentCollection = getCollectionByPath(parentCollectionPath, this.registry);
        const resolvedRelations = resolveCollectionRelations(parentCollection);
        const relation = findRelation(resolvedRelations, relationKey);
        if (!relation) {
            const available = Object.keys(resolvedRelations).join(", ") || "(none)";
            throw new Error(`Relation '${relationKey}' not found in collection '${parentCollectionPath}'. Available relations: [${available}]`);
        }

        return this.countRelatedRows(parentCollection, parentId, relation, []);
    }

    /**
     * Count the target rows a parent reaches through `relation`, narrowed by
     * `additionalFilters` (conditions on the target table).
     *
     * Shared by the public count and by {@link isRelated}, so "how many children
     * does this parent have" and "is this row one of them" are answered by the
     * same join — a membership test that reconstructed the join separately would
     * be free to disagree with the listing it is supposed to gate.
     */
    private async countRelatedRows(
        parentCollection: CollectionConfig,
        parentId: string | number,
        relation: Relation,
        additionalFilters: SQL[]
    ): Promise<number> {
        const targetCollection = relation.target();
        const targetTable = getTableForCollection(targetCollection, this.registry);
        const targetPks = requirePrimaryKeys(targetCollection, this.registry);
        const targetIdInfo = targetPks[0];
        const targetIdField = targetTable[targetIdInfo.fieldName as keyof typeof targetTable] as AnyPgColumn;

        const parentPks = requirePrimaryKeys(parentCollection, this.registry);
        const parentIdInfo = parentPks[0];
        const parsedParentIdObj = parseIdValues(parentId, parentPks);
        const parsedParentId = parsedParentIdObj[parentIdInfo.fieldName];
        const parentTable = this.registry.getTable(getTableName(parentCollection));
        if (!parentTable) throw new Error("Parent table not found");
        const parentIdCol = parentTable[parentIdInfo.fieldName as keyof typeof parentTable] as AnyPgColumn;

        // Start count with distinct to avoid duplicates from junction tables
        let query = this.db.select({ count: sql<number>`count(distinct ${targetIdField})` }).from(targetTable).$dynamic();

        // Use unified count query builder from DrizzleConditionBuilder
        query = DrizzleConditionBuilder.buildRelationCountQuery(
            query,
            relation,
            parsedParentId,
            targetTable,
            parentTable,
            parentIdCol,
            targetIdField,
            this.registry,
            additionalFilters
        );

        const result = await query;
        return Number(result[0]?.count || 0);
    }

    /**
     * Whether `targetId` is actually reachable from the parent named in `hop`.
     *
     * A nested address like `authors/1/posts/43` used to resolve to the target
     * collection and then match on the primary key alone, so the parent segment
     * decided nothing: the row came back, and was updated or deleted, whoever it
     * belonged to. Reads, updates and deletes now all gate on this.
     */
    async isRelated(hop: NestedPathHop, targetId: string | number): Promise<boolean> {
        const targetTable = getTableForCollection(hop.targetCollection, this.registry);
        const targetPks = requirePrimaryKeys(hop.targetCollection, this.registry);
        const parsedTargetId = parseIdValues(targetId, targetPks);

        const identity: SQL[] = targetPks.map(pk => {
            const column = targetTable[pk.fieldName as keyof typeof targetTable] as AnyPgColumn;
            if (!column) {
                throw new Error(`ID field '${pk.fieldName}' not found in table for collection '${hop.targetCollection.slug}'`);
            }
            return eq(column, parsedTargetId[pk.fieldName]);
        });

        return (await this.countRelatedRows(hop.parentCollection, hop.parentId, hop.relation, identity)) > 0;
    }

    /**
     * Remove the junction row linking a parent to `targetId`, leaving the target
     * row itself alone.
     *
     * This is what `DELETE authors/1/tags/5` has to mean for a many-to-many: the
     * target is shared, so deleting the row would remove the tag from every other
     * post that uses it. It used to do exactly that — resolve the path to the
     * `tags` table and delete by primary key.
     */
    async unlinkRelatedEntity(
        tx: DrizzleClient,
        hop: NestedPathHop,
        targetId: string | number
    ): Promise<void> {
        const through = hop.relation.through;
        if (!through) {
            throw new Error(`Relation '${hop.relationKey}' has no junction table to unlink through`);
        }

        const junctionTable = this.registry.getTable(through.table);
        if (!junctionTable) {
            throw new Error(`Junction table not found: ${through.table}`);
        }

        const sourceJunctionColumn = junctionTable[through.sourceColumn as keyof typeof junctionTable] as AnyPgColumn;
        const targetJunctionColumn = junctionTable[through.targetColumn as keyof typeof junctionTable] as AnyPgColumn;

        if (!sourceJunctionColumn || !targetJunctionColumn) {
            throw new Error(`Junction columns not found for relation '${hop.relationKey}' on table '${through.table}'`);
        }

        const parentPks = requirePrimaryKeys(hop.parentCollection, this.registry);
        const parsedParentId = parseIdValues(hop.parentId, parentPks)[parentPks[0].fieldName];

        const targetPks = requirePrimaryKeys(hop.targetCollection, this.registry);
        const parsedTargetId = parseIdValues(targetId, targetPks)[targetPks[0].fieldName];

        await tx.delete(junctionTable).where(and(
            eq(sourceJunctionColumn, parsedParentId),
            eq(targetJunctionColumn, parsedTargetId)
        ));

        logger.info(`Unlinked '${hop.relationKey}' ${parsedTargetId} from ${hop.parentCollection.slug} ${parsedParentId}`);
    }

    /**
     * Batch fetch related rows for multiple parent rows to avoid N+1 queries
     */
    async batchFetchRelatedEntities(
        parentCollectionPath: string,
        parentIds: (string | number)[],
        _relationKey: string,
        relation: Relation
    ): Promise<Map<string, RelatedRow<Record<string, unknown>>>> {
        if (parentIds.length === 0) return new Map();

        const parentCollection = getCollectionByPath(parentCollectionPath, this.registry);
        const targetCollection = relation.target();
        const targetTable = getTableForCollection(targetCollection, this.registry);
        const targetPks = requirePrimaryKeys(targetCollection, this.registry);
        const targetIdInfo = targetPks[0];
        const targetIdField = targetTable[targetIdInfo.fieldName as keyof typeof targetTable] as AnyPgColumn;

        const parentPks = requirePrimaryKeys(parentCollection, this.registry);
        const parentIdInfo = parentPks[0];
        const parentTable = this.registry.getTable(getTableName(parentCollection));
        if (!parentTable) throw new Error("Parent table not found");
        const parentIdCol = parentTable[parentIdInfo.fieldName as keyof typeof parentTable] as AnyPgColumn;

        // Parse all parent IDs once
        const parsedParentIds = parentIds.map(id => parseIdValues(id, parentPks)[parentIdInfo.fieldName]);

        // Handle join path relations with batching
        if (relation.joinPath && relation.joinPath.length > 0) {
            let query = this.db.select().from(parentTable).$dynamic();
            let currentTable = parentTable;

            // Apply each join in the path
            for (const join of relation.joinPath) {
                const joinTable = this.registry.getTable(join.table);
                if (!joinTable) {
                    throw new Error(`Join table not found: ${join.table}`);
                }

                const fromColumn = Array.isArray(join.on.from) ? join.on.from[0] : join.on.from;
                const toColumn = Array.isArray(join.on.to) ? join.on.to[0] : join.on.to;

                const fromParts = fromColumn.split(".");
                const toParts = toColumn.split(".");

                const fromColName = fromParts[fromParts.length - 1];
                const toColName = toParts[toParts.length - 1];

                const fromCol = currentTable[fromColName as keyof typeof currentTable] as AnyPgColumn;
                const toCol = joinTable[toColName as keyof typeof joinTable] as AnyPgColumn;

                if (!fromCol || !toCol) {
                    throw new Error(`Join columns not found: ${fromColumn} -> ${toColumn}`);
                }

                query = applyDynamicJoin(query, joinTable, eq(fromCol, toCol));
                currentTable = joinTable;
            }

            // Match every parent at once, each by its whole key.
            query = query.where(this.parentKeyCondition(parentTable, parentPks, parentIds));

            const results = await query;
            const targetTableName = relation.joinPath[relation.joinPath.length - 1].table;
            const resultMap = new Map<string, RelatedRow<Record<string, unknown>>>();

            // Group by the parent's address — the same token the caller looks
            // results up by, derived the same way on both sides.
            for (const row of results as Array<Record<string, unknown>>) {
                const parentRow = (row[getTableName(parentCollection)] || row) as Record<string, unknown>;
                const targetRow = (row[targetTableName] || row) as Record<string, unknown>;

                resultMap.set(
                    buildCompositeId(parentRow, parentPks),
                    await this.toRelatedRow(targetRow, targetCollection, targetPks)
                );
            }

            return resultMap;
        }

        // Handle owning relations with proper FK-based batching.
        // For owning relations, parent rows hold the FK (e.g. posts.author_id).
        // We need to:
        //   1. Fetch FK values from the parent table in a single query
        //   2. Query the target table with unique FK values
        //   3. Map results back to parent rows via their FK values
        if (relation.direction === "owning" && relation.localKey) {
            this.assertSingleKeyAddressable(parentCollection, parentPks, relation.localKey);
            const localKeyCol = parentTable[relation.localKey as keyof typeof parentTable] as AnyPgColumn;
            if (!localKeyCol) {
                throw new Error(`Local key column '${relation.localKey}' not found in parent table`);
            }

            // Step 1: Fetch all FK values from parent table in ONE query
            const fkRows = await this.db
                .select({
                    parentId: parentIdCol,
                    fkValue: localKeyCol
                })
                .from(parentTable)
                .where(inArray(parentIdCol, parsedParentIds));

            // Build parentId → fkValue mapping and collect unique FK values
            const parentToFk = new Map<string, string | number>();
            const uniqueFkValues: (string | number)[] = [];
            const seenFks = new Set<string>();

            for (const row of fkRows as Array<{ parentId: string | number; fkValue: string | number | null }>) {
                if (row.fkValue == null) continue;
                parentToFk.set(String(row.parentId), row.fkValue);
                const fkStr = String(row.fkValue);
                if (!seenFks.has(fkStr)) {
                    seenFks.add(fkStr);
                    uniqueFkValues.push(row.fkValue);
                }
            }

            if (uniqueFkValues.length === 0) return new Map();

            // Step 2: Fetch all target rows in ONE query
            const targetResults = await this.db
                .select()
                .from(targetTable)
                .where(inArray(targetIdField, uniqueFkValues));

            // Index target rows by their ID
            const targetById = new Map<string, Record<string, unknown>>();
            for (const row of targetResults as Array<Record<string, unknown>>) {
                const tid = String(row[targetIdInfo.fieldName]);
                targetById.set(tid, row);
            }

            // Step 3: Map back to parent rows
            const resultMap = new Map<string, RelatedRow<Record<string, unknown>>>();
            for (const [parentIdStr, fkValue] of parentToFk) {
                const targetRow = targetById.get(String(fkValue));
                if (targetRow) {
                    resultMap.set(parentIdStr, await this.toRelatedRow(targetRow, targetCollection, targetPks));
                }
            }

            return resultMap;
        }

        // Handle inverse relation types with batching. The parent is named by a
        // single FK column on the target, so a composite-keyed parent has no
        // correct reading here either.
        this.assertSingleKeyAddressable(
            parentCollection,
            parentPks,
            relation.foreignKeyOnTarget ?? `${relation.inverseRelationName}_id`
        );
        let query = this.db.select().from(targetTable).$dynamic();

        // Build the relation query with ALL parent IDs
        query = applyDynamicRelationQuery(
            query,
            query,
            relation,
            parsedParentIds, // Pass array instead of single ID
            targetTable,
            parentTable,
            parentIdCol,
            targetIdField,
            this.registry,
            []
        );

        const results = await query;
        const resultMap = new Map<string, RelatedRow<Record<string, unknown>>>();

        // Build a Set<string> for O(1) parent-ID lookups that is immune to
        // number-vs-string type mismatches (Drizzle may return either depending
        // on the column type and driver).
        const parentIdSet = new Set(parsedParentIds.map(String));

        // Map results back to parent rows
        for (const row of results as Array<Record<string, unknown>>) {
            const targetRow = (row[getTableName(targetCollection)] || row) as Record<string, unknown>;

            // Determine the parent ID this result belongs to based on the relation type
            let parentId: string | number | undefined;

            if (relation.direction === "inverse" && relation.foreignKeyOnTarget) {
                parentId = targetRow[relation.foreignKeyOnTarget] as string | number | undefined;
            } else if (relation.direction === "inverse" && relation.cardinality === "one" && relation.inverseRelationName) {
                const inferredForeignKeyName = `${relation.inverseRelationName}_id`;
                parentId = targetRow[inferredForeignKeyName] as string | number | undefined;
            }

            if (parentId !== undefined && parentIdSet.has(String(parentId))) {
                resultMap.set(String(parentId), await this.toRelatedRow(targetRow, targetCollection, targetPks));
            }
        }

        return resultMap;
    }

    /**
     * Batch fetch many-cardinality related rows for multiple parent rows.
     * Returns a Map<parentId, RelatedRow[]> instead of Map<parentId, RelatedRow>.
     * Uses a single SQL query with IN clause to avoid N+1.
     */
    async batchFetchRelatedEntitiesMany(
        parentCollectionPath: string,
        parentIds: (string | number)[],
        _relationKey: string,
        relation: Relation
    ): Promise<Map<string, RelatedRow<Record<string, unknown>>[]>> {
        if (parentIds.length === 0) return new Map();

        const parentCollection = getCollectionByPath(parentCollectionPath, this.registry);
        const targetCollection = relation.target();
        const targetTable = getTableForCollection(targetCollection, this.registry);
        const targetPks = requirePrimaryKeys(targetCollection, this.registry);
        const targetIdInfo = targetPks[0];
        const targetIdField = targetTable[targetIdInfo.fieldName as keyof typeof targetTable] as AnyPgColumn;

        const parentPks = requirePrimaryKeys(parentCollection, this.registry);
        const parentIdInfo = parentPks[0];
        const parentTable = this.registry.getTable(getTableName(parentCollection));
        if (!parentTable) throw new Error("Parent table not found");
        const parentIdCol = parentTable[parentIdInfo.fieldName as keyof typeof parentTable] as AnyPgColumn;

        const parsedParentIds = parentIds.map(id => parseIdValues(id, parentPks)[parentIdInfo.fieldName]);

        // Handle join path relations (many-to-many through junction tables)
        if (relation.joinPath && relation.joinPath.length > 0) {
            let query = this.db.select().from(parentTable).$dynamic();
            let currentTable = parentTable;

            for (const join of relation.joinPath) {
                const joinTable = this.registry.getTable(join.table);
                if (!joinTable) throw new Error(`Join table not found: ${join.table}`);

                const fromColumn = Array.isArray(join.on.from) ? join.on.from[0] : join.on.from;
                const toColumn = Array.isArray(join.on.to) ? join.on.to[0] : join.on.to;
                const fromColName = fromColumn.split(".").pop()!;
                const toColName = toColumn.split(".").pop()!;

                const fromCol = currentTable[fromColName as keyof typeof currentTable] as AnyPgColumn;
                const toCol = joinTable[toColName as keyof typeof joinTable] as AnyPgColumn;
                if (!fromCol || !toCol) throw new Error(`Join columns not found: ${fromColumn} -> ${toColumn}`);

                query = applyDynamicJoin(query, joinTable, eq(fromCol, toCol));
                currentTable = joinTable;
            }

            query = query.where(this.parentKeyCondition(parentTable, parentPks, parentIds));

            const results = await query;
            const targetTableName = relation.joinPath[relation.joinPath.length - 1].table;
            const resultMap = new Map<string, RelatedRow<Record<string, unknown>>[]>();

            for (const row of results as Array<Record<string, unknown>>) {
                const parentRow = (row[getTableName(parentCollection)] || row) as Record<string, unknown>;
                const targetRow = (row[targetTableName] || row) as Record<string, unknown>;
                const parentId = buildCompositeId(parentRow, parentPks);
                const arr = resultMap.get(parentId) || [];
                arr.push(await this.toRelatedRow(targetRow, targetCollection, targetPks));
                resultMap.set(parentId, arr);
            }

            return resultMap;
        }

        // Handle many-to-many owning relations with junction table (relation.through)
        // This is the standard path for posts→tags style relations where
        // sanitizeRelation populated the `through` config.
        if (relation.through && relation.cardinality === "many" && relation.direction === "owning") {
            // The junction names its parent with one column, so the same
            // single-key limit applies as for a direct foreign key.
            this.assertSingleKeyAddressable(parentCollection, parentPks, `${relation.through.table}.${relation.through.sourceColumn}`);
            const junctionTable = this.registry.getTable(relation.through.table);
            if (!junctionTable) {
                logger.warn(`[batchFetchRelatedEntitiesMany] Junction table '${relation.through.table}' not found`);
                return new Map();
            }

            const sourceJunctionCol = junctionTable[relation.through.sourceColumn as keyof typeof junctionTable] as AnyPgColumn;
            const targetJunctionCol = junctionTable[relation.through.targetColumn as keyof typeof junctionTable] as AnyPgColumn;

            if (!sourceJunctionCol || !targetJunctionCol) {
                logger.warn(`[batchFetchRelatedEntitiesMany] Junction columns not found in '${relation.through.table}'`);
                return new Map();
            }

            // SELECT target.*, junction.sourceColumn FROM junction
            // INNER JOIN target ON junction.targetColumn = target.id
            // WHERE junction.sourceColumn IN (parentIds)
            const query = this.db
                .select()
                .from(junctionTable)
                .innerJoin(targetTable, eq(targetJunctionCol, targetIdField))
                .where(inArray(sourceJunctionCol, parsedParentIds));

            const results = await query;
            const resultMap = new Map<string, RelatedRow<Record<string, unknown>>[]>();
            const targetTableName = getTableName(targetCollection);

            for (const row of results as Array<Record<string, unknown>>) {
                // The junction table data is namespaced under its table name
                const junctionData = (row[relation.through.table] || row) as Record<string, unknown>;
                const targetData = (row[targetTableName] || row) as Record<string, unknown>;

                const parentId = String(junctionData[relation.through.sourceColumn]);
                const arr = resultMap.get(parentId) || [];
                arr.push(await this.toRelatedRow(targetData, targetCollection, targetPks));
                resultMap.set(parentId, arr);
            }

            return resultMap;
        }

        // Handle FK-based relations (one-to-many inverse). One column on the
        // target names the parent, so a composite-keyed parent cannot be named.
        this.assertSingleKeyAddressable(
            parentCollection,
            parentPks,
            relation.foreignKeyOnTarget ?? `${relation.inverseRelationName}_id`
        );
        let query = this.db.select().from(targetTable).$dynamic();

        query = applyDynamicRelationQuery(
            query,
            query,
            relation,
            parsedParentIds,
            targetTable,
            parentTable,
            parentIdCol,
            targetIdField,
            this.registry,
            []
        );

        const results = await query;
        const resultMap = new Map<string, RelatedRow<Record<string, unknown>>[]>();

        // Build a Set<string> for O(1) parent-ID lookups that is immune to
        // number-vs-string type mismatches (Drizzle may return either depending
        // on the column type and driver).
        const parentIdSet = new Set(parsedParentIds.map(String));

        for (const row of results as Array<Record<string, unknown>>) {
            const targetRow = (row[getTableName(targetCollection)] || row) as Record<string, unknown>;

            let parentId: string | number | undefined;

            if (relation.through && relation.direction === "inverse") {
                // Inverse many-to-many via junction table: the junction's targetColumn
                // references the parent (since from the inverse perspective, source/target are swapped).
                const junctionData = (row[relation.through.table] || row) as Record<string, unknown>;
                parentId = junctionData[relation.through.targetColumn] as string | number | undefined;
            } else if (relation.direction === "inverse" && relation.foreignKeyOnTarget) {
                parentId = targetRow[relation.foreignKeyOnTarget] as string | number | undefined;
            } else if (relation.direction === "inverse" && relation.inverseRelationName) {
                const inferredForeignKeyName = `${relation.inverseRelationName}_id`;
                parentId = targetRow[inferredForeignKeyName] as string | number | undefined;
            }

            if (parentId !== undefined && parentIdSet.has(String(parentId))) {
                const key = String(parentId);
                const arr = resultMap.get(key) || [];
                arr.push(await this.toRelatedRow(targetRow, targetCollection, targetPks));
                resultMap.set(key, arr);
            }
        }

        return resultMap;
    }

    /**
     * Update many-to-many and junction relations
     */
    async updateRelationsUsingJoins<M extends Record<string, unknown>>(
        tx: DrizzleClient,
        collection: CollectionConfig,
        id: string | number,
        relationValues: Partial<M>
    ) {
        const resolvedRelations = resolveCollectionRelations(collection);

        for (const [key, value] of Object.entries(relationValues)) {
            const relation = findRelation(resolvedRelations, key);
            if (!relation || relation.cardinality !== "many") continue;

            const targetEntityIds = (value && Array.isArray(value)) ? value.map((rel: { id: string | number }) => rel.id) : [];
            const targetCollection = relation.target();

            // Use joinPath if available
            if (relation.joinPath && relation.joinPath.length > 0) {
                const parentTableName = getTableName(collection);
                const targetTableName = getTableName(targetCollection);

                let junctionTable: PgTable | undefined = undefined;
                let sourceJunctionColumn: AnyPgColumn | null = null;
                let targetJunctionColumn: AnyPgColumn | null = null;

                const junctionTableName = relation.joinPath.find(step =>
                    step.table !== parentTableName && step.table !== targetTableName
                )?.table;

                if (junctionTableName) {
                    junctionTable = this.registry.getTable(junctionTableName);

                    if (junctionTable) {
                        for (const joinStep of relation.joinPath) {
                            const fromTable = DrizzleConditionBuilder.getTableNamesFromColumns(joinStep.on.from)[0];
                            const toTable = DrizzleConditionBuilder.getTableNamesFromColumns(joinStep.on.to)[0];

                            if (fromTable === parentTableName && toTable === junctionTableName) {
                                const columnNames = DrizzleConditionBuilder.getColumnNamesFromColumns(joinStep.on.to);
                                sourceJunctionColumn = junctionTable[columnNames[0] as keyof typeof junctionTable] as AnyPgColumn;
                            } else if (fromTable === junctionTableName && toTable === parentTableName) {
                                const columnNames = DrizzleConditionBuilder.getColumnNamesFromColumns(joinStep.on.from);
                                sourceJunctionColumn = junctionTable[columnNames[0] as keyof typeof junctionTable] as AnyPgColumn;
                            }

                            if (fromTable === junctionTableName && toTable === targetTableName) {
                                const columnNames = DrizzleConditionBuilder.getColumnNamesFromColumns(joinStep.on.from);
                                targetJunctionColumn = junctionTable[columnNames[0] as keyof typeof junctionTable] as AnyPgColumn;
                            } else if (fromTable === targetTableName && toTable === junctionTableName) {
                                const columnNames = DrizzleConditionBuilder.getColumnNamesFromColumns(joinStep.on.to);
                                targetJunctionColumn = junctionTable[columnNames[0] as keyof typeof junctionTable] as AnyPgColumn;
                            }
                        }
                    }
                }

                if (!junctionTable || !sourceJunctionColumn || !targetJunctionColumn) {
                    logger.warn(`Could not determine junction table for relation '${key}' in collection '${collection.slug}'`);
                    continue;
                }

                const parentPks = requirePrimaryKeys(collection, this.registry);
                const parentIdInfo = parentPks[0];
                const parsedParentIdObj = parseIdValues(id, parentPks);
                const parsedParentId = parsedParentIdObj[parentIdInfo.fieldName];

                // Delete existing relations for this row
                await tx.delete(junctionTable).where(eq(sourceJunctionColumn, parsedParentId));

                if (targetEntityIds.length > 0) {
                    const targetPks = requirePrimaryKeys(targetCollection, this.registry);
                    const targetIdInfo = targetPks[0];
                    const parsedTargetIds = targetEntityIds.map(id => parseIdValues(id, targetPks)[targetIdInfo.fieldName]);

                    const newLinks = parsedTargetIds.map(targetId => ({
                        [sourceJunctionColumn.name]: parsedParentId,
                        [targetJunctionColumn.name]: targetId
                    }));

                    if (newLinks.length > 0) {
                        await tx.insert(junctionTable).values(newLinks);
                    }
                }
            } else if (relation.through && relation.cardinality === "many" && relation.direction === "owning") {
                // Handle many-to-many relations with junction table using 'through' property
                const junctionTable = this.registry.getTable(relation.through.table);
                if (!junctionTable) {
                    logger.warn(`Junction table '${relation.through.table}' not found for relation '${key}' in collection '${collection.slug}'`);
                    continue;
                }

                const sourceJunctionColumn = junctionTable[relation.through.sourceColumn as keyof typeof junctionTable] as AnyPgColumn;
                const targetJunctionColumn = junctionTable[relation.through.targetColumn as keyof typeof junctionTable] as AnyPgColumn;

                if (!sourceJunctionColumn || !targetJunctionColumn) {
                    logger.warn(`Junction columns not found for relation '${key}'`);
                    continue;
                }

                const parentPks = requirePrimaryKeys(collection, this.registry);
                const parentIdInfo = parentPks[0];
                const parsedParentIdObj = parseIdValues(id, parentPks);
                const parsedParentId = parsedParentIdObj[parentIdInfo.fieldName];

                // Delete existing relations for this row
                await tx.delete(junctionTable).where(eq(sourceJunctionColumn, parsedParentId));

                if (targetEntityIds.length > 0) {
                    const targetPks = requirePrimaryKeys(targetCollection, this.registry);
                    const targetIdInfo = targetPks[0];
                    const parsedTargetIds = targetEntityIds.map(id => parseIdValues(id, targetPks)[targetIdInfo.fieldName]);

                    const newLinks = parsedTargetIds.map(targetId => ({
                        [sourceJunctionColumn.name]: parsedParentId,
                        [targetJunctionColumn.name]: targetId
                    }));

                    if (newLinks.length > 0) {
                        await tx.insert(junctionTable).values(newLinks);
                    }
                }
            } else if (relation.through && relation.cardinality === "many" && relation.direction === "inverse") {
                // Inverse M2M relations should be saved from the owning side.
                // The owning collection manages the junction table rows.
                logger.warn(`[updateRelationsUsingJoins] Inverse M2M relation '${key}' in collection '${collection.slug}' should be saved from the owning side. Skipping.`);
            } else if (relation.cardinality === "many" && relation.direction === "inverse" && relation.foreignKeyOnTarget) {
                // Handle one-to-many (inverse) by updating target FK to point to parent
                const targetTable = getTableForCollection(targetCollection, this.registry);
                const targetPks = requirePrimaryKeys(targetCollection, this.registry);
                const targetIdInfo = targetPks[0];
                const targetIdCol = targetTable[targetIdInfo.fieldName as keyof typeof targetTable] as AnyPgColumn;
                const fkCol = targetTable[relation.foreignKeyOnTarget as keyof typeof targetTable] as AnyPgColumn;

                if (!fkCol || !targetIdCol) {
                    logger.warn(`Invalid inverse-many config for relation '${key}' in collection '${collection.slug}'`);
                    continue;
                }

                const parentPks = requirePrimaryKeys(collection, this.registry);
                const parentIdInfo = parentPks[0];
                const parsedParentIdObj = parseIdValues(id, parentPks);
                const parsedParentId = parsedParentIdObj[parentIdInfo.fieldName];

                // Clear existing links not in the new set
                if (targetEntityIds.length > 0) {
                    const parsedTargetIds = targetEntityIds.map(id => parseIdValues(id, targetPks)[targetIdInfo.fieldName]);
                    await tx
                        .update(targetTable)
                        .set({ [relation.foreignKeyOnTarget]: null })
                        .where(and(eq(fkCol, parsedParentId), sql`${targetIdCol} NOT IN (${sql.join(parsedTargetIds)})`));

                    // Set FK for the provided targets
                    await tx
                        .update(targetTable)
                        .set({ [relation.foreignKeyOnTarget]: parsedParentId })
                        .where(inArray(targetIdCol as AnyPgColumn, parsedTargetIds as unknown[]));
                } else {
                    // If empty array provided, clear all existing links for this parent
                    await tx
                        .update(targetTable)
                        .set({ [relation.foreignKeyOnTarget]: null })
                        .where(eq(fkCol, parsedParentId));
                }
            } else {
                logger.warn(`Many relation '${key}' in collection '${collection.slug}' lacks write configuration and will be skipped during save.`);
            }
        }
    }

    /**
     * Update inverse relations (where FK is on the target table)
     */
    async updateInverseRelations(
        tx: DrizzleClient,
        sourceCollection: CollectionConfig,
        sourceEntityId: string | number,
        inverseRelationUpdates: Array<{
            relationKey: string;
            relation: Relation;
            newValue: unknown;
        }>
    ) {
        for (const update of inverseRelationUpdates) {
            const { relation, newValue } = update;

            try {
                const targetCollection = relation.target();
                const targetTable = getTableForCollection(targetCollection, this.registry);
                const targetPks = requirePrimaryKeys(targetCollection, this.registry);
                const targetIdInfo = targetPks[0];
                const sourcePks = requirePrimaryKeys(sourceCollection, this.registry);
                const sourceIdInfo = sourcePks[0];

                // Handle inverse relations with joinPath
                if (relation.direction === "inverse" && relation.joinPath && relation.joinPath.length > 0) {
                    await this.updateInverseJoinPathRelation(
                        tx,
                        sourceCollection,
                        sourceEntityId,
                        targetCollection,
                        relation,
                        newValue
                    );
                    continue;
                }

                // Check if this is a many-to-many inverse relation
                if (relation.cardinality === "many" && relation.direction === "inverse") {
                    const targetCollectionRelations = resolveCollectionRelations(targetCollection);
                    let junctionInfo: { table: string; sourceColumn: string; targetColumn: string } | null = null;

                    for (const [relationKey, targetRelation] of Object.entries(targetCollectionRelations)) {
                        if (targetRelation.cardinality === "many" &&
                            targetRelation.direction === "owning" &&
                            targetRelation.through &&
                            (targetRelation.relationName === relation.inverseRelationName || relationKey === relation.inverseRelationName)) {
                            junctionInfo = {
                                table: targetRelation.through.table,
                                sourceColumn: targetRelation.through.targetColumn,
                                targetColumn: targetRelation.through.sourceColumn
                            };
                            break;
                        }
                    }

                    if (junctionInfo) {
                        await this.updateManyToManyInverseRelation(
                            tx,
                            sourceCollection,
                            sourceEntityId,
                            targetCollection,
                            relation,
                            newValue,
                            junctionInfo
                        );
                        continue;
                    }
                }

                // Handle simple inverse relations
                if (!relation.foreignKeyOnTarget) {
                    logger.warn(`Inverse relation '${relation.relationName}' is missing foreignKeyOnTarget property. Skipping.`);
                    continue;
                }

                const foreignKeyColumn = targetTable[relation.foreignKeyOnTarget! as keyof typeof targetTable] as AnyPgColumn;
                if (!foreignKeyColumn) {
                    logger.warn(`Foreign key column '${relation.foreignKeyOnTarget}' not found in target table for relation '${relation.relationName}'`);
                    continue;
                }

                const parsedSourceIdObj = parseIdValues(sourceEntityId, sourcePks);
                const parsedSourceId = parsedSourceIdObj[sourceIdInfo.fieldName];

                if (newValue === null || newValue === undefined) {
                    await tx
                        .update(targetTable)
                        .set({ [relation.foreignKeyOnTarget!]: null })
                        .where(eq(foreignKeyColumn, parsedSourceId));
                } else {
                    const parsedNewTargetIdObj = parseIdValues(newValue as string | number, targetPks);
                    const parsedNewTargetId = parsedNewTargetIdObj[targetIdInfo.fieldName];
                    const targetIdField = targetTable[targetIdInfo.fieldName as keyof typeof targetTable] as AnyPgColumn;

                    // First, clear any existing FK that points to this source row
                    await tx
                        .update(targetTable)
                        .set({ [relation.foreignKeyOnTarget!]: null })
                        .where(eq(foreignKeyColumn, parsedSourceId));

                    // Then, update the new target row to point to this source row
                    await tx
                        .update(targetTable)
                        .set({ [relation.foreignKeyOnTarget!]: parsedSourceId })
                        .where(eq(targetIdField, parsedNewTargetId));
                }
            } catch (e) {
                logger.warn(`Failed to update inverse relation '${relation.relationName}'`, { error: e });
            }
        }
    }

    /**
     * Handle inverse relations with joinPath
     */
    private async updateInverseJoinPathRelation(
        tx: DrizzleClient,
        sourceCollection: CollectionConfig,
        sourceEntityId: string | number,
        targetCollection: CollectionConfig,
        relation: Relation,
        newValue: unknown
    ) {
        try {
            if (!relation.joinPath || relation.joinPath.length === 0) {
                logger.warn(`Inverse relation '${relation.relationName}' missing joinPath`);
                return;
            }

            const sourceTableName = getTableName(sourceCollection);
            const targetTableName = getTableName(targetCollection);

            // Find intermediate tables that are neither source nor target
            const intermediateTables = relation.joinPath
                .map(step => step.table)
                .filter(table => table !== sourceTableName && table !== targetTableName);

            // If there's exactly one intermediate table, it's likely a junction table for many-to-many
            if (intermediateTables.length === 1 && relation.cardinality === "many") {
                const junctionTableName = intermediateTables[0];
                const junctionTable = this.registry.getTable(junctionTableName);

                if (!junctionTable) {
                    logger.warn(`Junction table '${junctionTableName}' not found for inverse joinPath relation '${relation.relationName}'`);
                    return;
                }

                let sourceJunctionColumn: AnyPgColumn | null = null;
                let targetJunctionColumn: AnyPgColumn | null = null;

                for (const step of relation.joinPath) {
                    if (step.table === junctionTableName) {
                        const fromTable = DrizzleConditionBuilder.getTableNamesFromColumns(step.on.from)[0];
                        const toColumnNames = DrizzleConditionBuilder.getColumnNamesFromColumns(step.on.to);
                        const fromColumnNames = DrizzleConditionBuilder.getColumnNamesFromColumns(step.on.from);

                        if (fromTable === sourceTableName) {
                            sourceJunctionColumn = junctionTable[toColumnNames[0] as keyof typeof junctionTable] as AnyPgColumn;
                        } else if (fromTable === targetTableName) {
                            targetJunctionColumn = junctionTable[toColumnNames[0] as keyof typeof junctionTable] as AnyPgColumn;
                        } else {
                            const toTable = DrizzleConditionBuilder.getTableNamesFromColumns(step.on.to)[0];
                            if (toTable === sourceTableName) {
                                sourceJunctionColumn = junctionTable[fromColumnNames[0] as keyof typeof junctionTable] as AnyPgColumn;
                            } else if (toTable === targetTableName) {
                                targetJunctionColumn = junctionTable[fromColumnNames[0] as keyof typeof junctionTable] as AnyPgColumn;
                            }
                        }
                    }
                }

                if (!sourceJunctionColumn || !targetJunctionColumn) {
                    logger.warn(`Could not determine junction columns for inverse joinPath relation '${relation.relationName}'`);
                    return;
                }

                // Perform the junction table update
                const sourcePks = requirePrimaryKeys(sourceCollection, this.registry);
                const sourceIdInfo = sourcePks[0];
                const parsedSourceIdObj = parseIdValues(sourceEntityId, sourcePks);
                const parsedSourceId = parsedSourceIdObj[sourceIdInfo.fieldName];

                // Clear existing entries for this source row
                await tx.delete(junctionTable).where(eq(sourceJunctionColumn, parsedSourceId));

                // Add new entries if newValue is provided
                if (newValue && Array.isArray(newValue) && newValue.length > 0) {
                    const targetPks = requirePrimaryKeys(targetCollection, this.registry);
                    const targetIdInfo = targetPks[0];
                    const targetEntityIds = (newValue as Array<{ id: string | number } | string | number>).map((rel) => typeof rel === "object" && rel !== null ? rel.id : rel);
                    const parsedTargetIds = targetEntityIds.map(id => parseIdValues(id, targetPks)[targetIdInfo.fieldName]);

                    const newLinks = parsedTargetIds.map(targetId => ({
                        [sourceJunctionColumn!.name]: parsedSourceId,
                        [targetJunctionColumn!.name]: targetId
                    }));

                    if (newLinks.length > 0) {
                        await tx.insert(junctionTable).values(newLinks);
                    }
                } else if (newValue && !Array.isArray(newValue)) {
                    // Single value for one-to-one
                    const targetPks = requirePrimaryKeys(targetCollection, this.registry);
                    const targetIdInfo = targetPks[0];
                    const targetId = typeof newValue === "object" && newValue !== null ? (newValue as Record<string, unknown>).id as string | number : newValue as string | number;
                    const parsedTargetIdObj = parseIdValues(targetId, targetPks);
                    const parsedTargetId = parsedTargetIdObj[targetIdInfo.fieldName];

                    const newLink = {
                        [sourceJunctionColumn.name]: parsedSourceId,
                        [targetJunctionColumn.name]: parsedTargetId
                    };

                    await tx.insert(junctionTable).values(newLink);
                }
            }
        } catch (error) {
            logger.error(`Failed to update inverse joinPath relation '${relation.relationName}'`, { error: error });
            throw error;
        }
    }

    /**
     * Handle many-to-many inverse relation updates using junction tables
     */
    private async updateManyToManyInverseRelation(
        tx: DrizzleClient,
        sourceCollection: CollectionConfig,
        sourceEntityId: string | number,
        targetCollection: CollectionConfig,
        relation: Relation,
        newValue: unknown,
        junctionInfo: { table: string; sourceColumn: string; targetColumn: string }
    ) {
        try {
            const junctionTable = this.registry.getTable(junctionInfo.table);
            if (!junctionTable) {
                logger.warn(`Junction table '${junctionInfo.table}' not found for many-to-many inverse relation '${relation.relationName}'`);
                return;
            }

            const sourceJunctionColumn = junctionTable[junctionInfo.sourceColumn as keyof typeof junctionTable] as AnyPgColumn;
            const targetJunctionColumn = junctionTable[junctionInfo.targetColumn as keyof typeof junctionTable] as AnyPgColumn;

            if (!sourceJunctionColumn || !targetJunctionColumn) {
                logger.warn(`Junction columns not found for relation '${relation.relationName}'`);
                return;
            }

            const sourcePks = requirePrimaryKeys(sourceCollection, this.registry);
            const sourceIdInfo = sourcePks[0];
            const parsedSourceIdObj = parseIdValues(sourceEntityId, sourcePks);
            const parsedSourceId = parsedSourceIdObj[sourceIdInfo.fieldName];

            // Clear existing entries for this source row
            await tx.delete(junctionTable).where(eq(sourceJunctionColumn, parsedSourceId));

            // Add new entries if newValue is provided
            if (newValue && Array.isArray(newValue) && newValue.length > 0) {
                const targetPks = requirePrimaryKeys(targetCollection, this.registry);
                const targetIdInfo = targetPks[0];
                const targetEntityIds = (newValue as Array<{ id: string | number }>).map((rel) => rel.id);
                const parsedTargetIds = targetEntityIds.map(id => parseIdValues(id, targetPks)[targetIdInfo.fieldName]);

                const newLinks = parsedTargetIds.map(targetId => ({
                    [sourceJunctionColumn.name]: parsedSourceId,
                    [targetJunctionColumn.name]: targetId
                }));

                if (newLinks.length > 0) {
                    await tx.insert(junctionTable).values(newLinks);
                }
            }
        } catch (error) {
            logger.error(`Failed to update many-to-many inverse relation '${relation.relationName}'`, { error: error });
            throw error;
        }
    }

    /**
     * Update one-to-one relations that use joinPath
     */
    async updateJoinPathOneToOneRelations(
        tx: DrizzleClient,
        parentCollection: CollectionConfig,
        parentId: string | number,
        updates: Array<{
            relationKey: string;
            relation: Relation;
            newTargetId: string | number | null;
        }>
    ) {
        for (const upd of updates) {
            const { relation, newTargetId } = upd;
            const targetCollection = relation.target();
            const targetTable = getTableForCollection(targetCollection, this.registry);
            const targetPks = requirePrimaryKeys(targetCollection, this.registry);
            const targetIdInfo = targetPks[0];
            const targetIdCol = targetTable[targetIdInfo.fieldName as keyof typeof targetTable] as AnyPgColumn;

            // Determine mapping of columns
            const { targetFKColName, parentSourceColName } = this.resolveJoinPathWriteMapping(parentCollection, relation);
            const parentTable = getTableForCollection(parentCollection, this.registry);
            const parentPks = requirePrimaryKeys(parentCollection, this.registry);
            const parentIdInfo = parentPks[0];
            const parsedParentIdObj = parseIdValues(parentId, parentPks);
            const parsedParentId = parsedParentIdObj[parentIdInfo.fieldName];

            const parentIdCol = parentTable[parentIdInfo.fieldName as keyof typeof parentTable] as AnyPgColumn;
            const parentSourceCol = parentTable[parentSourceColName as keyof typeof parentTable] as AnyPgColumn;
            const targetFKCol = targetTable[targetFKColName as keyof typeof targetTable] as AnyPgColumn;

            if (!parentSourceCol) {
                logger.warn(`Parent source column '${parentSourceColName}' not found for joinPath relation '${relation.relationName}'`);
                continue;
            }
            if (!targetFKCol) {
                logger.warn(`Target FK column '${targetFKColName}' not found for joinPath relation '${relation.relationName}'`);
                continue;
            }

            // Fetch the parent row to obtain the value for parentSourceCol
            const parentRows = await tx
                .select({ val: parentSourceCol })
                .from(parentTable)
                .where(eq(parentIdCol, parsedParentId))
                .limit(1);
            if (parentRows.length === 0) continue;
            const parentFKValue = parentRows[0].val as string | number | null;

            if (newTargetId === null || newTargetId === undefined) {
                // Clear any target rows currently linked to this parent via the FK
                if (parentFKValue !== null && parentFKValue !== undefined) {
                    await tx.update(targetTable)
                        .set({ [targetFKColName]: null })
                        .where(eq(targetFKCol, String(parentFKValue)));
                }
                continue;
            }

            // Parse the new target id
            const parsedTargetIdObj = parseIdValues(newTargetId, targetPks);
            const parsedTargetId = parsedTargetIdObj[targetIdInfo.fieldName];

            // Ensure one-to-one by clearing existing link from any target rows with this parent FK
            if (parentFKValue !== null && parentFKValue !== undefined) {
                await tx.update(targetTable)
                    .set({ [targetFKColName]: null })
                    .where(eq(targetFKCol, String(parentFKValue)));
            } else {
                logger.warn(`Cannot set joinPath relation '${relation.relationName}' because parent FK value is null/undefined`);
                continue;
            }

            // Now set the FK on the target row
            await tx.update(targetTable)
                .set({ [targetFKColName]: parentFKValue })
                .where(eq(targetIdCol, parsedTargetId));
        }
    }

    /**
     * Resolve joinPath write mapping for one-to-one relations
     */
    resolveJoinPathWriteMapping(
        parentCollection: CollectionConfig,
        relation: Relation
    ): { targetFKColName: string; parentSourceColName: string } {
        if (!relation.joinPath || relation.joinPath.length === 0) {
            throw new Error("resolveJoinPathWriteMapping requires a joinPath relation");
        }
        const parentTableName = getTableName(parentCollection);
        const lastStep = relation.joinPath[relation.joinPath.length - 1];
        const targetFKColName = DrizzleConditionBuilder.getColumnNamesFromColumns(lastStep.on.to)[0];
        let currentFrom = lastStep.on.from;

        let safety = 0;
        while (safety++ < 10) {
            const currentFromTable = DrizzleConditionBuilder.getTableNamesFromColumns(currentFrom)[0];
            if (currentFromTable === parentTableName) {
                break;
            }
            const prevStep = relation.joinPath.find((s) => {
                const to = Array.isArray(s.on.to) ? s.on.to[0] : s.on.to;
                return to === currentFrom;
            });
            if (!prevStep) {
                throw new Error(`Could not resolve parent source column for joinPath relation '${relation.relationName}'`);
            }
            currentFrom = prevStep.on.from;
        }
        const parentSourceColName = DrizzleConditionBuilder.getColumnNamesFromColumns(currentFrom)[0];
        return { targetFKColName,
parentSourceColName };
    }

    /**
     * Handle junction table creation for many-to-many path-based saves
     */
    async handleJunctionTableCreation(
        tx: DrizzleClient,
        newEntityId: string | number,
        junctionTableInfo: {
            parentCollection: CollectionConfig;
            parentId: string | number;
            relation: Relation;
            relationKey: string;
        }
    ) {
        const { parentCollection, parentId, relation, relationKey } = junctionTableInfo;
        const targetCollection = relation.target();

        try {
            const junctionTable = this.registry.getTable(relation.through!.table);
            if (!junctionTable) {
                logger.warn(`Junction table '${relation.through!.table}' not found for relation '${relationKey}'`);
                return;
            }

            const sourceJunctionColumn = junctionTable[relation.through!.sourceColumn as keyof typeof junctionTable] as AnyPgColumn;
            const targetJunctionColumn = junctionTable[relation.through!.targetColumn as keyof typeof junctionTable] as AnyPgColumn;

            if (!sourceJunctionColumn || !targetJunctionColumn) {
                logger.warn(`Junction columns not found for relation '${relationKey}'`);
                return;
            }

            // Parse the new row ID to the correct type
            const targetPks = requirePrimaryKeys(targetCollection, this.registry);
            const targetIdInfo = targetPks[0];
            const parsedNewEntityIdObj = parseIdValues(newEntityId, targetPks);
            const parsedNewEntityId = parsedNewEntityIdObj[targetIdInfo.fieldName];

            // Create the junction table entry linking parent to the target row.
            const junctionData = {
                [sourceJunctionColumn.name]: parentId,
                [targetJunctionColumn.name]: parsedNewEntityId
            };

            // Idempotent: a link either exists or it does not, so asking for one
            // twice is not an error. This is what lets `PUT parent/id/child/childId`
            // mean "this row belongs to this parent's set" — the only way to
            // attach an *existing* row, which previously had none.
            await tx.insert(junctionTable).values(junctionData).onConflictDoNothing();

            logger.info(`Linked '${relationKey}' ${parsedNewEntityId} to ${parentId}`);
        } catch (error) {
            logger.error(`Failed to create junction table entry for relation '${relationKey}'`, { error: error });
            throw error;
        }
    }
}
