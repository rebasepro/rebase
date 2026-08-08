import { and, eq, inArray, or, sql, SQL } from "drizzle-orm";
import { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { DrizzleClient } from "../interfaces";
import { CollectionConfig, FilterValues, ResolvedRelation, ResolvedManyToMany, ResolvedHasMany, ResolvedHasOne } from "@rebasepro/types";
import { getTableName, resolveCollectionRelations, findRelation } from "@rebasepro/common";
import { hasForeignKeyOnTarget, isManyToMany, type ResolvedVia } from "@rebasepro/types";
import { DrizzleConditionBuilder } from "../utils/drizzle-conditions";
import {
    getCollectionByPath,
    getTableForCollection,
    requirePrimaryKeys,
    parseIdValues,
    buildCompositeId,
    joinsOnNaturalKey,
    sourceKeyField,
    type PrimaryKeyInfo
} from "./collection-helpers";
import { parseDataFromServer } from "../data-transformer";
import { PostgresCollectionRegistry } from "../collections/PostgresCollectionRegistry";
import { logger } from "@rebasepro/server";
import type { NestedPathHop } from "./nested-path";

/**
 * The ids in a to-many relation write, whatever shape the caller sent.
 *
 * A membership list is written as either the related rows (`[{ id: 1 }]`, what
 * the admin UI sends back after reading them) or as bare keys (`[1]`, `["t-1"]`,
 * what anyone writing the API by hand sends). Only the first was read, via a
 * blind `.map(rel => rel.id)`, and a bare key therefore became `undefined`:
 * on a numeric-keyed target that surfaced as `Invalid numeric ID: undefined`,
 * and on a string-keyed one it did not surface at all — `String(undefined)`
 * wrote a junction row pointing at the literal `"undefined"`, which no read
 * would ever match. Both shapes are accepted here, in one place, because both
 * call sites had the same assumption.
 *
 * An element that carries no key is refused rather than skipped: dropping it
 * would silently write a shorter membership list than the caller asked for.
 */
function relationTargetIds(value: unknown, relationName: string, collectionSlug: string): (string | number)[] {
    if (!Array.isArray(value)) return [];

    return value.map((element, index) => {
        if (typeof element === "string" || typeof element === "number") return element;
        if (element && typeof element === "object") {
            const id = (element as { id?: unknown }).id;
            if (typeof id === "string" || typeof id === "number") return id;
        }
        throw new Error(
            `Cannot write relation "${relationName}" on "${collectionSlug}": element ${index} carries no id. ` +
            "Pass either the related rows (`[{ id: … }]`) or their keys (`[1, 2]`), not " +
            `${element === null ? "null" : typeof element}.`
        );
    });
}

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
        via: string,
        relation?: ResolvedRelation
    ): void {
        // A `sourceKey` names the single column the link actually points at, so
        // the parent's key can be as wide as it likes — nothing here references
        // it. That is the one way out of this error, and the message below now
        // has to say so.
        if (relation && hasForeignKeyOnTarget(relation) && relation.sourceKey) return;

        if (parentPks.length > 1) {
            throw new Error(
                `Relation on '${parentCollection.slug}' uses '${via}', a single foreign-key column, but ` +
                `'${parentCollection.slug}' is keyed on ${parentPks.map(k => `'${k.fieldName}'`).join(" + ")}. ` +
                `One column cannot reference a composite key — give the relation a \`sourceKey\` naming ` +
                `a single unique column to point at, or express it with \`joinPath\`, whose ` +
                `\`on.from\`/\`on.to\` take every key column.`
            );
        }
    }

    /**
     * What the target's foreign key holds, for each of these parent rows.
     *
     * Ordinarily the parent's id, and then this is free. When the relation
     * declares a `sourceKey` the two are different values, and the mapping
     * between them lives in the source table — so it costs one SELECT, issued
     * once for the whole batch rather than per parent.
     *
     * Both directions come back because both are needed and deriving one from
     * the other by hand is how a batch loader ends up attributing a child to the
     * wrong parent: reads translate id → key to build the WHERE, and then
     * translate key → id to attribute each row that comes back.
     */
    /**
     * The value a related row's foreign key must hold to belong to this parent.
     *
     * `undefined` when the parent's source key is null — which is not an error
     * here, only in the callers that were about to write it. Exposed for
     * {@link PersistService}, which stamps this onto a child created under a
     * nested path and would otherwise write the id and lose the row.
     */
    async parentKeyValue(
        parentCollection: CollectionConfig,
        relation: ResolvedHasOne | ResolvedHasMany,
        parentId: string | number,
        db: DrizzleClient = this.db
    ): Promise<string | number | undefined> {
        const { keyByParentId } = await this.resolveSourceKeys(parentCollection, relation, [parentId], db);
        return keyByParentId.get(String(parentId));
    }

    private async resolveSourceKeys(
        parentCollection: CollectionConfig,
        relation: ResolvedHasOne | ResolvedHasMany,
        parentIds: (string | number)[],
        // Writes pass their transaction: reading the source key on the pool
        // while the same transaction is holding an uncommitted change to it
        // would translate the id against a stale value.
        db: DrizzleClient = this.db
    ): Promise<{ keyByParentId: Map<string, string | number>; parentIdByKey: Map<string, string | number> }> {
        const keyByParentId = new Map<string, string | number>();
        const parentIdByKey = new Map<string, string | number>();

        const parentPks = requirePrimaryKeys(parentCollection, this.registry);

        if (!joinsOnNaturalKey(relation, parentCollection, this.registry)) {
            // The ordinary case, and it must stay free of a round-trip: the
            // key IS the id. Parsed, not passed through — an id arrives as the
            // string from a URL, and comparing "7" against an integer column is
            // how this returns nothing at all.
            for (const id of parentIds) {
                const value = parseIdValues(id, parentPks)[parentPks[0].fieldName];
                keyByParentId.set(String(id), value);
                parentIdByKey.set(String(value), id);
            }
            return { keyByParentId, parentIdByKey };
        }

        const field = sourceKeyField(relation, parentCollection, this.registry);
        const parentTable = getTableForCollection(parentCollection, this.registry);
        const keyColumn = parentTable[field as keyof typeof parentTable] as AnyPgColumn;
        if (!keyColumn) {
            throw new Error(
                `\`sourceKey: "${field}"\` on relation '${relation.relationName}' is not a column on ` +
                `'${parentCollection.slug}'. It names a column on the source table, not on the target.`
            );
        }

        const rows = await db
            .select()
            .from(parentTable)
            .where(this.parentKeyCondition(parentTable, parentPks, parentIds));

        for (const row of rows as Array<Record<string, unknown>>) {
            const keyValue = row[field] as string | number | null;
            if (keyValue === null || keyValue === undefined) continue;
            const parentId = buildCompositeId(row, parentPks);
            keyByParentId.set(String(parentId), keyValue);
            // A duplicate here means the source key is not unique, which makes
            // "which parent does this child belong to" unanswerable. Refuse
            // rather than pick the last one seen.
            const existing = parentIdByKey.get(String(keyValue));
            if (existing !== undefined && String(existing) !== String(parentId)) {
                throw new Error(
                    `\`sourceKey: "${field}"\` on relation '${relation.relationName}' is not unique on ` +
                    `'${parentCollection.slug}': rows '${existing}' and '${parentId}' both hold ` +
                    `'${keyValue}'. Add a unique constraint — a link that addresses more than one source ` +
                    `row cannot say which one a related row belongs to.`
                );
            }
            parentIdByKey.set(String(keyValue), parentId);
        }

        return { keyByParentId, parentIdByKey };
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
        relation: ResolvedRelation,
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
        if (relation.kind === "via") {
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

        // Handle other relation types.
        //
        // The query builder compares the target's foreign key against a value,
        // and for a link on a natural key that value is not the id in the URL.
        // Resolved first, before anything is built, so a parent that reaches
        // nothing costs one statement rather than two.
        const matchValue = hasForeignKeyOnTarget(relation)
            ? (await this.resolveSourceKeys(parentCollection, relation, [parentId]))
                .keyByParentId.get(String(parentId))
            : parsedParentId;

        // A parent whose source key is null reaches nothing: NULL never equals
        // a foreign key. Say so with an empty list rather than an `= NULL`.
        if (matchValue === undefined) return [];

        let query = this.db.select().from(targetTable).$dynamic();

        // Build additional filter conditions
        const additionalFilters: SQL[] = [];

        // Handle search conditions if searchString is provided
        if (options.searchString) {
            const searchConditions = DrizzleConditionBuilder.buildSearchConditions(
                options.searchString,
                targetCollection.properties,
                targetTable,
                targetCollection
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
            matchValue,
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
        relation: ResolvedRelation,
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

        // Same translation the listing does, and it has to be: `isRelated`
        // gates writes on this count, so a count built from a different value
        // than the read would authorise rows the read never returned.
        const matchValue = hasForeignKeyOnTarget(relation)
            ? (await this.resolveSourceKeys(parentCollection, relation, [parentId]))
                .keyByParentId.get(String(parentId))
            : parsedParentId;

        if (matchValue === undefined) return 0;

        // Start count with distinct to avoid duplicates from junction tables
        let query = this.db.select({ count: sql<number>`count(distinct ${targetIdField})` }).from(targetTable).$dynamic();

        // Use unified count query builder from DrizzleConditionBuilder
        query = DrizzleConditionBuilder.buildRelationCountQuery(
            query,
            relation,
            matchValue,
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
        if (!isManyToMany(hop.relation)) {
            throw new Error(`Relation '${hop.relationKey}' has no junction table to unlink through`);
        }
        const through = hop.relation.through;

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
        relation: ResolvedRelation
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
        if (relation.kind === "via") {
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
        if (relation.kind === "belongsTo") {
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
            hasForeignKeyOnTarget(relation) ? relation.foreignKeyOnTarget : relation.relationName,
            relation
        );

        // One lookup for the whole batch, both directions: the WHERE is built
        // from the source-key values, and each row that comes back carries one
        // of those values rather than a parent id.
        const { keyByParentId, parentIdByKey } = hasForeignKeyOnTarget(relation)
            ? await this.resolveSourceKeys(parentCollection, relation, parentIds)
            : { keyByParentId: new Map<string, string | number>(), parentIdByKey: new Map<string, string | number>() };

        const matchValues = hasForeignKeyOnTarget(relation)
            ? [...keyByParentId.values()]
            : parsedParentIds;
        if (matchValues.length === 0) return new Map();

        let query = this.db.select().from(targetTable).$dynamic();

        // Build the relation query with ALL parent IDs
        query = applyDynamicRelationQuery(
            query,
            query,
            relation,
            matchValues, // Pass array instead of single ID
            targetTable,
            parentTable,
            parentIdCol,
            targetIdField,
            this.registry,
            []
        );

        const results = await query;
        const resultMap = new Map<string, RelatedRow<Record<string, unknown>>>();

        // Map results back to parent rows
        for (const row of results as Array<Record<string, unknown>>) {
            const targetRow = (row[getTableName(targetCollection)] || row) as Record<string, unknown>;

            // The parent's key is on the target row, in the relation's own
            // column. There used to be a second branch here that guessed the
            // column by appending `_id` to `inverseRelationName`, reached only
            // when the foreign key had not been resolved — which cannot happen
            // now that resolution fills it in.
            if (!hasForeignKeyOnTarget(relation)) continue;

            // Keyed by string throughout: Drizzle returns a numeric column as a
            // number or a string depending on the column type and the driver.
            const foreignKeyValue = targetRow[relation.foreignKeyOnTarget] as string | number | undefined;
            if (foreignKeyValue === undefined || foreignKeyValue === null) continue;

            const parentId = parentIdByKey.get(String(foreignKeyValue));
            if (parentId !== undefined) {
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
        relation: ResolvedRelation
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
        if (relation.kind === "via") {
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
        if (relation.kind === "manyToMany") {
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
            hasForeignKeyOnTarget(relation) ? relation.foreignKeyOnTarget : relation.relationName,
            relation
        );

        const { keyByParentId, parentIdByKey } = hasForeignKeyOnTarget(relation)
            ? await this.resolveSourceKeys(parentCollection, relation, parentIds)
            : { keyByParentId: new Map<string, string | number>(), parentIdByKey: new Map<string, string | number>() };

        const matchValues = hasForeignKeyOnTarget(relation)
            ? [...keyByParentId.values()]
            : parsedParentIds;
        if (matchValues.length === 0) return new Map();

        let query = this.db.select().from(targetTable).$dynamic();

        query = applyDynamicRelationQuery(
            query,
            query,
            relation,
            matchValues,
            targetTable,
            parentTable,
            parentIdCol,
            targetIdField,
            this.registry,
            []
        );

        const results = await query;
        const resultMap = new Map<string, RelatedRow<Record<string, unknown>>[]>();

        for (const row of results as Array<Record<string, unknown>>) {
            const targetRow = (row[getTableName(targetCollection)] || row) as Record<string, unknown>;

            // Junction-backed relations returned earlier in this method, so
            // what reaches here names the parent with a column on the target.
            if (!hasForeignKeyOnTarget(relation)) continue;

            const foreignKeyValue = targetRow[relation.foreignKeyOnTarget] as string | number | undefined;
            if (foreignKeyValue === undefined || foreignKeyValue === null) continue;

            const parentId = parentIdByKey.get(String(foreignKeyValue));
            if (parentId !== undefined) {
                const key = String(parentId);
                const arr = resultMap.get(key) || [];
                arr.push(await this.toRelatedRow(targetRow, targetCollection, targetPks));
                resultMap.set(key, arr);
            }
        }

        return resultMap;
    }

    /**
     * Bring one row's junction links in line with the ids a save carried,
     * by diffing against what is stored rather than replacing the lot.
     *
     * The old shape was `DELETE every link for this parent` followed by
     * `INSERT what the client sent`, which makes a save of the parent a full
     * replacement of the membership set from a list the browser assembled out
     * of a read it did earlier. Three things follow from that, and the diff
     * closes all three:
     *
     *  - **Lost update.** Two editors with post 7 open: A adds tag X and saves;
     *    B saves any field and the whole set is rewritten from B's older list,
     *    dropping X with nothing to show for it. A diff only names the ids that
     *    actually changed, so edits to disjoint tags no longer collide.
     *  - **Partial read, partial delete.** The read that fills the form runs
     *    under RLS, so a user who may edit the parent but cannot *see* some of
     *    the linked rows gets a shorter list — and writing it back deleted the
     *    links they were never shown. The DELETE now names ids instead of
     *    "everything for this parent", and the select that produces them runs
     *    in this same transaction under the same policies, so a link the caller
     *    cannot read is in neither list and survives the save.
     *  - **Junction payload columns.** A junction carrying its own columns
     *    (`position`, `role`, `created_at`) lost them on every save, because
     *    every row was re-inserted with only the two keys. Untouched links are
     *    now left alone.
     *
     * The insert is `ON CONFLICT DO NOTHING` so that two sessions adding the
     * same link concurrently is a no-op rather than a unique violation.
     */
    private async syncJunctionLinks(
        tx: DrizzleClient,
        junctionTable: PgTable,
        sourceJunctionColumn: AnyPgColumn,
        targetJunctionColumn: AnyPgColumn,
        parsedParentId: unknown,
        parsedTargetIds: unknown[]
    ) {
        const existingRows = await tx
            .select({ targetId: targetJunctionColumn })
            .from(junctionTable)
            .where(eq(sourceJunctionColumn, parsedParentId));

        // Keyed by `String(...)` because a junction key can come back from the
        // driver as a string where the parsed value is a number, and a diff
        // that misses that would delete and re-insert every link.
        const existingById = new Map<string, unknown>();
        for (const row of existingRows as Array<{ targetId: unknown }>) {
            if (row.targetId === null || row.targetId === undefined) continue;
            existingById.set(String(row.targetId), row.targetId);
        }

        const wantedById = new Map<string, unknown>();
        for (const targetId of parsedTargetIds) {
            if (targetId === null || targetId === undefined) continue;
            wantedById.set(String(targetId), targetId);
        }

        const removed = [...existingById.entries()]
            .filter(([key]) => !wantedById.has(key))
            .map(([, value]) => value);
        const added = [...wantedById.entries()]
            .filter(([key]) => !existingById.has(key))
            .map(([, value]) => value);

        if (removed.length > 0) {
            await tx.delete(junctionTable).where(and(
                eq(sourceJunctionColumn, parsedParentId),
                inArray(targetJunctionColumn, removed)
            ));
        }

        if (added.length > 0) {
            await tx.insert(junctionTable)
                .values(added.map(targetId => ({
                    [sourceJunctionColumn.name]: parsedParentId,
                    [targetJunctionColumn.name]: targetId
                })))
                .onConflictDoNothing();
        }
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

            const targetEntityIds = relationTargetIds(value, key, collection.slug);
            const targetCollection = relation.target();

            // Use joinPath if available
            if (relation.kind === "via") {
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

                let parsedTargetIds: unknown[] = [];
                if (targetEntityIds.length > 0) {
                    const targetPks = requirePrimaryKeys(targetCollection, this.registry);
                    const targetIdInfo = targetPks[0];
                    parsedTargetIds = targetEntityIds.map(id => parseIdValues(id, targetPks)[targetIdInfo.fieldName]);
                }

                await this.syncJunctionLinks(tx, junctionTable, sourceJunctionColumn, targetJunctionColumn,
                    parsedParentId, parsedTargetIds);
            } else if (relation.kind === "manyToMany") {
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

                let parsedTargetIds: unknown[] = [];
                if (targetEntityIds.length > 0) {
                    const targetPks = requirePrimaryKeys(targetCollection, this.registry);
                    const targetIdInfo = targetPks[0];
                    parsedTargetIds = targetEntityIds.map(id => parseIdValues(id, targetPks)[targetIdInfo.fieldName]);
                }

                await this.syncJunctionLinks(tx, junctionTable, sourceJunctionColumn, targetJunctionColumn,
                    parsedParentId, parsedTargetIds);
            } else if (relation.cardinality === "many" && hasForeignKeyOnTarget(relation)) {
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

                // What the children's foreign key must hold — the parent's id
                // unless the link declares a `sourceKey`, and then the value of
                // that column on this parent row.
                const parentKeyValue = (await this.resolveSourceKeys(collection, relation, [id], tx))
                    .keyByParentId.get(String(id));

                if (parentKeyValue === undefined) {
                    throw new Error(
                        `Cannot write relation '${key}' on '${collection.slug}': row '${id}' has no value in ` +
                        `\`sourceKey: "${sourceKeyField(relation, collection, this.registry)}"\`, so there is ` +
                        "nothing for the related rows to point at."
                    );
                }

                // Clear existing links not in the new set
                if (targetEntityIds.length > 0) {
                    const parsedTargetIds = targetEntityIds.map(id => parseIdValues(id, targetPks)[targetIdInfo.fieldName]);
                    await tx
                        .update(targetTable)
                        .set({ [relation.foreignKeyOnTarget]: null })
                        .where(and(eq(fkCol, parentKeyValue), sql`${targetIdCol} NOT IN (${sql.join(parsedTargetIds)})`));

                    // Set FK for the provided targets
                    await tx
                        .update(targetTable)
                        .set({ [relation.foreignKeyOnTarget]: parentKeyValue })
                        .where(inArray(targetIdCol as AnyPgColumn, parsedTargetIds as unknown[]));
                } else {
                    // If empty array provided, clear all existing links for this parent
                    await tx
                        .update(targetTable)
                        .set({ [relation.foreignKeyOnTarget]: null })
                        .where(eq(fkCol, parentKeyValue));
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
            relation: ResolvedRelation;
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

                if (relation.kind === "via") {
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

                // A many-to-many names its own junction. This used to walk the
                // *target's* relations looking for an owning side whose
                // `relationName` matched `inverseRelationName`, and swap its
                // source/target columns — a search that silently did nothing
                // when the far side was declared differently than expected.
                if (isManyToMany(relation)) {
                    await this.updateManyToManyInverseRelation(
                        tx,
                        sourceCollection,
                        sourceEntityId,
                        targetCollection,
                        relation,
                        newValue,
                        {
                            table: relation.through.table,
                            sourceColumn: relation.through.sourceColumn,
                            targetColumn: relation.through.targetColumn
                        }
                    );
                    continue;
                }

                // What is left names the parent with a column on the target.
                if (!hasForeignKeyOnTarget(relation)) {
                    logger.warn(`Relation '${relation.relationName}' has no column on the target to write. Skipping.`);
                    continue;
                }

                const foreignKeyColumn = targetTable[relation.foreignKeyOnTarget! as keyof typeof targetTable] as AnyPgColumn;
                if (!foreignKeyColumn) {
                    logger.warn(`Foreign key column '${relation.foreignKeyOnTarget}' not found in target table for relation '${relation.relationName}'`);
                    continue;
                }

                // The value the target's foreign key holds: this row's id, or
                // the column named by `sourceKey` when the link joins on one.
                const sourceKeyValue = (await this.resolveSourceKeys(sourceCollection, relation, [sourceEntityId], tx))
                    .keyByParentId.get(String(sourceEntityId));

                if (sourceKeyValue === undefined) {
                    throw new Error(
                        `Cannot write relation '${relation.relationName}' on '${sourceCollection.slug}': row ` +
                        `'${sourceEntityId}' has no value in \`sourceKey: ` +
                        `"${sourceKeyField(relation, sourceCollection, this.registry)}"\`, so there is nothing ` +
                        "for the related row to point at."
                    );
                }

                if (newValue === null || newValue === undefined) {
                    await tx
                        .update(targetTable)
                        .set({ [relation.foreignKeyOnTarget!]: null })
                        .where(eq(foreignKeyColumn, sourceKeyValue));
                } else {
                    const parsedNewTargetIdObj = parseIdValues(newValue as string | number, targetPks);
                    const parsedNewTargetId = parsedNewTargetIdObj[targetIdInfo.fieldName];
                    const targetIdField = targetTable[targetIdInfo.fieldName as keyof typeof targetTable] as AnyPgColumn;

                    // First, clear any existing FK that points to this source row
                    await tx
                        .update(targetTable)
                        .set({ [relation.foreignKeyOnTarget!]: null })
                        .where(eq(foreignKeyColumn, sourceKeyValue));

                    // Then, update the new target row to point to this source row
                    await tx
                        .update(targetTable)
                        .set({ [relation.foreignKeyOnTarget!]: sourceKeyValue })
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
        relation: ResolvedVia,
        newValue: unknown
    ) {
        try {

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

                // The membership this write asks for, as parsed keys. A single
                // value is the one-to-one case and reads as a set of one.
                let parsedTargetIds: unknown[] = [];
                if (newValue && Array.isArray(newValue) && newValue.length > 0) {
                    const targetPks = requirePrimaryKeys(targetCollection, this.registry);
                    const targetIdInfo = targetPks[0];
                    // This path already read both shapes; the other two did not.
                    // Same helper now, so the three cannot drift again.
                    const targetEntityIds = relationTargetIds(newValue, relation.relationName, sourceCollection.slug);
                    parsedTargetIds = targetEntityIds.map(id => parseIdValues(id, targetPks)[targetIdInfo.fieldName]);
                } else if (newValue && !Array.isArray(newValue)) {
                    const targetPks = requirePrimaryKeys(targetCollection, this.registry);
                    const targetIdInfo = targetPks[0];
                    const targetId = typeof newValue === "object" && newValue !== null ? (newValue as Record<string, unknown>).id as string | number : newValue as string | number;
                    parsedTargetIds = [parseIdValues(targetId, targetPks)[targetIdInfo.fieldName]];
                }

                await this.syncJunctionLinks(tx, junctionTable, sourceJunctionColumn, targetJunctionColumn,
                    parsedSourceId, parsedTargetIds);
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
        relation: ResolvedRelation,
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

            const targetEntityIds = Array.isArray(newValue)
                ? relationTargetIds(newValue, relation.relationName, sourceCollection.slug)
                : [];
            let parsedTargetIds: unknown[] = [];
            if (targetEntityIds.length > 0) {
                const targetPks = requirePrimaryKeys(targetCollection, this.registry);
                const targetIdInfo = targetPks[0];
                parsedTargetIds = targetEntityIds.map(id => parseIdValues(id, targetPks)[targetIdInfo.fieldName]);
            }

            await this.syncJunctionLinks(tx, junctionTable, sourceJunctionColumn, targetJunctionColumn,
                parsedSourceId, parsedTargetIds);
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
            // Only a `via` relation has a join path to write through, and the
            // caller only collects those.
            relation: ResolvedVia;
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
        relation: ResolvedVia
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
            // Only a junction-backed relation has a link to write, and the
            // caller only builds this for one — stated here so the body needs
            // no narrowing.
            relation: ResolvedManyToMany;
            relationKey: string;
        }
    ) {
        const { parentCollection, parentId, relation, relationKey } = junctionTableInfo;
        const targetCollection = relation.target();

        try {
            const junctionTable = this.registry.getTable(relation.through.table);
            if (!junctionTable) {
                logger.warn(`Junction table '${relation.through.table}' not found for relation '${relationKey}'`);
                return;
            }

            const sourceJunctionColumn = junctionTable[relation.through.sourceColumn as keyof typeof junctionTable] as AnyPgColumn;
            const targetJunctionColumn = junctionTable[relation.through.targetColumn as keyof typeof junctionTable] as AnyPgColumn;

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
