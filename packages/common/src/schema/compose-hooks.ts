import type { FilterValues, QueryNarrowing, TableHooks, TableRow, User } from "@rebasepro/types";

import { toFilterTuples } from "../data/filter-conditions";

/**
 * Combine several sets of table hooks into one set, run in the order given.
 *
 * A table has one `hooks` object, and `setTableHooks(slug, hooks)` replaces
 * rather than adds. When two independent pieces of behaviour — an audit trail
 * and a slug generator, a tenant scope and a soft-delete filter — belong on
 * the same table, this makes them one set, so neither has to know about the
 * other:
 *
 * ```ts
 * import { composeTableHooks } from "@rebasepro/common";
 *
 * export const posts = defineTable("posts", {
 *     // …
 *     hooks: composeTableHooks(auditTrail, slugFromTitle)
 * });
 * ```
 *
 * The same rules as the backend's own tiers (global hooks, then the table's),
 * hook by hook:
 *
 * - `beforeSave` chains: each set sees the values the previous one returned,
 *   and a returned object is shallow-merged over them (a set that returns
 *   nothing changes nothing).
 * - `afterRead` chains: each set sees the row the previous one returned, and a
 *   set that returns nothing leaves it as it was.
 * - `beforeQuery` narrowings are AND-ed: every set sees the query as the
 *   caller sent it, and the composed narrowing holds only rows every set's
 *   narrowing holds. A set that returns an object with neither `filter` nor
 *   `logical` is answered with that same empty object, which the backend
 *   refuses as it would from a tier.
 * - `beforeDelete` vetoes when any set returns `false`. Every set still runs.
 * - `afterSave` and `afterDelete` run in order, each awaited.
 * - A throw stops the composed hook and propagates as it is — except in
 *   `afterSaveError`, where a set that throws does not keep the next from
 *   running; the first error is rethrown once all have run (an
 *   `AggregateError` when more than one threw).
 *
 * `undefined` entries are skipped, so an optional set can be passed as it is.
 * A hook is present on the result only when some set has it: a table composed
 * of sets with no `beforeQuery` still has none, and its reads stay on the path
 * that does not need one. Each hook is called through its set, so a set
 * written with methods that use `this` keeps working. Pure — nothing is
 * registered anywhere.
 *
 * Typed by the table's row and insert types, so the composed hooks are what
 * `defineTable`'s `hooks` expects for that table.
 *
 * @group Schema
 */
export function composeTableHooks<
    Row extends TableRow = TableRow,
    Insert extends TableRow = Row,
    USER extends User = User
>(...hooks: (TableHooks<Row, Insert, USER> | undefined)[]): TableHooks<Row, Insert, USER> {
    const present = hooks.filter((set): set is TableHooks<Row, Insert, USER> => set !== undefined);
    const composed: TableHooks<Row, Insert, USER> = {};

    if (present.some(set => set.beforeSave)) {
        composed.beforeSave = async (props) => {
            let values = props.values;
            for (const set of present) {
                if (!set.beforeSave) continue;
                // A JavaScript set may return nothing: it then changes nothing.
                const result: Partial<Insert> | undefined = await set.beforeSave({ ...props, values });
                if (result) values = { ...values, ...result };
            }
            return values;
        };
    }

    if (present.some(set => set.afterRead)) {
        composed.afterRead = async (props) => {
            let row: TableRow = props.values;
            for (const set of present) {
                if (!set.afterRead) continue;
                const values = isServedRow<Row>(row) ? row : props.values;
                const result: TableRow | undefined = await set.afterRead({ ...props, values });
                row = result ?? row;
            }
            return row;
        };
    }

    if (present.some(set => set.beforeQuery)) {
        composed.beforeQuery = async (props) => {
            let combined: QueryNarrowing<Row> | undefined;
            for (const set of present) {
                if (!set.beforeQuery) continue;
                const narrowing = await set.beforeQuery(props);
                if (!narrowing) continue;
                if (!narrowing.filter && !narrowing.logical) return narrowing;
                combined = combined ? bothNarrowings(combined, narrowing) : narrowing;
            }
            return combined;
        };
    }

    if (present.some(set => set.beforeDelete)) {
        composed.beforeDelete = async (props) => {
            let vetoed = false;
            for (const set of present) {
                if (!set.beforeDelete) continue;
                if ((await set.beforeDelete(props)) === false) vetoed = true;
            }
            return vetoed ? false : undefined;
        };
    }

    if (present.some(set => set.afterSave)) {
        composed.afterSave = async (props) => {
            for (const set of present) {
                if (set.afterSave) await set.afterSave(props);
            }
        };
    }

    if (present.some(set => set.afterDelete)) {
        composed.afterDelete = async (props) => {
            for (const set of present) {
                if (set.afterDelete) await set.afterDelete(props);
            }
        };
    }

    if (present.some(set => set.afterSaveError)) {
        composed.afterSaveError = async (props) => {
            const errors: unknown[] = [];
            for (const set of present) {
                if (!set.afterSaveError) continue;
                try {
                    await set.afterSaveError(props);
                } catch (error) {
                    errors.push(error);
                }
            }
            if (errors.length === 1) throw errors[0];
            if (errors.length > 1) {
                throw new AggregateError(errors, `${errors.length} composed afterSaveError hooks threw`);
            }
        };
    }

    return composed;
}

/**
 * Whether a row an `afterRead` returned can be handed to the next set as the
 * table's row. `afterRead` returns any row (it may mask or derive keys) and the
 * next set is typed to receive the table's row; the backend passes the row on
 * between its tiers the same way, so any object is accepted.
 */
function isServedRow<Row extends TableRow>(value: TableRow): value is Row {
    return typeof value === "object" && value !== null;
}

/**
 * One narrowing that holds exactly the rows both hold. Filters are merged
 * field by field — a field both name gets both conditions, which a filter
 * AND-s — and logical groups are joined under an `and`.
 */
function bothNarrowings<Row extends TableRow>(first: QueryNarrowing<Row>, second: QueryNarrowing<Row>): QueryNarrowing<Row> {
    const filter = first.filter && second.filter
        ? bothFilters(first.filter, second.filter)
        : first.filter ?? second.filter;
    const logical = first.logical && second.logical
        ? { type: "and" as const, conditions: [first.logical, second.logical] }
        : first.logical ?? second.logical;
    return {
        ...(filter ? { filter } : {}),
        ...(logical ? { logical } : {})
    };
}

function bothFilters(first: FilterValues<string>, second: FilterValues<string>): FilterValues<string> {
    const merged: FilterValues<string> = { ...first };
    for (const [field, condition] of Object.entries(second)) {
        const prior = merged[field];
        merged[field] = prior ? [...toFilterTuples(prior), ...toFilterTuples(condition)] : condition;
    }
    return merged;
}
