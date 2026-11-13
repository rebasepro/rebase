import { and, asc, count, desc, eq, getTableColumns, gt, is, isNotNull, isNull, lt, or, sql, SQL } from "drizzle-orm";
import { AnyPgColumn, PgTable, PgTimestamp, PgTimestampString } from "drizzle-orm/pg-core";
import { FilterValues, INCLUDE_COUNT_KEY, isPercentileFraction, JUNCTION_PIVOT_KEY, MAX_INCLUDE_DEPTH, OrderByTuple, type RelationDescriptor, LogicalCondition, parseRelationAggregateSort } from "@rebasepro/types";
import { isTimeZoneName } from "@rebasepro/types";
import type { ColumnDescriptor } from "@rebasepro/types";
import { isJsNumberType } from "@rebasepro/common";
import type { DriverAggregate, DriverAggregateGroup, IncludeSpec, NullsPlacement, ReadOperation, ReadQuery, VectorSearchParams } from "@rebasepro/types";
import { apiHiddenKeys, includableRelations, queryableColumnKeys, unknownAggregateField, unknownIncludeRelation, unknownOrderByField, unknownProjectionField, normalizeDriverOrderBy, normalizeInclude, encodeCursor, type IncludeNode, type NormalizedInclude } from "@rebasepro/common";
import { generateForeignKeyName, toWireKey } from "@rebasepro/utils";
import { DrizzleConditionBuilder, getUnknownFilterFieldsMode, listedColumnKeys, type FilterCompilationOptions } from "../utils/drizzle-conditions";
import { currentFieldViewer, namesHiddenFromCaller } from "./field-viewer";
import { assertReadRequestReadable } from "./read-field-access";
import { enableIterativeScan, inTransaction, iterativeScansAvailable } from "./vector-iterative-scan";
import {
    columnAtKey,
    getColumnMeta,
    requireTableAt,
    pgTableOf,
    getPrimaryKeys,
    requirePrimaryKeys,
    deriveRowAddress,
    parseIdValues,
    idCanAddressTable,
    rowIdentityCondition,
    primaryKeyColumns,
    buildCompositeId,
    COMPOSITE_ID_SEPARATOR,
    type PrimaryKeyInfo
} from "./collection-helpers";
import { RelationService } from "./RelationService";
import { DrizzleClient } from "../interfaces";
import { PostgresTableRegistry } from "../model/PostgresTableRegistry";
import { toRestRow, canReadRelation } from "./row-pipeline";
import { visibleColumnProjection } from "./hidden-columns";
import type { RuntimeTable } from "../model/runtime-table";
import { isNestedPath, resolveNestedPath, type NestedPathHop } from "./nested-path";
import { relatedRowsOrder } from "./relation-tables";
// One rule, one place. See `soft-delete.ts` for why every read has to ask.
import { andSoftDelete, withSoftDelete, type WithDeleted } from "./soft-delete";
import { beforeQueryCondition, beforeQueryConditions, hasBeforeQuery, type ReadCallContextProvider } from "./read-scope";
import { ApiError, logger } from "@rebasepro/server";
import { reachedDatabase } from "../utils/pg-error-utils";


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
 * Service for handling all row read operations.
 * Handles fetching, searching, counting, and filtering rows.
 */
/**
 * Which aggregate aliases hold a number that Postgres handed back as a string.
 *
 * `count`, `sum` and `avg` always do: bigint and numeric are returned as text
 * because they do not fit a JS number in general. `min` and `max` are uncast,
 * so they do it too — but only over a numeric column, and those are the two
 * functions that also apply to text and dates.
 *
 * Decided by the column's Postgres type (a numeric kind), not by trying
 * `Number()` on the value.
 * `?select=avg(price),max(price)` used to answer `{avg_price: 5,
 * max_price: "8.5"}` — one column, two functions, two JSON types, and
 * arithmetic on the second one silently concatenates. Parsing whatever looks
 * numeric would fix that and break something worse: a `min(sku)` of `"00123"`
 * would come back as `123`, a different value, and no NaN check would catch it.
 *
 * Exported to be tested: the parsing itself needs a database, this decision
 * does not.
 */
export function numericAggregateAliases(
    aggregates: DriverAggregate[],
    columns: ReadonlyMap<string, ColumnDescriptor>
): Set<string> {
    const isNumberField = (field?: string): boolean => {
        const column = field === undefined ? undefined : columns.get(field);
        return column !== undefined && isJsNumberType(column.type);
    };
    return new Set(
        aggregates
            .filter(a =>
                a.fn === "count" || a.fn === "sum" || a.fn === "avg" || a.fn === "countDistinct" || a.fn === "percentile"
                || ((a.fn === "min" || a.fn === "max" || a.fn === "mode") && isNumberField(a.field)))
            .map(a => a.alias)
    );
}

/**
 * Refuse a read that names a relation property its caller may not read.
 *
 * The relation-shaped twin of the REST refusal of `?fields=salary`
 * (`assertQueryFieldsReadable`): a nested URL (`/departments/1/members`, and
 * `/departments/1/members/7` — is 7 one of them?) hands over the property's
 * value, its related rows; an aggregate sort (`orderBy=count(members)`) orders
 * the parents by it. An `include` omits such a relation instead (see
 * {@link canReadRelation} in `loadIncludes`), as the row strip omits any
 * withheld field from a row; a request that *names* one as what to read or
 * sort by is refused, naming it — field names are public, values are not.
 *
 * Except a private relation's name (`{ private: true }`), which is not public.
 * Its callers answer it as a relation the table does not declare before they
 * get here, so reaching this with one is a missed door — refused all the same.
 */
function assertRelationReadable(
    runtime: RuntimeTable,
    key: string,
    relation: RelationDescriptor,
    use: string
): void {
    if (canReadRelation(relation)) return;
    throw ApiError.badRequest(
        `'${key}' is not readable on table '${runtime.slug}' with your roles, so it cannot be used in ${use}.`,
        "FIELD_NOT_READABLE",
        {
            collection: runtime.slug,
            fields: [key],
            violations: [{ field: key, code: "access", message: `'${key}' is not readable with your roles.` }]
        }
    );
}

/**
 * What `fingerprint()` computes over a table's row versions, from their tuple
 * headers alone: no column is read, decoded or turned into text.
 *
 * Every row version has the xmin of the transaction that wrote it: an insert
 * or an update adds a new one, a delete takes one away. The count and the xmin
 * sum alone are linear, and cancel: a transaction that deletes one row,
 * updates another and inserts a third keeps both whenever the two xmins it
 * removed add up to twice its own, which two concurrent sessions reach. So
 * each version also adds a hash of its xmin, which no such arithmetic
 * cancels: a write only ever adds versions under its own new xid, so the
 * multiset of xmins after it can never equal the one before. The xmin alone,
 * and not the ctid beside it, because a materialized view's collection is a
 * view over its stored rows that passes their `xmin` through and no `ctid`.
 */
export function rowVersionsFingerprint(xmin: SQL): SQL {
    return sql`md5(count(*)::text || ':' || coalesce(sum(${xmin}::text::bigint), 0)::text || ':' || coalesce(sum(hashtext(${xmin}::text)::bigint), 0)::text)`;
}

/**
 * The column types `percentile_cont` orders by: anything that casts to
 * `double precision`, and `interval`. A text or a timestamp column is a
 * Postgres error at execution time, so it is refused before the statement.
 */
const PERCENTILE_TYPES = /^(smallint|integer|int[248]?|bigint|smallserial|serial[248]?|bigserial|real|float[48]?|double precision|numeric|decimal|interval)\b/i;

/**
 * Refuse a `percentile` the statement could not compute, as the 400 the REST
 * parser answers: a `p` that is not a fraction of at most three decimals (the
 * key names three, so a fourth made two percentiles share one key), or a column
 * that is not a number. Here, not only in the parser, because the in-process
 * SDK hands its aggregates straight to the driver.
 */
function assertPercentileComputable(aggregate: DriverAggregate, column: AnyPgColumn | SQL): void {
    if (!isPercentileFraction(aggregate.p)) {
        throw ApiError.badRequest(
            `\`percentile\` needs a fraction from 0 to 1 with at most three decimals, e.g. ` +
            `\`percentile(${aggregate.field ?? "field"},0.95)\`; got ${String(aggregate.p)}.`,
            "INVALID_AGGREGATE_SELECT"
        );
    }
    // A JSON path is read as numeric for percentile (`jsonLeafFor`), so only a
    // column has a type to check.
    if (is(column, SQL)) return;
    const type = column.getSQLType();
    if (!PERCENTILE_TYPES.test(type)) {
        throw ApiError.badRequest(
            `\`percentile\` is defined on a number or interval column, and '${aggregate.field}' is ${type}.`,
            "INVALID_AGGREGATE_SELECT"
        );
    }
}

export class FetchService {
    private relationService: RelationService;

    constructor(
        private db: DrizzleClient,
        private registry: PostgresTableRegistry,
        /**
         * How this service's reads reach the identity their `beforeQuery` hooks
         * run as. Passed by the driver that constructed it; absent only in a
         * test, where a collection declaring the hook is refused rather than
         * read unnarrowed. See `read-scope.ts`.
         */
        private callContext?: ReadCallContextProvider
    ) {
        this.relationService = new RelationService(db, registry, callContext);
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
        const runtime = this.registry.tableAt(collectionPath);
        return {
            owner: runtime,
            registry: this.registry,
            sourceIdColumn: runtime ? this.resolveIdColumn(runtime, table) : undefined
        };
    }

    /**
     * The conditions this collection's `beforeQuery` hooks ask to add, for a
     * read that is about to be compiled.
     *
     * Resolved here, from the registry this service already holds, rather than
     * handed in by a caller — so a read path that builds a WHERE cannot serve
     * one of these collections without the hook. `[]` when nothing is declared,
     * which leaves the compiled SQL byte-identical.
     *
     * Every caller pushes the result onto the same `allConditions` array its
     * own filter goes into, and every one of those arrays is AND-ed. That is
     * what keeps a hook additive: it is not trusted to narrow, it is only ever
     * given a way to.
     */
    private narrowRead(
        collectionPath: string,
        runtime: RuntimeTable,
        table: PgTable<any>,
        operation: ReadOperation,
        query: ReadQuery
    ): Promise<SQL[]> {
        return beforeQueryConditions(
            { registry: this.registry, callContext: this.callContext },
            runtime, collectionPath, table as PgTable<never>,
            { operation, query }, this.filterContext(collectionPath, table)
        );
    }

    /** {@link narrowRead}, pre-combined, for the reads that hold one `SQL`. */
    private narrowReadCondition(
        collectionPath: string,
        runtime: RuntimeTable,
        table: PgTable<any>,
        operation: ReadOperation,
        query: ReadQuery
    ): Promise<SQL | undefined> {
        return beforeQueryCondition(
            { registry: this.registry, callContext: this.callContext },
            runtime, collectionPath, table as PgTable<never>,
            { operation, query }, this.filterContext(collectionPath, table)
        );
    }

    /**
     * The read the hooks are shown, from the options a read path was given.
     *
     * Transport is left out on purpose — a `databaseId`, an `include` tree, a
     * `withDeleted` flag are not part of "which rows". What is in is what a
     * scope might reasonably branch on.
     */
    private static describeRead(options: {
        filter?: ReadQuery["filter"];
        logical?: LogicalCondition;
        searchString?: string;
        limit?: number;
        offset?: number;
        orderBy?: string | OrderByTuple[];
        order?: "desc" | "asc";
        fields?: string[];
        relatedTo?: NestedPathHop;
    }): ReadQuery {
        const orderBy = normalizeDriverOrderBy(options.orderBy, options.order);
        return {
            filter: options.filter,
            logical: options.logical,
            searchString: options.searchString,
            limit: options.limit,
            offset: options.offset,
            orderBy: orderBy && orderBy.length > 0 ? orderBy : undefined,
            fields: options.fields,
            relatedTo: options.relatedTo
                ? {
                    parentSlug: options.relatedTo.parent.slug,
                    parentId: options.relatedTo.parentId,
                    relationName: options.relatedTo.relation.name
                }
                : undefined
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
    private resolveIdColumn(runtime: RuntimeTable, table: PgTable<any>): AnyPgColumn | undefined {
        const [idInfo] = getPrimaryKeys(runtime, this.registry);
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

    /**
     * A filter and a logical group as conditions, compiled as a read compiles
     * them: for a write whose rows the filter chooses (`updateWhere`,
     * `deleteWhere`).
     */
    buildWriteConditions(
        filter: FilterValues<string> | undefined,
        logical: LogicalCondition | undefined,
        table: PgTable<any>,
        collectionPath: string
    ): SQL[] {
        const conditions = filter ? this.buildFilterConditions(filter, table, collectionPath) : [];
        if (logical) {
            const condition = DrizzleConditionBuilder.buildLogicalConditions(
                logical, table, collectionPath, this.filterContext(collectionPath, table)
            );
            if (condition) conditions.push(condition);
        }
        return conditions;
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
     * is an unknown field and gets the same 400 as every other typo, which is the
     * behaviour that matters: a sort that is silently dropped returns 200 with
     * rows in arbitrary order, and paging over that repeats and skips rows.
     */
    static readonly SCORE_FIELD = "_score";

    /**
     * The distance a vector search attaches to every row it serves, and to no
     * other. Like `_score` it is computed per query and stored nowhere.
     */
    static readonly DISTANCE_FIELD = "_distance";

    private resolveOrderTarget(
        table: PgTable<any>,
        orderBy: string,
        runtime?: RuntimeTable,
        searchString?: string
    ): AnyPgColumn | SQL | undefined {
        if (orderBy === FetchService.SCORE_FIELD && runtime && searchString) {
            const rank = DrizzleConditionBuilder.buildSearchRankExpression(searchString, table, runtime.descriptor);
            if (rank) return rank;
        }
        return this.resolveOrderByField(table, orderBy, runtime);
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
        runtime: RuntimeTable | undefined,
        collectionPath: string | undefined,
        cursorId?: unknown
    ): SQL | undefined {
        const spec = parseRelationAggregateSort(orderBy);
        if (!spec) return undefined;
        if (!runtime || !collectionPath) {
            throw ApiError.badRequest(
                `Cannot sort by '${orderBy}': an aggregate sort needs the collection it is written against, ` +
                "and this query carries none.",
                "ORDER_BY_FIELD_NOT_SORTABLE",
                { field: orderBy }
            );
        }
        // Ordering the parents by a relation's count is a reading of it, as
        // `orderBy=salary` is of a column. An unknown relation is left to the
        // builder below, which refuses it naming the ones there are.
        // A relation the API does not have is the builder's to refuse too, as
        // the unknown relation it is for this caller.
        const sorted = namesHiddenFromCaller(runtime.descriptor).has(spec.relation)
            ? undefined
            : runtime.relations.get(spec.relation);
        if (sorted) assertRelationReadable(runtime, spec.relation, sorted, "`orderBy`");
        const primaryKeys = getPrimaryKeys(runtime, this.registry);
        const idColumn = primaryKeys.length === 1
            ? table[primaryKeys[0].fieldName as keyof typeof table] as AnyPgColumn
            : undefined;
        if (!idColumn) {
            throw ApiError.badRequest(
                `Cannot sort by '${orderBy}' on table '${collectionPath}': the subquery correlates on a ` +
                "single key column, and this collection has none or has a composite one.",
                "ORDER_BY_FIELD_NOT_SORTABLE",
                { field: orderBy, collection: collectionPath }
            );
        }
        return DrizzleConditionBuilder.buildRelationAggregateExpression(
            spec, table, runtime, this.registry, idColumn, collectionPath, cursorId
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
        runtime?: RuntimeTable,
        searchString?: string,
        collectionPath?: string,
        cursorId?: unknown
    ): ResolvedOrderKey[] {
        const resolved: ResolvedOrderKey[] = [];
        for (const [field, direction, nulls] of keys) {
            // Checked before the column path: an aggregate key is not a column
            // name and would otherwise be reported as a typo'd one.
            const aggregate = this.resolveAggregateOrderTarget(table, field, runtime, collectionPath);
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
                            table, field, runtime, collectionPath, cursorId
                        )
                    })
                });
                continue;
            }
            const target = this.resolveOrderTarget(table, field, runtime, searchString);
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
     * The full `ORDER BY`: the caller's keys, then the primary key.
     *
     * The key is always last and always descending, every column of it. It is
     * not decoration — it is what makes the ordering *total*, and a cursor over
     * a non-total order repeats and skips rows among the ties. Every keyset
     * comparison built by {@link buildCursorConditions} ends on the same key
     * `DESC`, and the two have to agree: they did not, and an ascending sort
     * paged with `id >` against an `ORDER BY … , id DESC`, so rows sharing a
     * sort value were dropped from every page after the first. Nor is the
     * first column of a composite key enough: it ties every row that shares
     * it, which is exactly the rows a cursor then skipped.
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
        /**
         * The primary key columns, appended as the final tie-breaker.
         *
         * Empty for a `SELECT DISTINCT`, which does not select the key: Postgres
         * requires every ORDER BY expression of a distinct read to be in the
         * select list and answers a bare `42P10` otherwise. There is also
         * nothing for it to do there — a distinct read returns a set of values,
         * not rows, so there are no ties between rows to break.
         */
        keyColumns: AnyPgColumn[]
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
        for (const column of keyColumns) expressions.push(desc(column));
        return expressions as SQL[];
    }

    private resolveOrderByField(
        table: PgTable<any>,
        orderBy: string,
        runtime?: RuntimeTable
    ): AnyPgColumn | undefined {
        const columnAt = (key: string): AnyPgColumn | undefined => columnAtKey(table, key);

        const direct = columnAt(orderBy);
        if (direct) return direct;

        // Owning relation, resolved: the relation names its own local key.
        const declaredRelation = runtime ? runtime.relations.get(orderBy) : undefined;
        if (declaredRelation?.kind === "belongsTo") {
            // `localKey` is the column; the table is keyed by the column's key.
            const foreignKey = columnAt(declaredRelation.localField);
            if (foreignKey) return foreignKey;
        }

        // No collection in hand — the shapes an owning relation's key takes by
        // default (e.g. `project` → `projectId`, `userProfile` →
        // `userProfileId`), then the snake forms for a project that authored the
        // property under its column name. Only then, for the reason the filter
        // resolution gives: with a collection, a guess sorts on a column under
        // a name the field-access check never saw.
        if (!runtime) {
            for (const guess of [
                `${orderBy}Id`,
                toWireKey(generateForeignKeyName(orderBy)),
                `${orderBy}_id`,
                generateForeignKeyName(orderBy)
            ]) {
                const foreignKey = columnAt(guess);
                if (foreignKey) return foreignKey;
            }
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
        const collectionName = runtime?.slug;
        const onCollection = collectionName ? ` on table '${collectionName}'` : "";

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

        // The REST check answers a private sort key with the same function, so
        // a hidden column and a typo cannot be told apart.
        const answer = unknownOrderByField(
            orderBy, collectionName, listedColumnKeys(table, runtime?.descriptor)
        );
        throw ApiError.badRequest(answer.message, "UNKNOWN_ORDER_BY_FIELD", answer.details);
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
        runtime: RuntimeTable,
        tree: Record<string, IncludeNode>,
        wildcard: boolean
    ): { key: string; node: IncludeNode; relation: RelationDescriptor }[] {
        const owner = runtime;
        const out: { key: string; node: IncludeNode; relation: RelationDescriptor }[] = [];

        if (wildcard) {
            // `*` is "every relation, one hop", tab-only relations included.
            // The admin panel names the relations its properties render and
            // sends `*` only when it cannot resolve them in the browser. A
            // relation also named explicitly keeps its options.
            for (const [key, relation] of owner.relations) {
                out.push({ key, node: tree[key] ?? { children: {} }, relation });
            }
        }

        for (const [key, node] of Object.entries(tree)) {
            if (wildcard && owner.relations.has(key)) continue;
            const relation = owner.relations.get(key);
            if (!relation) {
                // The REST check answers an include of a private relation
                // with the same function, and neither lists one.
                const answer = unknownIncludeRelation(
                    key, runtime.slug, includableRelations(owner.descriptor)
                );
                throw ApiError.badRequest(answer.message, "UNKNOWN_RELATION", answer.details);
            }
            out.push({ key, node, relation });
        }

        return out;
    }

    /**
     * Resolve every level of an include tree against the collections, without
     * loading anything — the 400 for an unknown relation, decided before the
     * read rather than by it.
     *
     * {@link loadIncludes} resolves a level only once it has rows to load it
     * onto. On its own that made the refusal depend on the data: a typo in
     * `include` against an empty table, under a filter that matched nothing,
     * or below a relation that loaded no rows answered 200, and the same
     * request became a 400 the first time a row matched.
     */
    private assertIncludeResolvable(
        runtime: RuntimeTable,
        include: NormalizedInclude,
        depth = 1
    ): void {
        if (depth > MAX_INCLUDE_DEPTH) return;
        const levels = this.resolveIncludeLevel(runtime, include.tree, include.wildcard);
        this.assertCountsAllowed(runtime, levels);
        for (const { node, relation } of levels) {
            if (Object.keys(node.children).length === 0) continue;
            this.assertIncludeResolvable(
                this.registry.requireTable(relation.target), { wildcard: false, tree: node.children }, depth + 1
            );
        }
    }

    /**
     * The extra `WHERE` an include's own `where`/`logical` puts on the target.
     *
     * Pushed into the batch query rather than applied to the rows it returns:
     * filtering afterwards reads every related row of every parent to throw
     * most of them away, and on a to-many relation that is the whole table.
     */
    private includeNarrowing(node: IncludeNode, targetRuntime: RuntimeTable): SQL | undefined {
        if (!node.where && !node.logical) return undefined;
        const targetPath = targetRuntime.slug;
        const targetTable = pgTableOf(targetRuntime, this.registry);
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
     * Refuse a `count` the loader cannot serve honestly, before anything runs.
     *
     * - On a to-one relation: there is nothing to count past a row or none,
     *   and answering 0 or 1 under `_count` would invent a shape for it.
     * - On a collection with a property named `_count`: the total would be
     *   written over that column's value. A silent overwrite answers 200 with
     *   the column gone, so it is a 400 naming why.
     */
    private assertCountsAllowed(
        runtime: RuntimeTable,
        levels: { key: string; node: IncludeNode; relation: RelationDescriptor }[]
    ): void {
        const counted = levels.filter(({ node }) => node.count);
        if (counted.length === 0) return;
        const collectionName = runtime.slug;
        for (const { key, relation } of counted) {
            if (relation.cardinality === "one") {
                throw ApiError.badRequest(
                    `Cannot count relation '${key}' on table '${collectionName}': ` +
                    "it is a to-one relation. `count` totals the rows of a to-many relation.",
                    "INVALID_INCLUDE",
                    { relation: key, collection: collectionName }
                );
            }
        }
        if (runtime.columnsByKey.has(INCLUDE_COUNT_KEY) || runtime.relations.has(INCLUDE_COUNT_KEY)) {
            throw ApiError.badRequest(
                `Cannot serve \`count\` on table '${collectionName}': it declares a column named ` +
                `'${INCLUDE_COUNT_KEY}', which is where the totals would go.`,
                "INVALID_INCLUDE",
                { collection: collectionName, field: INCLUDE_COUNT_KEY }
            );
        }
    }

    /**
     * Cap and project the rows of ONE relation, per parent.
     *
     * The order and the limit are Postgres's: the batch loader ranks each
     * parent's related rows by the include's `orderBy` and reads back only the
     * ones within its `limit` (see
     * {@link RelationService.batchFetchRelatedEntitiesMany}), so `rows`
     * arrives sorted and already cut. The slice here is what holds the limit
     * where a `via` chain reaches one target along two paths — those rows share
     * a rank — and it costs nothing where nothing is left to cut.
     */
    private shapeRelatedRows(
        rows: Record<string, unknown>[],
        node: IncludeNode,
        targetRuntime: RuntimeTable
    ): Record<string, unknown>[] {
        let out = rows;
        if (node.limit !== undefined && out.length > node.limit) out = out.slice(0, node.limit);
        if (node.fields && node.fields.length > 0) {
            const keep = new Set(node.fields);
            // The key always survives: a related row nobody can address cannot
            // be followed, updated or deduplicated by the caller.
            for (const pk of getPrimaryKeys(targetRuntime, this.registry)) keep.add(pk.fieldName);
            // So does the link's own data. `fields` narrows the TARGET's
            // columns — it is keyed off the target's collection and validated
            // against it — and `_pivot` is not one of them: dropping it would
            // make `include=members&fields=id` silently lose the `role` that is
            // the reason the relation carries a payload at all.
            keep.add(JUNCTION_PIVOT_KEY);
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
        runtime: RuntimeTable,
        collectionPath: string,
        include: NormalizedInclude,
        depth = 1
    ): Promise<void> {
        if (depth === 1) this.assertIncludeResolvable(runtime, include);
        if (rows.length === 0 || depth > MAX_INCLUDE_DEPTH) return;

        const idInfoArray = getPrimaryKeys(runtime, this.registry);
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

        const requested = this.resolveIncludeLevel(runtime, include.tree, include.wildcard);
        this.assertCountsAllowed(runtime, requested);

        // A relation property this caller may not read is withheld whole: not
        // loaded, so neither embedded nor counted — absent from the row, as the
        // strip leaves any withheld field. Decided here, the one loader every
        // door reaches (REST, `POST …/query`, the in-process SDK, socket fetches
        // and subscriptions), and at every level of a nested include. The REST
        // rows were stripped before this runs, so the strip cannot catch it.
        const levels = requested.filter(({ relation }) => canReadRelation(relation));

        for (const { key, node, relation } of levels) {
            // The target's lowered collection, looked up by the relation's
            // target slug, for the readers still on one (filters, codecs).
            const targetRuntime = this.registry.requireTable(relation.target);
            // Deliberately unguarded: a `where` inside an include that names a
            // column the target does not have is the caller's mistake, and it
            // is already an ApiError. Anything else is not this loop's to
            // swallow either, so both travel to the caller untouched.
            const narrow: SQL | undefined = this.includeNarrowing(node, targetRuntime);

            // Rows loaded at this level, to recurse into. Collected as the
            // objects actually attached to the parents, so a nested include
            // mutates what the caller will see rather than a copy of it.
            const loaded: Record<string, unknown>[] = [];

            try {
                if (relation.cardinality === "one") {
                    // Rendered by the loader exactly as the target's own route
                    // renders it (`toRestRow`). The rows go along so a `belongsTo` takes each foreign
                    // key from the row rather than selecting it again.
                    const results = await this.relationService.batchFetchRelatedEntities(
                        collectionPath, rowIds, key, relation, narrow, { parentRows: addressable }
                    );
                    for (const row of addressable) {
                        const related = results.get(String(addressOf(row)));
                        // `null`, not "absent": a to-one relation that reaches
                        // nothing is a fact about the row, and leaving the key
                        // off makes it indistinguishable from not having asked.
                        if (!related) { row[key] = null; continue; }
                        const [shaped] = this.shapeRelatedRows([related.values], node, targetRuntime);
                        row[key] = shaped;
                        loaded.push(shaped);
                    }
                } else {
                    // The include's own order and limit, which the loader
                    // applies per parent in SQL — and, for `count`, the totals
                    // the same statement counts before the limit.
                    const totals = node.count ? new Map<string, number>() : undefined;
                    const window = node.limit !== undefined || (node.orderBy && node.orderBy.length > 0) || totals
                        ? { limit: node.limit, orderBy: node.orderBy, totals }
                        : undefined;
                    const results = await this.relationService.batchFetchRelatedEntitiesMany(
                        collectionPath, rowIds, key, relation, narrow, window
                    );
                    for (const row of addressable) {
                        const address = String(addressOf(row));
                        const related = results.get(address) ?? [];
                        if (totals) {
                            // Without a limit nothing was cut: the total is
                            // the related rows themselves, one per target.
                            const total = node.limit !== undefined
                                ? totals.get(address) ?? 0
                                : new Set(related.map(e => String(e.id))).size;
                            const counts = (row[INCLUDE_COUNT_KEY] ??= {}) as Record<string, number>;
                            counts[key] = total;
                        }
                        const shaped = this.shapeRelatedRows(
                            // The junction's own columns ride along under
                            // `_pivot` — the link's data, not the target's, so
                            // it is nested rather than merged: two posts sharing
                            // a tag see one tag row and two different links, and
                            // a flattened `role` would collide with a column of
                            // the target's own. It is not part of the target's
                            // REST rendering for the same reason: the target's
                            // collection does not describe the link's columns.
                            related.map(e => (e.pivot ? { ...e.values, [JUNCTION_PIVOT_KEY]: e.pivot } : e.values)),
                            node, targetRuntime
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
                    loaded, targetRuntime, targetRuntime.slug, children, depth + 1
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
        runtime: RuntimeTable,
        fields: string[] | undefined,
        idInfoArray: { fieldName: string; type: "string" | "number" }[],
        distinct?: boolean
    ): Record<string, AnyPgColumn> | undefined {
        const visible = visibleColumnProjection<AnyPgColumn>(getTableColumns(table), runtime.descriptor);
        if (!fields || fields.length === 0) return visible;

        let tableColumns: Record<string, AnyPgColumn>;
        try {
            tableColumns = getTableColumns(table);
        } catch {
            // Not a real drizzle table — a stub in a test, a derived path. No
            // projection is the right answer, as it is for the exclusions.
            return visible;
        }
        const available = visible ?? tableColumns;

        const keep = new Set(fields);
        if (!distinct) for (const pk of idInfoArray) keep.add(pk.fieldName);
        const relations = runtime.relations;

        const projection: Record<string, AnyPgColumn> = {};
        for (const name of keep) {
            const column = available[name];
            if (column !== undefined) { projection[name] = column; continue; }
            // Present on the table but not in `available` means it was excluded
            // — hidden, and staying hidden. Absent from both is a typo.
            if (tableColumns[name] !== undefined) continue;
            // A relation is not a column: `include` loads it, and naming it in
            // `fields` too is how a caller says to return it. Read as a typo,
            // `fields=title,author&include=author` was a 400 on every door.
            if (relations?.has(name)) continue;
            // The REST check answers a private column with the same function,
            // so a hidden column and a typo cannot be told apart.
            const answer = unknownProjectionField(
                name, runtime.slug, queryableColumnKeys(runtime.descriptor)
            );
            throw ApiError.badRequest(answer.message, "UNKNOWN_FIELD", answer.details);
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
        // A vector read orders by distance whatever `orderBy` says, so the same
        // holds for its rows — which are the ones carrying a distance.
        if (FetchService.DISTANCE_FIELD in row) return undefined;
        try {
            const runtime = requireTableAt(collectionPath, this.registry);
            const pks = getPrimaryKeys(runtime, this.registry);
            if (pks.length === 0) return undefined;
            const address = buildCompositeId(row, pks);
            if (!address || !address.split(COMPOSITE_ID_SEPARATOR).some(part => part !== "")) return undefined;
            // A single key's own value, so it compares against the column as
            // it came; a composite key's whole address, because the keyset
            // comparison ends on every key column and the first alone ties
            // every row that shares it.
            return encodeCursor(orderBy, row, pks.length === 1 ? row[pks[0].fieldName] : address);
        } catch {
            // A path with no registered collection — a nested or derived one.
            // No cursor is the honest answer; the listing pages by offset.
            return undefined;
        }
    }

    /**
     * Extract cursor pagination conditions from startAfter options.
     *
     * "Every row that sorts after this one", written out as a comparison over
     * the same keys the `ORDER BY` uses and ending on the same primary key,
     * descending. With one sort key that is the familiar
     * `k > v OR (k = v AND id < cursorId)`; with several it nests, each key's
     * tie handing the decision to the next.
     */
    private buildCursorConditions(
        table: PgTable<any>,
        idInfoArray: PrimaryKeyInfo[],
        options: { orderBy?: string | OrderByTuple[]; order?: "desc" | "asc"; startAfter?: Record<string, unknown> },
        collectionPath: string
    ): SQL[] {
        if (!options.startAfter) return [];
        const cursor = options.startAfter;
        const keys = normalizeDriverOrderBy(options.orderBy, options.order);
        const keyColumns = FetchService.keyColumns(table, idInfoArray, collectionPath);
        const cursorKey = FetchService.cursorKey(cursor, idInfoArray, collectionPath);

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
            const runtime = requireTableAt(collectionPath, this.registry);
            const resolved = this.resolveOrderKeys(
                table, keys, runtime, undefined, collectionPath,
                // An aggregate key correlates on a single key column — a
                // composite-key collection is refused one — so only a single
                // key's value can pin its subquery to the cursor row.
                cursorKey?.length === 1 ? cursorKey[0] : undefined
            );

            if (resolved.length > 0 && cursorKey) {
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
                    const seekValues = values.map((value, i) =>
                        this.preciseCursorValue(table, resolved[i].target, value, keyColumns, cursorKey));
                    return [this.buildKeysetComparison(resolved, seekValues, keyColumns, cursorKey)];
                }
            }
        } else if (cursorKey) {
            return [FetchService.keyAfter(keyColumns, cursorKey)];
        }

        return [];
    }

    /** The table's primary key columns, in key order. */
    private static keyColumns(table: PgTable<any>, idInfoArray: PrimaryKeyInfo[], collectionPath: string): AnyPgColumn[] {
        return idInfoArray.map(info => {
            const column = table[info.fieldName as keyof typeof table] as AnyPgColumn | undefined;
            if (!column) {
                throw new Error(`ID field '${info.fieldName}' not found in table '${collectionPath}'`);
            }
            return column;
        });
    }

    /**
     * The cursor row's key, one value per key column — or `undefined` for a
     * cursor that names no row.
     *
     * A cursor carries the row's address, which for a composite key is every
     * part joined (see {@link cursorFor}). One that carries fewer parts than
     * the key has columns — the first column's value alone, say — cannot say
     * which row it stopped at, and is refused rather than read as a guess.
     */
    private static cursorKey(
        cursor: Record<string, unknown>,
        idInfoArray: PrimaryKeyInfo[],
        collectionPath: string
    ): unknown[] | undefined {
        const address = cursor.id;
        if (idInfoArray.length === 1) {
            const value = address ?? cursor[idInfoArray[0].fieldName];
            return value === undefined || value === null ? undefined : [value];
        }
        if (address === undefined || address === null) {
            const parts = idInfoArray.map(info => cursor[info.fieldName]);
            return parts.some(part => part === undefined || part === null) ? undefined : parts;
        }
        let parsed: Record<string, string | number>;
        try {
            parsed = parseIdValues(String(address), idInfoArray);
        } catch {
            throw ApiError.badRequest(
                `Invalid cursor: its row id does not name every key column of '${collectionPath}' ` +
                `(${idInfoArray.map(info => info.fieldName).join(", ")}). Pass back the \`nextCursor\` ` +
                "from the previous page unchanged — it is opaque and must not be built by hand.",
                "INVALID_CURSOR"
            );
        }
        return idInfoArray.map(info => parsed[info.fieldName]);
    }

    /**
     * "Sorts after the cursor row" on the key alone: the key descending, as the
     * `ORDER BY` ends.
     *
     * Every column runs the same direction, so for a composite key the
     * row-value comparison is exactly the lexicographic order the `ORDER BY`
     * produces.
     */
    private static keyAfter(keyColumns: AnyPgColumn[], cursorKey: unknown[]): SQL {
        if (keyColumns.length === 1) return lt(keyColumns[0], cursorKey[0]);
        const values = keyColumns.map((column, i) => sql.param(cursorKey[i], column));
        return sql`(${sql.join(keyColumns, sql`, `)}) < (${sql.join(values, sql`, `)})`;
    }

    /**
     * The cursor row's value for a timestamp key, to the microsecond.
     *
     * A cursor is built from the row as served, and a timestamp is served to
     * the millisecond while Postgres stores it to the microsecond. Seeking past
     * the served value compares the column against something up to 999µs short
     * of the cursor row's own, so every row in that sliver lands on the wrong
     * side of it: paging `createdAt desc` over rows written in one transaction
     * stopped after the first page, and ascending repeated the cursor row
     * forever.
     *
     * So the exact value is read back from the cursor row by its key — but only
     * while that row still holds the millisecond the cursor carries. A row
     * deleted or re-stamped since the page was served falls back to the stored
     * value, which is where the listing was when the cursor was issued.
     *
     * Any other key, and a NULL, is returned as it came.
     */
    private preciseCursorValue(
        table: PgTable<any>,
        target: AnyPgColumn | SQL,
        value: unknown,
        keyColumns: AnyPgColumn[],
        cursorKey: unknown[]
    ): unknown {
        if (value === null || value === undefined) return value;
        if (!is(target, PgTimestamp) && !is(target, PgTimestampString)) return value;
        // A column that keeps no more than milliseconds is served whole.
        if (target.precision !== undefined && target.precision <= 3) return value;

        const stored = sql`CAST(${value instanceof Date ? value.toISOString() : String(value)} AS ${sql.raw(target.getSQLType())})`;
        const alias = sql.identifier("__cursor_row");
        const column = sql`${alias}.${sql.identifier(target.name)}`;
        const cursorRow = sql.join(keyColumns.map((key, i) =>
            sql`${alias}.${sql.identifier(key.name)} = ${sql.param(cursorKey[i], key)}`), sql` AND `);
        return sql`COALESCE((SELECT ${column} FROM ${table} AS ${alias} WHERE ${cursorRow} AND ${column} >= ${stored} AND ${column} < ${stored} + INTERVAL '1 millisecond' LIMIT 1), ${stored})`;
    }

    /**
     * "Sorts strictly after the cursor row", over `keys` and then the primary key.
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
        keyColumns: AnyPgColumn[],
        cursorKey: unknown[],
        index = 0
    ): SQL {
        // Past the last key, the primary key settles it. It is ordered `DESC`,
        // so "after" the cursor row means a smaller key.
        if (index >= keys.length) return FetchService.keyAfter(keyColumns, cursorKey);

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
        const rest = this.buildKeysetComparison(keys, values, keyColumns, cursorKey, index + 1);

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
    /**
     * The order a nested listing (`authors/1/posts`) reads in: the caller's,
     * when it names one, else the order the relation declares
     * (`rel.hasMany(target, { orderBy })`). Passed down as the read's own
     * `orderBy`, so the cursor of a paged listing is built on the same keys.
     */
    private static nestedOrder(
        hop: NestedPathHop | undefined,
        orderBy: string | OrderByTuple[] | undefined
    ): string | OrderByTuple[] | undefined {
        if (!hop || (orderBy !== undefined && orderBy.length > 0)) return orderBy;
        return relatedRowsOrder(hop.relation) ?? orderBy;
    }

    private buildRelationScope(hop: NestedPathHop): SQL {
        // The rows of this relation, reached by URL rather than by `include`.
        assertRelationReadable(hop.parent, hop.relationKey, hop.relation, "a nested path");
        const parentPks = requirePrimaryKeys(hop.parent, this.registry);
        const parsedParent = parseIdValues(hop.parentId, parentPks);
        // What a single-column link compares against. A link from a composite
        // key has no such value, and `findRelationDefects` refuses one at boot.
        const parsedParentId = parsedParent[parentPks[0].fieldName];

        // The parent row by every key column, for the shapes that read it.
        const parent = () => {
            const table = pgTableOf(hop.parent, this.registry);
            const columns = primaryKeyColumns(table, parentPks, hop.parent.slug);
            return {
                table,
                key: columns.map((column, i) => ({ column, value: parsedParent[parentPks[i].fieldName] }))
            };
        };

        const targetTable = pgTableOf(hop.target, this.registry);
        const targetPks = requirePrimaryKeys(hop.target, this.registry);
        const targetIdColumn = targetTable[targetPks[0].fieldName as keyof typeof targetTable] as AnyPgColumn;
        if (!targetIdColumn) {
            throw new Error(`ID field '${targetPks[0].fieldName}' not found in table '${hop.target.slug}'`);
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
        // "Is row 7 one of this parent's members" is the relation's value one
        // row at a time — the same reading the listing below is refused.
        assertRelationReadable(hop.parent, hop.relationKey, hop.relation, "a nested path");
        return this.relationService.isRelated(hop, id);
    }

    /**
     * Every row of a collection's table, as stored, a page at a time, in key
     * order — the driver's `scanStoredRows`.
     *
     * Deliberately none of the read pipeline: no `beforeQuery` (a sweep has no
     * caller to scope to, and the documented hook narrows a caller-less read to
     * the rows owned by nobody), no soft-delete filter, no `afterRead`, no
     * field stripping. The columns come back under their table names; a sweep
     * reads values, not keys. Paged by the key rather than an offset, so a row
     * deleted during the scan never shifts another past the next page.
     */
    async *scanStoredRows(collectionPath: string, pageSize = 500): AsyncGenerator<Record<string, unknown>[]> {
        const runtime = requireTableAt(collectionPath, this.registry);
        const table = pgTableOf(runtime, this.registry);
        const keys = primaryKeyColumns(table, requirePrimaryKeys(runtime, this.registry), collectionPath);
        const keyNames = keys.map(column => {
            const entry = Object.entries(getTableColumns(table)).find(([, candidate]) => candidate === column);
            if (!entry) throw new Error(`Key column '${column.name}' not found in table '${collectionPath}'`);
            return entry[0];
        });
        const limit = Math.max(1, pageSize);

        let after: unknown[] | undefined;
        for (;;) {
            // (k1 > v1) OR (k1 = v1 AND k2 > v2) OR … — the row after `after`.
            const past = after
                ? or(...keys.map((column, i) => and(
                    ...keys.slice(0, i).map((earlier, j) => eq(earlier, (after as unknown[])[j])),
                    gt(column, (after as unknown[])[i])
                )))
                : undefined;
            const query = this.db.select().from(table);
            const rows: Record<string, unknown>[] = await (past ? query.where(past) : query)
                .orderBy(...keys.map(column => asc(column)))
                .limit(limit);
            if (rows.length > 0) yield rows;
            if (rows.length < limit) return;
            const last = rows[rows.length - 1];
            after = keyNames.map(name => last[name]);
        }
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
        const effectivePath = hop ? hop.target.slug : collectionPath;

        const runtime = requireTableAt(effectivePath, this.registry);
        this.assertCallerMayRead(runtime.slug, options);
        const table = pgTableOf(runtime, this.registry);

        let query = this.db.select({ count: count() }).from(table).$dynamic();
        const allConditions: SQL[] = [];

        if (hop) allConditions.push(this.buildRelationScope(hop));

        // Soft delete. A listing that filters and a count that does not is a
        // page saying "1 of 4 results".
        withSoftDelete(allConditions, runtime, table, options.withDeleted);

        if (options.searchString) {
            const searchConditions = DrizzleConditionBuilder.buildSearchConditions(
                options.searchString, table, runtime.descriptor
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

        // The same narrowing the listing applies. A `beforeQuery` honoured by
        // one and not the other is a page reading "1 of 4 results" — the same
        // failure mode as the soft-delete condition above, which is why they sit
        // together.
        allConditions.push(...await this.narrowRead(
            effectivePath, runtime, table, "count",
            FetchService.describeRead({ ...options, relatedTo: hop })
        ));

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
            const vectorMeta = DrizzleConditionBuilder.buildVectorSearchConditions(table, options.vectorSearch, runtime.descriptor);
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
            aggregates: DriverAggregate[];
            groupBy?: (string | DriverAggregateGroup)[];
            filter?: FilterValues<Extract<keyof M, string>>;
            logical?: LogicalCondition;
            searchString?: string;
            limit?: number;
            /** Groups to skip. Applied only to a grouped aggregate, like `limit`. */
            offset?: number;
            /**
             * Sort for the groups: by a `groupBy` field or an aggregate's alias.
             * Applied only to a grouped aggregate; see {@link aggregateOrdering}.
             */
            orderBy?: OrderByTuple[];
            /** See `FetchCollectionProps.withDeleted`. */
            withDeleted?: WithDeleted;
        }
    ): Promise<Record<string, unknown>[]> {
        const runtime = requireTableAt(collectionPath, this.registry);
        this.assertCallerMayRead(runtime.slug, { filter: options.filter, logical: options.logical });
        const table = pgTableOf(runtime, this.registry);
        const columns = getTableColumns(table);
        const hidden: ReadonlySet<string> = currentFieldViewer() === undefined
            ? new Set()
            : apiHiddenKeys(runtime.descriptor);

        const columnFor = (field: string, forWhat: string): AnyPgColumn => {
            // A private column is a column the API does not have: an API
            // caller naming one gets the typo's answer, which lists no
            // private column — the REST check answers with the same function.
            const column = hidden.has(field) ? undefined : columns[field as keyof typeof columns] as AnyPgColumn | undefined;
            if (!column) {
                const answer = unknownAggregateField(field, forWhat, listedColumnKeys(table, runtime.descriptor));
                throw ApiError.badRequest(answer.message, "UNKNOWN_AGGREGATE_FIELD", answer.details);
            }
            // An aggregate over a column reads it: a role-restricted one is
            // refused for a caller without the role.
            this.assertCallerMayRead(runtime.slug, { fields: [field] });
            return column;
        };

        // A JSON path's value — `props->>players` — as text, or as a number
        // for the functions that add values up; a value that is not a number
        // is left out, as a numeric filter on the path leaves it out.
        const jsonLeafFor = (field: string, numeric: boolean): SQL | undefined => {
            const path = field.includes("->") ? field.split(/->>?/).map(segment => segment.trim()).filter(Boolean) : [];
            if (path.length < 2) return undefined;
            const [columnKey, ...keys] = path;
            const column = columnFor(columnKey, field);
            const sqlType = column.getSQLType?.() ?? "";
            if (sqlType !== "jsonb" && sqlType !== "json") {
                throw ApiError.badRequest(
                    `'${field}' reads inside '${columnKey}', which is ${sqlType || "not a JSON column"} on "${collectionPath}".`,
                    "UNKNOWN_AGGREGATE_FIELD"
                );
            }
            // The keys as literals, not parameters: a group's expression is
            // written twice — SELECT and GROUP BY — and two parameters are
            // two different expressions to Postgres.
            const literal = (key: string): SQL => sql.raw(`'${key.replace(/'/g, "''")}'`);
            let expression: SQL = sql`${column}`;
            for (const key of keys.slice(0, -1)) expression = sql`${expression} -> ${literal(key)}`;
            const leaf = sql`(${expression} ->> ${literal(keys[keys.length - 1])})`;
            return numeric ? sql`CASE WHEN ${leaf} ~ '^-?[0-9]+(\.[0-9]+)?$' THEN ${leaf}::numeric END` : leaf;
        };
        const NUMERIC_FUNCTIONS = new Set<DriverAggregate["fn"]>(["sum", "avg", "percentile"]);

        const selection: Record<string, SQL> = {};
        const groupKeys = new Set((options.groupBy ?? []).map(group => typeof group === "string" ? group : group.key));
        const aliases = new Set<string>();

        for (const aggregate of options.aggregates) {
            // A key named twice, or a group's, would overwrite a value in
            // the row. Derived keys only collide when `as` is left off two
            // aggregates of one function, which only a filter makes useful.
            if (aliases.has(aggregate.alias) || groupKeys.has(aggregate.alias)) {
                throw ApiError.badRequest(
                    `Two values of this aggregate would come back as '${aggregate.alias}'. Name one with \`as\`.`,
                    "INVALID_AGGREGATE_SELECT",
                    { alias: aggregate.alias }
                );
            }
            aliases.add(aggregate.alias);
            const filtered = aggregate.filter ? this.buildFilterConditions(aggregate.filter, table, collectionPath) : [];
            if (aggregate.filter && aggregate.fn === "fingerprint") {
                throw ApiError.badRequest(
                    "`fingerprint()` covers the rows the query matches; narrow it with the query's own `where`.",
                    "INVALID_AGGREGATE_SELECT"
                );
            }
            // `FILTER (WHERE …)`: only the rows it matches count towards
            // this one aggregate.
            const filterClause = (extra?: SQL): SQL => {
                const conditions = [...(extra ? [extra] : []), ...filtered];
                return conditions.length > 0 ? sql` FILTER (WHERE ${and(...conditions)})` : sql``;
            };
            if (aggregate.fn === "count" && !aggregate.field) {
                selection[aggregate.alias] = sql`count(*)${filterClause()}`;
                continue;
            }
            if (aggregate.fn === "fingerprint") {
                // A plain view stores no row versions to read; a materialized
                // view does, and its refresh writes new ones.
                if (runtime.descriptor.kind === "view" && !runtime.descriptor.view?.materialized) {
                    throw ApiError.badRequest(
                        `\`fingerprint()\` reads the versions of stored rows, and "${runtime.slug}" is a view that stores none. ` +
                        "Fingerprint the tables it reads, or make it a materialized view.",
                        "INVALID_AGGREGATE_SELECT"
                    );
                }
                selection[aggregate.alias] = rowVersionsFingerprint(sql`${table}.xmin`);
                continue;
            }
            const column: AnyPgColumn | SQL = jsonLeafFor(aggregate.field as string, NUMERIC_FUNCTIONS.has(aggregate.fn))
                ?? columnFor(aggregate.field as string, `${aggregate.fn}()`);
            const where = filterClause();
            switch (aggregate.fn) {
                case "count": selection[aggregate.alias] = sql`count(${column})${where}`; break;
                // Cast through numeric so what comes back is a string this
                // method parses, rather than a float whose precision depends on
                // the column type — `avg` over an integer column is otherwise
                // one shape here and another there.
                case "sum": selection[aggregate.alias] = sql`(sum(${column})${where})::numeric`; break;
                case "avg": selection[aggregate.alias] = sql`(avg(${column})${where})::numeric`; break;
                case "min": selection[aggregate.alias] = sql`min(${column})${where}`; break;
                case "max": selection[aggregate.alias] = sql`max(${column})${where}`; break;
                case "countDistinct": selection[aggregate.alias] = sql`count(DISTINCT ${column})${where}`; break;
                case "mode": selection[aggregate.alias] = sql`mode() WITHIN GROUP (ORDER BY ${column})${where}`; break;
                case "percentile":
                    assertPercentileComputable(aggregate, column);
                    selection[aggregate.alias] = sql`(percentile_cont(${aggregate.p ?? 0.5}::float8) WITHIN GROUP (ORDER BY ${column})${where})::numeric`;
                    break;
                // As JSON, so every column type comes back as the same array
                // shape: pg hands some array types over as their literal text.
                case "distinct":
                    selection[aggregate.alias] = sql`coalesce(jsonb_agg(DISTINCT ${column} ORDER BY ${column})${filterClause(sql`${column} IS NOT NULL`)}, '[]'::jsonb)`;
                    break;
            }
        }

        // A transformed group is an expression; `unnest` is a lateral join
        // that turns each row into one row per element.
        const lateral: SQL[] = [];
        const groupColumns = (options.groupBy ?? []).map(group => {
            if (typeof group === "string") return { field: group, column: jsonLeafFor(group, false) ?? columnFor(group, "groupBy") as AnyPgColumn | SQL };
            const column = columnFor(group.field, `${group.transform}()`);
            return { field: group.key, column: this.groupExpression(group, column, lateral, collectionPath) };
        });
        for (const group of groupColumns) {
            selection[group.field] = sql`${group.column}`;
        }

        let query = (lateral.length > 0
            ? this.db.select(selection).from(sql`${table} ${sql.join(lateral, sql` `)}`)
            : this.db.select(selection).from(table)
        ).$dynamic();

        const conditions: SQL[] = [];
        // Soft delete. A dashboard that sums deleted orders is reporting
        // revenue that was withdrawn.
        withSoftDelete(conditions, runtime, table, options.withDeleted);
        if (options.searchString) {
            const searchConditions = DrizzleConditionBuilder.buildSearchConditions(
                options.searchString, table, runtime.descriptor
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
        // An aggregate is an efficient way to learn about rows you cannot
        // select, so it is narrowed by the same hook as the listing. Without
        // this, `count(*)` over a scoped collection reports the unscoped total.
        conditions.push(...await this.narrowRead(
            collectionPath, runtime, table, "aggregate", FetchService.describeRead(options)
        ));
        if (conditions.length > 0) {
            const finalCondition = DrizzleConditionBuilder.combineConditionsWithAnd(conditions);
            if (finalCondition) query = query.where(finalCondition);
        }

        if (groupColumns.length > 0) {
            query = query.groupBy(...groupColumns.map(g => g.column));
            query = query.orderBy(...this.aggregateOrdering(options.orderBy, groupColumns, options.aggregates, selection));
            // Bounded for the same reason a listing is: grouping by a
            // high-cardinality column is a whole table's worth of rows in one
            // response.
            if (options.limit) query = query.limit(options.limit);
            if (options.offset) query = query.offset(options.offset);
        }

        const rows = await query as Record<string, unknown>[];

        // `count`, `sum` and `avg` arrive as strings: Postgres returns bigint
        // and numeric that way because they do not fit a JS number in general.
        // They do fit for every aggregate anyone puts on a dashboard, and a
        // caller handed `"12"` where they expected `12` has to find that out
        // for themselves. Parsed once, here.
        //
        // `min` and `max` over a NUMBER column too, which they were not. Those
        // are uncast, so a `numeric` column returns them as strings — and
        // `?select=avg(price),max(price)` answered `{avg_price: 5,
        // max_price: "8.5"}`: two functions, one column, two JSON types, and
        // arithmetic on the second one silently concatenates.
        //
        // Decided by the column's declared type rather than by trying
        // `Number()` on the value, because `min`/`max` are the two that also
        // apply to text and dates. Parsing whatever happens to look numeric
        // would turn a `min(sku)` of `"00123"` into `123`, which is a different
        // value, and the `Number.isNaN` guard below would not catch it.
        const numericAliases = numericAggregateAliases(
            options.aggregates,
            runtime.columnsByKey
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
     * A transformed group (`AggregateGroup`) as SQL. `lower`/`upper` read the
     * column as text; `year`/`month`/`day` truncate a date or timestamp, in UTC
     * when it has a time zone, to `YYYY`, `YYYY-MM` or `YYYY-MM-DD`; `unnest`
     * adds a lateral join over the array's elements to `lateral` and groups by
     * the element.
     */
    private groupExpression(
        group: DriverAggregateGroup,
        column: AnyPgColumn,
        lateral: SQL[],
        collectionPath: string
    ): SQL {
        const sqlType = column.getSQLType?.() ?? "";
        switch (group.transform) {
            case "lower": return sql`lower(${column}::text)`;
            case "upper": return sql`upper(${column}::text)`;
            case "year":
            case "month":
            case "day": {
                if (!/^(timestamp|date)/.test(sqlType)) {
                    throw ApiError.badRequest(
                        `\`${group.transform}(${group.field})\` groups a date, and '${group.field}' on "${collectionPath}" is ${sqlType || "not one"}.`,
                        "INVALID_AGGREGATE_GROUP",
                        { field: group.field, transform: group.transform }
                    );
                }
                const format = group.transform === "year" ? "YYYY" : group.transform === "month" ? "YYYY-MM" : "YYYY-MM-DD";
                // A timestamp with a zone is an instant, read in the zone
                // asked for (UTC by default); one without is taken as UTC.
                // A date has no time of day for a zone to move.
                if (group.timeZone !== undefined && !isTimeZoneName(group.timeZone)) {
                    throw ApiError.badRequest(
                        `\`${group.transform}(${group.field})\` was asked for in "${group.timeZone}", which is not a time zone. Use an IANA name such as "Europe/Madrid".`,
                        "INVALID_AGGREGATE_GROUP",
                        { field: group.field, transform: group.transform, timeZone: group.timeZone }
                    );
                }
                // A literal for the reason a JSON key is one; `isTimeZoneName`
                // admits letters, digits and `_ + - /` only.
                const zone = sql.raw(`'${group.timeZone ?? "UTC"}'`);
                const value = sqlType.startsWith("date")
                    ? sql`${column}`
                    : sqlType.includes("with time zone")
                        ? sql`(${column} AT TIME ZONE ${zone})`
                        : group.timeZone ? sql`((${column} AT TIME ZONE 'UTC') AT TIME ZONE ${zone})` : sql`${column}`;
                return sql`to_char(${value}, ${sql.raw(`'${format}'`)})`;
            }
            case "unnest": {
                const meta = getColumnMeta(column);
                const alias = sql.identifier(`unnest_${lateral.length}`);
                if (meta.dataType === "array" || meta.columnType === "PgArray") {
                    lateral.push(sql`CROSS JOIN LATERAL unnest(${column}) AS ${alias}(element)`);
                } else if (sqlType === "jsonb") {
                    lateral.push(sql`CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(${column}) = 'array' THEN ${column} ELSE '[]'::jsonb END) AS ${alias}(element)`);
                } else {
                    throw ApiError.badRequest(
                        `\`unnest(${group.field})\` groups by the elements of an array, and '${group.field}' on "${collectionPath}" is ${sqlType || "not one"}.`,
                        "INVALID_AGGREGATE_GROUP",
                        { field: group.field, transform: group.transform }
                    );
                }
                return sql`${alias}.element`;
            }
        }
    }

    /**
     * The `ORDER BY` of a grouped aggregate: the caller's keys, then every
     * group key they did not name.
     *
     * A grouped aggregate is paged like a listing — `limit` bounds it, so more
     * groups than one page holds are reached with `offset` — and a page is only
     * a page over a total order. With no `ORDER BY` at all, Postgres returns the
     * groups in whatever order its plan produces them, so "the next fifty" was
     * not a thing that existed. The group keys identify a group, so ending on
     * them makes the order total and puts every page boundary in the same place
     * on every request.
     *
     * A key may name a `groupBy` field or an aggregate by its alias
     * (`count`, `sum_total`), sorted on the aggregate's own expression — a
     * drizzle selection is not aliased in the SQL, so there is no output name
     * to refer to. Anything else is a 400: Postgres would refuse it too, but as
     * a `GROUP BY` error from inside the statement.
     */
    private aggregateOrdering(
        orderBy: OrderByTuple[] | undefined,
        groupColumns: { field: string; column: AnyPgColumn | SQL }[],
        aggregates: { alias: string }[],
        selection: Record<string, SQL>
    ): SQL[] {
        const keys: ResolvedOrderKey[] = [];
        const named = new Set<string>();
        for (const [field, direction, nulls] of orderBy ?? []) {
            const group = groupColumns.find(g => g.field === field);
            const aggregate = aggregates.find(a => a.alias === field);
            const target = group?.column ?? (aggregate ? selection[aggregate.alias] : undefined);
            if (!target) {
                const sortable = [...groupColumns.map(g => g.field), ...aggregates.map(a => a.alias)];
                throw ApiError.badRequest(
                    `An aggregate cannot be sorted by '${field}'. It sorts by what it returns: ` +
                    `${sortable.map(name => `'${name}'`).join(", ")}.`,
                    "INVALID_ORDER_BY"
                );
            }
            keys.push({ field, direction, nulls, target });
            named.add(field);
        }
        for (const group of groupColumns) {
            if (!named.has(group.field)) keys.push({ field: group.field, direction: "asc", target: group.column });
        }
        return this.buildOrderExpressions(keys, []);
    }

    /**
     * Check if a field value is unique.
     *
     * Deliberately **not** narrowed by `beforeQuery`, and it is the only read
     * here that is not. The question is whether the value exists anywhere in
     * the table, not whether it exists among the rows this caller can see:
     * narrowed, it would answer "unique" for a value a hidden row already
     * holds, and the insert would then be rejected by the unique constraint
     * with a message about a row the caller has no way to find. Uniqueness is a
     * property of the table.
     */
    async checkUniqueField(
        collectionPath: string,
        fieldName: string,
        value: unknown,
        excludeEntityId?: string,
        _databaseId?: string
    ): Promise<boolean> {
        if (value === undefined || value === null) return true;

        const runtime = requireTableAt(collectionPath, this.registry);
        // A private column is a column the API does not have, and a column
        // the table does not have is never taken (below): the same answer.
        if (currentFieldViewer() !== undefined && apiHiddenKeys(runtime.descriptor).has(fieldName)) return true;
        // "Is this value taken?" is a filter on the column, answered 1 or 0.
        this.assertCallerMayRead(runtime.slug, { filter: { [fieldName]: ["==", value] } });
        const table = pgTableOf(runtime, this.registry);
        const idInfoArray = requirePrimaryKeys(runtime, this.registry);
        const field = table[fieldName as keyof typeof table] as AnyPgColumn;

        if (!field) return true;

        // An address the key columns cannot hold names no row, so there is
        // nothing to exclude — a row being created, for instance.
        const excludeRow = excludeEntityId && idCanAddressTable(excludeEntityId, table, idInfoArray)
            ? rowIdentityCondition(table, idInfoArray, excludeEntityId, collectionPath)
            : undefined;
        const conditions = DrizzleConditionBuilder.buildUniqueFieldCondition(field, value, excludeRow);

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
    /**
     * Refuse a read made on an API caller's behalf that names a column or
     * relation the caller may not read — filter, sort, projection, include
     * (and its `where`), vector search. The trusted server plane (no viewer)
     * is not refused. Every public read of this service passes here first, so
     * an in-process `context.data` under the caller's scope is refused exactly
     * as `GET /api/data` is (see {@link assertReadRequestReadable}).
     */
    private assertCallerMayRead(slug: string, request: Parameters<typeof assertReadRequestReadable>[0]): void {
        const viewer = currentFieldViewer();
        if (viewer === undefined) return;
        assertReadRequestReadable(request, { slug }, viewer, this.registry);
    }

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
        // reach a root one: the target table, narrowed by the relation.
        //
        // The scope (`relatedTo`) is always this method's to derive from the
        // path, never a caller's to send: these options arrive from a socket
        // frame spread whole, and a smuggled `relatedTo` is dropped.
        const requested = { ...options };
        Reflect.deleteProperty(requested, "relatedTo");
        const hop = isNestedPath(collectionPath) ? resolveNestedPath(collectionPath, this.registry) : undefined;
        const path = hop ? hop.target.slug : collectionPath;
        const read = hop
            ? { ...requested, orderBy: FetchService.nestedOrder(hop, requested.orderBy), relatedTo: hop }
            : { ...requested, relatedTo: undefined };

        // `relatedTo` is applied by `fetchRowsWithConditionsRaw`, which builds
        // the scope condition itself.
        const runtime = requireTableAt(path, this.registry);
        this.assertCallerMayRead(runtime.slug, { ...read, include });

        const normalizedInclude = normalizeInclude(include);

        // Base rows first, relations after. One SELECT, then one query per
        // relation per level of the include tree — never one per row, and never
        // the lateral join the relational query API compiles a to-many into.
        const rows = (await this.fetchRowsWithConditionsRaw<M>(path, read))
            .map(row => toRestRow(row, runtime, this.registry));

        if (normalizedInclude) {
            await this.loadIncludes(rows, runtime, path, normalizedInclude);
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

        const runtime = requireTableAt(collectionPath, this.registry);

        // An unknown relation is a 400 before it is a 404: whether the row
        // exists must not decide whether the request was well-formed.
        const normalizedInclude = normalizeInclude(include);
        if (normalizedInclude) this.assertIncludeResolvable(runtime, normalizedInclude);
        const table = pgTableOf(runtime, this.registry);
        const idInfoArray = requirePrimaryKeys(runtime, this.registry);

        // See `fetchOne`: an unaddressable id is a 404, not a database error.
        if (!idCanAddressTable(id, table, idInfoArray)) return null;

        const addressed = rowIdentityCondition(table, idInfoArray, id, collectionPath);

        // Soft delete: a stamped row is a 404 through the REST read too, so
        // `GET /:id` and the listing agree about which rows exist.
        const withDeleted = options?.withDeleted;
        const projection = this.columnProjection(table, runtime, options?.fields, idInfoArray);
        // The REST single get is narrowed by the same hook as the listing, so
        // `find()[0]` and `findById()` agree about which rows exist — and so
        // that a row excluded from a scoped listing cannot be read by guessing
        // its id.
        const narrowing = await this.narrowReadCondition(
            collectionPath, runtime, table, "get",
            FetchService.describeRead({ fields: options?.fields })
        );
        const identity = narrowing
            ? and(addressed, narrowing) as SQL
            : addressed;
        // No projection is every column: without a join, the same query `select()` builds.
        const result = await this.db
            .select(projection ?? getTableColumns(table))
            .from(table)
            .where(andSoftDelete(identity, runtime, table, withDeleted))
            .limit(1);

        if (result.length === 0) return null;

        const row = toRestRow(result[0] as Record<string, unknown>, runtime, this.registry);

        if (normalizedInclude) {
            await this.loadIncludes([row], runtime, collectionPath, normalizedInclude);
        }

        return row;
    }

    /**
     * {@link fetchOneForRest}'s read of a row an INSERT just wrote, taken from
     * the INSERT's own `RETURNING` instead of a second statement — or
     * `undefined` when the two could answer differently.
     *
     * A write answers with `fetchOneForRest(slug, id, undefined, …, { withDeleted: true })`
     * (see `PersistService.save`): the row's visible columns, rendered by
     * `toRestRow`. For a row the statement itself wrote, with nothing written
     * after it, `RETURNING` those same columns is that row — the same values
     * through the same column decoders, in the same order, rendered the same
     * way. One thing narrows the read and not the statement, and keeps the
     * read: a `beforeQuery` adds conditions to it (and runs application code),
     * so a row outside them is no answer today, and would be one from
     * `RETURNING`.
     *
     * Per-field read access does not: the read selects the same columns and
     * withholds what the caller may not read when it renders the row
     * (`toRestRow` → `stripUnreadable`), which is the render here too — so an
     * `excludeFromApi` column is written, and not answered, without a read
     * back per row.
     *
     * Row-level security is the same either way. `INSERT … RETURNING` holds
     * the new row to the table's SELECT policies and refuses one they hide
     * (42501) — which the INSERT's `RETURNING <key>` already did, so returning
     * more columns changes nothing about who may write or read what.
     */
    insertReturning(collectionPath: string): {
        columns: Record<string, AnyPgColumn>;
        render: (returned: Record<string, unknown>) => Record<string, unknown>;
    } | undefined {
        const runtime = requireTableAt(collectionPath, this.registry);
        if (hasBeforeQuery(this.registry, runtime)) return undefined;
        const table = pgTableOf(runtime, this.registry);
        // Not a real drizzle table (a stub in a test): nothing to return, so
        // the read stays.
        const tableColumns: Record<string, AnyPgColumn> | undefined = getTableColumns(table);
        if (!tableColumns) return undefined;
        const idInfoArray = requirePrimaryKeys(runtime, this.registry);
        // The read's projection, kept in the table's column order, so the
        // rendered row has its keys in the order the read gives them.
        const visible = this.columnProjection(table, runtime, undefined, idInfoArray);
        const columns: Record<string, AnyPgColumn> = {};
        for (const [name, column] of Object.entries(tableColumns)) {
            if (!visible || name in visible) columns[name] = column;
        }
        return { columns, render: returned => toRestRow(returned, runtime, this.registry) };
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
        const runtime = requireTableAt(collectionPath, this.registry);
        const table = pgTableOf(runtime, this.registry);
        const idInfoArray = requirePrimaryKeys(runtime, this.registry);

        // A vector read orders by distance, and a distance is computed per
        // query and stored nowhere, so there is no value on the cursor row to
        // seek past. Seeking anyway compared ids under a distance order: page
        // two was the rows with a smaller id, which is not the next page.
        if (options.vectorSearch && options.startAfter) {
            throw ApiError.badRequest(
                "Cursor pagination (`startAfter`) cannot be combined with a vector search. " +
                "Its rows are ordered by a distance computed per query, which cannot key a cursor. " +
                "Use `limit`/`offset` for the next page of nearest rows.",
                "VECTOR_CURSOR_UNSUPPORTED"
            );
        }

        // A vector read runs with pgvector's iterative index scan, which has to
        // be set in a transaction — see `vector-iterative-scan.ts`. This
        // driver's request-scoped copies already read in one; the base driver,
        // on the pool, is given one, read-only, and reads again inside it.
        const iterative = options.vectorSearch !== undefined
            && await iterativeScansAvailable(this.db, this.registry);
        if (iterative && !inTransaction(this.db)) {
            return this.db.transaction(
                (tx) => new FetchService(tx, this.registry, this.callContext).fetchRowsWithConditionsRaw(collectionPath, options),
                { accessMode: "read only" }
            );
        }

        let vectorMeta: { orderBy: SQL; filter?: SQL; distanceSelect: SQL } | undefined;
        if (options.vectorSearch) {
            vectorMeta = DrizzleConditionBuilder.buildVectorSearchConditions(table, options.vectorSearch, runtime.descriptor);
        }

        // A generated search column is an index in column form; `SELECT *`
        // would ship it to every caller. The projection is undefined — and the
        // SQL therefore unchanged — for any table without one. `fields`
        // narrows it further, in SQL rather than after the fact.
        const visible = this.columnProjection(table, runtime, options.fields, idInfoArray, options.distinct === true);

        // Relevance, alongside the row, exactly as `_distance` rides along with
        // a vector search. Present only when the collection opted in and the
        // request carried a search string, so a caller can order by it, show
        // it, or blend it with a score of their own.
        const rankSelect = options.searchString
            ? DrizzleConditionBuilder.buildSearchRankExpression(options.searchString, table, runtime.descriptor)
            : undefined;

        // Only when asked: a `ts_headline` per declared field per row.
        const matchesSelect = options.searchString && options.searchExplain
            ? DrizzleConditionBuilder.buildSearchMatchesExpression(options.searchString, table, runtime.descriptor)
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
                ? builder(visible).from(table).$dynamic()
                : builder().from(table).$dynamic();
        };

        let query = vectorMeta
            ? this.db.select({ table_row: (visible ?? table),
_distance: vectorMeta.distanceSelect }).from(table).$dynamic()
            : rankSelect
                ? this.db.select({
                    table_row: (visible ?? table),
                    _score: rankSelect,
                    ...(matchesSelect ? { _matches: matchesSelect } : {})
                }).from(table).$dynamic()
                : selectFrom();
        const allConditions: SQL[] = [];

        if (options.relatedTo) allConditions.push(this.buildRelationScope(options.relatedTo));

        // Soft delete, on the `db.select` path. Both paths serve the same
        // request, so a deleted row must not come back down one and not the
        // other — which is exactly what happens when each grows its own filter.
        withSoftDelete(allConditions, runtime, table, options.withDeleted);

        if (options.searchString) {
            const searchConditions = DrizzleConditionBuilder.buildSearchConditions(
                options.searchString, table, runtime.descriptor
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

        // This is the one place this pipeline builds a WHERE, so it is the one
        // place the hook has to be applied for the listing, the search, the
        // vector read, the nested-path listing and the realtime refetch.
        allConditions.push(...await this.narrowRead(
            collectionPath, runtime, table, "list", FetchService.describeRead(options)
        ));

        // A vector `threshold` is not a WHERE condition here. The rows come
        // back closest first whatever the plan, so the ones within it are the
        // front of the page — and are cut from it below, after the read. As a
        // condition it was applied to the index's candidates after the scan,
        // like any filter, and under an iterative scan a page asking for more
        // rows than lie within the threshold made the index walk on to its
        // scan limit looking for them: 22 ms against 1 ms for the same page
        // (20,000 rows × 256 dimensions). Cut afterwards, the page and its
        // offset are the same rows either way — those within the threshold
        // are a prefix of the ordering — and no scan looks past the page.

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
        const keyColumns = FetchService.keyColumns(table, idInfoArray, collectionPath);
        const orderExpressions = vectorMeta
            ? [asc(vectorMeta.orderBy), ...keyColumns.map(column => desc(column))]
            : this.buildOrderExpressions(
                // `collectionPath` too: an aggregate over a relation
                // (`count(applications)`) resolves its subquery against it, and
                // without it every such sort on this path — the REST list, the
                // SDK's `find()` — was refused as a query that "carries none".
                this.resolveOrderKeys(table, sortKeys, runtime, options.searchString, collectionPath),
                wantsDistinct ? [] : keyColumns
            );
        if (orderExpressions.length > 0) query = query.orderBy(...orderExpressions);

        if (options.startAfter) {
            // Keyset seeking on the REST path. `startAfter` arrived on this
            // signature from the beginning and was never read here, so
            // `?after=` reached the driver and paged nothing: the cursor was
            // decoded, handed over, and dropped one function short of the
            // comparison built to consume it.
            const cursorConditions = this.buildCursorConditions(table, idInfoArray, options, collectionPath);
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

        if (iterative) await enableIterativeScan(this.db);

        const rawResults = await query;

        if (vectorMeta) {
            const threshold = options.vectorSearch?.threshold;
            return (rawResults as { table_row: Record<string, unknown>; _distance: unknown }[])
                .map(r => ({
                    ...r.table_row,
                    _distance: typeof r._distance === "number" ? r._distance : parseFloat(String(r._distance))
                }))
                // `<`, as the SQL condition was: a row at exactly the threshold
                // is outside it, and so is a NaN distance (a zero vector's
                // cosine), which Postgres also orders above every number.
                .filter(row => threshold == null || row._distance < threshold);
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
