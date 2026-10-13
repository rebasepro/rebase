import type { CollectionCallbacks, FilterValues, QueryNarrowing, User } from "@rebasepro/types";
import { toFilterTuples } from "../data/filter-conditions";

/**
 * Combine several sets of collection callbacks into one set, run in the order
 * given.
 *
 * A collection has one `callbacks` object, the backend one global `callbacks`
 * object, and `setCollectionCallbacks` replaces rather than adds. When two
 * independent pieces of behaviour — an audit trail and a slug generator, a
 * tenant scope and a soft-delete filter — belong on the same collection, this
 * makes them one set, so neither has to know about the other:
 *
 * ```ts
 * import { composeCallbacks, defineCollection } from "@rebasepro/cms-types";
 *
 * export default defineCollection({
 *     slug: "posts",
 *     // …
 *     callbacks: composeCallbacks(auditTrail, slugFromTitle)
 * });
 * ```
 *
 * Each hook combines exactly as the backend combines its own tiers — global,
 * then collection, then property — so composing two sets into the collection's
 * slot behaves as if the first were the global set and the second the
 * collection's:
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
 * - A throw stops the composed hook and propagates as it is, exactly as a
 *   throw from a tier stops the backend's — except in `afterSaveError`, where,
 *   as between tiers, a set that throws does not keep the next from running;
 *   the first error is rethrown once all have run (an `AggregateError` when
 *   more than one threw).
 *
 * `undefined` entries are skipped, so an optional set can be passed as it is.
 * A hook is present on the result only when some set has it: a collection
 * composed of sets with no `beforeQuery` still has none, and its reads stay on
 * the path that does not need one. Pure — nothing is registered anywhere.
 *
 * @group Hooks and utilities
 */
export function composeCallbacks<M extends Record<string, unknown> = Record<string, unknown>, USER extends User = User>(
    ...sets: (CollectionCallbacks<M, USER> | undefined)[]
): CollectionCallbacks<M, USER> {
    const present = sets.filter((set): set is CollectionCallbacks<M, USER> => set !== undefined);
    const composed: CollectionCallbacks<M, USER> = {};

    // Each hook is called through its set, never detached from it, so a set
    // written with methods that use `this` keeps working when composed.

    if (present.some(set => set.beforeSave)) {
        composed.beforeSave = async (props) => {
            let values = props.values;
            for (const set of present) {
                if (!set.beforeSave) continue;
                const result = await set.beforeSave({ ...props, values });
                if (result) values = { ...values, ...result };
            }
            return values;
        };
    }

    if (present.some(set => set.afterRead)) {
        composed.afterRead = async (props) => {
            let row = props.row;
            for (const set of present) {
                if (!set.afterRead) continue;
                row = (await set.afterRead({ ...props, row })) ?? row;
            }
            return row;
        };
    }

    if (present.some(set => set.beforeQuery)) {
        composed.beforeQuery = async (props) => {
            let combined: QueryNarrowing<M> | undefined;
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
 * One narrowing that holds exactly the rows both hold.
 *
 * Filters are merged field by field — a field both name gets both conditions,
 * which a filter AND-s — so the filter stays a filter and compiles as one.
 * Logical groups are joined under an `and`.
 */
function bothNarrowings<M extends Record<string, unknown>>(
    first: QueryNarrowing<M>,
    second: QueryNarrowing<M>
): QueryNarrowing<M> {
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
