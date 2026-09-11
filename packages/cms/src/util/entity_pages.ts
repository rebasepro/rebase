import { Entity, FindParams, FindResponse } from "@rebasepro/types";

/** The slice of a collection accessor a page walk needs. */
export interface EntityPageAccessor<M extends Record<string, unknown>> {
    find(params?: FindParams<M>): Promise<FindResponse<M>>;
}

export interface WalkEntityPagesParams<M extends Record<string, unknown>> {
    accessor: EntityPageAccessor<M>;
    /** Query to walk. The window (`limit` / `offset` / `page`) is owned by the walk. */
    params?: Omit<FindParams<M>, "limit" | "offset" | "page">;
    pageSize: number;
    /** Walking past this many rows throws, with `onCeiling`'s message. */
    maxRows: number;
    onCeiling: (maxRows: number) => string;
    /** Called after every page with the rows so far, and the total when the server reports one. */
    onProgress?: (loaded: number, total: number | undefined) => void;
    /** Checked between pages. When it aborts, what has been read so far is returned. */
    signal?: { aborted: boolean };
}

/**
 * Read **every** row matching a query, one page at a time.
 *
 * `find({})` sends no `limit`, and an absent limit is resolved server-side to
 * `DEFAULT_LIST_LIMIT` — 50 rows. Anything that means "all of them" and asks
 * once gets 50 back, with nothing to say that is what happened.
 *
 * Termination is driven by the server's `meta.hasMore` where it is reported and
 * by an empty page otherwise — never by comparing a page's length against the
 * requested limit, since a final page that happens to be exactly full is
 * indistinguishable that way and a walk that stops there drops rows.
 *
 * @throws When more than `maxRows` rows match. A truncated answer is worse than
 * no answer: it is indistinguishable from a complete one.
 */
export async function walkEntityPages<M extends Record<string, unknown>>({
    accessor,
    params,
    pageSize,
    maxRows,
    onCeiling,
    onProgress,
    signal
}: WalkEntityPagesParams<M>): Promise<Entity<M>[]> {

    const rows: Entity<M>[] = [];
    let offset = 0;

    for (; ;) {
        if (signal?.aborted) break;

        const res = await accessor.find({
            ...params,
            limit: pageSize,
            offset
        } as FindParams<M>);

        const page = res?.data ?? [];
        rows.push(...page);
        onProgress?.(rows.length, res?.meta?.total);

        if (rows.length > maxRows)
            throw new Error(onCeiling(maxRows));

        // An empty page ends the walk whatever the metadata says, so a server
        // that keeps answering `hasMore` cannot spin forever.
        if (page.length === 0) break;
        if (res?.meta && !res.meta.hasMore) break;

        // By rows received, not by `pageSize`: a server whose ceiling is lower
        // than the page we asked for would otherwise skip everything it clamped.
        offset += page.length;
    }

    return rows;
}
