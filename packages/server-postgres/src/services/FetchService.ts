import { and, asc, count, desc, eq, getTableColumns, getTableName, gt, isNotNull, isNull, lt, or, sql, SQL, TableRelationalConfig, TablesRelationalConfig } from "drizzle-orm";
import { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { CollectionConfig, FilterValues, MAX_INCLUDE_DEPTH, OrderByTuple, ResolvedRelation, LogicalCondition, isManyToMany, parseRelationAggregateSort } from "@rebasepro/types";
import type { IncludeSpec, NullsPlacement, VectorSearchParams } from "@rebasepro/types";
import { resolveCollectionRelations, findRelation, fieldKeyForColumn, createRelationRef, createRelationRefWithData, normalizeDriverOrderBy, normalizeInclude, encodeCursor, type IncludeNode, type NormalizedInclude } from "@rebasepro/common";
import { generateForeignKeyName, toWireKey } from "@rebasepro/utils";
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
import { toFlatRow, toRestRow, toRestValues, isJunctionRelation } from "./row-pipeline";
import { visibleColumnProjection, hiddenColumnsOption } from "../schema/search-column";
import { isNestedPath, resolveNestedPath, type NestedPathHop } from "./nested-path";
// One rule, one place. See `soft-delete.ts` for why every read has to ask.
import { andSoftDelete, withSoftDelete, type WithDeleted } from "./soft-delete";
import { ApiError, logger } from "@rebasepro/server";
import { reachedDatabase } from "../utils/pg-error-utils";

/** Type-safe accessor for Drizzle's relational query API via dynamic table name */
type DbQueryAccessor = Record<string, RelationalQueryBuilder<any, any>> | undefined;

/**
 * One sort key, with the column or expression it was resolved to.
 *
 * `cursorTarget` is the same expression pinned to the cursor row instead of the
 * outer one, and is set only for a key that has no stored value to compare a
 * later page against — an aggregate over a relation. Where it is present the
 * keyset comparison recomputes the cursor row's value in SQL rather than
 * reading it off the cursor; see {@link FetchService.buildKeysetComparison}.
 */
type ResolvedOrderKey = {
    field: string;
    direction: "asc" | "desc";
    /**
     * Where this key's NULLs go. Absent means the direction's own convention —
     * see {@link FetchService.nullsLast}, which is the one place the two
     * functions that have to agree about it both read.
     */
    nulls?: NullsPlacement;
    target: AnyPgColumn | SQL;
    cursorTarget?: SQL;
};

/**
 * Ascending comparison for two values of one column, with NULLs placed.
 *
 * Used only to order the rows *inside* one included relation, where the sort
 * happens after a batched load rather than in SQL — see
 * {@link FetchService.shapeRelatedRows}. The NULL placement is the same
 * question the `ORDER BY` answers, and it is answered the same way here so a
 * nested `orderBy` does not put its empty values at the opposite end from the
 * identical top-level one.
 */
function compareForSort(a: unknown, b: unknown, nullsLast: boolean): number {
    const aNull = a === null || a === undefined;
    const bNull = b === null || b === undefined;
    if (aNull && bNull) return 0;
    if (aNull) return nullsLast ? 1 : -1;
    if (bNull) return nullsLast ? -1 : 1;
    // Dates compare as numbers; everything else falls back to a string
    // comparison, which is what a mixed or unknown column has.
    const av = a instanceof Date ? a.getTime() : a;
    const bv = b instanceof Date ? b.getTime() : b;
    if (typeof av === "number" && typeof bv === "number") return av - bv;
    if (typeof av === "boolean" && typeof bv === "boolean") return (av ? 1 : 0) - (bv ? 1 : 0);
    return String(av).localeCompare(String(bv));
}

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

    /**
     * The aggregate a sort key names, as an expression, or `undefined` if the
     * key is not one.
     *
     * `cursorId` builds the same expression pinned to the cursor row — see
     * {@link DrizzleConditionBuilder.buildRelationAggregateExpression}.
     *
     * A key that *parses* as an aggregate but names no relation, or a column
     * the target does not have, throws rather than falling through to the
     * column path. Falling through would report `min(applications.created_at)`
     * as an unknown column and list the columns of the wrong table.
     */
    private resolveAggregateOrderTarget(
        table: PgTable<any>,
        orderBy: string,
        collection: CollectionConfig | undefined,
        collectionPath: string | undefined,
        cursorId?: unknown
    ): SQL | undefined {
        const spec = parseRelationAggregateSort(orderBy);
        if (!spec) return undefined;
        if (!collection || !collectionPath) {
            throw ApiError.badRequest(
                `Cannot sort by '${orderBy}': an aggregate sort needs the collection it is written against, ` +
                "and this query carries none.",
                "ORDER_BY_FIELD_NOT_SORTABLE",
                { field: orderBy }
            );
        }
        const primaryKeys = getPrimaryKeys(collection, this.registry);
        const idColumn = primaryKeys.length === 1
            ? table[primaryKeys[0].fieldName as keyof typeof table] as AnyPgColumn
            : undefined;
        if (!idColumn) {
            throw ApiError.badRequest(
                `Cannot sort by '${orderBy}' on collection '${collectionPath}': the subquery correlates on a ` +
                "single key column, and this collection has none or has a composite one.",
                "ORDER_BY_FIELD_NOT_SORTABLE",
                { field: orderBy, collection: collectionPath }
            );
        }
        return DrizzleConditionBuilder.buildRelationAggregateExpression(
            spec, table, collection, this.registry, idColumn, collectionPath, cursorId
        );
    }

    /**
     * Resolve every sort key to the expression it orders by, in order of
     * significance.
     *
     * A key that resolves to nothing is dropped rather than skipping the rest:
     * `resolveOrderByField` only *returns* undefined under the lenient
     * unknown-field mode, where dropping is the configured answer, and dropping
     * one key of several still honours the ones that did resolve.
     */
    private resolveOrderKeys(
        table: PgTable<any>,
        keys: OrderByTuple[],
        collection?: CollectionConfig,
        searchString?: string,
        collectionPath?: string,
        cursorId?: unknown
    ): ResolvedOrderKey[] {
        const resolved: ResolvedOrderKey[] = [];
        for (const [field, direction, nulls] of keys) {
            // Checked before the column path: an aggregate key is not a column
            // name and would otherwise be reported as a typo'd one.
            const aggregate = this.resolveAggregateOrderTarget(table, field, collection, collectionPath);
            if (aggregate) {
                resolved.push({
                    field,
                    direction,
                    nulls,
                    target: aggregate,
                    // Built only when a cursor is in play: it is a second
                    // subquery, and a listing with no `startAfter` has nothing
                    // to compare against.
                    ...(cursorId !== undefined && {
                        cursorTarget: this.resolveAggregateOrderTarget(
                            table, field, collection, collectionPath, cursorId
                        )
                    })
                });
                continue;
            }
            const target = this.resolveOrderTarget(table, field, collection, searchString);
            if (target) resolved.push({ field,
direction,
nulls,
target });
        }
        return resolved;
    }

    /**
     * Whether this key's NULLs sort *after* its real values.
     *
     * The default is Postgres's own — `NULLS LAST` ascending, `NULLS FIRST`
     * descending — and it was previously hardcoded in two places that had to
     * agree: the `ORDER BY` and the keyset comparison behind cursor paging. A
     * key that states a placement overrides it, in both, because they read the
     * answer from here.
     *
     * The default is also the thing a "newest first" list gets wrong: every row
     * with no date sorts to the very top, ahead of everything real, and the only
     * way out used to be an `is-not-null` filter that dropped those rows
     * entirely. `orderBy: [["published_at", "desc", "last"]]` is the fix.
     */
    private static nullsLast(key: Pick<ResolvedOrderKey, "direction" | "nulls">): boolean {
        if (key.nulls) return key.nulls === "last";
        return key.direction === "asc";
    }

    /**
     * The full `ORDER BY`: the caller's keys, then the id.
     *
     * The id is always last and always descending. It is not decoration — it is
     * what makes the ordering *total*, and a cursor over a non-total order
     * repeats and skips rows among the ties. Every keyset comparison built by
     * {@link buildCursorConditions} ends on the same `id DESC`, and the two have
     * to agree: they did not, and an ascending sort paged with `id >` against an
     * `ORDER BY … , id DESC`, so rows sharing a sort value were dropped from
     * every page after the first.
     *
     * Where the NULLs go is written out rather than inherited. Postgres already
     * defaults to `NULLS LAST` ascending and `NULLS FIRST` descending, so this
     * changes no query — but {@link buildKeysetComparison} encodes that exact
     * placement, and an invariant two functions depend on should be stated in
     * both rather than assumed in one. It matters most for the keys that are
     * *always* nullable: an aggregate over a relation is NULL for every row the
     * relation reaches nothing from, which is precisely the "nobody waiting"
     * end of a queue.
     */
    private buildOrderExpressions(
        keys: ResolvedOrderKey[],
        idField: AnyPgColumn,
        /**
         * Append the primary key as a final tie-breaker.
         *
         * Off for a `SELECT DISTINCT`, which does not select the key: Postgres
         * requires every ORDER BY expression of a distinct read to be in the
         * select list and answers a bare `42P10` otherwise. There is also
         * nothing for it to do there — a distinct read returns a set of values,
         * not rows, so there are no ties between rows to break.
         */
        tieBreakOnId = true
    ): SQL[] {
        // Four literal branches rather than a nested `sql` fragment for the
        // placement: a nested fragment renders as a child SQL node, which is
        // correct in the statement and invisible to anything reading the
        // expression's own chunks — including the test that asserts a
        // descending sort really does say `NULLS LAST` when it was asked to.
        const expressions = keys.map((key) => {
            const nullsLast = FetchService.nullsLast(key);
            if (key.direction === "asc") {
                return nullsLast ? sql`${key.target} ASC NULLS LAST` : sql`${key.target} ASC NULLS FIRST`;
            }
            return nullsLast ? sql`${key.target} DESC NULLS LAST` : sql`${key.target} DESC NULLS FIRST`;
        });
        if (tieBreakOnId) expressions.push(desc(idField));
        return expressions as SQL[];
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
            // `localKey` is the column; the table is keyed by the wire name.
            const foreignKey = columnAt(fieldKeyForColumn(collection, declaredRelation.localKey));
            if (foreignKey) return foreignKey;
        }

        // No collection in hand — the shapes an owning relation's key takes by
        // default (e.g. `project` → `projectId`, `userProfile` →
        // `userProfileId`), then the snake forms for a project that authored the
        // property under its column name.
        for (const guess of [
            `${orderBy}Id`,
            toWireKey(generateForeignKeyName(orderBy)),
            `${orderBy}_id`,
            generateForeignKeyName(orderBy)
        ]) {
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

    // =============================================================
    // THE INCLUDE PIPELINE
    //
    // One implementation, reached by every read: the REST list, the REST
    // get-by-id, the in-process accessor and the realtime refetch. It used to
    // be four. `db.query.findMany({ with })` served REST — the lateral-join
    // path this file's own comments call "catastrophically slow… 7s+ for 350
    // rows" — while the admin fetch batched through `RelationService` and the
    // realtime refetch loaded EVERY relation because it passed no `include` at
    // all. So `find()` and `listen()` answered the same query with different
    // rows, and the fast path was the one nobody could reach.
    //
    // What runs now is the batched one, for all of them: one query per relation
    // per level, never per row.
    // =============================================================

    /**
     * The relations one level of an include tree names, resolved.
     *
     * A name that is not a relation is a **400 `UNKNOWN_RELATION`**. It used to
     * be dropped silently, which answers 200 with the field missing — and a
     * missing relation field is indistinguishable from a row that genuinely has
     * no related row, so a typo in an `include` looked like empty data.
     */
    private resolveIncludeLevel(
        collection: CollectionConfig,
        tree: Record<string, IncludeNode>,
        wildcard: boolean
    ): { key: string; node: IncludeNode; relation: ResolvedRelation }[] {
        const resolvedRelations = resolveCollectionRelations(collection);
        const out: { key: string; node: IncludeNode; relation: ResolvedRelation }[] = [];

        if (wildcard) {
            // `*` is "every relation, one hop" — the admin panel's shape. A
            // relation also named explicitly keeps its options.
            for (const [key, relation] of Object.entries(resolvedRelations)) {
                out.push({ key, node: tree[key] ?? { children: {} }, relation });
            }
        }

        for (const [key, node] of Object.entries(tree)) {
            if (wildcard && key in resolvedRelations) continue;
            const relation = resolvedRelations[key];
            if (!relation) {
                const known = Object.keys(resolvedRelations).sort();
                throw ApiError.badRequest(
                    `Unknown relation '${key}' on collection '${collection.slug ?? collection.name}'`
                    + (known.length > 0
                        ? `. Its relations are: ${known.join(", ")}`
                        : ". It declares no relations."),
                    "UNKNOWN_RELATION",
                    { relation: key, collection: collection.slug ?? collection.name, ...(known.length > 0 && { validRelations: known }) }
                );
            }
            out.push({ key, node, relation });
        }

        return out;
    }

    /**
     * The extra `WHERE` an include's own `where`/`logical` puts on the target.
     *
     * Pushed into the batch query rather than applied to the rows it returns:
     * filtering afterwards reads every related row of every parent to throw
     * most of them away, and on a to-many relation that is the whole table.
     */
    private includeNarrowing(node: IncludeNode, targetCollection: CollectionConfig): SQL | undefined {
        if (!node.where && !node.logical) return undefined;
        const targetPath = targetCollection.slug;
        const targetTable = getTableForCollection(targetCollection, this.registry);
        const conditions: SQL[] = [];
        if (node.where) {
            conditions.push(...this.buildFilterConditions(node.where, targetTable, targetPath));
        }
        if (node.logical) {
            const logical = DrizzleConditionBuilder.buildLogicalConditions(
                node.logical, targetTable, targetPath, this.filterContext(targetPath, targetTable)
            );
            if (logical) conditions.push(logical);
        }
        return conditions.length > 0
            ? DrizzleConditionBuilder.combineConditionsWithAnd(conditions)
            : undefined;
    }

    /**
     * Sort, cap and project the rows of ONE to-many relation, per parent.
     *
     * `orderBy` and `limit` are applied here rather than in SQL because a limit
     * on a batched relation load is *per parent*, and expressing that needs a
     * LATERAL or a window function per relation kind — four of them, each with
     * its own join shape. The rows were already narrowed by
     * {@link includeNarrowing} in SQL, so what this sorts and cuts is the set
     * the caller asked for and not the table.
     */
    private shapeRelatedRows(
        rows: Record<string, unknown>[],
        node: IncludeNode,
        targetCollection: CollectionConfig
    ): Record<string, unknown>[] {
        let out = rows;
        if (node.orderBy && node.orderBy.length > 0) {
            const keys = node.orderBy;
            out = [...out].sort((a, b) => {
                for (const [field, direction, nulls] of keys) {
                    const cmp = compareForSort(a[field], b[field], FetchService.nullsLast({ direction, nulls }));
                    if (cmp !== 0) return direction === "desc" ? -cmp : cmp;
                }
                return 0;
            });
        }
        if (node.limit !== undefined) out = out.slice(0, node.limit);
        if (node.fields && node.fields.length > 0) {
            const keep = new Set(node.fields);
            // The key always survives: a related row nobody can address cannot
            // be followed, updated or deduplicated by the caller.
            for (const pk of getPrimaryKeys(targetCollection, this.registry)) keep.add(pk.fieldName);
            out = out.map(row => {
                const projected: Record<string, unknown> = {};
                for (const [key, value] of Object.entries(row)) {
                    if (keep.has(key)) projected[key] = value;
                }
                return projected;
            });
        }
        return out;
    }

    /**
     * Load an include tree onto `rows`, in place, one batched query per
     * relation per level.
     *
     * Recurses into nested includes with the rows it just loaded, so
     * `comments.author` is two queries for a page of posts rather than one per
     * comment. The depth bound lives on the normalizer
     * ({@link MAX_INCLUDE_DEPTH}); this asserts it again because the tree can
     * also be built in-process, where nothing normalized it.
     */
    private async loadIncludes(
        rows: Record<string, unknown>[],
        collection: CollectionConfig,
        collectionPath: string,
        include: NormalizedInclude,
        depth = 1
    ): Promise<void> {
        if (rows.length === 0 || depth > MAX_INCLUDE_DEPTH) return;

        const idInfoArray = getPrimaryKeys(collection, this.registry);
        if (idInfoArray.length === 0) return;

        // The address the batch groups its results by. Both sides derive it the
        // same way, so they agree by construction rather than by both happening
        // to pick column zero.
        const addressOf = (row: Record<string, unknown>): string | undefined => {
            const address = buildCompositeId(row, idInfoArray);
            return address && address.split(COMPOSITE_ID_SEPARATOR).some(part => part !== "")
                ? address
                : undefined;
        };
        const addressable = rows.filter(row => addressOf(row) !== undefined);
        if (addressable.length === 0) return;
        const rowIds = addressable.map(row => addressOf(row) as string);

        const levels = this.resolveIncludeLevel(collection, include.tree, include.wildcard);

        for (const { key, node, relation } of levels) {
            const targetCollection = relation.target();
            // Deliberately unguarded: a `where` inside an include that names a
            // column the target does not have is the caller's mistake, and it
            // is already an ApiError. Anything else is not this loop's to
            // swallow either, so both travel to the caller untouched.
            const narrow: SQL | undefined = this.includeNarrowing(node, targetCollection);

            // Rows loaded at this level, to recurse into. Collected as the
            // objects actually attached to the parents, so a nested include
            // mutates what the caller will see rather than a copy of it.
            const loaded: Record<string, unknown>[] = [];

            try {
                if (relation.cardinality === "one") {
                    const results = await this.relationService.batchFetchRelatedEntities(
                        collectionPath, rowIds, key, relation, narrow
                    );
                    for (const row of addressable) {
                        const related = results.get(String(addressOf(row)));
                        // `null`, not "absent": a to-one relation that reaches
                        // nothing is a fact about the row, and leaving the key
                        // off makes it indistinguishable from not having asked.
                        if (!related) { row[key] = null; continue; }
                        // Rendered exactly as the parent is: the include loader
                        // attaches these itself, and a target left in the walk's
                        // own types is how a date came back as a string at the
                        // top level and a `{ __type: "date" }` envelope one
                        // level down, in one response.
                        const [shaped] = this.shapeRelatedRows(
                            [toRestValues({ ...related.values }, targetCollection)], node, targetCollection
                        );
                        row[key] = shaped;
                        loaded.push(shaped);
                    }
                } else {
                    const results = await this.relationService.batchFetchRelatedEntitiesMany(
                        collectionPath, rowIds, key, relation, narrow
                    );
                    for (const row of addressable) {
                        const related = results.get(String(addressOf(row))) ?? [];
                        const shaped = this.shapeRelatedRows(
                            related.map(e => toRestValues({ ...e.values }, targetCollection)), node, targetCollection
                        );
                        row[key] = shaped;
                        loaded.push(...shaped);
                    }
                }
            } catch (e) {
                // An `include` that failed is not an `include` that matched
                // nothing. A Postgres error also poisons the surrounding
                // transaction, so swallowing one loses every later relation in
                // the same request too — one failure, several missing fields.
                if (e instanceof ApiError) throw e;
                if (reachedDatabase(e)) throw e;
                logger.warn(`[include] Failed to load relation '${key}' on ${collectionPath}`, { error: e });
                continue;
            }

            const children = Object.keys(node.children).length > 0
                ? { wildcard: false, tree: node.children }
                : undefined;
            if (children && loaded.length > 0) {
                await this.loadIncludes(
                    loaded, targetCollection, targetCollection.slug, children, depth + 1
                );
            }
        }
    }

    /**
     * The SELECT list for a read: the visible columns, narrowed to `fields`.
     *
     * `?fields=` used to be a trim of the *response* — every column read out of
     * the database and most of them thrown away in JavaScript. It is a
     * projection now, so asking for two columns of a wide row reads two
     * columns; that is also what makes `distinct` mean anything.
     *
     * Two things survive a narrowing regardless:
     *
     * - the **primary key**, because a row nobody can address cannot be
     *   updated, deleted, or paged past — and `meta.nextCursor` is derived from
     *   it, so a projection without it would silently disable seeking. The one
     *   exception is `distinct`, below;
     * - the exclusions. `excludeFromApi` and the generated search columns are
     *   removed *after* the narrowing, so naming one in `fields` does not
     *   un-hide it. That was the shape of the `?searchString=` leak: a path
     *   that skipped the projection returned a password hash the plain read
     *   correctly withheld.
     *
     * An unknown column name is a 400 rather than a silent omission: a caller
     * who mistypes `?fields=titel` otherwise gets rows without titles and no
     * hint why.
     *
     * **`distinct` drops the primary key.** Keeping it is what the refusal of
     * `distinct` beside a search or vector query already describes: a value
     * that differs on every row makes the whole row distinct by construction,
     * so the query "would answer 200 having done nothing". A surrogate key does
     * that more reliably than any score — `?fields=status&distinct=true` came
     * back with one row per row, every one carrying its `id`. So a distinct
     * read is a read of the named columns and nothing else. It addresses no
     * rows, which is the honest shape for one: `cursorFor` finds no key on the
     * row and issues no cursor, and the result is a set of values rather than a
     * set of rows to update or delete.
     */
    private columnProjection(
        table: PgTable<any>,
        collection: CollectionConfig,
        fields: string[] | undefined,
        idInfoArray: { fieldName: string; type: "string" | "number" }[],
        distinct?: boolean
    ): Record<string, unknown> | undefined {
        const visible = visibleColumnProjection(getTableColumns(table), collection);
        if (!fields || fields.length === 0) return visible;

        let tableColumns: Record<string, unknown>;
        try {
            tableColumns = getTableColumns(table) as Record<string, unknown>;
        } catch {
            // Not a real drizzle table — a stub in a test, a derived path. No
            // projection is the right answer, as it is for the exclusions.
            return visible;
        }
        const available = visible ?? tableColumns;

        const keep = new Set(fields);
        if (!distinct) for (const pk of idInfoArray) keep.add(pk.fieldName);

        const projection: Record<string, unknown> = {};
        for (const name of keep) {
            const column = available[name];
            if (column !== undefined) { projection[name] = column; continue; }
            // Present on the table but not in `available` means it was excluded
            // — hidden, and staying hidden. Absent from both is a typo.
            if (tableColumns[name] !== undefined) continue;
            throw ApiError.badRequest(
                `Unknown field '${name}' in \`fields\` on collection `
                + `'${collection.slug ?? collection.name}'. Valid fields: `
                + Object.keys(available).sort().join(", "),
                "UNKNOWN_FIELD",
                { field: name, collection: collection.slug ?? collection.name }
            );
        }
        return projection;
    }

    /**
     * The opaque cursor that continues a listing after `row`. See
     * {@link RestFetchService.cursorFor}.
     *
     * Here rather than at the route because deriving it needs the collection's
     * primary key, which may be named anything and span several columns — the
     * driver's knowledge, not the HTTP layer's.
     */
    cursorFor(
        collectionPath: string,
        row: Record<string, unknown>,
        orderBy?: OrderByTuple[]
    ): string | undefined {
        // Relevance is computed per query rather than stored, so there is no
        // value on this row to compare a later page against — and two requests
        // with different search strings produce scores that are not on the same
        // scale at all. `buildCursorConditions` refuses such a cursor; issuing
        // one here would be handing out a string whose only use is a 400.
        if (orderBy?.some(([field]) => field === FetchService.SCORE_FIELD)) return undefined;
        try {
            const collection = getCollectionByPath(collectionPath, this.registry);
            const pks = getPrimaryKeys(collection, this.registry);
            if (pks.length === 0) return undefined;
            const address = buildCompositeId(row, pks);
            if (!address || !address.split(COMPOSITE_ID_SEPARATOR).some(part => part !== "")) return undefined;
            // The single-key value, not the composite token: the keyset
            // comparison compares it against the id *column*.
            return encodeCursor(orderBy, row, row[pks[0].fieldName]);
        } catch {
            // A path with no registered collection — a nested or derived one.
            // No cursor is the honest answer; the listing pages by offset.
            return undefined;
        }
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
                    // A relation that failed to load is not a relation that is absent.
                    // Without this the request answers 200 with the field quietly
                    // missing — and because a Postgres error poisons the surrounding
                    // transaction, every later relation in the same request is
                    // swallowed too, so one failure becomes a response missing
                    // several fields. Same guard the four other catches in this file
                    // already use.
                    if (reachedDatabase(e)) throw e;
                    logger.warn(`Could not resolve joinPath relation '${key}'`, { error: e });
                }
            });

        await Promise.all(promises);
    }

    /**
     * Extract cursor pagination conditions from startAfter options.
     *
     * "Every row that sorts after this one", written out as a comparison over
     * the same keys the `ORDER BY` uses and ending on the same `id DESC`. With
     * one key that is the familiar `k > v OR (k = v AND id < cursorId)`; with
     * several it nests, each key's tie handing the decision to the next.
     */
    private buildCursorConditions(
        table: PgTable<any>,
        idField: AnyPgColumn,
        idInfo: { fieldName: string; type: "string" | "number" },
        options: { orderBy?: string | OrderByTuple[]; order?: "desc" | "asc"; startAfter?: Record<string, unknown> },
        collectionPath?: string
    ): SQL[] {
        if (!options.startAfter) return [];
        const cursor = options.startAfter;
        const keys = normalizeDriverOrderBy(options.orderBy, options.order);

        if (keys) {
            // Relevance is computed per query, not stored, so there is no value
            // on the cursor row to compare a later page against — and two
            // requests with different search strings would produce scores that
            // are not on the same scale at all. Refusing is the only honest
            // answer: a dropped cursor condition silently repeats and skips
            // rows, which is precisely what paging exists to prevent.
            if (keys.some(([field]) => field === FetchService.SCORE_FIELD)) {
                throw ApiError.badRequest(
                    "Cursor pagination (`startAfter`) cannot be combined with `orderBy: \"_score\"`. " +
                    "Relevance is computed per query rather than stored, so it cannot key a cursor. " +
                    "Use `limit`/`offset` for relevance-ordered pages, or order by a column.",
                    "SCORE_CURSOR_UNSUPPORTED",
                    { field: FetchService.SCORE_FIELD }
                );
            }
            const collection = collectionPath ? getCollectionByPath(collectionPath, this.registry) : undefined;
            const startAfterId = cursor.id ?? cursor[idInfo.fieldName];
            const resolved = this.resolveOrderKeys(
                table, keys, collection, undefined, collectionPath,
                // A null id addresses no row, so pinning a subquery to it would
                // aggregate over nothing and read as "the cursor row has no
                // related rows" rather than as the absent cursor it is.
                startAfterId ?? undefined
            );

            if (resolved.length > 0 && startAfterId !== undefined) {
                const cursorValues = cursor.values as Record<string, unknown> | undefined;
                // `in`, not `??`: a cursor row whose sort value is genuinely
                // NULL is a row this has to be able to page past, and `??`
                // read it as "the cursor did not carry this key" and dropped
                // the whole condition.
                const values = resolved.map(({ field, cursorTarget }) => cursorTarget
                    // An aggregate is not stored on the row, so the cursor
                    // never carried it and never could. Its value is recomputed
                    // from the cursor id instead, in SQL, by `cursorTarget` —
                    // there is nothing for this list to supply.
                    ? null
                    : (cursorValues && field in cursorValues) ? cursorValues[field] : cursor[field]);
                // Every key needs a value from the cursor row. A missing one
                // cannot be guessed, and a comparison built from the keys that
                // happen to be present is not the same comparison — so this
                // falls through to no cursor condition, which is what a single
                // missing sort value has always done here.
                if (values.every((value, i) => resolved[i].cursorTarget || value !== undefined)) {
                    return [this.buildKeysetComparison(resolved, values, idField, startAfterId)];
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
     * "Sorts strictly after the cursor row", over `keys` and then the id.
     *
     * Built by recursion rather than as a row-value comparison — `(a, b) > (x, y)`
     * would be shorter, but it is only correct when every key runs the same
     * direction, and `roles ASC, created_at DESC` is exactly the case this
     * exists to serve.
     *
     * NULLs are compared by the rule Postgres sorts them under (last ascending,
     * first descending) rather than by `>`/`<`, which answer *unknown* against
     * NULL and therefore match nothing. Ordering by a nullable column and paging
     * used to drop every row whose sort value was NULL from page two onward.
     */
    private buildKeysetComparison(
        keys: ResolvedOrderKey[],
        values: unknown[],
        idField: AnyPgColumn,
        cursorId: unknown,
        index = 0
    ): SQL {
        // Past the last key, the id settles it. It is ordered `DESC`, so "after"
        // the cursor row means a smaller id.
        if (index >= keys.length) return lt(idField, cursorId);

        const { direction, cursorTarget } = keys[index];
        // Which end the NULLs sort at — the direction's convention unless the
        // key stated one. Read from the same place `buildOrderExpressions`
        // reads it, because a comparison that disagrees with the ORDER BY it
        // pages over repeats and skips rows and reports nothing wrong.
        const nullsLast = FetchService.nullsLast(keys[index]);
        // A column or an expression. `_score` is an expression too, but a
        // cursor over relevance is refused before this is reached; an aggregate
        // over a relation is the one that gets here. Drizzle's comparison
        // helpers are typed per operand kind, so the union has to be resolved
        // here rather than at the call site.
        const target = keys[index].target as AnyPgColumn;
        const value = values[index];
        const rest = this.buildKeysetComparison(keys, values, idField, cursorId, index + 1);

        // No stored value to compare against — the cursor row's is recomputed
        // by an expression instead, and whether it is NULL is a question only
        // SQL can answer. So both branches of the null test below have to exist
        // in the statement rather than being chosen here.
        //
        // `cursorTarget` references only the cursor id, never the outer row, so
        // Postgres evaluates it once for the whole statement rather than per
        // row — repeating it across the branches costs nothing.
        // "Sorts after" for two non-null values is decided by the *direction*;
        // where the NULLs sit is decided by `nullsLast`. The two used to be the
        // same test, which was correct only while the placement was the
        // direction's default and silently wrong the moment a key named one.
        const after = (a: AnyPgColumn | SQL, b: unknown) =>
            direction === "asc" ? gt(a as AnyPgColumn, b) : lt(a as AnyPgColumn, b);
        const afterSql = (a: AnyPgColumn | SQL, b: SQL) =>
            direction === "asc" ? sql`${a} > ${b}` : sql`${a} < ${b}`;

        if (cursorTarget) {
            return nullsLast
                // NULLS LAST. A cursor row among the NULLs has only later NULLs
                // after it; otherwise everything that sorts later, then the
                // NULLs, then the ties.
                ? or(
                    and(isNull(cursorTarget), isNull(target), rest),
                    and(
                        isNotNull(cursorTarget),
                        or(
                            afterSql(target, cursorTarget),
                            isNull(target),
                            and(sql`${target} = ${cursorTarget}`, rest)
                        )
                    )
                )!
                // NULLS FIRST. A cursor row among the NULLs still has every
                // non-null row after it; a non-null cursor row has the NULLs
                // already behind it.
                : or(
                    and(isNull(cursorTarget), or(isNotNull(target), and(isNull(target), rest))),
                    and(
                        isNotNull(cursorTarget),
                        or(
                            afterSql(target, cursorTarget),
                            and(sql`${target} = ${cursorTarget}`, rest)
                        )
                    )
                )!;
        }

        if (value === null) {
            // The cursor row sorts among the NULLs.
            return nullsLast
                // NULLS LAST: nothing non-null is left, so only later NULLs.
                ? and(isNull(target), rest)!
                // NULLS FIRST: every non-null row is still ahead, plus later NULLs.
                : or(isNotNull(target), and(isNull(target), rest))!;
        }

        return nullsLast
            // NULLS LAST, so the NULLs are still ahead of a non-null cursor row.
            ? or(after(target, value), isNull(target), and(eq(target, value), rest))!
            // NULLS FIRST, so they are behind it and nothing has to admit them.
            : or(after(target, value), and(eq(target, value), rest))!;
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
        databaseId?: string,
        withDeleted?: WithDeleted
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
                    // Soft delete: a stamped row answers 404 like any other
                    // absent one, so `findById` and `find` agree about which
                    // rows exist.
                    where: andSoftDelete(eq(idField, parsedId), collection, table, withDeleted),
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
            .where(andSoftDelete(eq(idField, parsedId), collection, table, withDeleted))
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
                            // A relation that failed to load is not a relation that is absent.
                            // Without this the request answers 200 with the field quietly
                            // missing — and because a Postgres error poisons the surrounding
                            // transaction, every later relation in the same request is
                            // swallowed too, so one failure becomes a response missing
                            // several fields. Same guard the four other catches in this file
                            // already use.
                            if (reachedDatabase(e)) throw e;
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
            orderBy?: string | OrderByTuple[];
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
            /** See `FetchCollectionProps.withDeleted`. */
            withDeleted?: WithDeleted;
            /**
             * Relations to load. **Absent means none** — the same as it means
             * over REST.
             *
             * It used to mean *all of them*, unconditionally, and this is the
             * method the realtime refetch goes through. So a subscription was
             * pushed rows carrying every relation the collection declares while
             * the identical `find()` returned rows carrying none, and a client
             * that rendered both saw the row change shape when a write landed.
             */
            include?: IncludeSpec;
            /** Columns to read — a projection pushed into the SELECT. */
            fields?: string[];
            /** `SELECT DISTINCT` over the projection. */
            distinct?: boolean;
        } = {}
    ): Promise<Record<string, unknown>[]> {
        const collection = getCollectionByPath(collectionPath, this.registry);
        const table = getTableForCollection(collection, this.registry);
        const idInfoArray = requirePrimaryKeys(collection, this.registry);
        const idInfo = idInfoArray[0];
        const idField = table[idInfo.fieldName as keyof typeof table] as AnyPgColumn;

        if (!idField) {
            throw new Error(`ID field '${idInfo.fieldName}' not found in table for collection '${collectionPath}'`);
        }

        // ONE read, then relations.
        //
        // This method used to hold a `db.query.findMany` branch and a full
        // second copy of the `db.select` builder below it — the same
        // conditions, ordering, vector and rank handling as
        // `fetchRowsWithConditionsRaw`, written out twice. Two copies of a
        // query builder is two answers to every question asked of it, and they
        // had already drifted: only one of them read `startAfter`, so cursor
        // paging worked on one path and silently did nothing on the other.
        const results = await this.fetchRowsWithConditionsRaw<M>(collectionPath, options);

        return this.processRowResults<M>(
            results, collection, collectionPath, idInfo, options.databaseId,
            normalizeInclude(options.include), idInfoArray
        );
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
        /**
         * The relations to load. **Absent means none.**
         *
         * It was a `skipRelations` boolean defaulting to *load everything*, and
         * that default is what made the realtime refetch return rows of a
         * different shape from the REST list serving the identical query. The
         * parameter now says which relations rather than whether, so the two
         * callers state the same thing and neither can quietly mean "all".
         */
        include?: NormalizedInclude,
        _idInfoArray?: { fieldName: string; type: "string" | "number" }[]
    ): Promise<Record<string, unknown>[]> {
        if (results.length === 0) return [];

        // First pass: parse all rows WITHOUT per-row relation queries.
        // We deliberately omit db/registry so parseDataFromServer only does type
        // coercion (dates, numbers, FK→relation stubs for owning relations) and
        // does NOT issue individual SQL queries for inverse relations. The
        // include pass below batch-loads what the caller asked for, one query
        // per relation per level, avoiding the N+1 that plagued the old path.
        void idInfo;
        const values = await Promise.all(results.map(async (rawRow: Record<string, unknown>) =>
            await parseDataFromServer(rawRow as M, collection) as Record<string, unknown>));

        // Second pass: the relations the caller named, through the same batched
        // loader every other read uses — so a row from here and a row from the
        // REST list carry the same relations, loaded the same way.
        if (include) {
            await this.loadIncludes(values, collection, collectionPath, include);
        }

        // Columns only — the address is the consumer's to derive.
        return values;
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
            orderBy?: string | OrderByTuple[];
            order?: "desc" | "asc";
            limit?: number;
            offset?: number;
            startAfter?: Record<string, unknown>;
            searchString?: string;
            searchExplain?: boolean;
            databaseId?: string;
            vectorSearch?: VectorSearchParams;
            /** Relations to load. Absent means none — see `fetchRowsWithConditions`. */
            include?: IncludeSpec;
            /** Columns to read — a projection pushed into the SELECT. */
            fields?: string[];
            /** `SELECT DISTINCT` over the projection. */
            distinct?: boolean;
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
            orderBy?: string | OrderByTuple[];
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
            /**
             * Only the `threshold` half of a vector search narrows a count: the
             * distance ordering and the `_distance` column change which rows
             * come back first, not how many there are. Omitting it here left
             * `meta.total` counting rows the threshold had excluded, so a
             * request that was served three rows was told there were nine.
             */
            vectorSearch?: VectorSearchParams;
            /** See `FetchCollectionProps.withDeleted`. */
            withDeleted?: WithDeleted;
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

        // Soft delete. A listing that filters and a count that does not is a
        // page saying "1 of 4 results".
        withSoftDelete(allConditions, collection, table, options.withDeleted);

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

        // A `threshold` genuinely narrows the row set on the fetch path, and
        // this count did not apply it — so a similarity-filtered listing
        // reported the size of the *unfiltered* set, and `hasMore` stayed true
        // over pages that were already empty. Only the threshold narrows it:
        // the ORDER BY and the `_distance` projection change which rows come
        // first and what rides along with them, not how many there are.
        if (options.vectorSearch) {
            // Built for any vector search rather than only a thresholded one,
            // because this is also where an unknown or non-vector
            // `vector_search` property is refused with a 400. Without a
            // threshold it contributes no filter, so the count is unchanged and
            // what is gained is that `/count` refuses the request the listing
            // refuses instead of answering it with a number.
            const vectorMeta = DrizzleConditionBuilder.buildVectorSearchConditions(table, options.vectorSearch);
            if (vectorMeta.filter) allConditions.push(vectorMeta.filter);
        }

        if (allConditions.length > 0) {
            const finalCondition = DrizzleConditionBuilder.combineConditionsWithAnd(allConditions);
            if (finalCondition) query = query.where(finalCondition);
        }

        const result = await query;
        return Number(result[0]?.count || 0);
    }

    /**
     * `count`/`sum`/`avg`/`min`/`max`, optionally grouped.
     *
     * The gap this fills is narrow and constant: every dashboard wants "revenue
     * by status" and "orders per day", and without it the options were a custom
     * function holding hand-written SQL, or fetching every row and reducing in
     * JavaScript — which is wrong at any size that matters, and silently wrong
     * under a `limit`.
     *
     * It runs through the same request-scoped handle as every other read, so
     * **RLS applies to the rows being aggregated**. That is the property worth
     * protecting here: an aggregate is an effective way to read data you cannot
     * select, and `count(*)` over a table whose policies would return nothing
     * has to be zero.
     */
    async aggregate<M extends Record<string, unknown>>(
        collectionPath: string,
        options: {
            aggregates: { fn: "count" | "sum" | "avg" | "min" | "max"; field?: string; alias: string }[];
            groupBy?: string[];
            filter?: FilterValues<Extract<keyof M, string>>;
            logical?: LogicalCondition;
            searchString?: string;
            limit?: number;
            /** See `FetchCollectionProps.withDeleted`. */
            withDeleted?: WithDeleted;
        }
    ): Promise<Record<string, unknown>[]> {
        const collection = getCollectionByPath(collectionPath, this.registry);
        const table = getTableForCollection(collection, this.registry);
        const columns = getTableColumns(table);

        const columnFor = (field: string, forWhat: string): AnyPgColumn => {
            const column = columns[field as keyof typeof columns] as AnyPgColumn | undefined;
            if (!column) {
                throw ApiError.badRequest(
                    `Unknown field '${field}' in ${forWhat}. Valid fields: ${Object.keys(columns).sort().join(", ")}`,
                    "UNKNOWN_AGGREGATE_FIELD"
                );
            }
            return column;
        };

        const selection: Record<string, SQL> = {};

        for (const aggregate of options.aggregates) {
            if (aggregate.fn === "count" && !aggregate.field) {
                selection[aggregate.alias] = sql`count(*)`;
                continue;
            }
            const column = columnFor(aggregate.field as string, `${aggregate.fn}()`);
            switch (aggregate.fn) {
                case "count": selection[aggregate.alias] = sql`count(${column})`; break;
                // Cast through numeric so what comes back is a string this
                // method parses, rather than a float whose precision depends on
                // the column type — `avg` over an integer column is otherwise
                // one shape here and another there.
                case "sum": selection[aggregate.alias] = sql`sum(${column})::numeric`; break;
                case "avg": selection[aggregate.alias] = sql`avg(${column})::numeric`; break;
                case "min": selection[aggregate.alias] = sql`min(${column})`; break;
                case "max": selection[aggregate.alias] = sql`max(${column})`; break;
            }
        }

        const groupColumns = (options.groupBy ?? []).map(field => ({
            field,
            column: columnFor(field, "groupBy")
        }));
        for (const group of groupColumns) {
            selection[group.field] = sql`${group.column}`;
        }

        let query = this.db.select(selection).from(table).$dynamic();

        const conditions: SQL[] = [];
        // Soft delete. A dashboard that sums deleted orders is reporting
        // revenue that was withdrawn.
        withSoftDelete(conditions, collection, table, options.withDeleted);
        if (options.searchString) {
            const searchConditions = DrizzleConditionBuilder.buildSearchConditions(
                options.searchString, collection.properties, table, collection
            );
            // No searchable field means no row matches — the same impossible
            // WHERE the listing uses, rather than an unfiltered aggregate.
            if (searchConditions.length === 0) return [];
            conditions.push(DrizzleConditionBuilder.combineConditionsWithOr(searchConditions) as SQL);
        }
        if (options.filter) {
            conditions.push(...this.buildFilterConditions(options.filter, table, collectionPath));
        }
        if (options.logical) {
            const logicalCondition = DrizzleConditionBuilder.buildLogicalConditions(
                options.logical, table, collectionPath, this.filterContext(collectionPath, table)
            );
            if (logicalCondition) conditions.push(logicalCondition);
        }
        if (conditions.length > 0) {
            const finalCondition = DrizzleConditionBuilder.combineConditionsWithAnd(conditions);
            if (finalCondition) query = query.where(finalCondition);
        }

        if (groupColumns.length > 0) {
            query = query.groupBy(...groupColumns.map(g => g.column));
            // Bounded for the same reason a listing is: grouping by a
            // high-cardinality column is a whole table's worth of rows in one
            // response.
            if (options.limit) query = query.limit(options.limit);
        }

        const rows = await query as Record<string, unknown>[];

        // `count`, `sum` and `avg` arrive as strings: Postgres returns bigint
        // and numeric that way because they do not fit a JS number in general.
        // They do fit for every aggregate anyone puts on a dashboard, and a
        // caller handed `"12"` where they expected `12` has to find that out
        // for themselves. Parsed once, here.
        const numericAliases = new Set(
            options.aggregates.filter(a => a.fn === "count" || a.fn === "sum" || a.fn === "avg").map(a => a.alias)
        );
        return rows.map(row => {
            const out: Record<string, unknown> = { ...row };
            for (const alias of numericAliases) {
                if (out[alias] === null || out[alias] === undefined) continue;
                const parsed = Number(out[alias]);
                if (!Number.isNaN(parsed)) out[alias] = parsed;
            }
            return out;
        });
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
     * Fetch a collection of rows, with the relations `include` names.
     *
     * ## Why this no longer uses `db.query.findMany({ with })`
     *
     * It used to, whenever a `db.query` builder existed for the table — which
     * is Drizzle's relational API, and which compiles a to-many relation into a
     * lateral join. This file's own comment on the *other* read path says what
     * that costs: "catastrophically slow for large collections (7s+ for 350
     * rows)". So the admin fetch avoided it and REST took it, and the fast,
     * batched loader that the admin used was unreachable from the HTTP API.
     *
     * There is one loader now, {@link loadIncludes}, and every read reaches it:
     * one query per relation per level, never one per row. That also makes this
     * method and the realtime refetch the same code, which is what stops
     * `find()` and `listen()` returning different shapes for one query.
     *
     * @param include - see {@link IncludeSpec}: names, dotted paths, `["*"]`,
     *   or the parametrised tree. An unknown name is a 400 `UNKNOWN_RELATION`.
     */
    async fetchCollectionForRest<M extends Record<string, unknown>>(
        collectionPath: string,
        options: {
            filter?: FilterValues<Extract<keyof M, string>>;
            /** An `or(...)`/`and(...)` group, applied alongside `filter`. */
            logical?: LogicalCondition;
            orderBy?: string | OrderByTuple[];
            order?: "desc" | "asc";
            limit?: number;
            offset?: number;
            startAfter?: Record<string, unknown>;
            searchString?: string;
            databaseId?: string;
            vectorSearch?: VectorSearchParams;
            /** Narrow to the rows reachable from a parent through a relation. */
            relatedTo?: NestedPathHop;
            /**
             * See `FetchCollectionProps.withDeleted`. Applied by
             * `fetchRowsWithConditionsRaw` — the one place this pipeline builds
             * a WHERE — so it holds for the listing, the nested-path listing
             * and the realtime refetch alike.
             */
            withDeleted?: WithDeleted;
            /** Columns to read — a projection pushed into the SELECT. */
            fields?: string[];
            /** `SELECT DISTINCT` over the projection. */
            distinct?: boolean;
            /** Ask each row which declared search fields matched. */
            searchExplain?: boolean;
        } = {},
        include?: IncludeSpec
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
        // `relatedTo` is applied by `fetchRowsWithConditionsRaw`, which builds
        // the scope condition itself — this used to build a second one here and
        // hand it to a `db.query` branch that no longer exists.
        const collection = getCollectionByPath(collectionPath, this.registry);

        const normalizedInclude = normalizeInclude(include);

        // Base rows first, relations after. One SELECT, then one query per
        // relation per level of the include tree — never one per row, and never
        // the lateral join the relational query API compiles a to-many into.
        const rows = (await this.fetchRowsWithConditionsRaw<M>(collectionPath, options))
            .map(row => toRestRow(row, collection, this.registry));

        if (normalizedInclude) {
            await this.loadIncludes(rows, collection, collectionPath, normalizedInclude);
        }

        return rows;
    }

    /**
     * Fetch a single row, with the relations `include` names.
     *
     * The same two steps `fetchCollectionForRest` takes, for one row, through
     * the same {@link loadIncludes}. It used to be a separate implementation on
     * `db.query.findFirst({ with })` with a hand-written N+1 fallback beneath
     * it, and the two disagreed: the primary path returned a to-one relation as
     * the target's columns, the fallback merged an `id` over them, and a
     * relation that resolved to nothing was *absent* on one path and `null` on
     * the other. `find()[0]` and `findById()` now answer with the same row.
     */
    async fetchOneForRest<M extends Record<string, unknown>>(
        collectionPath: string,
        id: string | number,
        include?: IncludeSpec,
        databaseId?: string,
        options?: {
            fields?: string[];
            /** See `FetchCollectionProps.withDeleted`. */
            withDeleted?: WithDeleted;
        }
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

        // Soft delete: a stamped row is a 404 through the REST read too, so
        // `GET /:id` and the listing agree about which rows exist.
        const withDeleted = options?.withDeleted;
        const projection = this.columnProjection(table, collection, options?.fields, idInfoArray);
        const result = await this.db
            .select(projection as never)
            .from(table)
            .where(andSoftDelete(eq(idField, parsedId), collection, table, withDeleted))
            .limit(1);

        if (result.length === 0) return null;

        const row = toRestRow(result[0] as Record<string, unknown>, collection, this.registry);

        const normalizedInclude = normalizeInclude(include);
        if (normalizedInclude) {
            await this.loadIncludes([row], collection, collectionPath, normalizedInclude);
        }

        return row;
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
            orderBy?: string | OrderByTuple[];
            order?: "desc" | "asc";
            limit?: number;
            offset?: number;
            startAfter?: Record<string, unknown>;
            searchString?: string;
            searchExplain?: boolean;
            vectorSearch?: VectorSearchParams;
            relatedTo?: NestedPathHop;
            /** See `FetchCollectionProps.withDeleted`. */
            withDeleted?: WithDeleted;
            /** Columns to read — see {@link columnProjection}. */
            fields?: string[];
            /** `SELECT DISTINCT` over the projection. */
            distinct?: boolean;
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
        // SQL therefore unchanged — for any table without one. `fields`
        // narrows it further, in SQL rather than after the fact.
        const visible = this.columnProjection(table, collection, options.fields, idInfoArray, options.distinct === true);

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

        // `SELECT DISTINCT`, over exactly the projection above.
        //
        // Only on the plain read. A vector or relevance query selects a
        // per-row computed value beside the columns — a distance, a score —
        // and DISTINCT over a set that includes one makes every row distinct
        // by construction: it would answer 200 having done nothing, which is
        // worse than refusing.
        const wantsDistinct = options.distinct === true;
        if (wantsDistinct && (vectorMeta || rankSelect)) {
            throw ApiError.badRequest(
                "`distinct` cannot be combined with a search or vector query: both attach a per-row "
                + "score to every row, so no two rows are ever equal and DISTINCT would have no effect. "
                + "Drop one of the two.",
                "DISTINCT_NOT_APPLICABLE"
            );
        }
        const selectFrom = () => {
            const builder = wantsDistinct ? this.db.selectDistinct.bind(this.db) : this.db.select.bind(this.db);
            return visible
                ? builder(visible as never).from(table).$dynamic()
                : builder().from(table).$dynamic();
        };

        let query = vectorMeta
            ? this.db.select({ table_row: (visible ?? table) as never,
_distance: vectorMeta.distanceSelect }).from(table).$dynamic()
            : rankSelect
                ? this.db.select({
                    table_row: (visible ?? table) as never,
                    _score: rankSelect,
                    ...(matchesSelect ? { _matches: matchesSelect } : {})
                }).from(table).$dynamic()
                : selectFrom();
        const allConditions: SQL[] = [];

        if (options.relatedTo) allConditions.push(this.buildRelationScope(options.relatedTo));

        // Soft delete, on the `db.select` path. Both paths serve the same
        // request, so a deleted row must not come back down one and not the
        // other — which is exactly what happens when each grows its own filter.
        withSoftDelete(allConditions, collection, table, options.withDeleted);

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

        const sortKeys = normalizeDriverOrderBy(options.orderBy, options.order) ?? [];

        // Postgres requires every ORDER BY expression of a `SELECT DISTINCT` to
        // be in the select list, and answers a bare `42P10` if one is not —
        // which reaches the caller as a 500 quoting SQL they never wrote. The
        // condition is knowable here, so it is a 400 that names the column and
        // the fix instead.
        if (wantsDistinct && visible) {
            const selected = new Set(Object.keys(visible));
            const missing = sortKeys.map(([field]) => field).filter(field => !selected.has(field));
            if (missing.length > 0) {
                throw ApiError.badRequest(
                    `\`distinct\` cannot sort by ${missing.map(f => `'${f}'`).join(", ")}: a DISTINCT read `
                    + "can only be ordered by columns it returns, or the rows it collapses have no "
                    + `defined order. Add ${missing.map(f => `'${f}'`).join(", ")} to \`fields\`, or drop them `
                    + "from `orderBy`.",
                    "DISTINCT_ORDER_BY_NOT_SELECTED",
                    { fields: missing }
                );
            }
        }

        // Vector search overrides ORDER BY with distance (ascending = closest first)
        const orderExpressions = vectorMeta
            ? [asc(vectorMeta.orderBy), desc(idField)]
            : this.buildOrderExpressions(
                this.resolveOrderKeys(table, sortKeys, collection, options.searchString),
                idField,
                !wantsDistinct
            );
        if (orderExpressions.length > 0) query = query.orderBy(...orderExpressions);

        if (options.startAfter) {
            // Keyset seeking on the REST path. `startAfter` arrived on this
            // signature from the beginning and was never read here, so
            // `?after=` reached the driver and paged nothing: the cursor was
            // decoded, handed over, and dropped one function short of the
            // comparison built to consume it.
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
}
