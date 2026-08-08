import type { FindParams, FilterValues, LogicalCondition } from "@rebasepro/types";

/**
 * The one place a collection read's parameters are assembled.
 *
 * ## Why this exists
 *
 * Four call sites used to build this object by hand — `useCollection` and
 * `useDataTableController`, each in both their `listen` and `find` branches.
 * Every one of them listed the fields it forwarded, so adding an option to
 * `FindParams` meant remembering four places, and forgetting one failed
 * silently: the option simply never reached the server, and the feature it
 * enabled looked broken for reasons nowhere near the code that dropped it.
 *
 * That is not hypothetical. `searchExplain` was added to three of the four and
 * the miss was found by intercepting a WebSocket frame, because nothing else
 * could see it.
 *
 * A field added here reaches every read. `toFindParams` returns `FindParams`
 * itself, so the compiler checks the shape rather than a hand-copied list.
 */
export interface CollectionQueryInput<M extends Record<string, unknown>> {
    where?: FilterValues<Extract<keyof M, string>>;
    logical?: LogicalCondition;
    /**
     * Loosened from `FindParams["orderBy"]` on purpose: callers hold the sort
     * as a plain `[string, direction]` read off user config or a URL, where the
     * column is not statically known. Narrowing it here would push a cast onto
     * every call site, which is the kind of friction that sends people back to
     * hand-building the object this exists to replace.
     */
    orderBy?: [string, "asc" | "desc"];
    limit?: number;
    offset?: number;
    page?: number;
    searchString?: string;
    include?: string[];
}

/**
 * Build the parameters for one collection read.
 *
 * Derived options live here rather than at the call sites, so they cannot
 * disagree: `searchExplain` rides along exactly when there is a search string
 * to explain, which is also the only time it costs anything.
 */
export function toFindParams<M extends Record<string, unknown>>(
    input: CollectionQueryInput<M>
): FindParams<M> {
    const { searchString, ...rest } = input;
    return {
        ...rest,
        ...(searchString ? { searchString, searchExplain: true } : {})
    } as FindParams<M>;
}
