import { Entity, FindParams } from "@rebasepro/types";

/**
 * One page as a walk reads it. A collection accessor's `FindResponse` is one;
 * `nextCursor` is what the REST listing adds whenever another page follows
 * (`PaginationMeta.nextCursor`), and the admin's data client passes it through.
 */
export interface EntityPage<M extends Record<string, unknown>> {
    data: Entity<M>[];
    meta?: {
        total?: number;
        hasMore?: boolean;
        nextCursor?: string;
    };
}

/** The slice of a collection accessor a page walk needs. */
export interface EntityPageAccessor<M extends Record<string, unknown>> {
    find(params?: FindParams<M>): Promise<EntityPage<M>>;
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
 * Each page after the first continues from the server's `meta.nextCursor`
 * (sent back as `after`) whenever the previous page carried one. Paging by
 * `offset` made the database skip every row already read on every request, so
 * a walk cost the square of the collection; a seek reads only the next page,
 * and rows written mid-walk no longer shift it. Where no cursor comes —
 * relevance ordering, a server that predates cursors — or one stops advancing,
 * it pages by `offset` from the rows it has read. `after` and `offset` are
 * never sent together (the server refuses that, `CURSOR_WITH_OFFSET`).
 *
 * @throws When more than `maxRows` rows match. A truncated answer is worse than
 * no answer: it is indistinguishable from a complete one.
 */
export async function walkEntityPages<M extends Record<string, unknown>>(
    params: WalkEntityPagesParams<M>
): Promise<Entity<M>[]> {
    const rows: Entity<M>[] = [];
    await forEachEntityPage<M>({
        ...params,
        onPage: (page) => {
            rows.push(...page);
        }
    });
    return rows;
}

/**
 * {@link walkEntityPages}, handing each page to `onPage` as it arrives instead
 * of collecting them: the next page is read once `onPage` has settled, and
 * nothing here keeps a page after that. For a caller that can consume a page
 * and let it go — an export writing its file as it reads.
 *
 * @throws When more than `maxRows` rows match — after handing on the pages
 * before the one that crossed it.
 */
export async function forEachEntityPage<M extends Record<string, unknown>>({
    accessor,
    params,
    pageSize,
    maxRows,
    onCeiling,
    onProgress,
    signal,
    onPage
}: WalkEntityPagesParams<M> & {
    onPage: (page: Entity<M>[]) => void | Promise<void>;
}): Promise<void> {

    let loaded = 0;
    let offset = 0;
    let after: string | undefined;

    for (; ;) {
        if (signal?.aborted) break;

        const res = await accessor.find({
            ...params,
            limit: pageSize,
            ...(after ? { after } : { offset })
        } as FindParams<M>);

        const page = res?.data ?? [];
        loaded += page.length;
        onProgress?.(loaded, res?.meta?.total);

        if (loaded > maxRows)
            throw new Error(onCeiling(maxRows));

        if (page.length > 0) await onPage(page);

        // An empty page ends the walk whatever the metadata says, so a server
        // that keeps answering `hasMore` cannot spin forever.
        if (page.length === 0) break;
        if (res?.meta && !res.meta.hasMore) break;

        // By rows received, not by `pageSize`: a server whose ceiling is lower
        // than the page we asked for would otherwise skip everything it clamped.
        // Counted on seeked pages too, so a fall back to offset resumes where
        // the walk has got to.
        offset += page.length;
        // A cursor equal to the one just sent cannot advance the walk; offset
        // still can.
        const next = res?.meta?.nextCursor;
        after = next && next !== after ? next : undefined;
    }
}
