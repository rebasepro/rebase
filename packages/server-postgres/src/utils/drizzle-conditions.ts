import { and, eq, or, sql, SQL, ilike, inArray, getTableColumns } from "drizzle-orm";
import { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import {
    ALL_WHERE_FILTER_OPS,
    CollectionConfig, FilterValues, WhereFilterOp, JoinStep, LogicalCondition, FilterCondition,
    ResolvedRelation, ResolvedBelongsTo, ResolvedHasOne, ResolvedHasMany,
    ResolvedForeignKeyOnTarget, ResolvedManyToMany, hasForeignKeyOnTarget, isManyToMany,
    encodeRelationAggregateSort, type RelationAggregateFn, type RelationAggregateSort
} from "@rebasepro/types";
import {
    fieldKeyForColumn, getColumnName, getTableName, normalizeToEntityRelation, resolveCollectionRelations, toFilterTuples
} from "@rebasepro/common";
import { generateForeignKeyName, toWireKey } from "@rebasepro/utils";
/**
 * Postgres's own default for `pg_trgm.word_similarity_threshold`. Named here
 * because the fuzzy predicate has to know when the index-backed operator agrees
 * with the collection's declared threshold and when it would narrow too far.
 */
const PG_TRGM_WORD_SIMILARITY_DEFAULT = 0.6;
import { buildSearchColumnSpec, SEARCH_UNACCENT_FN, type SearchColumnSpec } from "../schema/search-column";
import { PostgresCollectionRegistry } from "../collections/PostgresCollectionRegistry";
import { ConditionBuilderStatic } from "../interfaces";
import { ApiError, logger } from "@rebasepro/server";
import { getColumnMeta } from "../services/collection-helpers";

/**
 * What to do with a filter field that resolves to no column at all.
 *
 *  - `"error"` (default) — reject the request. A filter that cannot be
 *    compiled is *dropped*, and dropping a condition can only ever widen the
 *    result set. On a data plane where row-level security is the last line of
 *    defence, a typo'd or renamed filter key therefore runs the query without
 *    that condition and returns everything RLS happens to allow.
 *  - `"warn"` — the historical behaviour: log and silently drop the condition.
 *    Only for a deployment that knowingly sends filter keys the table does not
 *    have and has satisfied itself that widening is safe there.
 */
export type UnknownFilterFieldsMode = "error" | "warn";

/**
 * A user's search term, made safe to drop inside a `%…%` LIKE pattern.
 *
 * The term is already a bind parameter, so this is not about injection. It is
 * about the two things a LIKE metacharacter does when it arrives from a search
 * box:
 *
 *  1. **It changes the query.** `%` and `_` are wildcards, so searching for
 *     `50%` returned every row and `a_c` matched `abc`. Nothing the caller
 *     could type would find a literal `%`.
 *  2. **It is a cost the caller chooses.** Postgres matches LIKE by
 *     backtracking: each `%` re-tries every remaining offset, so
 *     `?searchString=a%a%a%a%a%a%a%b` is polynomial with an attacker-chosen
 *     exponent — evaluated per row, OR-ed across every string property of the
 *     collection, on a sequential scan (a leading `%` cannot use an index), and
 *     the page limit does not bound it because the scan happens first.
 *
 * This is the server-side half of the pattern `like-pattern-redos.test.ts`
 * hardened the offline evaluator against; that test's own note ("the same
 * translation in the Mongo driver hands the expression to the database, where
 * it occupies a server thread instead") describes this call site.
 *
 * Backslash is the default `ESCAPE` character for LIKE, and the pattern is
 * bound rather than interpolated, so a single backslash here reaches the
 * matcher as one. Escaping the escape character first is what keeps a term
 * ending in `\` from swallowing the closing `%`.
 *
 * Note this is a *substring search*, not the `like` filter operator: a caller
 * who wants wildcards has `?title=like.foo%` for that, where the pattern is the
 * documented input.
 */
export const escapeLikePattern = (value: string): string =>
    value.replace(/[\\%_]/g, ch => `\\${ch}`);

/**
 * The Drizzle column a relation's column name addresses on a table.
 *
 * A relation names its link in *column* terms — `localKey: "author_id"`,
 * `foreignKeyOnTarget: "author_id"` — because that is what the database and
 * every FK constraint call it. A Drizzle table is keyed by the *wire* name,
 * `authorId`. Indexing the table with the column, which is what every one of
 * these call sites used to do, therefore finds nothing the moment the two
 * differ: for a `columnName`-carrying property that was already true, and it is
 * now true of every derived foreign key.
 *
 * `undefined` rather than a throw: each caller already has a message naming the
 * relation it was resolving, which is worth more than a generic one here.
 */
/**
 * The junction table a `manyToMany` relation names is not in the registry.
 *
 * Six sites raised `Junction table not found: <name>`, which is a fact and not
 * a diagnosis. The name in the message is the one the relation *declares*, and
 * the two things it can mean are opposite: the table exists in the database and
 * the generated Drizzle schema predates it, or the table was never created and
 * the relation's `through.table` is a typo. Both are one command away from
 * being settled, and neither was named.
 */
function junctionTableMissing(junctionName: string): Error {
    return new Error(
        `The relation declares a junction table "${junctionName}", and no such table is registered. ` +
        "Either the generated Drizzle schema predates it — run `rebase schema generate` — or the " +
        "table does not exist yet: `rebase db push` creates the junctions a relation declares. " +
        "If neither helps, check the `through.table` name on the relation."
    );
}

const relationColumn = (
    table: PgTable<any>,
    collection: CollectionConfig | undefined,
    column: string
): AnyPgColumn | undefined => {
    const key = fieldKeyForColumn(collection, column);
    return (key in table ? table[key as keyof typeof table] as AnyPgColumn : undefined) || undefined;
};

/** The target collection of a relation, or `undefined` if its thunk cannot resolve. */
const targetOf = (relation: ResolvedRelation): CollectionConfig | undefined => {
    try {
        return relation.target();
    } catch {
        return undefined;
    }
};

/**
 * The SQL each aggregate sort function compiles to.
 *
 * A lookup rather than interpolation, and `sql.raw` applied to five constants
 * written out here rather than to anything derived from a request. The key is
 * already validated by `parseRelationAggregateSort` — this is the second lock
 * on the same door, so that a future caller reaching the builder directly
 * cannot put a string from the wire where a function name goes.
 */
const AGGREGATE_SQL: Record<RelationAggregateFn, SQL> = {
    min: sql.raw("min"),
    max: sql.raw("max"),
    count: sql.raw("count"),
    sum: sql.raw("sum"),
    avg: sql.raw("avg")
};

/** Column types `ILIKE '%…%'` is defined on. */
const ILIKE_SQL_TYPES = /^(text|varchar|character varying|char|character|bpchar|citext)\b/;

/**
 * Can this column be matched with `ILIKE`?
 *
 * Asked of the column's *declared SQL type*, never with `instanceof`. The
 * previous version tested `column instanceof PgVarchar || … PgText || … PgChar`,
 * and `instanceof` compares class identity: it is only true when the column was
 * constructed by the very same copy of `drizzle-orm` that this module imported.
 *
 * An application's generated schema builds its tables with the app's own
 * `drizzle-orm`, and this driver declares its own dependency on one. When the
 * two ranges do not overlap — an app scaffolded against `^0.44` with a driver
 * asking for `^0.45` — a strict installer gives the driver a second copy, every
 * check returns false, no condition is produced, and the caller compiles that
 * into an impossible `WHERE`. The result is a 200 with an empty page for every
 * search on every collection without a `search` block: the failure looks
 * exactly like "nothing matched". Observed in production, not theorised.
 *
 * `getSQLType()` is a value the column reports about itself, so it crosses
 * module instances the way a class identity cannot. It also happens to fix
 * `citext`, which the `instanceof` list never covered.
 */
const supportsILike = (column: AnyPgColumn): boolean => {
    const sqlType = typeof column?.getSQLType === "function" ? column.getSQLType().toLowerCase() : "";
    return ILIKE_SQL_TYPES.test(sqlType);
};

/**
 * Process-wide default, set once when the driver is constructed.
 *
 * The condition builder is a set of *static* methods reached from a dozen
 * `FetchService` call sites, none of which carry the driver's config — the
 * service is built from `(db, registry)` alone. Threading an option from
 * `createPostgresAdapter` down to each of them would mean touching every
 * intermediate signature to plumb a value that is a single deployment-wide
 * switch. A module-level default set at adapter construction, plus an explicit
 * per-call override for callers that have one (tests, mainly), buys the same
 * control for none of the churn. It is safe by default, so the only reason to
 * set it at all is to opt *out*.
 */
let defaultUnknownFilterFieldsMode: UnknownFilterFieldsMode = "error";

/** Set the process-wide behaviour for unresolvable filter fields. */
export function configureUnknownFilterFields(mode: UnknownFilterFieldsMode): void {
    defaultUnknownFilterFieldsMode = mode;
}

/** The process-wide behaviour for unresolvable filter fields. */
export function getUnknownFilterFieldsMode(): UnknownFilterFieldsMode {
    return defaultUnknownFilterFieldsMode;
}

/** Per-call context for compiling a filter into SQL. */
export interface FilterCompilationOptions {
    /**
     * Overrides the process-wide {@link UnknownFilterFieldsMode} for this call.
     */
    unknownFields?: UnknownFilterFieldsMode;
    /**
     * The collection the filter is written against. Its resolved relations are
     * what turn an owning-relation filter key into the foreign-key column it
     * actually lives in; without it only the default key shapes can be guessed.
     */
    collection?: CollectionConfig;
    /**
     * The driver's registry, for relations whose link is not on this row at
     * all. A `manyToMany` compiles to an `EXISTS` over its junction and a
     * `hasMany`/`hasOne` to one over the target table — neither of which this
     * builder can reach from the collection alone.
     */
    registry?: PostgresCollectionRegistry;
    /**
     * The key column of the table being filtered — what those `EXISTS`
     * subqueries correlate back to.
     *
     * It has to be the Drizzle column object rather than a name: a column
     * renders qualified with its own table, which is what binds it to the
     * *outer* row instead of to the junction or target aliased inside the
     * subquery. See {@link DrizzleConditionBuilder.buildRelationFilterCondition}.
     */
    sourceIdColumn?: AnyPgColumn;
}

/**
 * What a filter field turns out to name.
 *
 * A field naming a column compiles to a comparison on it. A field naming a
 * relation that owns no column here compiles to a whole `EXISTS` condition
 * instead, so there is no column to hand back — which is why resolution
 * answers with a discriminated result rather than a column. The caller cannot
 * tell the two apart from the field name, and the difference is not cosmetic:
 * one is `column <op> value`, the other is a correlated subquery.
 */
type FilterTarget =
    | { kind: "column"; column: AnyPgColumn }
    | {
        /** A path *inside* a json/jsonb column — `metadata->>country`. */
        kind: "json";
        column: AnyPgColumn;
        /** The keys to walk, outermost first. Always at least one. */
        path: string[];
    }
    | {
        kind: "relation";
        relation: ResolvedForeignKeyOnTarget | ResolvedManyToMany;
        /** Bound here so the compile step cannot be reached without them. */
        registry: PostgresCollectionRegistry;
        sourceIdColumn: AnyPgColumn;
    }
    | {
        /**
         * A *column of the related row* — `applications.status`. Same `EXISTS`
         * as `relation`, with the predicate moved off the target's id and onto
         * one of its columns.
         */
        kind: "relation-field";
        /**
         * `via` is not among them: it is refused at resolution, and leaving it
         * in the type would let a later edit reach the compile step with a
         * relation there is no correlation for.
         */
        relation: ResolvedBelongsTo | ResolvedForeignKeyOnTarget | ResolvedManyToMany;
        registry: PostgresCollectionRegistry;
        /** The column on *this* table the subquery correlates back to. */
        sourceIdColumn: AnyPgColumn;
        /** The table the predicate is asked of, already resolved. */
        targetTable: PgTable<any>;
        /** The column on {@link targetTable} the predicate compares. */
        targetColumn: AnyPgColumn;
    };

/**
 * Split `metadata->address->>city` into its column and its path.
 *
 * The arrows are PostgREST's spelling and Postgres's own, so the filter reads
 * the same as the SQL it becomes — and, more usefully, the same as what someone
 * would have written by hand in the SQL console while working out what to ask
 * for. A field with no arrow is not a JSON path and returns `undefined`, which
 * leaves every existing filter on exactly the path it took before.
 *
 * Both arrows are accepted and mean the same thing here: the extraction is
 * always compiled to `->>` (text) at the leaf, because that is the only form a
 * comparison can be made against. `->` is allowed because people write it out
 * of habit, and refusing it would be pedantry about a distinction this layer
 * erases anyway.
 */
/**
 * Split `applications.status` into the relation and the column it addresses.
 *
 * One dot, and only the first one: a relation name cannot contain a dot, and
 * everything after it is handed to the target as a single column key. A second
 * dot would be a second hop — `talents.applications.job.title` — which is a
 * different feature (it needs a chain of subqueries, and a chain has to decide
 * what "some" means at every level), so it is refused rather than silently read
 * as a column named `job.title` that no table has.
 *
 * Returns `undefined` for a field with no dot, which leaves every existing
 * filter on exactly the path it took before.
 */
function parseRelationFieldPath(field: string): { relationKey: string; fieldKey: string } | undefined {
    const dot = field.indexOf(".");
    if (dot <= 0 || dot === field.length - 1) return undefined;
    return { relationKey: field.slice(0, dot), fieldKey: field.slice(dot + 1) };
}

function parseJsonFieldPath(field: string): { columnKey: string; path: string[] } | undefined {
    if (!field.includes("->")) return undefined;

    const segments = field.split(/->>?/).map(s => s.trim()).filter(Boolean);
    if (segments.length < 2) return undefined;

    const [columnKey, ...path] = segments;
    return { columnKey, path };
}

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

/**
 * The operand of `in`/`not-in`, as a list.
 *
 * A scalar is the one-element list, because that is what it means and because
 * the wire produces one: `?filter=id.in.5` parses to the string `"5"`, not to
 * `["5"]` — the REST dialect only builds an array when the value is
 * parenthesised. Treating that as malformed and dropping the condition turned
 * a perfectly ordinary query into an unfiltered read.
 *
 * The empty list stays empty. Callers must decide what "no candidates" means
 * for their operator — it is `FALSE` for `in` and `TRUE` for `not-in` — and
 * neither of those is "no condition at all".
 */
function toMembershipList(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [value];
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
         * Lazy: `via`, `belongsTo`, and a foreign key that points at a
         * `sourceKey` need the parent's own table. A junction and a plain
         * foreign key are expressible from the parent's *id* alone, and
         * requiring the table for them would make a child listing fail on a
         * parent whose table isn't registered.
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
                    throw junctionTableMissing(junctionName);
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
                //
                // The junction is aliased and referenced by identifier, never as a
                // Drizzle column. A column object carries no table qualifier of its
                // own — it is rendered against whatever the surrounding builder
                // thinks the current table is — so inside `db.query.findMany`, which
                // aliases the root table, `${sourceCol}` came out qualified with the
                // *target's* alias: `podcast.podcast_id`, a column that does not
                // exist. That aborts the transaction, and the fallback read then
                // fails on the poisoned transaction rather than on anything to do
                // with the relation. Only `targetIdColumn` stays a column object,
                // because that one *must* bind to the outer row to correlate.
                //
                // Aliasing also disambiguates a self-referential many-to-many, where
                // the junction and the target are the same table.
                const junctionAlias = "__rel_m2m";
                const junctionRef = (column: AnyPgColumn) =>
                    sql`${sql.identifier(junctionAlias)}.${sql.identifier(column.name)}`;
                return sql`EXISTS (SELECT 1 FROM ${junctionTable} AS ${sql.identifier(junctionAlias)} WHERE ${junctionRef(targetCol)} = ${targetIdColumn} AND ${junctionRef(sourceCol)} = ${parentId})`;
            }

            case "hasOne":
            case "hasMany": {
                const fkColumn = relationColumn(targetTable, targetOf(relation), relation.foreignKeyOnTarget);
                if (!fkColumn) {
                    throw new Error(
                        `Foreign key column '${relation.foreignKeyOnTarget}' not found in the target table of ` +
                        `relation '${relation.relationName}'.`
                    );
                }
                if (!relation.sourceKey) return eq(fkColumn, parentId);

                // A link on a natural key: the foreign key holds a column of the
                // parent row, not its id, so the parent has to be read. As a
                // subquery rather than a prior SELECT, for the same reason
                // `belongsTo` below is — one statement sees one snapshot, and a
                // scope condition that read the key separately could be built
                // from a value the very next statement no longer agrees with.
                const { table, idColumn } = parent();
                return sql`${fkColumn} = (SELECT ${sql.identifier(relation.sourceKey)} FROM ${table} WHERE ${idColumn} = ${parentId})`;
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
     * What a filter field names, or `undefined` if it names nothing.
     *
     * Three ways a field resolves. It may address its column directly; it may
     * be an owning relation, whose foreign key is a column here; or it may be
     * a relation whose link lives on another table entirely, which compiles to
     * a subquery instead of a column. Only a field that resolves to *none* of
     * them is an error, and by default it is one: see
     * {@link UnknownFilterFieldsMode} for why silently dropping it is a
     * data-exposure primitive rather than a convenience.
     *
     * For an owning relation the relation's own `localKey` is the authority,
     * not `<field>_id`. The default local key is `generateForeignKeyName`,
     * which snake-cases *and singularises* — `userProfile` → `user_profile_id`,
     * `users` → `user_id` — and it can be overridden outright. Guessing
     * `<field>_id` therefore misses perfectly ordinary owning relations, and
     * with this resolution failing closed that miss is a 400 on a filter that
     * has nothing wrong with it. The guesses stay, last, for callers that hand
     * over no collection to resolve against.
     *
     * The subquery kinds need a registry and the source table's key column on
     * top of the collection. A caller that supplies neither gets the behaviour
     * it had before they were compilable — unresolvable, and so fail-closed —
     * rather than a half-built condition.
     */
    private static resolveFilterTarget(
        table: PgTable<any>,
        field: string,
        collectionPath: string,
        mode: UnknownFilterFieldsMode,
        options: FilterCompilationOptions
    ): FilterTarget | undefined {
        const { collection, registry, sourceIdColumn } = options;

        const columnAt = (key: string): AnyPgColumn | undefined =>
            (key in table ? table[key as keyof typeof table] as AnyPgColumn : undefined) || undefined;

        const direct = columnAt(field);
        if (direct) return { kind: "column", column: direct };

        // Checked after the direct lookup, so a column literally named with an
        // arrow — which Postgres permits, if someone quoted it — still wins.
        const jsonPath = parseJsonFieldPath(field);
        if (jsonPath) {
            const base = columnAt(jsonPath.columnKey);
            if (base) {
                const meta = getColumnMeta(base);
                // Refused rather than compiled: `->>` on a text column is a
                // Postgres error at execution time, which surfaces as a 500 on
                // a request whose only fault is a typo'd column name.
                if (meta.dataType !== "json" && meta.columnType !== "PgJsonb" && meta.columnType !== "PgJson") {
                    throw ApiError.badRequest(
                        `Cannot filter inside "${jsonPath.columnKey}" — it is not a json or jsonb column.`,
                        "INVALID_FILTER_FIELD"
                    );
                }
                return { kind: "json", column: base, path: jsonPath.path };
            }
        }

        if (collection) {
            const relation = resolveCollectionRelations(collection)[field];

            // Owning relation, resolved: the relation names its own local key.
            if (relation?.kind === "belongsTo") {
                const foreignKey = relationColumn(table, collection, relation.localKey);
                if (foreignKey) return { kind: "column", column: foreignKey };
            }

            // The link is on the target table or in a junction. `via` is left
            // out: its join path is authored source → target with no stated
            // inverse, so reversing it into a filter is a different problem
            // from the two shapes below rather than a third case of them.
            if (relation && (hasForeignKeyOnTarget(relation) || isManyToMany(relation)) && registry && sourceIdColumn) {
                // The `EXISTS` correlates the target's foreign key with a column
                // on *this* table, and that is the primary key only when the
                // link joins on it. A `sourceKey` names a different one, and
                // correlating on the id anyway silently matches nothing —
                // "filter by this relation" would quietly return zero rows.
                const correlationColumn = hasForeignKeyOnTarget(relation) && relation.sourceKey
                    ? relationColumn(table, collection, relation.sourceKey)
                    : sourceIdColumn;
                if (!correlationColumn) {
                    throw new Error(
                        `\`sourceKey: "${(relation as ResolvedForeignKeyOnTarget).sourceKey}"\` on relation ` +
                        `'${relation.relationName}' is not a column on '${collectionPath}', so a filter on ` +
                        "that relation has nothing to correlate against."
                    );
                }
                return { kind: "relation", relation, registry, sourceIdColumn: correlationColumn };
            }

            // `applications.status` — a column of the related row rather than
            // its id. Resolved last of the relation shapes, so a relation
            // literally named with a dot still wins above.
            const relationField = parseRelationFieldPath(field);
            if (relationField && registry && sourceIdColumn) {
                const target = this.resolveRelationFieldTarget(
                    table, relationField, collection, registry, sourceIdColumn, field, collectionPath
                );
                if (target) return target;
            }
        }

        // No collection in hand — the shapes an owning relation's key takes by
        // default (e.g. `project` → `projectId`, `userProfile` →
        // `userProfileId`). The snake forms stay in the list because a project
        // may have authored the property under its column name, which is still
        // its wire name.
        for (const guess of [
            `${field}Id`,
            toWireKey(generateForeignKeyName(field)),
            `${field}_id`,
            generateForeignKeyName(field)
        ]) {
            const foreignKey = columnAt(guess);
            if (foreignKey) return { kind: "column", column: foreignKey };
        }

        if (mode === "warn") {
            logger.warn(`Filtering by field '${field}', but it does not exist in table for collection '${collectionPath}'`);
            return undefined;
        }

        let validFields: string[] = [];
        try {
            validFields = Object.keys(getTableColumns(table)).sort();
        } catch {
            // A table stand-in without Drizzle's column symbols — the message
            // is worth less without the list, but not worth failing over.
        }

        // Not `expected`: unlike an anonymous token refresh, this is never a
        // routine outcome. It means a filter key and the schema have drifted
        // apart, which used to widen results silently — exactly the thing an
        // operator wants in the log at warn.
        throw ApiError.badRequest(
            `Unknown filter field '${field}' on collection '${collectionPath}'` +
            (validFields.length > 0 ? `. Valid fields: ${validFields.join(", ")}` : ""),
            "UNKNOWN_FILTER_FIELD",
            { field, collection: collectionPath, ...(validFields.length > 0 && { validFields }) }
        );
    }

    /**
     * `applications.status` — the relation, and the column of the target it
     * addresses.
     *
     * `undefined` when the first segment names no relation: the field simply is
     * not a relation path, and resolution carries on to the guesses and then to
     * the unknown-field answer, which is where a typo belongs. A segment that
     * *does* name a relation is a different matter — the author plainly meant
     * this shape — so everything after that point throws rather than returning,
     * naming what went wrong. Falling through would report "unknown filter
     * field 'applications.status'" and list the columns of the wrong table.
     *
     * `via` is refused for the reason it is absent from
     * `filterableRelationKinds`: its join path is authored source → target with
     * no stated inverse, so there is nothing to correlate a subquery back to.
     */
    private static resolveRelationFieldTarget(
        table: PgTable<any>,
        path: { relationKey: string; fieldKey: string },
        collection: CollectionConfig,
        registry: PostgresCollectionRegistry,
        sourceIdColumn: AnyPgColumn,
        field: string,
        collectionPath: string
    ): FilterTarget | undefined {
        const relation = resolveCollectionRelations(collection)[path.relationKey];
        if (!relation) return undefined;

        if (relation.kind === "via") {
            throw ApiError.badRequest(
                `Cannot filter by '${field}' on collection '${collectionPath}': '${path.relationKey}' is a ` +
                "`via` relation, whose join path is authored one way only, so there is nothing to correlate " +
                "a subquery back to.",
                "UNSUPPORTED_RELATION_FILTER",
                { field, collection: collectionPath, relation: path.relationKey, kind: relation.kind }
            );
        }

        const targetCollection = targetOf(relation);
        const targetTable = targetCollection && registry.getTable(getTableName(targetCollection));
        if (!targetCollection || !targetTable) {
            throw new Error(
                `Table not found for the target of relation '${relation.relationName}' on '${collectionPath}', ` +
                `so '${field}' has nothing to filter against.`
            );
        }

        const targetColumn = relationColumn(targetTable, targetCollection, path.fieldKey)
            ?? (path.fieldKey in targetTable
                ? targetTable[path.fieldKey as keyof typeof targetTable] as AnyPgColumn
                : undefined);
        if (!targetColumn) {
            let validFields: string[] = [];
            try {
                validFields = Object.keys(getTableColumns(targetTable)).sort();
            } catch {
                // Same tolerance as the column path: a table stand-in without
                // Drizzle's column symbols still gets the error, just no list.
            }
            throw ApiError.badRequest(
                `Unknown field '${path.fieldKey}' on '${targetCollection.slug}', the target of relation ` +
                `'${path.relationKey}' on collection '${collectionPath}'` +
                (validFields.length > 0 ? `. Valid fields: ${validFields.join(", ")}` : ""),
                "UNKNOWN_FILTER_FIELD",
                {
                    field,
                    collection: collectionPath,
                    relation: path.relationKey,
                    targetCollection: targetCollection.slug,
                    ...(validFields.length > 0 && { validFields })
                }
            );
        }

        // The column on *this* table the subquery correlates back to. Only
        // `hasMany`/`hasOne` can name a different one; `belongsTo` correlates
        // from its own foreign key, and a many-to-many from the primary key the
        // junction was built against.
        const correlationColumn = relation.kind === "belongsTo"
            ? relationColumn(table, collection, relation.localKey)
            : hasForeignKeyOnTarget(relation) && relation.sourceKey
                ? relationColumn(table, collection, relation.sourceKey)
                : sourceIdColumn;
        if (!correlationColumn) {
            throw new Error(
                `Relation '${relation.relationName}' on '${collectionPath}' names a key that is not a column ` +
                `there, so '${field}' has nothing to correlate against.`
            );
        }

        return {
            kind: "relation-field",
            relation,
            registry,
            sourceIdColumn: correlationColumn,
            targetTable,
            targetColumn
        };
    }

    /**
     * Build filter conditions from FilterValues
     */
    static buildFilterConditions<M extends Record<string, unknown>>(
        filter: FilterValues<Extract<keyof M, string>>,
        table: PgTable<any>,
        collectionPath: string,
        options: FilterCompilationOptions = {}
    ): SQL[] {
        const mode = options.unknownFields ?? defaultUnknownFilterFieldsMode;
        const conditions: SQL[] = [];

        for (const [field, filterParam] of Object.entries(filter)) {
            if (!filterParam) continue;

            const target = this.resolveFilterTarget(table, field, collectionPath, mode, options);
            if (!target) continue;

            // One tuple or an array of them — the grammar, read the same way by
            // every compiler. See `toFilterTuples`.
            for (const [op, value] of toFilterTuples(filterParam)) {
                const condition = this.compileFilterTarget(target, op, value, field, collectionPath);
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
        collectionPath: string,
        options: FilterCompilationOptions = {}
    ): SQL | null {
        if ("type" in cond) {
            const subSQLs = cond.conditions
                .map(c => this.buildLogicalConditions(c, table, collectionPath, options))
                .filter((sql): sql is SQL => sql !== null);
            if (subSQLs.length === 0) return null;
            return (cond.type === "or" ? or(...subSQLs) : and(...subSQLs)) ?? null;
        } else {
            // A dropped leaf is worse here than in a flat filter: inside an
            // `or(...)` the disjunction loses a branch, so the surviving
            // branches match on their own and the result set widens by
            // everything the dropped leaf would have excluded.
            const target = this.resolveFilterTarget(
                table,
                cond.column,
                collectionPath,
                options.unknownFields ?? defaultUnknownFilterFieldsMode,
                options
            );
            if (!target) return null;
            return this.compileFilterTarget(
                target, cond.operator as WhereFilterOp, cond.value, cond.column, collectionPath
            );
        }
    }

    /** Dispatch a resolved filter field onto the shape it actually compiles to. */
    private static compileFilterTarget(
        target: FilterTarget,
        op: WhereFilterOp,
        value: unknown,
        field: string,
        collectionPath: string
    ): SQL | null {
        if (target.kind === "column") {
            return this.buildSingleFilterCondition(target.column, op, value);
        }
        if (target.kind === "json") {
            return this.buildJsonPathCondition(target.column, target.path, op, value);
        }
        if (target.kind === "relation-field") {
            return this.buildRelationFieldCondition(target, op, value, field, collectionPath);
        }
        return this.buildRelationFilterCondition(
            target.relation, op, value, target.sourceIdColumn, target.registry, field, collectionPath
        );
    }

    /**
     * A comparison against a value extracted from a json/jsonb column.
     *
     * The path is walked with `->` and the leaf taken with `->>`, so what comes
     * out is always **text**. That is the whole of the type story, and it is
     * the part worth being explicit about, because the alternatives are all
     * worse:
     *
     *  - text comparison alone makes `["<", 100]` compare lexically, where
     *    `"9"` is greater than `"100"`;
     *  - casting unconditionally makes every filter on a non-numeric value a
     *    runtime `invalid input syntax for type numeric` — a 500 on a row whose
     *    JSON simply holds a string.
     *
     * So the *filter value* decides. A number on an ordering comparison casts
     * both sides to numeric; everything else compares as text, with booleans
     * rendered the way `->>` renders them (`"true"` / `"false"`). A row whose
     * JSON holds a non-numeric value at a path being compared numerically is
     * excluded rather than fatal, which is what `IS NOT NULL`-style filtering
     * means everywhere else in this file.
     *
     * The path segments are bound as parameters, never interpolated: they come
     * from a query string, and `->>` takes a text parameter perfectly well.
     */
    private static buildJsonPathCondition(
        column: AnyPgColumn,
        path: string[],
        op: WhereFilterOp,
        value: unknown
    ): SQL | null {
        // Every segment but the last with `->` (staying in json), the last
        // with `->>` (leaving as text).
        let expr: SQL = sql`${column}`;
        for (const key of path.slice(0, -1)) {
            expr = sql`${expr} -> ${key}`;
        }
        const leaf = sql`${expr} ->> ${path[path.length - 1]}`;

        const numericComparison = typeof value === "number" &&
            (op === ">" || op === ">=" || op === "<" || op === "<=");

        if (numericComparison) {
            // The guard is what keeps this from being a 500: rows whose value
            // at this path is not a number are excluded, not fatal.
            const numeric = sql`CASE WHEN ${leaf} ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (${leaf})::numeric END`;
            switch (op) {
                case ">": return sql`${numeric} > ${value}`;
                case ">=": return sql`${numeric} >= ${value}`;
                case "<": return sql`${numeric} < ${value}`;
                case "<=": return sql`${numeric} <= ${value}`;
            }
        }

        const asText = (v: unknown): string => typeof v === "boolean" ? String(v) : String(v);

        switch (op) {
            case "==":
                return value === null || value === undefined ? sql`${leaf} IS NULL` : sql`${leaf} = ${asText(value)}`;
            case "!=":
                return value === null || value === undefined ? sql`${leaf} IS NOT NULL` : sql`${leaf} != ${asText(value)}`;
            case ">": return sql`${leaf} > ${asText(value)}`;
            case ">=": return sql`${leaf} >= ${asText(value)}`;
            case "<": return sql`${leaf} < ${asText(value)}`;
            case "<=": return sql`${leaf} <= ${asText(value)}`;
            case "like": return sql`${leaf} LIKE ${asText(value)}`;
            case "ilike": return sql`${leaf} ILIKE ${asText(value)}`;
            case "not-like": return sql`${leaf} NOT LIKE ${asText(value)}`;
            case "not-ilike": return sql`${leaf} NOT ILIKE ${asText(value)}`;
            case "is-null": return sql`${leaf} IS NULL`;
            case "is-not-null": return sql`${leaf} IS NOT NULL`;
            case "in":
            case "not-in": {
                if (value === null || value === undefined) {
                    return op === "in" ? sql`${leaf} IS NULL` : sql`${leaf} IS NOT NULL`;
                }
                const values = toMembershipList(value).map(asText);
                // Same inversion guard as the column path: an empty list
                // matches nothing, and dropping the condition would match
                // everything.
                if (values.length === 0) return op === "in" ? sql`FALSE` : sql`TRUE`;
                const list = sql.join(values.map(v => sql`${v}`), sql`, `);
                return op === "in" ? sql`${leaf} IN (${list})` : sql`${leaf} NOT IN (${list})`;
            }
            default:
                // `array-contains` and friends are about the column, not a
                // scalar inside it — `metadata @> '{"tags":["x"]}'` is the
                // question, and it is asked of the column directly.
                throw ApiError.badRequest(
                    `Operator "${op}" is not supported on a JSON path. Use it on the column itself.`,
                    "INVALID_FILTER_OPERATOR"
                );
        }
    }

    /**
     * A filter on a relation that owns no column on this row — `EXISTS` over
     * the rows it reaches.
     *
     * `posts` filtered by `tags == <tagId>` is not a comparison on `posts`; it
     * is a question about the junction:
     *
     *     EXISTS (SELECT 1 FROM posts_tags AS j
     *             WHERE j.post_id = posts.id AND j.tag_id = <tagId>)
     *
     * which is {@link buildRelationScopeCondition}'s many-to-many shape with
     * source and target swapped — there the junction's *target* column
     * correlates and the source is pinned; here the *source* column correlates
     * and the target is what the filter constrains.
     *
     * `hasMany`/`hasOne` are the same shape one table over: the target row
     * carries the foreign key, so the correlation is on that key and the
     * compared column is the target's own id.
     *
     * `EXISTS` and not a join, for the reason the scope condition gives: a join
     * through a junction multiplies the outer rows by the number of matching
     * links, which duplicates results and silently breaks `limit`/`offset`.
     *
     * Everything inside the subquery is referenced by identifier against a
     * local alias, and only `sourceIdColumn` stays a Drizzle column object —
     * again see {@link buildRelationScopeCondition}, which explains why a
     * column object renders against whatever table the surrounding builder
     * thinks is current and so cannot be used for the inner references. The
     * alias is also what keeps a self-referential relation unambiguous
     * (`categories.children`, or a many-to-many whose junction and target are
     * the same table), where the subquery's table and the outer one coincide.
     */
    static buildRelationFilterCondition(
        relation: ResolvedForeignKeyOnTarget | ResolvedManyToMany,
        op: WhereFilterOp,
        value: unknown,
        sourceIdColumn: AnyPgColumn,
        registry: PostgresCollectionRegistry,
        field: string,
        collectionPath: string
    ): SQL {
        const alias = "__rel_filter";
        const ref = (column: AnyPgColumn) =>
            sql`${sql.identifier(alias)}.${sql.identifier(column.name)}`;

        let scanTable: PgTable<any>;
        let correlation: SQL;
        let comparedColumn: AnyPgColumn;

        if (relation.kind === "manyToMany") {
            const { table: junctionName, sourceColumn, targetColumn } = relation.through;
            const junctionTable = registry.getTable(junctionName);
            if (!junctionTable) {
                throw junctionTableMissing(junctionName);
            }
            const sourceCol = junctionTable[sourceColumn as keyof typeof junctionTable] as AnyPgColumn;
            const targetCol = junctionTable[targetColumn as keyof typeof junctionTable] as AnyPgColumn;
            if (!sourceCol || !targetCol) {
                throw new Error(
                    `Junction columns '${sourceColumn}'/'${targetColumn}' not found in '${junctionName}'`
                );
            }
            scanTable = junctionTable;
            correlation = sql`${ref(sourceCol)} = ${sourceIdColumn}`;
            comparedColumn = targetCol;
        } else {
            const targetCollection = relation.target();
            const targetTable = registry.getTable(getTableName(targetCollection));
            if (!targetTable) {
                throw new Error(
                    `Table not found for the target of relation '${relation.relationName}' ` +
                    `(collection '${targetCollection.slug}')`
                );
            }
            const fkColumn = relationColumn(targetTable, targetCollection, relation.foreignKeyOnTarget);
            if (!fkColumn) {
                throw new Error(
                    `Foreign key column '${relation.foreignKeyOnTarget}' not found in the target table of ` +
                    `relation '${relation.relationName}'.`
                );
            }
            // The filter value is a target row's id, so that is what the
            // subquery compares — the foreign key is spent on the correlation.
            const targetIdColumn = this.primaryKeyColumn(targetTable);
            if (!targetIdColumn) {
                throw new Error(
                    `No primary key or "id" column in the target table of relation '${relation.relationName}', ` +
                    `so a filter on it has nothing to match against.`
                );
            }
            scanTable = targetTable;
            correlation = sql`${ref(fkColumn)} = ${sourceIdColumn}`;
            comparedColumn = targetIdColumn;
        }

        const { predicate, negate } = this.buildRelationFilterPredicate(
            ref(comparedColumn), op, value, field, collectionPath
        );

        const where = predicate ? sql`${correlation} AND ${predicate}` : correlation;
        const exists = sql`EXISTS (SELECT 1 FROM ${scanTable} AS ${sql.identifier(alias)} WHERE ${where})`;
        return negate ? sql`NOT ${exists}` : exists;
    }

    /**
     * The inner predicate of a relation filter, and whether the `EXISTS`
     * wrapping it is negated.
     *
     * Negation is `NOT EXISTS` of the *positive* predicate, never `EXISTS` of a
     * negated one. On a many-valued relation the two are different questions:
     * `EXISTS (… AND tag_id != X)` asks "does some tag differ from X", which is
     * true of nearly every post with more than one tag and answers nothing
     * anybody asked. `NOT EXISTS (… AND tag_id = X)` asks "is X absent", which
     * is what unticking a value in a filter control means — and it makes `==`
     * and `!=` partition the rows, the way a filter implies they do.
     *
     * `is-null`/`is-not-null` drop the predicate entirely: with nothing but the
     * correlation left, they become "has no related row at all" and "has at
     * least one", which is the only reading of null a link can have.
     *
     * Under RLS, "no related row" means *no row this reader can see*. A junction
     * with row-level security but no `SELECT` policy for `rebase_user` is opaque
     * to it, so every row comes back looking unlinked and `is-null` matches all
     * of them. That is not a leak — the outer table's own policies still decide
     * which rows exist at all, and the positive direction correctly returns
     * nothing — but it over-reports, and the cause is a missing junction policy
     * rather than anything here. Rebase derives one for a declared many-to-many;
     * a hand-written schema has to supply it.
     *
     * `in`/`not-in` against a *null value* mean the same thing, rather than
     * membership of an empty list. Membership against null is not a membership
     * question, and the admin's "filter for null values" control emits the
     * operator that happens to be selected — on a to-many relation that is
     * always `in` or `not-in`, because those are the only ones the multi-select
     * can produce. Reading `["in", null]` as an empty list would answer "posts
     * with no tags" with no posts at all.
     *
     * An empty `in` list compiles to `FALSE` rather than being dropped. Dropped
     * is what the column path does, and dropping a condition widens the result
     * — the whole reason this resolution fails closed. `in []` matches nothing
     * and `not-in []` matches everything, and `NOT EXISTS (… AND FALSE)` gives
     * the second for free.
     *
     * Anything else is rejected. Returning `null` for an operator this cannot
     * express would drop the condition, and the operators the admin offers for
     * a relation are exactly the six below.
     */
    private static buildRelationFilterPredicate(
        ref: SQL,
        op: WhereFilterOp,
        value: unknown,
        field: string,
        collectionPath: string
    ): { predicate?: SQL; negate: boolean } {
        value = unwrapRelationFilterValue(value);
        const isNullish = value === null || value === undefined;

        const equals = () => sql`${ref} = ${value}`;
        const inList = () => {
            // Same reading as the column path: a scalar is the one-element
            // list, an empty list is `FALSE`. Here `FALSE` also gives
            // `not-in []` its answer for free — `NOT EXISTS (… AND FALSE)`
            // is true of every row, which is what excluding nothing means.
            const values = toMembershipList(value);
            return values.length === 0
                ? sql`FALSE`
                : sql`${ref} IN (${sql.join(values.map(v => sql`${v}`), sql`, `)})`;
        };

        switch (op) {
            case "==":
                return isNullish ? { negate: true } : { predicate: equals(), negate: false };
            case "!=":
                return isNullish ? { negate: false } : { predicate: equals(), negate: true };
            case "in":
                return isNullish ? { negate: true } : { predicate: inList(), negate: false };
            case "not-in":
                return isNullish ? { negate: false } : { predicate: inList(), negate: true };
            case "is-null":
                return { negate: true };
            case "is-not-null":
                return { negate: false };
            // A to-many relation *is* the list, so the array operators ask the
            // same two questions under different names: "contains X" is "some
            // related row is X", and "contains any of [X, Y]" is `in`. They
            // reach here because the admin offers them for a property that is
            // an *array of* relations, and rejecting a question the shape
            // answers perfectly well would put a 400 behind a working control.
            case "array-contains":
                return isNullish ? { negate: true } : { predicate: equals(), negate: false };
            case "array-contains-any":
                return isNullish ? { negate: true } : { predicate: inList(), negate: false };
            default:
                throw ApiError.badRequest(
                    `Operator '${op}' cannot be applied to relation field '${field}' on collection ` +
                    `'${collectionPath}'. A relation with no column on this row is filtered by ` +
                    "membership: ==, !=, in, not-in, array-contains, array-contains-any, is-null, " +
                    "is-not-null.",
                    "UNSUPPORTED_RELATION_FILTER_OPERATOR",
                    { field, collection: collectionPath, operator: op }
                );
        }
    }

    /**
     * A filter on a *column of the related row* — `applications.status`.
     *
     * The same `EXISTS` {@link buildRelationFilterCondition} builds, with the
     * predicate moved off the target's id and onto one of its columns:
     *
     *     EXISTS (SELECT 1 FROM talent_applications AS t
     *             WHERE t.talent_id = talents.id
     *               AND t.status IN ('applied', 'reviewing', 'interview'))
     *
     * which is the shape every "who is waiting" queue is written in. Without
     * it the only way to ask is to fetch every row and filter in the browser,
     * and a filter the client applies after paging is not a filter — the page
     * was already chosen without it.
     *
     * A many-to-many needs one more table than the id filter does. That one
     * stops at the junction, because the junction already holds the value it
     * compares; a column of the target is a table further out, so the subquery
     * joins the target to the junction and correlates from the junction. The
     * join is inside `EXISTS`, so it cannot multiply the outer rows the way a
     * top-level join through a junction would.
     *
     * `belongsTo` is included even though its foreign key is a column here:
     * `author.name` is a column of another table either way, and refusing the
     * one relation kind that reads most naturally would be a rule about
     * implementation rather than about meaning.
     *
     * Under RLS the subquery runs as the reader, so it sees the target rows
     * that reader's policies allow and no others. On the positive direction
     * that is exactly right. On the negative — `!=`, `not-in`, and any
     * `NOT EXISTS` — "no related row satisfies this" and "no related row this
     * reader can see satisfies this" are the same sentence, so a target table
     * with row-level security and no `SELECT` policy for `rebase_user` makes
     * every row look unmatched and the negative filter over-reports. Nothing is
     * leaked: the outer table's own policies still decide which rows exist. The
     * cause is a missing policy on the target rather than anything here, and it
     * is the same caveat the id-filter path carries.
     */
    static buildRelationFieldCondition(
        target: Extract<FilterTarget, { kind: "relation-field" }>,
        op: WhereFilterOp,
        value: unknown,
        field: string,
        collectionPath: string
    ): SQL {
        const alias = "__rel_field";
        const { relation, targetTable, targetColumn } = target;
        const ref = sql`${sql.identifier(alias)}.${sql.identifier(targetColumn.name)}`;

        const { predicate, negate } = this.buildRelationColumnPredicate(
            ref, targetColumn, op, value, field, collectionPath
        );

        // Everything inside the subquery is referenced by identifier against a
        // local alias — see `buildRelationScopeCondition` for why a Drizzle
        // column object cannot be used there. Only `sourceIdColumn` stays a
        // column object, which is what binds it to the *outer* row.
        let from: SQL;
        let correlation: SQL;

        if (relation.kind === "manyToMany") {
            const { table: junctionName, sourceColumn, targetColumn: junctionTargetColumn } = relation.through;
            const junctionTable = target.registry.getTable(junctionName);
            if (!junctionTable) {
                throw junctionTableMissing(junctionName);
            }
            const sourceCol = junctionTable[sourceColumn as keyof typeof junctionTable] as AnyPgColumn;
            const targetCol = junctionTable[junctionTargetColumn as keyof typeof junctionTable] as AnyPgColumn;
            if (!sourceCol || !targetCol) {
                throw new Error(
                    `Junction columns '${sourceColumn}'/'${junctionTargetColumn}' not found in '${junctionName}'`
                );
            }
            const targetKey = this.primaryKeyColumn(targetTable);
            if (!targetKey) {
                throw new Error(
                    `No primary key or "id" column in the target table of relation '${relation.relationName}', ` +
                    `so '${field}' has nothing to join the junction against.`
                );
            }
            const junctionAlias = "__rel_field_junction";
            from = sql`${targetTable} AS ${sql.identifier(alias)} INNER JOIN ${junctionTable} AS ${sql.identifier(junctionAlias)} ON ${sql.identifier(junctionAlias)}.${sql.identifier(targetCol.name)} = ${sql.identifier(alias)}.${sql.identifier(targetKey.name)}`;
            correlation = sql`${sql.identifier(junctionAlias)}.${sql.identifier(sourceCol.name)} = ${target.sourceIdColumn}`;
        } else if (relation.kind === "belongsTo") {
            const targetKey = this.primaryKeyColumn(targetTable);
            if (!targetKey) {
                throw new Error(
                    `No primary key or "id" column in the target table of relation '${relation.relationName}', ` +
                    `so '${field}' has nothing to correlate against.`
                );
            }
            from = sql`${targetTable} AS ${sql.identifier(alias)}`;
            correlation = sql`${sql.identifier(alias)}.${sql.identifier(targetKey.name)} = ${target.sourceIdColumn}`;
        } else {
            const foreignKey = relationColumn(targetTable, targetOf(relation), relation.foreignKeyOnTarget);
            if (!foreignKey) {
                throw new Error(
                    `Foreign key column '${relation.foreignKeyOnTarget}' not found in the target table of ` +
                    `relation '${relation.relationName}'.`
                );
            }
            from = sql`${targetTable} AS ${sql.identifier(alias)}`;
            correlation = sql`${sql.identifier(alias)}.${sql.identifier(foreignKey.name)} = ${target.sourceIdColumn}`;
        }

        const where = predicate ? sql`${correlation} AND ${predicate}` : correlation;
        const exists = sql`EXISTS (SELECT 1 FROM ${from} WHERE ${where})`;
        return negate ? sql`NOT ${exists}` : exists;
    }

    /**
     * The inner predicate of a relation *column* filter, and whether the
     * `EXISTS` wrapping it is negated.
     *
     * The negation rule is the one {@link buildRelationFilterPredicate} states
     * and holds for exactly the same reason, one column over. A negative
     * operator is `NOT EXISTS` of the **positive** predicate, never `EXISTS` of
     * a negated one: `EXISTS (… AND status != 'hired')` asks "does some
     * application differ from hired", which is true of nearly every candidate
     * with more than one application and answers nothing anybody asked.
     * `NOT EXISTS (… AND status = 'hired')` asks "is there no hired
     * application", which is what unticking a value means — and it makes `==`
     * and `!=` partition the rows, the way a filter implies they do.
     *
     * `is-null` and `is-not-null` are the exception, and deliberately not a
     * complementary pair here. On a column they compile to `EXISTS (… AND col
     * IS NULL)` and `EXISTS (… AND col IS NOT NULL)` — "has a related row whose
     * column is unset" and "has one where it is set" — which is the plain
     * reading of `applications.status is-not-null` and the useful one. They are
     * both true of a candidate with two applications, one of each. Making
     * `is-not-null` the negation instead would make it "no application has an
     * unset status", which is true of a candidate with no applications at all
     * and so answers a queue with the very rows the queue exists to exclude.
     *
     * Unlike the id path, every operator is available: the compared value is an
     * ordinary column, so `>=` on a date and `ilike` on a name mean here what
     * they mean anywhere else. Only an operator that does not exist is refused,
     * and it throws rather than returning `null` — a dropped condition widens
     * the read, which is the whole reason this file fails closed.
     */
    private static buildRelationColumnPredicate(
        ref: SQL,
        column: AnyPgColumn,
        op: WhereFilterOp,
        value: unknown,
        field: string,
        collectionPath: string
    ): { predicate?: SQL; negate: boolean } {
        value = unwrapRelationFilterValue(value);
        const isNullish = value === null || value === undefined;

        const equals = () => sql`${ref} = ${value}`;
        const inList = (): SQL => {
            const values = toMembershipList(value);
            // An empty list matches nothing, and `NOT EXISTS (… AND FALSE)`
            // gives `not-in []` — which excludes nothing — for free. Dropping
            // the condition instead would match everything.
            return values.length === 0
                ? sql`FALSE`
                : sql`${ref} IN (${sql.join(values.map(v => sql`${v}`), sql`, `)})`;
        };
        const isNull = () => sql`${ref} IS NULL`;
        const contains = (): SQL => {
            const meta = getColumnMeta(column);
            const isNativeArray = meta.dataType === "array" || meta.columnType === "PgArray";
            if (op === "array-contains-any") {
                if (Array.isArray(value) && value.length === 0) return sql`FALSE`;
                if (Array.isArray(value) && value.length > 0) {
                    return isNativeArray
                        ? sql`${ref} && ARRAY[${sql.join(value.map(v => sql`${v}`), sql`, `)}]`
                        : sql`${ref} ?| array[${sql.join(value.map(v => sql`${String(v)}`), sql`, `)}]`;
                }
            }
            return isNativeArray
                ? sql`${ref} @> ARRAY[${value}]`
                : sql`${ref} @> ${JSON.stringify([value])}`;
        };

        switch (op) {
            case "==":
                return { predicate: isNullish ? isNull() : equals(), negate: false };
            case "!=":
                return { predicate: isNullish ? isNull() : equals(), negate: true };
            case ">":
                return { predicate: sql`${ref} > ${value}`, negate: false };
            case ">=":
                return { predicate: sql`${ref} >= ${value}`, negate: false };
            case "<":
                return { predicate: sql`${ref} < ${value}`, negate: false };
            case "<=":
                return { predicate: sql`${ref} <= ${value}`, negate: false };
            case "in":
                return { predicate: isNullish ? isNull() : inList(), negate: false };
            case "not-in":
                return { predicate: isNullish ? isNull() : inList(), negate: true };
            case "like":
                return { predicate: sql`${ref} LIKE ${String(value)}`, negate: false };
            case "not-like":
                return { predicate: sql`${ref} LIKE ${String(value)}`, negate: true };
            case "ilike":
            case "not-ilike": {
                // `ILIKE` is only defined on the text family. Asking it of a
                // date or an integer is a Postgres error at execution time — a
                // 500 on a request whose only fault is an operator the admin
                // offered for the wrong column.
                if (!supportsILike(column)) {
                    throw ApiError.badRequest(
                        `Operator '${op}' cannot be applied to '${field}' on collection '${collectionPath}': ` +
                        `'${column.name}' is ${column.getSQLType?.() ?? "not a text column"}, and case-insensitive ` +
                        "matching is only defined on text.",
                        "UNSUPPORTED_RELATION_FILTER_OPERATOR",
                        { field, collection: collectionPath, operator: op }
                    );
                }
                return { predicate: sql`${ref} ILIKE ${String(value)}`, negate: op === "not-ilike" };
            }
            case "is-null":
                return { predicate: isNull(), negate: false };
            case "is-not-null":
                return { predicate: sql`${ref} IS NOT NULL`, negate: false };
            case "array-contains":
            case "array-contains-any":
                return { predicate: contains(), negate: false };
            default:
                throw ApiError.badRequest(
                    `Unknown filter operator '${op}'. Valid operators: ${ALL_WHERE_FILTER_OPS.join(", ")}.`,
                    "UNKNOWN_FILTER_OPERATOR",
                    { operator: op, validOperators: ALL_WHERE_FILTER_OPS }
                );
        }
    }

    /**
     * An aggregate over the rows a relation reaches, as a scalar expression —
     * what `orderBy: [{ relation: "applications", field: "created_at", agg:
     * "min" }, "asc"]` compiles to.
     *
     *     (SELECT min(t.created_at) FROM talent_applications AS t
     *      WHERE t.talent_id = talents.id)
     *
     * A correlated scalar subquery rather than a `LEFT JOIN LATERAL`: the join
     * would have to be threaded into a query the relational query builder
     * assembles, while a scalar expression drops straight into `ORDER BY` and
     * into the keyset comparison behind cursor paging — which has to be the
     * *same* expression, or paging and ordering disagree and rows are skipped.
     *
     * `correlateTo` is what the subquery is pinned against. Left out, it is the
     * outer row's key column and the expression is correlated in the ordinary
     * way. Given a literal — the cursor row's id — the subquery stops being
     * correlated at all, so Postgres evaluates it once for the whole statement
     * rather than per row. That is how a cursor pages over an aggregate it has
     * no stored value for: the value is recomputed from the id it does have.
     *
     * Over zero related rows `count` is 0 and every other function is NULL,
     * which is what puts "nobody waiting" at a defined end of the order rather
     * than wherever a missing value would land. See `buildOrderExpressions` for
     * where that end is pinned.
     *
     * Under RLS the subquery runs as the reader, so a related row the reader
     * cannot see does not contribute — an aggregate is over the rows that
     * reader can see, which is the only total it could honestly report.
     */
    static buildRelationAggregateExpression(
        spec: RelationAggregateSort,
        table: PgTable<any>,
        collection: CollectionConfig,
        registry: PostgresCollectionRegistry,
        sourceIdColumn: AnyPgColumn,
        collectionPath: string,
        correlateTo?: unknown
    ): SQL {
        const relation = resolveCollectionRelations(collection)[spec.relation];
        if (!relation) {
            throw ApiError.badRequest(
                `Cannot sort by '${encodeRelationAggregateSort(spec)}' on collection '${collectionPath}': ` +
                `'${spec.relation}' is not a relation there.`,
                "UNKNOWN_ORDER_BY_FIELD",
                { field: encodeRelationAggregateSort(spec), collection: collectionPath, relation: spec.relation }
            );
        }
        if (relation.kind === "via") {
            throw ApiError.badRequest(
                `Cannot sort by '${encodeRelationAggregateSort(spec)}' on collection '${collectionPath}': ` +
                "`via` relations are authored one way only, so there is nothing to correlate a subquery back to.",
                "ORDER_BY_FIELD_NOT_SORTABLE",
                { field: encodeRelationAggregateSort(spec), collection: collectionPath, kind: relation.kind }
            );
        }

        const targetCollection = targetOf(relation);
        const targetTable = targetCollection && registry.getTable(getTableName(targetCollection));
        if (!targetCollection || !targetTable) {
            throw new Error(
                `Table not found for the target of relation '${relation.relationName}' on '${collectionPath}', ` +
                "so there is nothing to aggregate."
            );
        }

        const alias = "__rel_agg";
        // `count` with no field counts the related rows themselves. Every other
        // function needs something to aggregate, and a key that named no column
        // never got this far — `parseRelationAggregateSort` refuses it.
        let aggregand: SQL = sql`*`;
        if (spec.field) {
            const column = relationColumn(targetTable, targetCollection, spec.field)
                ?? (spec.field in targetTable
                    ? targetTable[spec.field as keyof typeof targetTable] as AnyPgColumn
                    : undefined);
            if (!column) {
                let validFields: string[] = [];
                try {
                    validFields = Object.keys(getTableColumns(targetTable)).sort();
                } catch {
                    // A table stand-in without Drizzle's column symbols.
                }
                throw ApiError.badRequest(
                    `Unknown field '${spec.field}' on '${targetCollection.slug}', the target of relation ` +
                    `'${spec.relation}' on collection '${collectionPath}'` +
                    (validFields.length > 0 ? `. Valid fields: ${validFields.join(", ")}` : ""),
                    "UNKNOWN_ORDER_BY_FIELD",
                    {
                        field: encodeRelationAggregateSort(spec),
                        collection: collectionPath,
                        relation: spec.relation,
                        targetCollection: targetCollection.slug,
                        ...(validFields.length > 0 && { validFields })
                    }
                );
            }
            aggregand = sql`${sql.identifier(alias)}.${sql.identifier(column.name)}`;
        } else if (spec.agg !== "count") {
            throw ApiError.badRequest(
                `'${spec.agg}' needs a field to aggregate — only 'count' means something on its own.`,
                "ORDER_BY_FIELD_NOT_SORTABLE",
                { field: encodeRelationAggregateSort(spec), collection: collectionPath }
            );
        }

        // The literal pins the subquery to one row; the column object binds it
        // to the outer row, because a Drizzle column renders qualified with its
        // own table. See `buildRelationScopeCondition`.
        const source: SQL = correlateTo === undefined ? sql`${sourceIdColumn}` : sql`${correlateTo}`;

        let from: SQL;
        let correlation: SQL;

        if (relation.kind === "manyToMany") {
            const { table: junctionName, sourceColumn, targetColumn } = relation.through;
            const junctionTable = registry.getTable(junctionName);
            if (!junctionTable) {
                throw junctionTableMissing(junctionName);
            }
            const sourceCol = junctionTable[sourceColumn as keyof typeof junctionTable] as AnyPgColumn;
            const targetCol = junctionTable[targetColumn as keyof typeof junctionTable] as AnyPgColumn;
            if (!sourceCol || !targetCol) {
                throw new Error(
                    `Junction columns '${sourceColumn}'/'${targetColumn}' not found in '${junctionName}'`
                );
            }
            const targetKey = this.primaryKeyColumn(targetTable);
            if (!targetKey) {
                throw new Error(
                    `No primary key or "id" column in the target table of relation '${relation.relationName}'.`
                );
            }
            const junctionAlias = "__rel_agg_junction";
            from = sql`${targetTable} AS ${sql.identifier(alias)} INNER JOIN ${junctionTable} AS ${sql.identifier(junctionAlias)} ON ${sql.identifier(junctionAlias)}.${sql.identifier(targetCol.name)} = ${sql.identifier(alias)}.${sql.identifier(targetKey.name)}`;
            correlation = sql`${sql.identifier(junctionAlias)}.${sql.identifier(sourceCol.name)} = ${source}`;
        } else if (relation.kind === "belongsTo") {
            const targetKey = this.primaryKeyColumn(targetTable);
            const localKey = relationColumn(table, collection, relation.localKey);
            if (!targetKey || !localKey) {
                throw new Error(
                    `Relation '${relation.relationName}' on '${collectionPath}' names a key that is not a column, ` +
                    "so there is nothing to aggregate against."
                );
            }
            from = sql`${targetTable} AS ${sql.identifier(alias)}`;
            // A to-one reaches one row, so the aggregate is that row's value.
            // Pinning by a literal cursor id means looking the key up on the
            // cursor row rather than reading it off the outer one.
            const owner: SQL = correlateTo === undefined
                ? sql`${localKey}`
                : sql`(SELECT ${sql.identifier(localKey.name)} FROM ${table} WHERE ${sourceIdColumn} = ${correlateTo})`;
            correlation = sql`${sql.identifier(alias)}.${sql.identifier(targetKey.name)} = ${owner}`;
        } else {
            const foreignKey = relationColumn(targetTable, targetCollection, relation.foreignKeyOnTarget);
            if (!foreignKey) {
                throw new Error(
                    `Foreign key column '${relation.foreignKeyOnTarget}' not found in the target table of ` +
                    `relation '${relation.relationName}'.`
                );
            }
            // `sourceKey` names a column other than the primary key when the
            // link joins on one; correlating on the id anyway aggregates over
            // nothing and every row sorts as though it had no related rows.
            const sourceKeyColumn = relation.sourceKey
                ? relationColumn(table, collection, relation.sourceKey)
                : sourceIdColumn;
            if (!sourceKeyColumn) {
                throw new Error(
                    `\`sourceKey: "${relation.sourceKey}"\` on relation '${relation.relationName}' is not a ` +
                    `column on '${collectionPath}'.`
                );
            }
            const pinned: SQL = correlateTo === undefined
                ? sql`${sourceKeyColumn}`
                : relation.sourceKey
                    ? sql`(SELECT ${sql.identifier(sourceKeyColumn.name)} FROM ${table} WHERE ${sourceIdColumn} = ${correlateTo})`
                    : sql`${correlateTo}`;
            from = sql`${targetTable} AS ${sql.identifier(alias)}`;
            correlation = sql`${sql.identifier(alias)}.${sql.identifier(foreignKey.name)} = ${pinned}`;
        }

        // The function name is not interpolated from input: it comes off a
        // five-member union the parser validated, and is written out here so
        // nothing string-shaped reaches the statement.
        const aggregate = AGGREGATE_SQL[spec.agg];
        return sql`(SELECT ${aggregate}(${aggregand}) FROM ${from} WHERE ${correlation})`;
    }

    /** The column a table's rows are keyed by: its primary key, else `id`. */
    private static primaryKeyColumn(table: PgTable<any>): AnyPgColumn | undefined {
        return (Object.values(table).find((col: Record<string, unknown>) => col.primary)
            ?? Object.values(table).find((col: Record<string, unknown>) => col.name === "id")) as AnyPgColumn | undefined;
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
            case "in": {
                // Membership against a null *value* is a null check, not an
                // empty list — the admin's "filter for null values" control
                // emits whichever operator is selected, so `["in", null]` is
                // how it asks for a null foreign key when the user picked
                // `in`. Reading it as an empty list dropped the condition
                // outright, which widened the read to every row.
                if (value === null || value === undefined) {
                    return sql`${column} IS NULL`;
                }
                const values = toMembershipList(value);
                // An empty list matches nothing. Returning no condition — what
                // this did — matches *everything*, which is the same inversion
                // one layer down from the one `UnknownFilterFieldsMode` exists
                // for. It is the dangerous shape too: `filter: { id: ["in",
                // teamIds] }` with no teams is how a caller asks for nothing,
                // and it answered with the whole table.
                return values.length === 0 ? sql`FALSE` : inArray(column, values);
            }
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
                // "Overlaps nothing" is false, not a licence to skip the
                // condition. The single-value fallback below is for a *scalar*
                // operand; an empty array fell into it and built
                // `@> ARRAY[$1]` around an empty binding.
                if (Array.isArray(value) && value.length === 0) {
                    return sql`FALSE`;
                }
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
            case "not-in": {
                // The mirror of `in` above, including the empty list — which
                // excludes nothing, and so matches every row. Same condition
                // the old code produced by accident, now on purpose and for
                // the empty list only.
                if (value === null || value === undefined) {
                    return sql`${column} IS NOT NULL`;
                }
                const values = toMembershipList(value);
                if (values.length === 0) return sql`TRUE`;
                return sql`${column} NOT IN (${sql.join(values.map(v => sql`${v}`), sql`, `)})`;
            }
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
                // The relation path five hundred lines up already refuses this,
                // and says why: "returning `null` for an operator this cannot
                // express would drop the condition", and a dropped condition
                // widens the result. The column path is its twin and kept the
                // warning — so `{ status: ["contains", "x"] }` filtered on
                // nothing and answered 200 with every row, which reads as data
                // that matched.
                //
                // The wire layer rejects operator-shaped unknowns before they
                // arrive (`UnknownFilterOperatorError`, 400). What reaches here
                // came from in-process `rebase.dataAsAdmin`, a stored filter preset or
                // a config — none of them typechecked at the call site, all of
                // them able to name an operator that no longer exists.
                throw ApiError.badRequest(
                    `Unknown filter operator '${op}'. Valid operators: ${ALL_WHERE_FILTER_OPS.join(", ")}.`,
                    "UNKNOWN_FILTER_OPERATOR",
                    { operator: op, validOperators: ALL_WHERE_FILTER_OPS }
                );
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
            throw junctionTableMissing(through.table);
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
            const targetIdCol = this.primaryKeyColumn(targetTable);
            if (!targetIdCol) {
                throw new Error(
                    `No primary key or "id" column in the target table of relation '${relation.relationName}'.`
                );
            }
            return match(targetIdCol);
        }

        const foreignKeyCol = relationColumn(targetTable, targetOf(relation), relation.foreignKeyOnTarget);
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
     * Build search conditions for text fields.
     *
     * Two shapes, chosen by whether the collection declared a `search` block:
     *
     * - **Declared** — one `@@ websearch_to_tsquery` against the generated
     *   `tsvector` column. Stems, drops stopwords, AND-es the terms, reaches
     *   inside JSONB and arrays, and uses the GIN index.
     * - **Not declared** — the original `ILIKE '%term%'` OR-ed across top-level
     *   string properties, with the term escaped (see {@link escapeLikePattern})
     *   so it is matched as the literal text the user typed.
     *
     * The second is the default and stays the default. A collection that has
     * not opted in compiles to exactly the SQL it compiled to before this
     * branch existed, which is the only reason it is safe to have added it.
     *
     * `collection` is optional so that the callers which genuinely have no
     * collection in hand — nested paths, derived views — keep working; without
     * one there is no `search` block to read and the ILIKE path is correct.
     */
    static buildSearchConditions(
        searchString: string,
        properties: Record<string, unknown>,
        table: PgTable<any>,
        collection?: CollectionConfig
    ): SQL[] {
        const searchConditions: SQL[] = [];

        const ftsCondition = collection
            ? DrizzleConditionBuilder.buildFullTextCondition(searchString, table, collection)
            : undefined;
        if (ftsCondition) return [ftsCondition];

        let declaredStringProperties = 0;

        for (const [key, prop] of Object.entries(properties)) {
            const p = prop as Record<string, unknown>;
            // Only include string properties that don't have enum defined
            // PostgreSQL enum and uuid columns don't support ILIKE, so we skip them
            if (p.type === "string" && !p.enum && p.isId !== "uuid") {
                declaredStringProperties++;
                const fieldColumn = table[key as keyof typeof table] as AnyPgColumn;
                if (fieldColumn && supportsILike(fieldColumn)) {
                    searchConditions.push(ilike(fieldColumn, `%${escapeLikePattern(searchString)}%`));
                }
            }
        }

        // Every string property was rejected, so the caller is about to turn an
        // empty condition list into "match nothing" — a 200 with an empty page,
        // which reads as "no such row" rather than as the breakage it is. Say so
        // once per query: this is how the `instanceof` version of
        // {@link supportsILike} failed silently in the field for months.
        if (declaredStringProperties > 0 && searchConditions.length === 0) {
            logger.warn(
                `[search] "${collection?.slug ?? "collection"}" declares ${declaredStringProperties} string ` +
                "property(ies) but none compiled to a searchable column, so this search can only return nothing. " +
                "Check that the generated schema's column types are text/varchar/char."
            );
        }

        return searchConditions;
    }

    /**
     * The `@@` predicate for a collection that declared a `search` block, or
     * undefined for one that did not.
     *
     * The query is normalized exactly as the indexed content was — same text
     * search configuration, same accent folding. Skipping that on the query
     * side is the subtle way to get a search that matches nothing: the column
     * would hold `gestion` while the query asked for `gestión`.
     *
     * `websearch_to_tsquery` rather than `plainto_tsquery` because it is the
     * one that behaves the way a search box looks like it should — quoted
     * phrases, `or`, and a leading `-` to exclude — and because it never throws
     * on user input, which `to_tsquery` does on so much as a stray parenthesis.
     */
    static buildFullTextCondition(
        searchString: string,
        table: PgTable<any>,
        collection: CollectionConfig
    ): SQL | undefined {
        let spec: SearchColumnSpec | undefined;
        try {
            spec = buildSearchColumnSpec(collection);
        } catch {
            // Reported at boot. Falling back to ILIKE here keeps reads serving.
            return undefined;
        }
        if (!spec) return undefined;

        const column = table[spec.column as keyof typeof table] as AnyPgColumn | undefined;
        if (!column) {
            // The block is declared but the column is not on the table yet —
            // a database that has not been migrated. ILIKE still answers.
            return undefined;
        }

        const query = DrizzleConditionBuilder.normalizedTsQuery(searchString, spec);
        const exact = sql`${column} @@ ${query}`;

        if (!spec.fuzzy) return exact;

        const fuzzyColumn = table[spec.fuzzy.column as keyof typeof table] as AnyPgColumn | undefined;
        if (!fuzzyColumn) return exact;

        const needle = spec.unaccent
            ? sql`${sql.raw(SEARCH_UNACCENT_FN)}(${searchString})`
            : sql`${searchString}`;

        // `word_similarity(query, document)`, not `similarity`. `similarity`
        // scores two strings as wholes, so a short query against a whole row's
        // text scores near zero however well it matches part of it — measured:
        // "iso 14001 auditor" against one candidate's concatenated fields
        // scores 0.228 by `similarity` and 0.783 by `word_similarity`. The
        // first is below any usable threshold, which would have made `fuzzy`
        // a setting that quietly did nothing.
        //
        // Argument order matters: the first operand is the needle, and the
        // score is its similarity to the best-matching extent of the second.
        //
        // Both the function and the operator are schema-qualified: pg_trgm is
        // installed into `public`, and an unqualified reference resolves
        // through `search_path`, which does not necessarily reach it.
        const similar = sql`public.word_similarity(${needle}, ${fuzzyColumn}) >= ${spec.fuzzy.threshold}`;
        // `<%` is the index-backed form, but it tests against the session's
        // `pg_trgm.word_similarity_threshold` (0.6), not ours. Above that
        // default the operator narrows using the trigram index and the explicit
        // score refines; at or below it, the operator would exclude rows the
        // declared threshold admits, so the score stands alone and the planner
        // scans — correct either way, and only the faster path is conditional.
        const fuzzy = spec.fuzzy.threshold > PG_TRGM_WORD_SIMILARITY_DEFAULT
            ? sql`(${needle} OPERATOR(public.<%) ${fuzzyColumn} AND ${similar})`
            : similar;

        return sql`(${exact} OR ${fuzzy})`;
    }

    /**
     * `websearch_to_tsquery(<config>, <normalized search string>)`.
     *
     * Split out because the ranking expression needs the identical query — a
     * row ranked against a different tsquery than it was matched against is a
     * ranking of something else.
     */
    static normalizedTsQuery(searchString: string, spec: SearchColumnSpec): SQL {
        const normalized = spec.unaccent
            ? sql`${sql.raw(SEARCH_UNACCENT_FN)}(${searchString})`
            : sql`${searchString}`;
        return sql`websearch_to_tsquery(${spec.language}, ${normalized})`;
    }

    /**
     * A JSONB array of `{ field, snippet }` naming which declared fields matched
     * and showing the text around each hit — what backs `_matches`.
     *
     * A ranked list answers "which rows", never "why this row". For a talent
     * pool that difference is the product: a candidate surfacing for
     * "iso 14001" on a *certification* is a different candidate from one whose
     * bio happens to mention the standard, and the score cannot tell them apart.
     *
     * Built as a correlated subquery over a `VALUES` list of the declared
     * fields, rather than one `CASE` per field, so the shape does not change
     * with the number of fields and the empty result is a plain `[]`.
     *
     * `ts_headline` runs over the same normalized text that was indexed. Over
     * the *original* text it would find nothing to mark whenever `unaccent` is
     * on — the query's lexemes are folded and the document's are not — and
     * would return the text silently unhighlighted. Folded-but-marked beats
     * pretty-but-inert.
     *
     * Undefined when the collection has not opted in, when the column is not on
     * the table yet, or when the caller did not ask: this costs a `ts_headline`
     * per field per row and `ts_headline` re-parses the document.
     */
    static buildSearchMatchesExpression(
        searchString: string,
        table: PgTable<any>,
        collection: CollectionConfig
    ): SQL | undefined {
        let spec: SearchColumnSpec | undefined;
        try {
            spec = buildSearchColumnSpec(collection);
        } catch {
            return undefined;
        }
        if (!spec || spec.fields.length === 0) return undefined;
        if (!table[spec.column as keyof typeof table]) return undefined;

        const query = DrizzleConditionBuilder.normalizedTsQuery(searchString, spec);
        const config = sql`${spec.language}`;

        // `ord` keeps the author's declared field order in the output, so the
        // most important field they named reads first rather than whichever
        // Postgres aggregated first.
        const rows = spec.fields.map((f, i) =>
            sql`(${i}, ${f.path}, ${sql.raw(f.textSql)})`
        );

        return sql`(
            SELECT coalesce(jsonb_agg(s.m ORDER BY f.ord), '[]'::jsonb)
            FROM (VALUES ${sql.join(rows, sql`, `)}) AS f(ord, path, txt)
            CROSS JOIN LATERAL (
                SELECT jsonb_build_object(
                    'field', f.path,
                    'snippet', ts_headline(${config}::regconfig, f.txt, ${query},
                        'StartSel=<mark>,StopSel=</mark>,MaxWords=14,MinWords=1,MaxFragments=1,FragmentDelimiter= … ')
                ) AS m
                WHERE to_tsvector(${config}::regconfig, f.txt) @@ ${query}
            ) s
        )`;
    }

    /**
     * `ts_rank(<column>, <query>)` for the collection, or undefined when it has
     * not opted in. This is what backs `orderBy: ["_score", "desc"]`.
     */
    static buildSearchRankExpression(
        searchString: string,
        table: PgTable<any>,
        collection: CollectionConfig
    ): SQL | undefined {
        let spec: SearchColumnSpec | undefined;
        try {
            spec = buildSearchColumnSpec(collection);
        } catch {
            return undefined;
        }
        if (!spec) return undefined;
        const column = table[spec.column as keyof typeof table] as AnyPgColumn | undefined;
        if (!column) return undefined;

        const rank = sql`ts_rank(${column}, ${DrizzleConditionBuilder.normalizedTsQuery(searchString, spec)})`;
        if (!spec.fuzzy) return rank;

        const fuzzyColumn = table[spec.fuzzy.column as keyof typeof table] as AnyPgColumn | undefined;
        if (!fuzzyColumn) return rank;

        // With `fuzzy` on, `ts_rank` alone is not a ranking — it is zero for
        // every row the trigram path matched and the exact path did not, which
        // is the whole population of a typo'd query. Measured on the real
        // sustentalent pool: "auditor de iso14000" matches four candidates,
        // every one of them at ts_rank 0, so ordering by rank alone returned
        // the best match in whatever order the table felt like.
        //
        // Summed rather than blended with tuned constants: a row that matched
        // exactly contributes both terms, so it outranks a fuzzy-only row of
        // equal similarity without needing a coefficient to say so. Both terms
        // are non-negative and monotonic, which is all the ordering needs.
        const needle = spec.unaccent
            ? sql`${sql.raw(SEARCH_UNACCENT_FN)}(${searchString})`
            : sql`${searchString}`;
        return sql`(${rank} + public.word_similarity(${needle}, ${fuzzyColumn}))`;
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
            throw junctionTableMissing(through.table);
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
     *
     * `property` is `?vector_search=` off the querystring, so it is an untrusted
     * *name*, and it used to be looked up straight in the drizzle table object.
     * Two ways that went wrong, both answering 500 to a malformed request:
     * `?vector_search=title` built `"title" <=> '[1,2]'::vector`, which the
     * database rejects with "operator does not exist"; and a table object also
     * carries non-column keys (`_`, methods), which passed the `if (!column)`
     * guard and compiled to nonsense. The name is resolved against the table's
     * actual columns and required to be a `vector` — anything else is the
     * caller's mistake and gets a 400 that says so.
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
        const column = DrizzleConditionBuilder.resolveVectorColumn(table, vectorSearch.property);

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

    /**
     * The `vector` column a request named, or a 400 explaining what it named.
     *
     * `getTableColumns` rather than a key lookup: it returns only the columns,
     * so `_`, `getSQL` and every other property of a drizzle table stop looking
     * like candidates. The type check is on the *physical* column
     * (`vector(1536)`) rather than on the declared property, so it holds for an
     * introspected collection too, where the property carries no Rebase type.
     */
    private static resolveVectorColumn(table: PgTable<any>, property: string): AnyPgColumn {
        const columns = getTableColumns(table) as Record<string, AnyPgColumn> | undefined;
        const column = columns?.[property];
        if (!column) {
            const known = Object.entries(columns ?? {})
                .filter(([, c]) => isVectorColumn(c))
                .map(([name]) => name);
            throw ApiError.badRequest(
                `Unknown vector property "${property}". ` +
                (known.length > 0
                    ? `This collection's vector properties are: ${known.join(", ")}.`
                    : "This collection declares no `vector` property to search."),
                "UNKNOWN_VECTOR_PROPERTY"
            );
        }
        if (!isVectorColumn(column)) {
            throw ApiError.badRequest(
                `Property "${property}" is not a vector column (it is \`${columnSqlType(column) || "unknown"}\`), ` +
                "so it has no distance operator. Name the property declared as `{ type: \"vector\" }`.",
                "UNKNOWN_VECTOR_PROPERTY"
            );
        }
        return column;
    }
}

/** The column's SQL type, for a value that may not be a drizzle column at all. */
const columnSqlType = (column: unknown): string => {
    const getSQLType = (column as { getSQLType?: () => string })?.getSQLType;
    return typeof getSQLType === "function" ? getSQLType.call(column).toLowerCase() : "";
};

/** True for `vector(1536)` and its pgvector siblings, whatever the width. */
const isVectorColumn = (column: unknown): boolean =>
    /^(vector|halfvec|sparsevec)\b/.test(columnSqlType(column));

/**
 * Alias for DrizzleConditionBuilder for consistent naming with other database implementations.
 * This allows code to use PostgresConditionBuilder alongside future MongoConditionBuilder, etc.
 */
export const PostgresConditionBuilder = DrizzleConditionBuilder;

