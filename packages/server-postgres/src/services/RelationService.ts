import { and, eq, getTableColumns, inArray, lte, or, sql, SQL } from "drizzle-orm";
import { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { DrizzleClient } from "../interfaces";
import type { CollectionConfig, FilterValues, OrderByTuple, RelationDescriptor } from "@rebasepro/types";
import { joinConditions, type JoinStep } from "@rebasepro/types";
import type { RelationOfKind } from "@rebasepro/common";
import { DrizzleConditionBuilder, joinColumn } from "../utils/drizzle-conditions";
import {
    getCollectionByPath,
    parseIdValues,
    buildCompositeId,
    rowIdentityCondition,
    primaryKeyColumns,
    type PrimaryKeyInfo
} from "./collection-helpers";
import {
    catalogueTableOf,
    columnKeyOf,
    joinsOnNaturalKey,
    keysOfTable,
    pointsBack,
    relationTarget,
    requireRelation,
    sourceKeyField,
    type PointsBackRelation
} from "./relation-tables";
import type { RuntimeTable } from "../model/runtime-table";
import { parseDataFromServer } from "../data-transformer";
import { stripUnreadable, toRestRow } from "./row-pipeline";
import { hiddenColumnsOption } from "../schema/search-column";
import { PostgresTableRegistry } from "../model/PostgresTableRegistry";
import type { NestedPathHop } from "./nested-path";
import { bindThroughJunction, readPivotColumns } from "./junction-writes";
// A soft-deleted row must not come back through a relation either: a deleted
// comment reappearing under its post is the same bug as one reappearing in the
// listing. See `soft-delete.ts`.
import { andSoftDelete, softDeleteCondition } from "./soft-delete";
import { beforeQueryCondition, type ReadCallContextProvider } from "./read-scope";

/**
 * Typed wrapper for Drizzle dynamic query innerJoin.
 * Drizzle's `$dynamic()` queries lose the `innerJoin` method from
 * their static type, but it exists at runtime. This helper bridges
 * the gap with a single confined cast.
 *
 * Exported so `data-transformer` uses this one rather than restating the same
 * fact — it double-cast `query.innerJoin(...)` to `typeof query`, which is
 * the same claim about the same drizzle behaviour in a second spelling.
 */
export function applyDynamicJoin<T>(query: T, joinTable: PgTable, condition: SQL): T {
    return (query as unknown as { innerJoin(t: PgTable, c: SQL): T }).innerJoin(joinTable, condition) as T;
}

/**
 * The ON condition of one `joinPath` step: every `from` column equal to its
 * `to` column, or `undefined` naming the first column either table lacks.
 *
 * `on.from`/`on.to` are a column or a tuple, and a tuple is how a step joins on
 * a composite key. Comparing the first pair alone joined each row to every row
 * sharing that column — every locale of a translation, not the one addressed.
 *
 * A step listing several conditions joins on any one of them, OR-ed: a row
 * that meets two of them is still one row of an inner join, so a link held in
 * either of two columns is read once either way.
 */
export function joinStepCondition(
    currentTable: PgTable,
    joinTable: PgTable,
    step: Pick<JoinStep, "on">
): { condition: SQL } | { missing: string } {
    const alternatives: SQL[] = [];
    for (const on of joinConditions(step)) {
        const from = Array.isArray(on.from) ? on.from : [on.from];
        const to = Array.isArray(on.to) ? on.to : [on.to];
        const pairs: SQL[] = [];
        for (let i = 0; i < Math.max(from.length, to.length); i++) {
            const fromColumn = from[i] ?? "(none)";
            const toColumn = to[i] ?? "(none)";
            // By SQL name or property key: a generated table keys `order_id` as
            // `orderId`, and a step names the column. See `joinColumn`.
            const fromCol = joinColumn(currentTable, fromColumn);
            const toCol = joinColumn(joinTable, toColumn);
            if (!fromCol || !toCol) return { missing: `${fromColumn} -> ${toColumn}` };
            pairs.push(eq(fromCol, toCol));
        }
        alternatives.push(pairs.length === 1 ? pairs[0] : and(...pairs)!);
    }
    return { condition: alternatives.length === 1 ? alternatives[0] : or(...alternatives)! };
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
    return DrizzleConditionBuilder.buildRelationQuery(...args) as T;
}

/**
 * The relation's own matching condition, AND-ed with an include's `where`.
 *
 * Written once because the batch loaders reach the same decision from six
 * places — one per relation kind, twice over for the to-one and to-many
 * variants — and a `where` dropped from one of them is a filter the caller
 * asked for that silently did not apply.
 */
function narrowed(base: SQL, narrow?: SQL): SQL {
    return narrow ? and(base, narrow)! : base;
}

/**
 * Two optional conditions, AND-ed: either, both, or neither.
 *
 * The include's own `where` and the target collection's `beforeQuery` arrive
 * separately and are both optional, and they have to reach the loaders as one
 * condition because that is the shape every relation kind threads through.
 */
function narrowBoth(a?: SQL, b?: SQL): SQL | undefined {
    if (a && b) return and(a, b)!;
    return a ?? b;
}

/**
 * What an include asks of ONE to-many relation's rows, per parent: how many,
 * and in what order. See {@link RelationService.batchFetchRelatedEntitiesMany}.
 */
export interface RelatedRowWindow {
    /** Rows to keep per parent. */
    limit?: number;
    /** Their order, by the target's own columns. */
    orderBy?: OrderByTuple[];
    /**
     * Filled, when given and a `limit` is set, with each parent's number of
     * matching related rows *before* the limit — what `include: { x: { limit,
     * count: true } }` serves under `_count`. Counted in the ranking subquery,
     * so it is the same statement, the same conditions and the same RLS
     * context as the rows. A parent with no related row is absent (zero).
     * Without a limit nothing is cut, and the caller counts what it got.
     */
    totals?: Map<string, number>;
}

/**
 * How the batch loaders render a target row.
 *
 * - `"admin"` — the view model the admin panel reads: declared types parsed
 *   (`parseDataFromServer`), the target's own to-one relations as
 *   `{ __type: "relation" }` refs, undeclared columns dropped.
 * - `"rest"` — the row the target's own route serves (`toRestRow`): what an
 *   `include` embeds. The REST contract is that a developer never sees a ref,
 *   and an included row is rendered exactly as the same row is at the top
 *   level.
 */
export type RelatedRowStyle = "admin" | "rest";

/** The alias of the subquery a limited relation read joins back to. */
const RANKED = "__ranked";

/**
 * The order one parent's related rows come in: the include's own keys, then
 * the target's key ascending.
 *
 * The key ascending is the order an unordered batch read handed rows back in
 * on an append-only table, and so the rows a `limit` with no `orderBy` kept —
 * stated now rather than left to the plan. A key that names no column of the
 * target sorts nothing, as it sorted nothing when the sort ran over the
 * returned rows in JavaScript; the caller's field access on it was already
 * judged at the route.
 *
 * NULLs go where a top-level `orderBy` puts them: the stated placement, else
 * Postgres's own (last ascending, first descending).
 */
export function relatedRowOrder(targetTable: PgTable, targetKeys: AnyPgColumn[], orderBy: OrderByTuple[] | undefined): SQL[] {
    const columns = getTableColumns(targetTable);
    const order: SQL[] = [];
    for (const [field, direction, nulls] of orderBy ?? []) {
        const column = Object.prototype.hasOwnProperty.call(columns, field) ? columns[field] : undefined;
        if (!column) continue;
        const nullsLast = nulls ? nulls === "last" : direction === "asc";
        if (direction === "desc") {
            order.push(nullsLast ? sql`${column} DESC NULLS LAST` : sql`${column} DESC NULLS FIRST`);
        } else {
            order.push(nullsLast ? sql`${column} ASC NULLS LAST` : sql`${column} ASC NULLS FIRST`);
        }
    }
    for (const key of targetKeys) order.push(sql`${key} ASC`);
    return order;
}

/**
 * The SELECT list of a ranked-keys subquery: the columns that identify one
 * related row under one parent, each under its own alias, and the row's rank
 * among that parent's related rows.
 *
 * `dense_rank`, not `row_number`: a `via` chain can reach the same target from
 * one parent along two paths, and those rows tie on every key, so they share a
 * rank and count once against the limit — the same multiplicity the unlimited
 * read serves them with.
 */
function rankedKeyFields(
    keys: AnyPgColumn[],
    partitionBy: AnyPgColumn[],
    order: SQL[],
    /**
     * Also select the partition's number of related rows, as `total` — set
     * for `include: { x: { count: true } }`.
     *
     * - `"rows"`: `count(*)`, where each related row is one row of the
     *   subquery (a foreign key on the target).
     * - the target's key columns: distinct keys, where one target can appear
     *   twice — a `via` chain reaching it along two paths, a junction without
     *   a key on its pair linking it twice. Those rows tie on rank and count
     *   once against the limit, so they count once here too. `count(DISTINCT
     *   …) OVER` does not exist, so it is the classic pair of ranks: ascending
     *   plus descending over the key, less one, is the number of distinct keys
     *   in the partition.
     */
    total?: "rows" | AnyPgColumn[]
): Record<string, SQL.Aliased<unknown>> {
    const fields: Record<string, SQL.Aliased<unknown>> = {};
    keys.forEach((key, i) => {
        fields[`k${i}`] = sql`${key}`.as(`__k${i}`);
    });
    const partition = sql.join(partitionBy, sql`, `);
    fields.rank = sql`dense_rank() over (partition by ${partition} order by ${sql.join(order, sql`, `)})`.as("__rank");
    if (total === "rows") {
        fields.total = sql<number>`(count(*) over (partition by ${partition}))::int`.as("__total");
    } else if (total) {
        const ascending = sql.join(total.map(key => sql`${key} ASC`), sql`, `);
        const descending = sql.join(total.map(key => sql`${key} DESC`), sql`, `);
        fields.total = sql<number>`(dense_rank() over (partition by ${partition} order by ${ascending}) + dense_rank() over (partition by ${partition} order by ${descending}) - 1)::int`.as("__total");
    }
    return fields;
}

/**
 * Record one parent's total from a ranked row, for {@link RelatedRowWindow.totals}.
 *
 * Every row of a parent carries the same total, so the first one seen wins and
 * the rest are a no-op.
 */
function recordTotal(window: RelatedRowWindow | undefined, parentId: string, row: Record<string, unknown>): void {
    if (!window?.totals || window.totals.has(parentId)) return;
    const total = (row[RANKED] as { total?: unknown } | undefined)?.total;
    if (total !== undefined && total !== null) window.totals.set(parentId, Number(total));
}

/**
 * A related record resolved by {@link RelationService}: the target row's
 * values plus the identity (`id`) and originating table (`path`, its slug)
 * needed to build relation references. Internal to the postgres driver —
 * flattened to plain rows at the fetch-service boundary.
 */
export interface RelatedRow<M extends Record<string, unknown> = Record<string, unknown>> {
    id: string | number;
    path: string;
    values: M;
    /**
     * The link's own columns, for a `manyToMany` that declares a `pivot`.
     * Absent for every other relation kind and for a junction that carries
     * nothing but its two keys.
     *
     * Kept beside `values` rather than merged into them, because it is not the
     * target's data: two posts sharing a tag see the same tag row and different
     * links. The include pipeline serves it under
     * {@link JUNCTION_PIVOT_KEY}.
     */
    pivot?: Record<string, unknown>;
}

/**
 * The two ends of one relation read, resolved once: the parent and target
 * runtime tables, the catalogue tables statements are built on, and the key
 * columns rows are addressed by.
 */
interface RelationEnds {
    parent: RuntimeTable;
    parentTable: PgTable;
    parentPks: PrimaryKeyInfo[];
    parentIdCol: AnyPgColumn;
    target: RuntimeTable;
    targetTable: PgTable;
    targetPks: PrimaryKeyInfo[];
    targetIdField: AnyPgColumn;
    /**
     * The target's lowered collection, for the subsystems that still render a
     * row from one (the view-model codec, the field strip, `beforeQuery`).
     * Looked up by the target's slug — never through the relation.
     */
    targetCollection: CollectionConfig;
}

/** The row a joined select keyed under `table`, or the row itself for a plain select. */
function rowOf(row: Record<string, unknown>, table: string): Record<string, unknown> {
    return (row[table] as Record<string, unknown> | undefined) || row;
}

/** The last table a `via` chain reaches: the target's, as the chain names it. */
function viaEndTable(relation: RelationOfKind<"via">): string {
    return relation.steps[relation.steps.length - 1].table;
}

export class RelationService {
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
    ) { }

    /** The runtime table a parent path names (`getCollectionByPath` resolves aliases and reports unknown paths). */
    private tableAt(path: string): RuntimeTable {
        return this.registry.requireTable(getCollectionByPath(path, this.registry).slug);
    }

    private ends(parent: RuntimeTable, relation: RelationDescriptor): RelationEnds {
        const target = relationTarget(this.registry, relation);
        const targetTable = catalogueTableOf(this.registry, target);
        const targetPks = keysOfTable(this.registry, target);
        const parentTable = catalogueTableOf(this.registry, parent);
        const parentPks = keysOfTable(this.registry, parent);
        return {
            parent,
            parentTable,
            parentPks,
            parentIdCol: parentTable[parentPks[0].fieldName as keyof typeof parentTable] as AnyPgColumn,
            target,
            targetTable,
            targetPks,
            targetIdField: targetTable[targetPks[0].fieldName as keyof typeof targetTable] as AnyPgColumn,
            targetCollection: getCollectionByPath(target.slug, this.registry)
        };
    }

    /**
     * The **target** table's `beforeQuery` narrowing, for rows reached
     * through a relation.
     *
     * The target's, not the parent's, because these are the target's rows: a
     * scope on `comments` has to hold whether they are listed at
     * `/comments` or loaded as `post.comments`. Without this an `include` is a
     * way around every row filter a table declares — the exact hole
     * `stripUnreadable` was once missing from the relation-ref branch.
     *
     * Folded into the `narrow` condition the loaders already thread through
     * every relation kind, so a `via` join, a junction, a foreign key and the
     * dynamic relation builder all apply it or none of them do.
     */
    private narrowTargetRead(
        parent: RuntimeTable,
        relation: RelationDescriptor,
        parentId?: string | number
    ): Promise<SQL | undefined> {
        const target = relationTarget(this.registry, relation);
        const targetCollection = getCollectionByPath(target.slug, this.registry);
        const targetTable = catalogueTableOf(this.registry, target);
        return beforeQueryCondition(
            { registry: this.registry, callContext: this.callContext },
            targetCollection,
            target.slug,
            targetTable as PgTable<never>,
            {
                operation: "relation",
                query: {
                    relatedTo: {
                        parentSlug: parent.slug,
                        parentId,
                        relationName: relation.name
                    }
                }
            },
            { collection: targetCollection, registry: this.registry }
        );
    }

    /**
     * The target rows a caller may see through `relation`: the target's
     * `beforeQuery` scope and its soft delete, as one condition on the target
     * table, or `undefined` when neither applies.
     *
     * What every loader here narrows a read by, exposed for the membership
     * writes. A write that diffs a new link set against "what is linked now"
     * has to diff against what the caller could have read — otherwise saving
     * back the list they were shown unlinks every row they were not.
     */
    async visibleTargetCondition(
        parent: RuntimeTable,
        relation: RelationDescriptor,
        parentId?: string | number
    ): Promise<SQL | undefined> {
        const target = relationTarget(this.registry, relation);
        return andSoftDelete(
            await this.narrowTargetRead(parent, relation, parentId),
            target,
            catalogueTableOf(this.registry, target)
        );
    }

    /**
     * One target row, as the {@link RelatedRow} everything here returns.
     *
     * `resolveNested` is the one thing the call sites do not agree on, and on
     * purpose: the single-parent fetches pass `db` and `registry` to
     * `parseDataFromServer`, so the target's *own* relations get resolved too,
     * while the batch paths deliberately do not — a query per target row is
     * the N+1 the batching exists to avoid.
     */
    private async toRelatedRow<M extends Record<string, unknown>>(
        targetRow: Record<string, unknown>,
        targetCollection: CollectionConfig,
        targetPks: PrimaryKeyInfo[],
        options?: {
            resolveNested?: boolean;
            /** The REST rendering, when the caller asked for it — see {@link restRendering}. */
            rest?: (row: Record<string, unknown>) => Record<string, unknown>;
        }
    ): Promise<RelatedRow<M>> {
        let values: Record<string, unknown>;
        if (options?.rest) {
            values = options.rest(targetRow);
        } else {
            values = options?.resolveNested
                ? await parseDataFromServer(targetRow, this.registry.requireTable(targetCollection.slug), targetCollection, this.db, this.registry)
                : await parseDataFromServer(targetRow, this.registry.requireTable(targetCollection.slug), targetCollection, undefined, this.registry);

            // The target's OWN exclusions, applied to the target's own columns.
            // WebSocket fetches and every realtime frame come through here, so
            // a leak here is invisible from the REST surface people test.
            stripUnreadable(values, targetCollection);
        }

        return {
            // The whole key: a composite target addressed by its first column
            // names every row that shares it.
            id: buildCompositeId(targetRow, targetPks),
            path: targetCollection.slug,
            values: values as M
        };
    }

    /**
     * A target row as its own REST route serves it, for the `"rest"` style.
     *
     * The loaders read the target with `SELECT *`, so the columns a REST read
     * never selects — a generated search vector — are dropped first; then
     * `toRestRow` renders the rest, which applies the target's field access.
     * Built once per batch: the hidden set is a property of the table.
     */
    private restRendering(
        targetCollection: CollectionConfig,
        targetTable: PgTable
    ): (row: Record<string, unknown>) => Record<string, unknown> {
        const hidden = Object.keys(hiddenColumnsOption(getTableColumns(targetTable), targetCollection) ?? {});
        return (row) => {
            if (hidden.length === 0) return toRestRow(row, targetCollection, this.registry);
            const visible = { ...row };
            for (const name of hidden) delete visible[name];
            return toRestRow(visible, targetCollection, this.registry);
        };
    }

    /**
     * A WHERE matching any of `parentIds`, by the whole key.
     *
     * A single key is an `IN (…)`. A composite one cannot be: matching
     * `tenant_id IN (1, 1)` collects every row of tenant 1, so two parents that
     * share their first column each receive the other's relations. It becomes
     * an OR of ANDs — one exact address per parent.
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
     * `localKey` and `foreignKey` are single column names: one column cannot
     * reference a two-column key, so such a relation has no correct reading.
     * Left alone it would silently match on the first key column and hand a
     * tenant's rows to its neighbour — say so instead.
     */
    private assertSingleKeyAddressable(
        parent: RuntimeTable,
        parentPks: PrimaryKeyInfo[],
        via: string,
        relation?: RelationDescriptor
    ): void {
        // A `sourceKey` names the single column the link actually points at, so
        // the parent's key can be as wide as it likes — nothing here references
        // it. That is the one way out of this error, and the message says so.
        if (relation && pointsBack(relation) && relation.sourceKey) return;

        if (parentPks.length > 1) {
            throw new Error(
                `Relation on '${parent.slug}' uses '${via}', a single foreign-key column, but ` +
                `'${parent.slug}' is keyed on ${parentPks.map(k => `'${k.fieldName}'`).join(" + ")}. ` +
                `One column cannot reference a composite key — give the relation a \`sourceKey\` naming ` +
                `a single unique column to point at, or declare it with \`rel.via\`, whose steps' ` +
                `\`on.from\`/\`on.to\` take every key column.`
            );
        }
    }

    /**
     * The value a related row's foreign key must hold to belong to this parent.
     *
     * `undefined` when the parent's source key is null — which is not an error
     * here, only in the callers that were about to write it. Exposed for
     * {@link PersistService}, which stamps this onto a child created under a
     * nested path and would otherwise write the id and lose the row.
     */
    async parentKeyValue(
        parent: RuntimeTable,
        relation: PointsBackRelation,
        parentId: string | number,
        db: DrizzleClient = this.db
    ): Promise<string | number | undefined> {
        const { keyByParentId } = await this.resolveSourceKeys(parent, relation, [parentId], db);
        return keyByParentId.get(String(parentId));
    }

    /**
     * What the target's foreign key holds, for each of these parent rows.
     *
     * Ordinarily the parent's id, and then this is free. When the relation
     * declares a `sourceKey` the two are different values, and the mapping
     * between them lives in the source table — so it costs one SELECT, issued
     * once for the whole batch rather than per parent.
     *
     * Both directions come back because both are needed: reads translate id →
     * key to build the WHERE, and then key → id to attribute each row that
     * comes back. Shared with {@link RelationWriteService}: a write needs the
     * same source key a read does.
     */
    async resolveSourceKeys(
        parent: RuntimeTable,
        relation: PointsBackRelation,
        parentIds: (string | number)[],
        // Writes pass their transaction: reading the source key on the pool
        // while the same transaction is holding an uncommitted change to it
        // would translate the id against a stale value.
        db: DrizzleClient = this.db
    ): Promise<{ keyByParentId: Map<string, string | number>; parentIdByKey: Map<string, string | number> }> {
        const keyByParentId = new Map<string, string | number>();
        const parentIdByKey = new Map<string, string | number>();

        const parentPks = keysOfTable(this.registry, parent);

        if (!joinsOnNaturalKey(this.registry, parent, relation)) {
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

        const field = sourceKeyField(this.registry, parent, relation);
        const parentTable = catalogueTableOf(this.registry, parent);
        const keyColumn = parentTable[field as keyof typeof parentTable] as AnyPgColumn;
        if (!keyColumn) {
            throw new Error(
                `\`sourceKey: "${relation.sourceKey}"\` on relation '${relation.name}' is not a column on ` +
                `'${parent.slug}'. It names a column on the source table, not on the target.`
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
                    `\`sourceKey: "${relation.sourceKey}"\` on relation '${relation.name}' is not unique on ` +
                    `'${parent.slug}': rows '${existing}' and '${parentId}' both hold ` +
                    `'${keyValue}'. Add a unique constraint — a link that addresses more than one source ` +
                    `row cannot say which one a related row belongs to.`
                );
            }
            parentIdByKey.set(String(keyValue), parentId);
        }

        return { keyByParentId, parentIdByKey };
    }

    /**
     * Fetch rows related to a parent row through a specific relation.
     * A relation the table does not declare is a 404 `UNKNOWN_RELATION`.
     */
    async fetchRelatedEntities<M extends Record<string, unknown>>(
        parentCollectionPath: string,
        parentId: string | number,
        relationKey: string,
        options: {
            filter?: FilterValues<Extract<keyof M, string>>;
            orderBy?: string | OrderByTuple[];
            order?: "desc" | "asc";
            limit?: number;
            startAfter?: Record<string, unknown>;
            searchString?: string;
            databaseId?: string;
        } = {}
    ): Promise<RelatedRow<M>[]> {
        const parent = this.tableAt(parentCollectionPath);
        return this.fetchEntitiesUsingJoins<M>(parent, parentId, requireRelation(parent, relationKey), options);
    }

    /**
     * Fetch the rows one parent reaches through `relation`.
     */
    async fetchEntitiesUsingJoins<M extends Record<string, unknown>>(
        parent: RuntimeTable,
        parentId: string | number,
        relation: RelationDescriptor,
        options: {
            filter?: FilterValues<Extract<keyof M, string>>;
            orderBy?: string | OrderByTuple[];
            order?: "desc" | "asc";
            limit?: number;
            startAfter?: Record<string, unknown>;
            searchString?: string;
            databaseId?: string;
        } = {}
    ): Promise<RelatedRow<M>[]> {
        const { target, targetTable, targetPks, targetIdField, targetCollection, parentTable, parentPks, parentIdCol } = this.ends(parent, relation);
        const parsedParentId = parseIdValues(parentId, parentPks)[parentPks[0].fieldName];

        // The target table's `beforeQuery`, resolved before either branch
        // builds a WHERE, so a scope applied in one branch is applied in both.
        const relatedNarrowing = await this.narrowTargetRead(parent, relation, parentId);

        if (relation.kind === "via") {
            let query = this.db.select().from(parentTable).$dynamic();
            let currentTable = parentTable;

            for (const join of relation.steps) {
                const joinTable = this.registry.getPgTable(join.table);
                if (!joinTable) {
                    throw new Error(`Join table not found: ${join.table}`);
                }

                const step = joinStepCondition(currentTable, joinTable, join);
                if ("missing" in step) {
                    throw new Error(`Join columns not found: ${step.missing}`);
                }

                query = applyDynamicJoin(query, joinTable, step.condition);
                currentTable = joinTable;
            }

            // The parent row by every key column — a condition on the first
            // column alone reads the related rows of every parent that shares
            // it — and the target's own soft delete beside its scope.
            query = query.where(narrowed(
                rowIdentityCondition(parentTable, parentPks, parentId, parent.slug),
                andSoftDelete(relatedNarrowing, target, targetTable)
            ));

            if (options.limit) {
                query = query.limit(options.limit);
            }

            const results = await query;
            const targetTableName = viaEndTable(relation);

            const rows: RelatedRow<M>[] = [];
            for (const row of results as Array<Record<string, unknown>>) {
                rows.push(await this.toRelatedRow<M>(rowOf(row, targetTableName), targetCollection, targetPks, { resolveNested: true }));
            }

            return rows;
        }

        // The query builder compares the target's foreign key against a value,
        // and for a link on a natural key that value is not the id in the URL.
        // Resolved first, so a parent that reaches nothing costs one statement.
        const matchValue = pointsBack(relation)
            ? (await this.resolveSourceKeys(parent, relation, [parentId]))
                .keyByParentId.get(String(parentId))
            : parsedParentId;

        // A parent whose source key is null reaches nothing: NULL never equals
        // a foreign key. Say so with an empty list rather than an `= NULL`.
        if (matchValue === undefined) return [];

        let query = this.db.select().from(targetTable).$dynamic();

        const additionalFilters: SQL[] = [];

        // Soft delete and `beforeQuery` on the *target*: the rows being loaded
        // belong to the target table, so it is that table's rules that decide.
        const relatedSoftDelete = softDeleteCondition(target, targetTable);
        if (relatedSoftDelete) additionalFilters.push(relatedSoftDelete);
        if (relatedNarrowing) additionalFilters.push(relatedNarrowing);

        if (options.searchString) {
            const searchConditions = DrizzleConditionBuilder.buildSearchConditions(
                options.searchString,
                targetTable,
                this.registry.requireTable(targetCollection.slug).descriptor
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

        query = applyDynamicRelationQuery(
            query,
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

        if (options.limit) {
            query = query.limit(options.limit);
        }

        const results = await query;
        if (!results || !Array.isArray(results)) {
            return [];
        }

        const rows: RelatedRow<M>[] = [];
        for (const row of results as Array<Record<string, unknown>>) {
            rows.push(await this.toRelatedRow<M>(rowOf(row, target.descriptor.table), targetCollection, targetPks, { resolveNested: true }));
        }

        return rows;
    }

    /**
     * Count related rows for a parent row.
     * A relation the table does not declare is a 404 `UNKNOWN_RELATION`.
     */
    async countRelatedEntities<M extends Record<string, unknown>>(
        parentCollectionPath: string,
        parentId: string | number,
        relationKey: string,
        _options: { filter?: FilterValues<Extract<keyof M, string>>; databaseId?: string } = {}
    ): Promise<number> {
        const parent = this.tableAt(parentCollectionPath);
        return this.countRelatedRows(parent, parentId, requireRelation(parent, relationKey), []);
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
        parent: RuntimeTable,
        parentId: string | number,
        relation: RelationDescriptor,
        additionalFilters: SQL[]
    ): Promise<number> {
        const { target, targetTable, targetIdField, parentTable, parentPks, parentIdCol } = this.ends(parent, relation);
        const parsedParentIdObj = parseIdValues(parentId, parentPks);
        const parsedParentId = parsedParentIdObj[parentPks[0].fieldName];

        // Same translation the listing does, and it has to be: `isRelated`
        // gates writes on this count, so a count built from a different value
        // than the read would authorise rows the read never returned.
        const matchValue = pointsBack(relation)
            ? (await this.resolveSourceKeys(parent, relation, [parentId]))
                .keyByParentId.get(String(parentId))
            : parsedParentId;

        if (matchValue === undefined) return 0;

        // Soft delete and `beforeQuery`, so a relation's count agrees with what
        // loading it returns — `isRelated` gates reads, updates and deletes at
        // a nested address on this number.
        const countSoftDelete = softDeleteCondition(target, targetTable);
        if (countSoftDelete) additionalFilters = [...additionalFilters, countSoftDelete];
        const countNarrowing = await this.narrowTargetRead(parent, relation, parentId);
        if (countNarrowing) additionalFilters = [...additionalFilters, countNarrowing];

        // Distinct, to avoid duplicates from junction tables
        let query = this.db.select({ count: sql<number>`count(distinct ${targetIdField})` }).from(targetTable).$dynamic();

        // Every `via` is counted through the scope condition a nested listing
        // filters by, so the count and the listing are one condition rather
        // than two that have to agree — matched on every key column of the
        // parent, and on each step's columns by SQL name or key.
        if (relation.kind === "via") {
            const scope = DrizzleConditionBuilder.buildRelationScopeCondition(
                relation,
                () => ({
                    table: parentTable,
                    key: primaryKeyColumns(parentTable, parentPks, parent.slug)
                        .map((column, i) => ({ column, value: parsedParentIdObj[parentPks[i].fieldName] }))
                }),
                parentId,
                targetTable,
                targetIdField,
                this.registry
            );
            const result = await query.where(and(scope, ...additionalFilters));
            return Number(result[0]?.count || 0);
        }

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
     * table and then match on the primary key alone, so the parent segment
     * decided nothing. Reads, updates and deletes now all gate on this.
     */
    async isRelated(hop: NestedPathHop, targetId: string | number): Promise<boolean> {
        const targetTable = catalogueTableOf(this.registry, hop.target);
        const targetPks = keysOfTable(this.registry, hop.target);
        const parsedTargetId = parseIdValues(targetId, targetPks);

        const identity: SQL[] = targetPks.map(pk => {
            const column = targetTable[pk.fieldName as keyof typeof targetTable] as AnyPgColumn;
            if (!column) {
                throw new Error(`ID field '${pk.fieldName}' not found in table '${hop.target.slug}'`);
            }
            return eq(column, parsedTargetId[pk.fieldName]);
        });

        return (await this.countRelatedRows(hop.parent, hop.parentId, hop.relation, identity)) > 0;
    }

    /**
     * Batch fetch related rows for multiple parent rows to avoid N+1 queries.
     *
     * `narrow` is an extra condition on the *target* table — what a per-include
     * `where` compiles to. It is pushed into the query rather than applied to
     * the rows that come back, because filtering afterwards reads every related
     * row of every parent in order to discard most of them.
     */
    async batchFetchRelatedEntities(
        parentCollectionPath: string,
        parentIds: (string | number)[],
        _relationKey: string,
        relation: RelationDescriptor,
        narrow?: SQL,
        options?: {
            /** How each target row is rendered; see {@link RelatedRowStyle}. */
            style?: RelatedRowStyle;
            /**
             * The parent rows themselves, in `parentIds` order, when the caller
             * holds them. A `belongsTo` reads each one's foreign key off its
             * row rather than selecting it again.
             */
            parentRows?: Record<string, unknown>[];
        }
    ): Promise<Map<string, RelatedRow<Record<string, unknown>>>> {
        if (parentIds.length === 0) return new Map();

        const parent = this.tableAt(parentCollectionPath);
        const { target, targetTable, targetPks, targetIdField, targetCollection, parentTable, parentPks, parentIdCol } = this.ends(parent, relation);
        const render = { rest: options?.style === "rest" ? this.restRendering(targetCollection, targetTable) : undefined };
        const targetIdInfo = targetPks[0];

        const parsedParentIds = parentIds.map(id => parseIdValues(id, parentPks)[parentPks[0].fieldName]);

        // Soft delete and the target's own `beforeQuery`, once, for every
        // branch below: folded into `narrow`, they compose with the include's
        // own `where` and every branch applies all of them or none.
        const narrowTarget = andSoftDelete(
            narrowBoth(narrow, await this.narrowTargetRead(parent, relation)),
            target, targetTable
        );

        if (relation.kind === "via") {
            let query = this.db.select().from(parentTable).$dynamic();
            let currentTable = parentTable;

            for (const join of relation.steps) {
                const joinTable = this.registry.getPgTable(join.table);
                if (!joinTable) {
                    throw new Error(`Join table not found: ${join.table}`);
                }

                const step = joinStepCondition(currentTable, joinTable, join);
                if ("missing" in step) {
                    throw new Error(`Join columns not found: ${step.missing}`);
                }

                query = applyDynamicJoin(query, joinTable, step.condition);
                currentTable = joinTable;
            }

            // Match every parent at once, each by its whole key.
            query = query.where(narrowed(this.parentKeyCondition(parentTable, parentPks, parentIds), narrowTarget));

            const results = await query;
            const targetTableName = viaEndTable(relation);
            const resultMap = new Map<string, RelatedRow<Record<string, unknown>>>();

            // Group by the parent's address — the same token the caller looks
            // results up by, derived the same way on both sides.
            for (const row of results as Array<Record<string, unknown>>) {
                resultMap.set(
                    buildCompositeId(rowOf(row, parent.descriptor.table), parentPks),
                    await this.toRelatedRow(rowOf(row, targetTableName), targetCollection, targetPks, render)
                );
            }

            return resultMap;
        }

        // Owning relation: the parent rows hold the foreign key. Read each
        // parent's key, fetch the targets in ONE query, map back by key.
        if (relation.kind === "belongsTo") {
            this.assertSingleKeyAddressable(parent, parentPks, relation.localKey);
            // The catalogue table and the rows are keyed by the column's key.
            const localKeyField = relation.localField;
            const localKeyCol = parentTable[localKeyField as keyof typeof parentTable] as AnyPgColumn;
            if (!localKeyCol) {
                throw new Error(`Local key column '${relation.localKey}' not found in parent table`);
            }

            // Step 1: the foreign key of every parent. A parent row the caller
            // already holds carries it under `localKeyField`, and is read from
            // there; only the parents whose row does not — a `fields`
            // projection that left it out, a key withheld by field access —
            // cost a query.
            const parentToFk = new Map<string, unknown>();
            const uniqueFkValues: unknown[] = [];
            const seenFks = new Set<string>();
            const remember = (parentId: string, fkValue: unknown) => {
                if (fkValue === null || fkValue === undefined) return;
                parentToFk.set(parentId, fkValue);
                const fkStr = String(fkValue);
                if (!seenFks.has(fkStr)) {
                    seenFks.add(fkStr);
                    uniqueFkValues.push(fkValue);
                }
            };

            const toRead: (string | number)[] = [];
            parentIds.forEach((parentId, i) => {
                const row = options?.parentRows?.[i];
                if (row && Object.prototype.hasOwnProperty.call(row, localKeyField)) {
                    remember(String(parentId), row[localKeyField]);
                } else {
                    toRead.push(parsedParentIds[i]);
                }
            });

            if (toRead.length > 0) {
                const fkRows = await this.db
                    .select({
                        parentId: parentIdCol,
                        fkValue: localKeyCol
                    })
                    .from(parentTable)
                    .where(inArray(parentIdCol, toRead));
                for (const row of fkRows) {
                    remember(String(row.parentId), row.fkValue);
                }
            }

            if (uniqueFkValues.length === 0) return new Map();

            // Step 2: Fetch all target rows in ONE query
            const targetResults = await this.db
                .select()
                .from(targetTable)
                .where(narrowed(inArray(targetIdField, uniqueFkValues), narrowTarget));

            const targetById = new Map<string, Record<string, unknown>>();
            for (const row of targetResults as Array<Record<string, unknown>>) {
                targetById.set(String(row[targetIdInfo.fieldName]), row);
            }

            // Step 3: Map back to parent rows
            const resultMap = new Map<string, RelatedRow<Record<string, unknown>>>();
            for (const [parentIdStr, fkValue] of parentToFk) {
                const targetRow = targetById.get(String(fkValue));
                if (targetRow) {
                    resultMap.set(parentIdStr, await this.toRelatedRow(targetRow, targetCollection, targetPks, render));
                }
            }

            return resultMap;
        }

        // The parent is named by a single column (on the target, or in a
        // junction), so a composite-keyed parent has no correct reading here.
        this.assertSingleKeyAddressable(
            parent,
            parentPks,
            pointsBack(relation) ? relation.foreignKey : relation.name,
            relation
        );

        // One lookup for the whole batch, both directions: the WHERE is built
        // from the source-key values, and each row that comes back carries one
        // of those values rather than a parent id.
        const { keyByParentId, parentIdByKey } = pointsBack(relation)
            ? await this.resolveSourceKeys(parent, relation, parentIds)
            : { keyByParentId: new Map<string, string | number>(), parentIdByKey: new Map<string, string | number>() };

        const matchValues = pointsBack(relation)
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
            // The builder AND-s `additionalFilters` into the relation's own
            // conditions, so a per-include `where` lands here as well.
            narrowTarget ? [narrowTarget] : []
        );

        const results = await query;
        const resultMap = new Map<string, RelatedRow<Record<string, unknown>>>();
        if (!pointsBack(relation)) return resultMap;
        const foreignKeyField = columnKeyOf(target, relation.foreignKey);

        for (const row of results as Array<Record<string, unknown>>) {
            const targetRow = rowOf(row, target.descriptor.table);

            // Keyed by string throughout: Drizzle returns a numeric column as a
            // number or a string depending on the column type and the driver.
            const foreignKeyValue = targetRow[foreignKeyField] as string | number | undefined;
            if (foreignKeyValue === undefined || foreignKeyValue === null) continue;

            const parentId = parentIdByKey.get(String(foreignKeyValue));
            if (parentId !== undefined) {
                resultMap.set(String(parentId), await this.toRelatedRow(targetRow, targetCollection, targetPks, render));
            }
        }

        return resultMap;
    }

    /**
     * Batch fetch many-cardinality related rows for multiple parent rows.
     * Returns a Map<parentId, RelatedRow[]> instead of Map<parentId, RelatedRow>.
     * Uses a single SQL query with IN clause to avoid N+1.
     *
     * `window` is an include's own `limit` and `orderBy`, and both are applied
     * by Postgres. A limit is *per parent*, so it is a rank within each
     * parent's rows rather than a `LIMIT`: a subquery ranks the keys of every
     * matching row — under the same relation condition, `narrow`, soft delete
     * and `beforeQuery` the unlimited read applies — and the read joins back to
     * the ones ranked within the limit. Rows come back in the window's order,
     * so the per-parent lists are already sorted.
     */
    async batchFetchRelatedEntitiesMany(
        parentCollectionPath: string,
        parentIds: (string | number)[],
        _relationKey: string,
        relation: RelationDescriptor,
        /** An extra condition on the target — see {@link batchFetchRelatedEntities}. */
        narrow?: SQL,
        window?: RelatedRowWindow,
        /** `style` — how each target row is rendered; see {@link RelatedRowStyle}. */
        options?: { style?: RelatedRowStyle }
    ): Promise<Map<string, RelatedRow<Record<string, unknown>>[]>> {
        if (parentIds.length === 0) return new Map();

        const parent = this.tableAt(parentCollectionPath);
        const { target, targetTable, targetPks, targetIdField, targetCollection, parentTable, parentPks, parentIdCol } = this.ends(parent, relation);
        const render = { rest: options?.style === "rest" ? this.restRendering(targetCollection, targetTable) : undefined };

        const parsedParentIds = parentIds.map(id => parseIdValues(id, parentPks)[parentPks[0].fieldName]);

        // Soft delete and the target's own `beforeQuery`, once, for every
        // branch below — see {@link batchFetchRelatedEntities}.
        const narrowTarget = andSoftDelete(
            narrowBoth(narrow, await this.narrowTargetRead(parent, relation)),
            target, targetTable
        );

        if (relation.kind === "via") {
            const joins: { table: PgTable; condition: SQL }[] = [];
            let currentTable = parentTable;

            for (const join of relation.steps) {
                const joinTable = this.registry.getPgTable(join.table);
                if (!joinTable) throw new Error(`Join table not found: ${join.table}`);

                const step = joinStepCondition(currentTable, joinTable, join);
                if ("missing" in step) throw new Error(`Join columns not found: ${step.missing}`);

                joins.push({ table: joinTable, condition: step.condition });
                currentTable = joinTable;
            }
            const throughPath = <Q>(query: Q): Q =>
                joins.reduce((joined, { table, condition }) => applyDynamicJoin(joined, table, condition), query);

            const scope = narrowed(this.parentKeyCondition(parentTable, parentPks, parentIds), narrowTarget);
            const endTable = currentTable;
            const targetKeys = targetPks.map(pk => endTable[pk.fieldName as keyof typeof endTable] as AnyPgColumn);
            const order = relatedRowOrder(endTable, targetKeys, window?.orderBy);

            let results: unknown[];
            if (window?.limit !== undefined) {
                // Ranked over distinct (parent, target) pairs: two paths to
                // one target are one related row, and share a rank.
                const parentKeys = parentPks.map(pk => parentTable[pk.fieldName as keyof typeof parentTable] as AnyPgColumn);
                const keys = [...parentKeys, ...targetKeys];
                const ranked = throughPath(
                    this.db.selectDistinct(rankedKeyFields(keys, parentKeys, order, window.totals ? targetKeys : undefined)).from(parentTable).$dynamic()
                ).where(scope).as(RANKED);
                results = await throughPath(this.db.select().from(parentTable).$dynamic())
                    .innerJoin(ranked, and(...keys.map((key, i) => eq(key, ranked[`k${i}`])))!)
                    .where(lte(ranked.rank, window.limit))
                    .orderBy(ranked.rank);
            } else {
                const query = throughPath(this.db.select().from(parentTable).$dynamic()).where(scope);
                results = window?.orderBy?.length ? await query.orderBy(...order) : await query;
            }
            const targetTableName = viaEndTable(relation);
            const resultMap = new Map<string, RelatedRow<Record<string, unknown>>[]>();

            for (const row of results as Array<Record<string, unknown>>) {
                const parentId = buildCompositeId(rowOf(row, parent.descriptor.table), parentPks);
                recordTotal(window, parentId, row);
                const arr = resultMap.get(parentId) || [];
                arr.push(await this.toRelatedRow(rowOf(row, targetTableName), targetCollection, targetPks, render));
                resultMap.set(parentId, arr);
            }

            return resultMap;
        }

        if (relation.kind === "manyToMany") {
            // The junction names its parent with one column, so the same
            // single-key limit applies as for a direct foreign key.
            this.assertSingleKeyAddressable(parent, parentPks, `${relation.through.table}.${relation.through.sourceKey}`);

            // An empty map here is a lie a caller cannot see through: `posts/1/tags`
            // answering `[]` is exactly what a post with no tags looks like. The
            // binder throws instead when the junction does not resolve.
            const { table: junctionTable, parentColumn: sourceJunctionCol, targetColumn: targetJunctionCol, parentKey } =
                bindThroughJunction(this.registry, relation, `${parent.slug}.${relation.name}`);

            // SELECT target.*, junction.* FROM junction
            // INNER JOIN target ON junction.targetKey = target.id
            // WHERE junction.sourceKey IN (parentIds)
            const scope = narrowed(inArray(sourceJunctionCol, parsedParentIds), narrowTarget);
            const order = relatedRowOrder(targetTable, [targetIdField], window?.orderBy);

            let results: unknown[];
            if (window?.limit !== undefined) {
                // A link is named by its two ends, so that pair is the key the
                // read joins back on — the same target is a different related
                // row under each parent. Distinct, so a junction without a
                // primary key on the pair cannot multiply the rows it joins.
                const keys = [sourceJunctionCol, targetJunctionCol];
                const ranked = this.db
                    .selectDistinct(rankedKeyFields(keys, [sourceJunctionCol], order, window.totals ? [targetJunctionCol] : undefined))
                    .from(junctionTable)
                    .innerJoin(targetTable, eq(targetJunctionCol, targetIdField))
                    .where(scope)
                    .as(RANKED);
                results = await this.db
                    .select()
                    .from(junctionTable)
                    .innerJoin(targetTable, eq(targetJunctionCol, targetIdField))
                    .innerJoin(ranked, and(eq(sourceJunctionCol, ranked.k0), eq(targetJunctionCol, ranked.k1)))
                    .where(lte(ranked.rank, window.limit))
                    .orderBy(ranked.rank);
            } else {
                const query = this.db
                    .select()
                    .from(junctionTable)
                    .innerJoin(targetTable, eq(targetJunctionCol, targetIdField))
                    .where(scope);
                results = window?.orderBy?.length ? await query.orderBy(...order) : await query;
            }
            const resultMap = new Map<string, RelatedRow<Record<string, unknown>>[]>();
            const pivot = relation.through.pivot;

            for (const row of results as Array<Record<string, unknown>>) {
                // The junction table data is namespaced under its table name
                const junctionData = rowOf(row, relation.through.table);
                const targetData = rowOf(row, target.descriptor.table);

                const parentId = String(junctionData[parentKey]);
                recordTotal(window, parentId, row);
                const arr = resultMap.get(parentId) || [];
                const related = await this.toRelatedRow(targetData, targetCollection, targetPks, render);
                if (pivot.length > 0) related.pivot = readPivotColumns(junctionData, pivot);
                arr.push(related);
                resultMap.set(parentId, arr);
            }

            return resultMap;
        }

        // A `belongsTo` is to-one: it has no list of rows to load.
        if (!pointsBack(relation)) return new Map();

        // A foreign key on the target: one column names the parent, so a
        // composite-keyed parent cannot be named.
        this.assertSingleKeyAddressable(parent, parentPks, relation.foreignKey, relation);

        const { keyByParentId, parentIdByKey } = await this.resolveSourceKeys(parent, relation, parentIds);
        const matchValues = [...keyByParentId.values()];
        if (matchValues.length === 0) return new Map();

        const targetKeys = targetPks.map(pk => targetTable[pk.fieldName as keyof typeof targetTable] as AnyPgColumn);
        const order = relatedRowOrder(targetTable, targetKeys, window?.orderBy);
        const foreignKeyField = columnKeyOf(target, relation.foreignKey);
        const foreignKeyColumn = targetTable[foreignKeyField as keyof typeof targetTable] as AnyPgColumn | undefined;

        let results: unknown[];
        if (window?.limit !== undefined && foreignKeyColumn) {
            // The relation's own condition, the include's `where`, the soft
            // delete and `beforeQuery`: everything the unlimited read applies.
            let rankedQuery = this.db.select(rankedKeyFields(targetKeys, [foreignKeyColumn], order, window.totals ? "rows" : undefined)).from(targetTable).$dynamic();
            rankedQuery = applyDynamicRelationQuery(
                rankedQuery, rankedQuery, relation, matchValues, targetTable, parentTable,
                parentIdCol, targetIdField, this.registry, narrowTarget ? [narrowTarget] : []
            );
            const ranked = rankedQuery.as(RANKED);
            results = await this.db
                .select()
                .from(targetTable)
                .innerJoin(ranked, and(...targetKeys.map((key, i) => eq(key, ranked[`k${i}`])))!)
                .where(lte(ranked.rank, window.limit))
                .orderBy(ranked.rank);
        } else {
            let query = this.db.select().from(targetTable).$dynamic();
            query = applyDynamicRelationQuery(
                query, query, relation, matchValues, targetTable, parentTable,
                parentIdCol, targetIdField, this.registry, narrowTarget ? [narrowTarget] : []
            );
            results = window?.orderBy?.length ? await query.orderBy(...order) : await query;
        }
        const resultMap = new Map<string, RelatedRow<Record<string, unknown>>[]>();

        for (const row of results as Array<Record<string, unknown>>) {
            const targetRow = rowOf(row, target.descriptor.table);
            const foreignKeyValue = targetRow[foreignKeyField] as string | number | undefined;
            if (foreignKeyValue === undefined || foreignKeyValue === null) continue;

            const parentId = parentIdByKey.get(String(foreignKeyValue));
            if (parentId !== undefined) {
                const key = String(parentId);
                recordTotal(window, key, row);
                const arr = resultMap.get(key) || [];
                arr.push(await this.toRelatedRow(targetRow, targetCollection, targetPks, render));
                resultMap.set(key, arr);
            }
        }

        return resultMap;
    }
}
