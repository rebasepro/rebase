import type { FindParams, FilterValues, LogicalCondition, OrderBySpec } from "@rebasepro/types";

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
     * as plain `[string, direction]` pairs read off user config or a URL, where
     * the columns are not statically known. Narrowing it here would push a cast
     * onto every call site, which is the kind of friction that sends people back
     * to hand-building the object this exists to replace.
     */
    orderBy?: OrderBySpec;
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
    const { searchString, limit, ...rest } = input;
    return {
        ...rest,
        ...resolveLimit(limit),
        ...(searchString ? { searchString, searchExplain: true } : {})
    } as FindParams<M>;
}

/**
 * Keep a meaningless `limit` inside the browser.
 *
 * The API refuses a `limit` below 1 — rightly: a window nobody can be served is
 * better refused than quietly widened. But a client that computes one has a bug
 * *here*, and forwarding it turns that bug into a 400 the user reads as the
 * server being broken. That is exactly how a restored, empty scroll entry
 * presented: an `Invalid limit: 0` error where the table should have been.
 *
 * Only the meaningless end is guarded. An absent limit is a supported request —
 * every ingress defaults it (`resolveClientListLimit`), so dropping one cannot
 * produce an unbounded read — whereas a limit *above* the ceiling states an
 * intent, and silently trimming it would hand back a page the caller cannot
 * tell apart from the whole collection. That one still travels, and is still
 * refused where the ceiling lives.
 */
function resolveLimit(limit: number | undefined): { limit?: number } {
    if (limit === undefined) return {};
    if (Number.isInteger(limit) && limit >= 1) return { limit };
    console.warn(`Ignoring an unusable \`limit\` of ${limit} — a page size must be a whole number of at least 1. ` +
        "Reading with the server's default page size instead.");
    return {};
}
