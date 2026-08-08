import { and, asc, count, desc, eq, getTableColumns, getTableName, gt, lt, or, SQL, TableRelationalConfig, TablesRelationalConfig } from "drizzle-orm";
import { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { CollectionConfig, FilterValues, ResolvedRelation, LogicalCondition, isManyToMany } from "@rebasepro/types";
import type { VectorSearchParams } from "@rebasepro/types";
import { resolveCollectionRelations, findRelation, createRelationRef, createRelationRefWithData } from "@rebasepro/common";
import { generateForeignKeyName } from "@rebasepro/utils";
import { DrizzleConditionBuilder, getUnknownFilterFieldsMode, type FilterCompilationOptions } from "../utils/drizzle-conditions";
import {
    getCollectionByPath,
    getTableForCollection,
    getPrimaryKeys,
    requirePrimaryKeys,
    deriveRowAddress,
    parseIdValues,
    idCanAddressTable,
    buildCompositeId,
    COMPOSITE_ID_SEPARATOR
} from "./collection-helpers";
import { parseDataFromServer, normalizeDbValues } from "../data-transformer";
import { RelationService } from "./RelationService";
import { RelationalQueryBuilder } from "drizzle-orm/pg-core/query-builders/query";
import { DrizzleClient } from "../interfaces";
import { PostgresCollectionRegistry } from "../collections/PostgresCollectionRegistry";
import { toFlatRow, toRestRow, isJunctionRelation } from "./row-pipeline";
import { visibleColumnProjection, hiddenColumnsOption } from "../schema/search-column";
import { isNestedPath, resolveNestedPath, type NestedPathHop } from "./nested-path";
import { ApiError, logger } from "@rebasepro/server";
import { reachedDatabase } from "../utils/pg-error-utils";

/** Type-safe accessor for Drizzle's relational query API via dynamic table name */
type DbQueryAccessor = Record<string, RelationalQueryBuilder<any, any>> | undefined;

/**
 * Service for handling all row read operations.
 * Handles fetching, searching, counting, and filtering rows.
 */
export class FetchService {
    private relationService: RelationService;

    constructor(private db: DrizzleClient, private registry: PostgresCollectionRegistry) {
        this.relationService = new RelationService(db, registry);
    }

    /**
     * Get the relational query builder for a given table name.
     * Safely narrows the DrizzleClient union type to access db.query[tableName].
     */
    private getQueryBuilder(tableName: string): RelationalQueryBuilder<TablesRelationalConfig, TableRelationalConfig> | undefined {
        const query = (this.db as { query?: DbQueryAccessor }).query;
        return query?.[tableName] as RelationalQueryBuilder<TablesRelationalConfig, TableRelationalConfig> | undefined;
    }

    /**
     * The context the condition builder needs to compile a filter key that is
     * not a column name outright.
     *
     * Two such keys. An owning relation's key resolves through the collection's
     * relations to its foreign-key column; a relation whose link lives on the
     * target table or in a junction resolves to a correlated `EXISTS`, which
     * needs the registry to reach that other table and this table's key column
     * to correlate back.
     *
     * Looked up rather than passed: every read path already has the path, only
     * some have the collection, and a path that names no registered collection
     * (a nested/derived one) is not an error here — the builder simply falls
     * back to guessing the default key shapes, and a relation filter it cannot
     * compile stays unresolvable and so fails closed.
     */
    private filterContext(collectionPath: string, table: PgTable<any>): FilterCompilationOptions {
        const collection = this.registry.getCollectionByPath(collectionPath) ?? undefined;
        return {
            collection,
            registry: this.registry,
            sourceIdColumn: collection ? this.resolveIdColumn(collection, table) : undefined
        };
    }

    /**
     * The table column this collection's rows are keyed by, or `undefined`.
     *
     * `getPrimaryKeys` rather than `requirePrimaryKeys`: a collection with no
     * resolvable key is not an error on the filter path — it only means the
     * relation filters that would correlate on it cannot be compiled, which
     * the builder already handles by failing that field closed.
     */
    private resolveIdColumn(collection: CollectionConfig, table: PgTable<any>): AnyPgColumn | undefined {
        const [idInfo] = getPrimaryKeys(collection, this.registry);
        if (!idInfo) return undefined;
        return table[idInfo.fieldName as keyof typeof table] as AnyPgColumn | undefined;
    }

    /**
     * Build filter conditions from FilterValues
     * Delegates to DrizzleConditionBuilder.buildFilterConditions
     */
    buildFilterConditions<M extends Record<string, unknown>>(
        filter: FilterValues<Extract<keyof M, string>>,
        table: PgTable<any>,
        collectionPath: string
    ): SQL[] {
        return DrizzleConditionBuilder.buildFilterConditions(
            filter, table, collectionPath, this.filterContext(collectionPath, table)
        );
    }

    // =============================================================
    // DRIZZLE QUERY HELPERS
    // =============================================================

    /**
     * Resolves the correct Drizzle column for sorting.
     * Automatically maps owning relation property keys to their underlying foreign key column.
     *
     * The relation's own `localKey` is the authority for that foreign key, not
     * `<field>_id`. The default local key comes from `generateForeignKeyName`,
     * which snake-cases *and singularises* — `userProfile` → `user_profile_id`,
     * `users` → `user_id` — and an author can override it outright. A wrong
     * guess resolves to nothing, the caller drops the `ORDER BY`, and the rows
     * come back in whatever order Postgres pleases: paging over that repeats
     * and skips rows rather than erroring. The guesses stay, last, for a
     * caller that hands over no collection to resolve against.
     */
    /**
     * The ORDER BY target, which may be relevance rather than a column.
     *
     * `_score` is only meaningful for a collection that declared a `search`
     * block *and* for a request that carried a search string — ranking rows
     * against no query ranks them all at zero. Outside those two conditions it
     * is an unknown field and gets the same 400 as any other typo, which is the
     * behaviour that matters: a sort that is silently dropped returns 200 with
     * rows in arbitrary order, and paging over that repeats and skips rows.
     */
    static readonly SCORE_FIELD = "_score";

    private resolveOrderTarget(
        table: PgTable<any>,
        orderBy: string,
        collection?: CollectionConfig,
        searchString?: string
    ): AnyPgColumn | SQL | undefined {
        if (orderBy === FetchService.SCORE_FIELD && collection && searchString) {
            const rank = DrizzleConditionBuilder.buildSearchRankExpression(searchString, table, collection);
            if (rank) return rank;
        }
        return this.resolveOrderByField(table, orderBy, collection);
    }

    private resolveOrderByField(
        table: PgTable<any>,
        orderBy: string,
        collection?: CollectionConfig
    ): AnyPgColumn | undefined {
        const columnAt = (key: string): AnyPgColumn | undefined =>
            (key in table ? table[key as keyof typeof table] as AnyPgColumn : undefined) || undefined;

        const direct = columnAt(orderBy);
        if (direct) return direct;

        // Owning relation, resolved: the relation names its own local key.
        const declaredRelation = collection ? resolveCollectionRelations(collection)[orderBy] : undefined;
        if (declaredRelation?.kind === "belongsTo") {
            const foreignKey = columnAt(declaredRelation.localKey);
            if (foreignKey) return foreignKey;
        }

        // No collection in hand — the two shapes an owning relation's key takes
        // by default (e.g. `project` → `project_id`, `userProfile` →
        // `user_profile_id`).
        for (const guess of [`${orderBy}_id`, generateForeignKeyName(orderBy)]) {
            const foreignKey = columnAt(guess);
            if (foreignKey) return foreignKey;
        }

        // Nothing resolved. Returning `undefined` is exactly what the docblock
        // above describes: the caller drops the ORDER BY and hands back rows in
        // whatever order Postgres pleases, while the requester believes they
        // are sorted. `?orderBy=titel` answered 200 with unsorted data and no
        // hint that the sort had been ignored.
        //
        // A *filter* naming a field that does not exist is already refused for
        // precisely this reason — it "used to widen results silently". An
        // unresolvable sort field is the same drift between a query and the
        // schema, so it answers the same way and honours the same switch: one
        // knob, because a deployment that wants the lenient behaviour wants it
        // for both.
        const collectionName = collection?.slug ?? collection?.name;
        const onCollection = collectionName ? ` on collection '${collectionName}'` : "";

        // A declared to-many relation is a different mistake from a typo, and
        // saying "unknown field" about a field the collection plainly declares
        // sends the reader looking for a spelling error that is not there.
        // There is simply no single value per row to order by — `posts.tags` is
        // a set — so no ORDER BY exists to write, with or without a typo.
        if (declaredRelation && declaredRelation.kind !== "belongsTo") {
            throw ApiError.badRequest(
                `Cannot sort by '${orderBy}'${onCollection}: it is a to-many relation ` +
                `(${declaredRelation.kind}), which has no single value per row to order by.`,
                "ORDER_BY_FIELD_NOT_SORTABLE",
                { field: orderBy, kind: declaredRelation.kind, ...(collectionName && { collection: collectionName }) }
            );
        }

        if (getUnknownFilterFieldsMode() === "warn") {
            logger.warn(
                `Sorting by field '${orderBy}'${onCollection}, but it does not exist in the table — ` +
                "the ORDER BY was dropped and these rows are unsorted."
            );
            return undefined;
        }

        let validFields: string[] = [];
        try {
            validFields = Object.keys(getTableColumns(table)).sort();
        } catch {
            // A table stand-in without Drizzle's column symbols — the message
            // is worth less without the list, but not worth failing over.
        }

        throw ApiError.badRequest(
            `Unknown orderBy field '${orderBy}'${onCollection}` +
            (validFields.length > 0 ? `. Valid fields: ${validFields.join(", ")}` : ""),
            "UNKNOWN_ORDER_BY_FIELD",
            {
                field: orderBy,
                ...(collectionName && { collection: collectionName }),
                ...(validFields.length > 0 && { validFields })
            }
        );
    }

    /**
     * Build the `with` config for Drizzle's relational query API.
     * Converts collection relations to a Drizzle-compatible `with` object.
     *
     * When `include` is provided, only those relations are loaded.
     * When `include` is absent, ALL relations are loaded (the admin path).
     *
     * Automatically detects many-to-many junction tables and nests
     * the target relation so actual row data is returned.
     */
    private buildWithConfig(
        collection: CollectionConfig,
        include?: string[]
    ): Record<string, boolean | { with: Record<string, boolean> }> {
        const resolvedRelations = resolveCollectionRelations(collection);
        const withConfig: Record<string, boolean | { with: Record<string, boolean> }> = {};

        const shouldInclude = (key: string) =>
            !include || include.length === 0 || include[0] === "*" || include.includes(key);

        for (const [key, relation] of Object.entries(resolvedRelations)) {
            if (!shouldInclude(key)) continue;

            const drizzleRelName = relation.relationName || key;

            // Skip relations that use joinPath as they are not mapped in Drizzle schemas
            if (relation.kind === "via") {
                continue;
            }

            // Detect many-to-many junction tables:
            // If the relation goes through a junction table (relation.through exists or
            // the Drizzle schema maps to a junction table), we need two-level with.
            if (relation.cardinality === "many" && isJunctionRelation(relation)) {
                // The Drizzle relation points to the junction table.
                // We need: { [junctionRelName]: { with: { [targetFkName]: true } } }
                // The target FK name is the relation on the junction table that points to the actual target.
                const targetFkName = this.getJunctionTargetRelationName(relation, collection);
                if (targetFkName) {
                    withConfig[drizzleRelName] = { with: { [targetFkName]: true } };
                } else {
                    withConfig[drizzleRelName] = true;
                }
            } else {
                withConfig[drizzleRelName] = true;
            }
        }

        return withConfig;
    }

    /**
     * Get the Drizzle relation name on the junction table that points to the actual target row.
     * For example, for posts_tags junction, this returns "tag_id" (the relation pointing to tags).
     */
    private getJunctionTargetRelationName(relation: ResolvedRelation, _collection: CollectionConfig): string | null {
        if (isManyToMany(relation)) {
            // The junction relation on the junction table pointing to the target
            // uses the targetColumn name as the Drizzle relation name
            return relation.through.targetColumn.replace(/_id$/, "_id");
        }
        return null;
    }

    /**
     * Post-fetch joinPath relations for a single flat row.
     * joinPath relations cannot be expressed via Drizzle's `with` config,
     * so they must be loaded separately after the primary query.
     */
    private async resolveJoinPathRelations<M extends Record<string, unknown>>(
        row: Record<string, unknown>,
        collection: CollectionConfig,
        collectionPath: string,
        parsedId: string | number,
        _databaseId?: string
    ): Promise<void> {
        const resolvedRelations = resolveCollectionRelations(collection);

        const promises = Object.entries(resolvedRelations)
            .filter(([key, relation]) => relation.kind === "via")
            .map(async ([key, relation]) => {
                try {
                    const relatedRows = await this.relationService.fetchRelatedEntities(
                        collectionPath,
                        parsedId,
                        key,
                        { limit: relation.cardinality === "one" ? 1 : undefined }
                    );

                    if (relation.cardinality === "one" && relatedRows.length > 0) {
                        const e = relatedRows[0];
                        row[key] = createRelationRefWithData(e.id, e.path, e);
                    } else if (relation.cardinality === "many") {
                        row[key] = relatedRows.map(e =>
                            createRelationRefWithData(e.id, e.path, e)
                        );
                    }
                } catch (e) {
                    logger.warn(`Could not resolve joinPath relation '${key}'`, { error: e });
                }
            });

        await Promise.all(promises);
    }

    /**
     * Resolves joinPath relations for raw REST rows and directly injects them.
     * Uses RelationService to query the database and maps results back to the flattened objects.
     */
    private async resolveJoinPathRelationsBatchRest(
        rows: Record<string, unknown>[],
        collection: CollectionConfig,
        collectionPath: string,
        idInfoArray: { fieldName: string; type: "string" | "number" }[],
        include?: string[]
    ): Promise<void> {
        if (rows.length === 0) return;

        const resolvedRelations = resolveCollectionRelations(collection);
        const propertyKeys = new Set(Object.keys(collection.properties || {}));
        const shouldInclude = (key: string) =>
            !include || include.length === 0 || include[0] === "*" || include.includes(key);

        const joinPathRelations = Object.entries(resolvedRelations)
            .filter(([key, relation]) => relation.kind === "via" && propertyKeys.has(key) && shouldInclude(key));

        if (joinPathRelations.length === 0) return;

        // These rows carry their key columns verbatim, so the parent's address
        // is derived from them. It used to be parsed back out of a synthesized
        // `id` — which no longer exists on a row, and threw (composite: parts
        // mismatch; numeric: NaN) into the catch below, where a warning is all
        // that separates "no relations" from "relations dropped".
        //
        // The whole key, because that is what the batch groups its results by:
        // both sides derive the token the same way, so they agree by
        // construction rather than by both happening to pick column zero.
        const parentIdOf = (row: Record<string, unknown>): string | undefined => {
            const address = buildCompositeId(row, idInfoArray);
            return address && address.split(COMPOSITE_ID_SEPARATOR).some(part => part !== "") ? address : undefined;
        };

        for (const [key, relation] of joinPathRelations) {
            try {
                const addressable = rows.filter(r => parentIdOf(r) !== undefined && parentIdOf(r) !== null);
                if (addressable.length === 0) continue;
                const rowIds = addressable.map(r => parentIdOf(r) as string | number);

                if (relation.cardinality === "one") {
                    const resultMap = await this.relationService.batchFetchRelatedEntities(
                        collectionPath,
                        rowIds,
                        key,
                        relation
                    );

                    for (const row of addressable) {
                        const relatedRow = resultMap.get(String(parentIdOf(row)));
                        // Columns only: the target's address is the consumer's to
                        // derive, and merging it last overwrote a real `id` column.
                        row[key] = relatedRow ? { ...relatedRow.values } : null;
                    }
                } else if (relation.cardinality === "many") {
                    const resultMap = await this.relationService.batchFetchRelatedEntitiesMany(
                        collectionPath,
                        rowIds,
                        key,
                        relation
                    );

                    for (const row of addressable) {
                        const relatedList = resultMap.get(String(parentIdOf(row))) || [];
                        row[key] = relatedList.map(e => ({ ...e.values }));
                    }
                }
            } catch (e) {
                logger.warn(`Could not batch resolve joinPath relation '${key}' for REST`, { error: e });
            }
        }
    }

    /**
     * Build db.query-compatible options from standard fetch options.
     * Handles filter, search, orderBy, limit, and cursor-based pagination.
     */
    private buildDrizzleQueryOptions<M extends Record<string, unknown>>(
        table: PgTable<any>,
        idField: AnyPgColumn,
        idInfo: { fieldName: string; type: "string" | "number" },
        options: {
            filter?: FilterValues<Extract<keyof M, string>>;
            orderBy?: string;
            order?: "desc" | "asc";
            limit?: number;
            offset?: number;
            startAfter?: Record<string, unknown>;
            searchString?: string;
            logical?: LogicalCondition;
        },
        collectionPath: string,
        withConfig?: Record<string, unknown>,
        scopeCondition?: SQL
    ): Record<string, unknown> {
        const queryOpts: Record<string, unknown> = {};

        // Same exclusion the `db.select` fallback applies, in the shape the
        // relational query builder takes. Both paths serve the same request, so
        // a row must not carry the search column down one and not the other.
        const hidden = hiddenColumnsOption(
            getTableColumns(table),
            this.registry.getCollectionByPath(collectionPath) ?? undefined
        );
        if (hidden) queryOpts.columns = hidden;

        if (withConfig) queryOpts.with = withConfig;

        // Build where conditions
        const allConditions: SQL[] = [];

        if (scopeCondition) allConditions.push(scopeCondition);

        if (options.searchString) {
            const collection = getCollectionByPath(collectionPath, this.registry);
            const searchConditions = DrizzleConditionBuilder.buildSearchConditions(
                options.searchString, collection.properties, table, collection
            );
            if (searchConditions.length === 0) {
                // Return options that will produce empty results
                queryOpts.where = and(eq(idField, -99999999)); // impossible condition
                return queryOpts;
            }
            allConditions.push(DrizzleConditionBuilder.combineConditionsWithOr(searchConditions)!);
        }

        if (options.filter) {
            const filterConditions = this.buildFilterConditions(options.filter, table, collectionPath);
            if (filterConditions.length > 0) allConditions.push(...filterConditions);
        }

        if (options.logical) {
            const logicalCondition = DrizzleConditionBuilder.buildLogicalConditions(options.logical, table, collectionPath, this.filterContext(collectionPath, table));
            if (logicalCondition) allConditions.push(logicalCondition);
        }

        // Cursor-based pagination (startAfter)
        if (options.startAfter) {
            const cursorConditions = this.buildCursorConditions(table, idField, idInfo, options, collectionPath);
            if (cursorConditions.length > 0) allConditions.push(...cursorConditions);
        }

        if (allConditions.length > 0) {
            queryOpts.where = and(...allConditions);
        }

        // OrderBy
        const orderExpressions: unknown[] = [];
        if (options.orderBy) {
            const collection = getCollectionByPath(collectionPath, this.registry);
            const orderByField = this.resolveOrderTarget(table, options.orderBy, collection, options.searchString);
            if (orderByField) {
                orderExpressions.push(options.order === "asc" ? asc(orderByField) : desc(orderByField));
            }
        }
        orderExpressions.push(desc(idField));
        if (orderExpressions.length > 0) {
            queryOpts.orderBy = orderExpressions;
        }

        // Limit
        const limitValue = options.searchString ? (options.limit || 50) : options.limit;
        if (limitValue) queryOpts.limit = limitValue;

        // Offset (numeric pagination)
        if (options.offset && options.offset > 0) queryOpts.offset = options.offset;

        return queryOpts;
    }

    /**
     * Extract cursor pagination conditions from startAfter options.
     */
    private buildCursorConditions(
        table: PgTable<any>,
        idField: AnyPgColumn,
        idInfo: { fieldName: string; type: "string" | "number" },
        options: { orderBy?: string; order?: "desc" | "asc"; startAfter?: Record<string, unknown> },
        collectionPath?: string
    ): SQL[] {
        if (!options.startAfter) return [];
        const cursor = options.startAfter;

        if (options.orderBy) {
            // Relevance is computed per query, not stored, so there is no value
            // on the cursor row to compare a later page against — and two
            // requests with different search strings would produce scores that
            // are not on the same scale at all. Refusing is the only honest
            // answer: a dropped cursor condition silently repeats and skips
            // rows, which is precisely what paging exists to prevent.
            if (options.orderBy === FetchService.SCORE_FIELD) {
                throw ApiError.badRequest(
                    "Cursor pagination (`startAfter`) cannot be combined with `orderBy: \"_score\"`. " +
                    "Relevance is computed per query rather than stored, so it cannot key a cursor. " +
                    "Use `limit`/`offset` for relevance-ordered pages, or order by a column.",
                    "SCORE_CURSOR_UNSUPPORTED",
                    { field: FetchService.SCORE_FIELD }
                );
            }
            const collection = collectionPath ? getCollectionByPath(collectionPath, this.registry) : undefined;
            const orderByField = this.resolveOrderByField(table, options.orderBy, collection);
            if (orderByField) {
                const startAfterOrderValue = (cursor.values as Record<string, unknown> | undefined)?.[options.orderBy] ?? cursor[options.orderBy];
                const startAfterId = cursor.id ?? cursor[idInfo.fieldName];

                if (startAfterOrderValue !== undefined && startAfterId !== undefined) {
                    if (options.order === "asc") {
                        return [or(
                            gt(orderByField, startAfterOrderValue),
                            and(eq(orderByField, startAfterOrderValue), gt(idField, startAfterId))
                        )!];
                    } else {
                        return [or(
                            lt(orderByField, startAfterOrderValue),
                            and(eq(orderByField, startAfterOrderValue), lt(idField, startAfterId))
                        )!];
                    }
                }
            }
        } else {
            const startAfterId = cursor.id ?? cursor[idInfo.fieldName];
            if (startAfterId !== undefined && startAfterId !== null) {
                const idInfoArray = [idInfo] as Array<{ fieldName: string; type: "string" | "number" }>;
                const parsedStartAfterIdObj = parseIdValues(startAfterId as string | number, idInfoArray);
                return [lt(idField, parsedStartAfterIdObj[idInfo.fieldName])];
            }
        }

        return [];
    }

    /**
     * Compile "rows reachable from this parent" into a `WHERE` condition on the
     * target table, so a nested listing can run as an ordinary collection query.
     */
    private buildRelationScope(hop: NestedPathHop): SQL {
        const parentPks = requirePrimaryKeys(hop.parentCollection, this.registry);
        const parentIdInfo = parentPks[0];
        const parsedParentId = parseIdValues(hop.parentId, parentPks)[parentIdInfo.fieldName];

        const parent = () => {
            const table = getTableForCollection(hop.parentCollection, this.registry);
            const idColumn = table[parentIdInfo.fieldName as keyof typeof table] as AnyPgColumn;
            if (!idColumn) {
                throw new Error(`ID field '${parentIdInfo.fieldName}' not found in table for collection '${hop.parentCollection.slug}'`);
            }
            return { table,
idColumn };
        };

        const targetTable = getTableForCollection(hop.targetCollection, this.registry);
        const targetPks = requirePrimaryKeys(hop.targetCollection, this.registry);
        const targetIdColumn = targetTable[targetPks[0].fieldName as keyof typeof targetTable] as AnyPgColumn;
        if (!targetIdColumn) {
            throw new Error(`ID field '${targetPks[0].fieldName}' not found in table for collection '${hop.targetCollection.slug}'`);
        }

        return DrizzleConditionBuilder.buildRelationScopeCondition(
            hop.relation,
            parent,
            parsedParentId as string | number,
            targetTable,
            targetIdColumn,
            this.registry
        );
    }

    /**
     * Whether `id` is actually reachable at `collectionPath`.
     *
     * Trivially true for a root path. For a nested one it is a real question:
     * the path resolves to the target collection, and matching on the primary
     * key alone made the parent segment decorative — `authors/1/posts/43`
     * returned post 43 whoever wrote it, and the REST layer's delete then
     * deleted it. A row that is not under this parent is reported as absent,
     * which is what a caller addressing it through the parent should see.
     */
    private async isAddressableUnder(collectionPath: string, id: string | number): Promise<boolean> {
        if (!isNestedPath(collectionPath)) return true;
        const hop = resolveNestedPath(collectionPath, this.registry);
        if (!hop) return true;
        return this.relationService.isRelated(hop, id);
    }

    /**
     * Fetch a single row by ID
     */
    async fetchOne<M extends Record<string, unknown>>(
        collectionPath: string,
        id: string | number,
        databaseId?: string
    ): Promise<Record<string, unknown> | undefined> {
        if (!await this.isAddressableUnder(collectionPath, id)) return undefined;

        const collection = getCollectionByPath(collectionPath, this.registry);
        const table = getTableForCollection(collection, this.registry);
        const idInfoArray = requirePrimaryKeys(collection, this.registry);
        const idInfo = idInfoArray[0];
        const idField = table[idInfo.fieldName as keyof typeof table] as AnyPgColumn;

        if (!idField) {
            throw new Error(`ID field '${idInfo.fieldName}' not found in table for collection '${collectionPath}'`);
        }

        // An address the key columns cannot hold names no row — the same answer
        // as a well-formed id nobody has. Asking Postgres instead raises 22P02
        // and aborts the transaction around this read.
        if (!idCanAddressTable(id, table, idInfoArray)) return undefined;

        const parsedIdObj = parseIdValues(id, idInfoArray);
        const parsedId = parsedIdObj[idInfo.fieldName];

        // Primary path: use db.query.findFirst with relation loading

        const tableName = getTableName(table);

        const qb = this.getQueryBuilder(tableName);
        if (qb) {
            try {
                const withConfig = this.buildWithConfig(collection);

                const hidden = hiddenColumnsOption(getTableColumns(table), collection);

                const row = await qb.findFirst({
                    where: eq(idField, parsedId),
                    with: withConfig,
                    ...(hidden ? { columns: hidden } : {})
                } as Parameters<NonNullable<typeof qb>["findFirst"]>[0]);

                if (!row) return undefined;

                const flatRow = toFlatRow(row, collection, this.registry);

                // Post-fetch joinPath relations that Drizzle's `with` can't express
                await this.resolveJoinPathRelations<M>(flatRow, collection, collectionPath, parsedId, databaseId);

                return flatRow;
            } catch (e) {
                if (e instanceof Error && e.message.includes("not enough information to infer relation")) {
                    logger.error(`[FetchService] ResolvedRelation inference error for collection '${collectionPath}': ${e.message}`);
                    logger.error("Hint: This usually means a relation in your drizzle schema is missing a reciprocal 'one()' or 'many()' definition. Run 'rebase schema generate' to fix this.");
                }
                if (reachedDatabase(e)) throw e;
                logger.warn(`[FetchService] db.query.findFirst failed for ${collectionPath}, falling back to db.select`, { error: e });
            }
        }

        // Fallback: db.select + N+1 relation loading
        const visibleOne = visibleColumnProjection(getTableColumns(table), collection);
        const result = await this.db
            .select(visibleOne as never)
            .from(table)
            .where(eq(idField, parsedId))
            .limit(1);

        if (result.length === 0) return undefined;

        const raw = result[0] as M;
        const values = await parseDataFromServer(raw, collection, this.db, this.registry) as Record<string, unknown>;

        // Load relations based on cardinality (N+1 — only used in fallback)
        const resolvedRelations = resolveCollectionRelations(collection);
        const propertyKeys = new Set(Object.keys(collection.properties));

        const relationPromises = Object.entries(resolvedRelations)
            .filter(([key]) => propertyKeys.has(key))
            .map(async ([key, relation]) => {
                if (relation.cardinality === "many") {
                    const relatedRows = await this.relationService.fetchRelatedEntities(
                        collectionPath,
                        parsedId,
                        key,
                        {}
                    );
                    values[key] = relatedRows.map(e =>
                        createRelationRef(e.id, e.path)
                    );
                } else if (relation.cardinality === "one") {
                    if (values[key] == null) {
                        try {
                            const relatedRows = await this.relationService.fetchRelatedEntities(
                                collectionPath,
                                parsedId,
                                key,
                                { limit: 1 }
                            );
                            if (relatedRows.length > 0) {
                                const e = relatedRows[0];
                                values[key] = createRelationRef(e.id, e.path);
                            }
                        } catch (e) {
                            logger.warn(`Could not resolve one-to-one relation property: ${key}`, { error: e });
                        }
                    }
                }
            });

        await Promise.all(relationPromises);

        return {
            ...values,
            id: id.toString()
        };
    }

    /**
     * Unified method to fetch rows with optional search functionality
     */
    async fetchRowsWithConditions<M extends Record<string, unknown>>(
        collectionPath: string,
        options: {
            filter?: FilterValues<Extract<keyof M, string>>;
            orderBy?: string;
            order?: "desc" | "asc";
            limit?: number;
            offset?: number;
            startAfter?: Record<string, unknown>;
            searchString?: string;
            searchExplain?: boolean;
            databaseId?: string;
            vectorSearch?: VectorSearchParams;
            logical?: LogicalCondition;
            /** Narrow to the rows reachable from a parent through a relation. */
            relatedTo?: NestedPathHop;
        } = {}
    ): Promise<Record<string, unknown>[]> {
        const scopeCondition = options.relatedTo ? this.buildRelationScope(options.relatedTo) : undefined;
        const collection = getCollectionByPath(collectionPath, this.registry);
        const table = getTableForCollection(collection, this.registry);
        const idInfoArray = requirePrimaryKeys(collection, this.registry);
        const idInfo = idInfoArray[0];
        const idField = table[idInfo.fieldName as keyof typeof table] as AnyPgColumn;

        if (!idField) {
            throw new Error(`ID field '${idInfo.fieldName}' not found in table for collection '${collectionPath}'`);
        }

        // Primary path: use db.query.findMany with relation loading
        // Skip when searchString is present (same reason as fetchCollectionForRest)
        // Skip when collection has relations — lateral JOINs are catastrophically
        // slow for large collections (7s+ for 350 rows). The db.select fallback
        // path uses batch relation resolution which is 50x faster.

        const tableName = getTableName(table);

        const qb = this.getQueryBuilder(tableName);
        const withConfig = this.buildWithConfig(collection);
        const hasRelations = withConfig && Object.keys(withConfig).length > 0;

        // Skip db.query path when vectorSearch is present — it doesn't support
        // custom SELECT expressions needed for the _distance column.
        if (qb && !options.searchString && !hasRelations && !options.vectorSearch) {
            try {
                const queryOpts = this.buildDrizzleQueryOptions<M>(
                    table, idField, idInfo, options, collectionPath, undefined, scopeCondition
                );


                const results = await qb.findMany(queryOpts as Parameters<NonNullable<typeof qb>["findMany"]>[0]);

                const rows = (results as Record<string, unknown>[]).map(row =>
                    toFlatRow(row, collection, this.registry)
                );

                return rows;
            } catch (e) {
                if (e instanceof Error && e.message.includes("not enough information to infer relation")) {
                    logger.error(`[FetchService] ResolvedRelation inference error for collection '${collectionPath}': ${e.message}`);
                    logger.error("Hint: This usually means a relation in your drizzle schema is missing a reciprocal 'one()' or 'many()' definition. Run 'rebase schema generate' to fix this.");
                }
                if (reachedDatabase(e)) throw e;
                logger.warn(`[FetchService] db.query.findMany failed for ${collectionPath}, falling back to db.select`, { error: e });
            }
        }

        // Fallback: db.select + processRowResults (N+1 for relations)
        // When vectorSearch is present, add _distance to the SELECT.
        let vectorMeta: { orderBy: SQL; filter?: SQL; distanceSelect: SQL } | undefined;
        if (options.vectorSearch) {
            vectorMeta = DrizzleConditionBuilder.buildVectorSearchConditions(table, options.vectorSearch);
        }

        // A generated search column is an index in column form; `SELECT *`
        // would ship it to every caller. The projection is undefined — and the
        // SQL therefore unchanged — for any table without one.
        const visible = visibleColumnProjection(getTableColumns(table), collection);

        // Relevance, alongside the row, exactly as `_distance` rides along with
        // a vector search. Present only when the collection opted in and the
        // request carried a search string, so a caller can order by it, show
        // it, or blend it with a score of their own.
        const rankSelect = options.searchString
            ? DrizzleConditionBuilder.buildSearchRankExpression(options.searchString, table, collection)
            : undefined;

        // Only when asked: a `ts_headline` per declared field per row.
        const matchesSelect = options.searchString && options.searchExplain
            ? DrizzleConditionBuilder.buildSearchMatchesExpression(options.searchString, table, collection)
            : undefined;

        let query = vectorMeta
            ? this.db.select({ table_row: (visible ?? table) as never,
_distance: vectorMeta.distanceSelect }).from(table).$dynamic()
            : rankSelect
                ? this.db.select({
                    table_row: (visible ?? table) as never,
                    _score: rankSelect,
                    ...(matchesSelect ? { _matches: matchesSelect } : {})
                }).from(table).$dynamic()
                : (visible ? this.db.select(visible as never).from(table).$dynamic() : this.db.select().from(table).$dynamic());
        const allConditions: SQL[] = [];

        if (scopeCondition) allConditions.push(scopeCondition);

        if (options.searchString) {
            const searchConditions = DrizzleConditionBuilder.buildSearchConditions(
                options.searchString, collection.properties, table, collection
            );
            if (searchConditions.length === 0) return [];
            allConditions.push(DrizzleConditionBuilder.combineConditionsWithOr(searchConditions)!);
        }

        if (options.filter) {
            const filterConditions = this.buildFilterConditions(options.filter, table, collectionPath);
            if (filterConditions.length > 0) allConditions.push(...filterConditions);
        }

        if (options.logical) {
            const logicalCondition = DrizzleConditionBuilder.buildLogicalConditions(options.logical, table, collectionPath, this.filterContext(collectionPath, table));
            if (logicalCondition) allConditions.push(logicalCondition);
        }

        // Vector distance threshold filter
        if (vectorMeta?.filter) {
            allConditions.push(vectorMeta.filter);
        }

        if (allConditions.length > 0) {
            const finalCondition = DrizzleConditionBuilder.combineConditionsWithAnd(allConditions);
            if (finalCondition) query = query.where(finalCondition);
        }

        const orderExpressions = [];
        // Vector search overrides ORDER BY with distance (ascending = closest first)
        if (vectorMeta) {
            orderExpressions.push(asc(vectorMeta.orderBy));
        } else if (options.orderBy) {
            const orderByField = this.resolveOrderTarget(table, options.orderBy, collection, options.searchString);
            if (orderByField) {
                orderExpressions.push(options.order === "asc" ? asc(orderByField) : desc(orderByField));
            }
        }
        orderExpressions.push(desc(idField));
        if (orderExpressions.length > 0) query = query.orderBy(...orderExpressions);

        if (options.startAfter) {
            const cursorConditions = this.buildCursorConditions(table, idField, idInfo, options, collectionPath);
            if (cursorConditions.length > 0) {
                allConditions.push(...cursorConditions);
                const finalCondition = DrizzleConditionBuilder.combineConditionsWithAnd(allConditions);
                if (finalCondition) query = query.where(finalCondition);
            }
        }

        const limitValue = options.vectorSearch
            ? (options.limit || 10)
            : options.searchString ? (options.limit || 50) : options.limit;
        if (limitValue) query = query.limit(limitValue);

        // Offset (numeric pagination)
        if (options.offset && options.offset > 0) query = query.offset(options.offset);

        const rawResults = await query;

        // When vector search is active, unwrap the nested select shape and
        // attach _distance to each row's values.
        const results = vectorMeta
            ? (rawResults as { table_row: Record<string, unknown>; _distance: unknown }[]).map(r => ({
                ...r.table_row,
                _distance: typeof r._distance === "number" ? r._distance : parseFloat(String(r._distance))
            }))
            // Same nested shape, unwrapped the same way, when a relevance
            // score was selected instead.
            : rankSelect
                ? (rawResults as { table_row: Record<string, unknown>; _score: unknown; _matches?: unknown }[]).map(r => ({
                    ...r.table_row,
                    _score: typeof r._score === "number" ? r._score : parseFloat(String(r._score)),
                    ...(matchesSelect ? { _matches: r._matches ?? [] } : {})
                }))
                : rawResults as Record<string, unknown>[];

        return this.processRowResults<M>(results, collection, collectionPath, idInfo, options.databaseId, false, idInfoArray);
    }

    /**
     * Fallback path used when db.query is unavailable.
     *
     * The primary path runs the results through `toFlatRow`, which maps
     * relations from what drizzle already nested — no query per row. This one
     * has no nesting to read, so it resolves relations itself, in batches.
     *
     * Process raw database results into flat rows with relations.
     */
    private async processRowResults<M extends Record<string, unknown>>(
        results: Record<string, unknown>[],
        collection: CollectionConfig,
        collectionPath: string,
        idInfo: { fieldName: string; type: "string" | "number" },
        _databaseId?: string,
        skipRelations = false,
        idInfoArray?: { fieldName: string; type: "string" | "number" }[]
    ): Promise<Record<string, unknown>[]> {
        if (results.length === 0) return [];

        // First pass: parse all rows WITHOUT per-row relation queries.
        // We deliberately omit db/registry so parseDataFromServer only does type
        // coercion (dates, numbers, FK→relation stubs for owning relations) and
        // does NOT issue individual SQL queries for inverse relations.  The second
        // pass below batch-loads all inverse/many relations in O(1) queries per
        // relation type, avoiding the N+1 that plagued the old path.
        const parsedRows = await Promise.all(results.map(async (rawRow: Record<string, unknown>) => {
            const values = await parseDataFromServer(rawRow as M, collection) as Record<string, unknown>;
            return {
                rawRow,
                values
            };
        }));

        if (!skipRelations) {
            // Second pass: batch load missing one-to-one relations
            const resolvedRelations = resolveCollectionRelations(collection);
            const propertyKeys = new Set(Object.keys(collection.properties));

            for (const [key, relation] of Object.entries(resolvedRelations)) {
                if (!propertyKeys.has(key) || relation.cardinality !== "one") continue;

                const rowsMissingRelation = parsedRows.filter(item => {
                    const val = item.values[key];
                    if (val == null) return true;
                    if (typeof val === "object" && !Array.isArray(val) && (val as Record<string, unknown>).__type === "relation" && (val as Record<string, unknown>).data == null) return true;
                    return false;
                });

                if (rowsMissingRelation.length === 0) continue;

                try {
                    const rowIds = rowsMissingRelation.map(item => item.rawRow[idInfo.fieldName] as string | number);
                    const relationResults = await this.relationService.batchFetchRelatedEntities(
                        collectionPath,
                        rowIds,
                        key,
                        relation
                    );

                    rowsMissingRelation.forEach(item => {
                        const id = item.rawRow[idInfo.fieldName] as string | number;
                        const relatedRow = relationResults.get(String(id));
                        if (relatedRow) {
                            item.values[key] = createRelationRefWithData(relatedRow.id, relatedRow.path, relatedRow);
                        }
                    });
                } catch (e) {
                    logger.warn(`Could not batch load one-to-one relation property: ${key}`, { error: e });
                }
            }

            // Batch load many-cardinality relations (1 query per relation type
            // instead of N queries per row)
            const manyRelations = Object.entries(resolvedRelations)
                .filter(([key, relation]) => propertyKeys.has(key) && relation.cardinality === "many");

            for (const [key, relation] of manyRelations) {
                try {
                    const rowIds = parsedRows.map(item => item.rawRow[idInfo.fieldName] as string | number);
                    const relationResults = await this.relationService.batchFetchRelatedEntitiesMany(
                        collectionPath,
                        rowIds,
                        key,
                        relation
                    );

                    parsedRows.forEach(item => {
                        const id = String(item.rawRow[idInfo.fieldName]);
                        const relatedRows = relationResults.get(id) || [];
                        item.values[key] = relatedRows.map(e =>
                            createRelationRefWithData(e.id, e.path, e)
                        );
                    });
                } catch (e) {
                    logger.warn(`Could not batch load many relation property: ${key}`, { error: e });
                }
            }
        }

        // Columns only — the address is the consumer's to derive.
        return parsedRows.map(item => item.values);
    }

    /**
     * Fetch a collection of rows
     */
    async fetchCollection<M extends Record<string, unknown>>(
        collectionPath: string,
        options: {
            filter?: FilterValues<Extract<keyof M, string>>;
            /**
             * An `or(...)`/`and(...)` group, applied alongside `filter`.
             *
             * `fetchRowsWithConditions` below has always applied this; it was
             * simply absent from this signature, so the only callers that could
             * pass one were the ones that went around this method. Realtime
             * came through here, which is why a subscription filtered by a
             * logical group was pushed every row in the table.
             */
            logical?: LogicalCondition;
            orderBy?: string;
            order?: "desc" | "asc";
            limit?: number;
            offset?: number;
            startAfter?: Record<string, unknown>;
            searchString?: string;
            databaseId?: string;
            vectorSearch?: VectorSearchParams;
        } = {}
    ): Promise<Record<string, unknown>[]> {
        // A nested path is the target collection narrowed by a relation — the
        // same query, one condition heavier. It used to be a separate builder
        // that honoured `limit` and nothing else.
        const hop = isNestedPath(collectionPath) ? resolveNestedPath(collectionPath, this.registry) : undefined;
        if (hop) {
            return this.fetchRowsWithConditions<M>(hop.targetCollection.slug, { ...options,
relatedTo: hop });
        }

        return this.fetchRowsWithConditions<M>(collectionPath, options);
    }

    /**
     * Search rows by text
     */
    async searchRows<M extends Record<string, unknown>>(
        collectionPath: string,
        searchString: string,
        options: {
            filter?: FilterValues<Extract<keyof M, string>>;
            /**
             * An `or(...)`/`and(...)` group, applied alongside `filter`.
             *
             * `fetchRowsWithConditions` has always applied one; it was missing
             * from this signature, so a realtime search subscription carrying a
             * group could not pass it on and served every row matching the text
             * that RLS allowed.
             */
            logical?: LogicalCondition;
            orderBy?: string;
            order?: "desc" | "asc";
            limit?: number;
            databaseId?: string;
            /** Ask each row which declared search field matched. */
            searchExplain?: boolean;
        } = {}
    ): Promise<Record<string, unknown>[]> {
        return this.fetchRowsWithConditions<M>(collectionPath, {
            ...options,
            searchString
        });
    }

    /**
     * Count rows in a collection
     */
    async count<M extends Record<string, unknown>>(
        collectionPath: string,
        options: {
            filter?: FilterValues<Extract<keyof M, string>>;
            logical?: LogicalCondition;
            searchString?: string;
            databaseId?: string;
        } = {}
    ): Promise<number> {
        // Same narrowing as the listing — and, unlike the count it replaces,
        // the same `filter` and `searchString` too, so `total` describes the
        // rows that were actually served.
        const hop = isNestedPath(collectionPath) ? resolveNestedPath(collectionPath, this.registry) : undefined;
        const effectivePath = hop ? hop.targetCollection.slug : collectionPath;

        const collection = getCollectionByPath(effectivePath, this.registry);
        const table = getTableForCollection(collection, this.registry);

        let query = this.db.select({ count: count() }).from(table).$dynamic();
        const allConditions: SQL[] = [];

        if (hop) allConditions.push(this.buildRelationScope(hop));

        if (options.searchString) {
            const searchConditions = DrizzleConditionBuilder.buildSearchConditions(
                options.searchString, collection.properties, table, collection
            );
            if (searchConditions.length === 0) return 0;
            allConditions.push(DrizzleConditionBuilder.combineConditionsWithOr(searchConditions)!);
        }

        if (options.filter) {
            const filterConditions = this.buildFilterConditions(options.filter, table, effectivePath);
            if (filterConditions.length > 0) allConditions.push(...filterConditions);
        }

        if (options.logical) {
            const logicalCondition = DrizzleConditionBuilder.buildLogicalConditions(
                options.logical, table, effectivePath, this.filterContext(effectivePath, table)
            );
            if (logicalCondition) allConditions.push(logicalCondition);
        }

        if (allConditions.length > 0) {
            const finalCondition = DrizzleConditionBuilder.combineConditionsWithAnd(allConditions);
            if (finalCondition) query = query.where(finalCondition);
        }

        const result = await query;
        return Number(result[0]?.count || 0);
    }

    /**
     * Check if a field value is unique
     */
    async checkUniqueField(
        collectionPath: string,
        fieldName: string,
        value: unknown,
        excludeEntityId?: string,
        _databaseId?: string
    ): Promise<boolean> {
        if (value === undefined || value === null) return true;

        const collection = getCollectionByPath(collectionPath, this.registry);
        const table = getTableForCollection(collection, this.registry);
        const idInfoArray = requirePrimaryKeys(collection, this.registry);
        const idInfo = idInfoArray[0];
        const idField = table[idInfo.fieldName as keyof typeof table] as AnyPgColumn;
        const field = table[fieldName as keyof typeof table] as AnyPgColumn;

        if (!field) return true;

        const parsedExcludeId = excludeEntityId ? parseIdValues(excludeEntityId, idInfoArray)[idInfo.fieldName] : undefined;
        const conditions = DrizzleConditionBuilder.buildUniqueFieldCondition(
            field,
            value,
            idField,
            parsedExcludeId
        );

        const result = await this.db
            .select({ count: count() })
            .from(table)
            .where(and(...conditions));

        const countResult = Number(result[0]?.count || 0);
        return countResult === 0;
    }

    /**
     * Get the RelationService instance for external use
     */
    getRelationService(): RelationService {
        return this.relationService;
    }

    // =============================================================
    // REST API INCLUDE-AWARE METHODS
    // =============================================================

    /**
     * Fetch a collection of rows with optional relation includes.
     * When `include` is provided, only the specified relations are populated
     * with full row data (not just { id, path, __type }).
     * When `include` is absent, no relation queries are made (fast path).
     *
     * @param include - Array of relation keys to populate, or ["*"] for all
     */
    async fetchCollectionForRest<M extends Record<string, unknown>>(
        collectionPath: string,
        options: {
            filter?: FilterValues<Extract<keyof M, string>>;
            /** An `or(...)`/`and(...)` group, applied alongside `filter`. */
            logical?: LogicalCondition;
            orderBy?: string;
            order?: "desc" | "asc";
            limit?: number;
            offset?: number;
            startAfter?: Record<string, unknown>;
            searchString?: string;
            databaseId?: string;
            vectorSearch?: VectorSearchParams;
            /** Narrow to the rows reachable from a parent through a relation. */
            relatedTo?: NestedPathHop;
        } = {},
        include?: string[]
    ): Promise<Record<string, unknown>[]> {
        // Resolve a nested path here rather than at the route, so `include`,
        // `offset` and the rest reach a child listing by the same route they
        // reach a root one.
        if (isNestedPath(collectionPath)) {
            const hop = resolveNestedPath(collectionPath, this.registry);
            if (hop) {
                return this.fetchCollectionForRest<M>(
                    hop.targetCollection.slug, { ...options,
relatedTo: hop }, include
                );
            }
        }

        const scopeCondition = options.relatedTo ? this.buildRelationScope(options.relatedTo) : undefined;
        const collection = getCollectionByPath(collectionPath, this.registry);
        const table = getTableForCollection(collection, this.registry);
        const idInfoArray = requirePrimaryKeys(collection, this.registry);
        const idInfo = idInfoArray[0];
        const idField = table[idInfo.fieldName as keyof typeof table] as AnyPgColumn;

        // Primary path: use db.query.findMany
        // NOTE: Skip db.query path when searchString is present because
        // Drizzle's relational query API doesn't properly apply raw SQL
        // ILIKE conditions — the fallback db.select path handles them correctly.

        const tableName = getTableName(table);

        const qb = this.getQueryBuilder(tableName);
        // Skip db.query path when vectorSearch is present — needs custom SELECT
        if (qb && !options.searchString && !options.vectorSearch) {
            try {
                const withConfig = (include && include.length > 0)
                    ? this.buildWithConfig(collection, include)
                    : undefined;

                const queryOpts = this.buildDrizzleQueryOptions<M>(
                    table, idField, idInfo, options, collectionPath, withConfig, scopeCondition
                );


                const results = await qb.findMany(queryOpts as Parameters<NonNullable<typeof qb>["findMany"]>[0]);

                const restRows = (results as Record<string, unknown>[]).map(row =>
                    toRestRow(row, collection, this.registry)
                );

                // Drizzle relational query API doesn't resolve joinPath relations, fetch manually
                await this.resolveJoinPathRelationsBatchRest(restRows, collection, collectionPath, idInfoArray, include);

                return restRows;
            } catch (e) {
                if (e instanceof Error && e.message.includes("not enough information to infer relation")) {
                    logger.error(`[FetchService] ResolvedRelation inference error for collection '${collectionPath}': ${e.message}`);
                    logger.error("Hint: This usually means a relation in your drizzle schema is missing a reciprocal 'one()' or 'many()' definition. Run 'rebase schema generate' to fix this.");
                }
                if (reachedDatabase(e)) throw e;
                logger.warn(`[fetchCollectionForRest] db.query.findMany failed for ${collectionPath}, falling back`, { error: e });
            }
        }

        // Fallback: fetch base rows without relations
        const rows = await this.fetchRowsWithConditionsRaw<M>(collectionPath, options);

        if (!include || include.length === 0) {
            return rows;
        }

        // Fallback relation loading via batch
        const resolvedRelations = resolveCollectionRelations(collection);
        const propertyKeys = new Set(Object.keys(collection.properties || {}));
        const shouldInclude = (key: string) =>
            include[0] === "*" || include.includes(key);

        const rowIds = rows.map(e => e[idInfo.fieldName] as string | number);

        for (const [key, relation] of Object.entries(resolvedRelations)) {
            if (!propertyKeys.has(key) || !shouldInclude(key) || relation.cardinality !== "one") continue;
            try {
                const batchResults = await this.relationService.batchFetchRelatedEntities(
                    collectionPath, rowIds, key, relation
                );
                for (const row of rows) {
                    const eid = row[idInfo.fieldName] as string | number;
                    const related = batchResults.get(String(eid));
                    if (related) {
                        (row as Record<string, unknown>)[key] = { ...related.values };
                    }
                }
            } catch (e) {
                logger.warn(`[include] Failed to batch load one-to-one '${key}'`, { error: e });
            }
        }

        for (const [key, relation] of Object.entries(resolvedRelations)) {
            if (!propertyKeys.has(key) || !shouldInclude(key) || relation.cardinality !== "many") continue;
            try {
                const batchResults = await this.batchFetchManyRelatedRows(
                    collectionPath, rowIds, key
                );
                for (const row of rows) {
                    const eid = row[idInfo.fieldName] as string | number;
                    const relatedList = batchResults.get(String(eid)) || [];
                    (row as Record<string, unknown>)[key] = relatedList;
                }
            } catch (e) {
                logger.warn(`[include] Failed to batch load many '${key}'`, { error: e });
            }
        }

        return rows;
    }

    /**
     * Fetch a single row with optional relation includes for REST API.
     */
    async fetchOneForRest<M extends Record<string, unknown>>(
        collectionPath: string,
        id: string | number,
        include?: string[],
        databaseId?: string
    ): Promise<Record<string, unknown> | null> {
        if (!await this.isAddressableUnder(collectionPath, id)) return null;

        const collection = getCollectionByPath(collectionPath, this.registry);
        const table = getTableForCollection(collection, this.registry);
        const idInfoArray = requirePrimaryKeys(collection, this.registry);
        const idInfo = idInfoArray[0];
        const idField = table[idInfo.fieldName as keyof typeof table] as AnyPgColumn;

        // See `fetchOne`: an unaddressable id is a 404, not a database error.
        if (!idCanAddressTable(id, table, idInfoArray)) return null;

        const parsedIdObj = parseIdValues(id, idInfoArray);
        const parsedId = parsedIdObj[idInfo.fieldName];

        // Primary path: use db.query.findFirst

        const tableName = getTableName(table);

        const qb = this.getQueryBuilder(tableName);
        if (qb) {
            try {
                const withConfig = (include && include.length > 0)
                    ? this.buildWithConfig(collection, include)
                    : undefined;


                const row = await qb.findFirst({
                    where: eq(idField, parsedId),
                    ...(withConfig ? { with: withConfig } : {})
                } as Parameters<NonNullable<typeof qb>["findFirst"]>[0]);

                if (!row) return null;

                const restRow = toRestRow(row, collection, this.registry);

                // Drizzle relational query API doesn't resolve joinPath relations, fetch manually
                await this.resolveJoinPathRelationsBatchRest([restRow], collection, collectionPath, idInfoArray, include);

                return restRow;
            } catch (e) {
                if (e instanceof Error && e.message.includes("not enough information to infer relation")) {
                    logger.error(`[FetchService] ResolvedRelation inference error for collection '${collectionPath}': ${e.message}`);
                    logger.error("Hint: This usually means a relation in your drizzle schema is missing a reciprocal 'one()' or 'many()' definition. Run 'rebase schema generate' to fix this.");
                }
                if (reachedDatabase(e)) throw e;
                logger.warn(`[fetchOneForRest] db.query.findFirst failed for ${collectionPath}, falling back`, { error: e });
            }
        }

        // Fallback: db.select + N+1 relation loading
        const visibleOne = visibleColumnProjection(getTableColumns(table), collection);
        const result = await this.db
            .select(visibleOne as never)
            .from(table)
            .where(eq(idField, parsedId))
            .limit(1);

        if (result.length === 0) return null;

        const flatEntity: Record<string, unknown> = { ...(result[0] as Record<string, unknown>) };

        if (!include || include.length === 0) {
            return flatEntity;
        }

        // Fallback relation population
        const resolvedRelations = resolveCollectionRelations(collection);
        const propertyKeys = new Set(Object.keys(collection.properties || {}));
        const shouldInclude = (key: string) =>
            include[0] === "*" || include.includes(key);

        for (const [key, relation] of Object.entries(resolvedRelations)) {
            if (!propertyKeys.has(key) || !shouldInclude(key)) continue;

            try {
                const relatedRows = await this.relationService.fetchRelatedEntities(
                    collectionPath, parsedId, key, {}
                );

                if (relation.cardinality === "one") {
                    if (relatedRows.length > 0) {
                        const e = relatedRows[0];
                        flatEntity[key] = { id: e.id,
...e.values };
                    }
                } else {
                    flatEntity[key] = relatedRows.map(e => ({
                        id: e.id,
...e.values
                    }));
                }
            } catch (e) {
                logger.warn(`[include] Failed to load relation '${key}'`, { error: e });
            }
        }

        return flatEntity;
    }

    /**
     * Fetch raw rows without any relation processing (for REST fast path)
     */
    private async fetchRowsWithConditionsRaw<M extends Record<string, unknown>>(
        collectionPath: string,
        options: {
            filter?: FilterValues<Extract<keyof M, string>>;
            /**
             * An `or(...)`/`and(...)` group, applied alongside `filter`.
             *
             * Declared *and applied*, because this is the path every REST search
             * and vector read takes: `fetchCollectionForRest` skips `db.query`
             * whenever a `searchString` or a `vectorSearch` is present. The
             * group arrived here on `options` from the very beginning and was
             * simply never read, so `?searchString=x&or=(...)` served every row
             * matching `x` that RLS allowed — while `count` (which does apply
             * it) reported the narrowed total, so `meta.total` and `data`
             * described different sets of rows.
             */
            logical?: LogicalCondition;
            orderBy?: string;
            order?: "desc" | "asc";
            limit?: number;
            offset?: number;
            startAfter?: Record<string, unknown>;
            searchString?: string;
            searchExplain?: boolean;
            vectorSearch?: VectorSearchParams;
            relatedTo?: NestedPathHop;
        } = {}
    ): Promise<Record<string, unknown>[]> {
        const collection = getCollectionByPath(collectionPath, this.registry);
        const table = getTableForCollection(collection, this.registry);
        const idInfoArray = requirePrimaryKeys(collection, this.registry);
        const idInfo = idInfoArray[0];
        const idField = table[idInfo.fieldName as keyof typeof table] as AnyPgColumn;

        let vectorMeta: { orderBy: SQL; filter?: SQL; distanceSelect: SQL } | undefined;
        if (options.vectorSearch) {
            vectorMeta = DrizzleConditionBuilder.buildVectorSearchConditions(table, options.vectorSearch);
        }

        // A generated search column is an index in column form; `SELECT *`
        // would ship it to every caller. The projection is undefined — and the
        // SQL therefore unchanged — for any table without one.
        const visible = visibleColumnProjection(getTableColumns(table), collection);

        // Relevance, alongside the row, exactly as `_distance` rides along with
        // a vector search. Present only when the collection opted in and the
        // request carried a search string, so a caller can order by it, show
        // it, or blend it with a score of their own.
        const rankSelect = options.searchString
            ? DrizzleConditionBuilder.buildSearchRankExpression(options.searchString, table, collection)
            : undefined;

        // Only when asked: a `ts_headline` per declared field per row.
        const matchesSelect = options.searchString && options.searchExplain
            ? DrizzleConditionBuilder.buildSearchMatchesExpression(options.searchString, table, collection)
            : undefined;

        let query = vectorMeta
            ? this.db.select({ table_row: (visible ?? table) as never,
_distance: vectorMeta.distanceSelect }).from(table).$dynamic()
            : rankSelect
                ? this.db.select({
                    table_row: (visible ?? table) as never,
                    _score: rankSelect,
                    ...(matchesSelect ? { _matches: matchesSelect } : {})
                }).from(table).$dynamic()
                : (visible ? this.db.select(visible as never).from(table).$dynamic() : this.db.select().from(table).$dynamic());
        const allConditions: SQL[] = [];

        if (options.relatedTo) allConditions.push(this.buildRelationScope(options.relatedTo));

        if (options.searchString) {
            const searchConditions = DrizzleConditionBuilder.buildSearchConditions(
                options.searchString, collection.properties, table, collection
            );
            if (searchConditions.length === 0) return [];
            allConditions.push(DrizzleConditionBuilder.combineConditionsWithOr(searchConditions)!);
        }

        if (options.filter) {
            const filterConditions = this.buildFilterConditions(options.filter, table, collectionPath);
            if (filterConditions.length > 0) allConditions.push(...filterConditions);
        }

        if (options.logical) {
            const logicalCondition = DrizzleConditionBuilder.buildLogicalConditions(options.logical, table, collectionPath, this.filterContext(collectionPath, table));
            if (logicalCondition) allConditions.push(logicalCondition);
        }

        if (vectorMeta?.filter) {
            allConditions.push(vectorMeta.filter);
        }

        if (allConditions.length > 0) {
            const finalCondition = DrizzleConditionBuilder.combineConditionsWithAnd(allConditions);
            if (finalCondition) query = query.where(finalCondition);
        }

        const orderExpressions = [];
        if (vectorMeta) {
            orderExpressions.push(asc(vectorMeta.orderBy));
        } else if (options.orderBy) {
            const orderByField = this.resolveOrderTarget(table, options.orderBy, collection, options.searchString);
            if (orderByField) {
                orderExpressions.push(options.order === "asc" ? asc(orderByField) : desc(orderByField));
            }
        }
        orderExpressions.push(desc(idField));
        if (orderExpressions.length > 0) query = query.orderBy(...orderExpressions);

        const limitValue = options.vectorSearch
            ? (options.limit || 10)
            : options.searchString ? (options.limit || 50) : options.limit;
        if (limitValue) query = query.limit(limitValue);

        // Offset (numeric pagination)
        if (options.offset && options.offset > 0) query = query.offset(options.offset);

        const rawResults = await query;

        if (vectorMeta) {
            return (rawResults as { table_row: Record<string, unknown>; _distance: unknown }[]).map(r => ({
                ...r.table_row,
                _distance: typeof r._distance === "number" ? r._distance : parseFloat(String(r._distance))
            }));
        }

        if (rankSelect) {
            return (rawResults as { table_row: Record<string, unknown>; _score: unknown; _matches?: unknown }[]).map(r => ({
                ...r.table_row,
                _score: typeof r._score === "number" ? r._score : parseFloat(String(r._score)),
                ...(matchesSelect ? { _matches: r._matches ?? [] } : {})
            }));
        }

        return rawResults as Record<string, unknown>[];
    }

    /**
     * Check if the Drizzle instance has the relational query API available
     * for a given collection path.
     * Note: Primary path now uses inline `getQueryBuilder()` checks.
     */
    private hasDrizzleQueryAPI(collectionPath: string): boolean {

        const qb = this.getQueryBuilder("__probe__");
        if (!qb) {
            // If getQueryBuilder returns undefined even for a probe, query API is not available
            return false;
        }
        const collection = getCollectionByPath(collectionPath, this.registry);
        const table = getTableForCollection(collection, this.registry);
        const tableName = getTableName(table);
        return !!this.getQueryBuilder(tableName);
    }

    /**
     * Fallback path used when db.query is unavailable.
     * The primary path uses db.query.findMany with `with` config, which
     * loads all relations in a single query.
     *
     * Batch fetch many-to-many related rows for multiple parent IDs.
     * Groups results by parent ID to avoid N+1.
     */
    private async batchFetchManyRelatedRows(
        parentCollectionPath: string,
        parentIds: (string | number)[],
        relationKey: string
    ): Promise<Map<string, Record<string, unknown>[]>> {
        if (parentIds.length === 0) return new Map();

        // Resolve the relation definition so we can use the true batch method
        const collection = getCollectionByPath(parentCollectionPath, this.registry);
        const resolvedRelations = resolveCollectionRelations(collection);
        const relation = resolvedRelations[relationKey];

        if (!relation) {
            logger.warn(`[batchFetchManyRelatedRows] ResolvedRelation '${relationKey}' not found, skipping`);
            return new Map();
        }

        // Delegate to RelationService.batchFetchRelatedEntitiesMany which
        // uses a single SQL query with IN(...) — O(1) instead of O(N).
        // RelationService returns RelatedRow shapes (id + path + values) — flatten to plain rows here.
        const entityMap = await this.relationService.batchFetchRelatedEntitiesMany(
            parentCollectionPath,
            parentIds,
            relationKey,
            relation
        );
        const flatMap = new Map<string, Record<string, unknown>[]>();
        for (const [key, rows] of entityMap) {
            flatMap.set(key, rows.map(e => ({ ...e.values, id: e.id })));
        }
        return flatMap;
    }
}
