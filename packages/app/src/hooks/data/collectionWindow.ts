import { MAX_LIST_LIMIT } from "@rebasepro/types";
import type { CollectionAccessor, Entity, FindParams } from "@rebasepro/types";

/**
 * The part of a read that says *which* rows, without saying how many or from
 * where. The window adds `limit` and `offset` itself, page by page.
 */
export type CollectionWindowQuery<M extends Record<string, unknown>> =
    Omit<FindParams<M>, "limit" | "offset" | "page" | "after">;

/**
 * What a {@link CollectionWindow} reports on every change.
 */
export interface CollectionWindowState<M extends Record<string, unknown> = Record<string, unknown>> {
    /**
     * The rows in the window, in order, without duplicates.
     *
     * `undefined` until the window first covers what it was opened for — the
     * first page, or every row a restored scroll position had on screen — so a
     * view that is still showing its previous rows keeps them instead of
     * flashing a partial list.
     */
    rows: Entity<M>[] | undefined;
    /** Rows not yet on screen are being read: the first page, or the next one. */
    loading: boolean;
    error: Error | undefined;
    /** A page came back short, so there is nothing past `rows`. */
    complete: boolean;
}

export interface CollectionWindowOptions<M extends Record<string, unknown>> {
    accessor: Pick<CollectionAccessor<M>, "find" | "listen">;
    query: CollectionWindowQuery<M>;
    /** Rows in the first page, which is the one kept live. */
    pageSize: number;
    /** How many rows the window should hold. `Infinity` reads them all. */
    target: number;
    /** Subscribe to the first page when the accessor can. Defaults to `true`. */
    live?: boolean;
    /**
     * Applied to every page as it arrives, before it is merged — the panel's
     * own `afterRead`, for instance.
     */
    process?: (rows: Entity<M>[]) => Promise<Entity<M>[]> | Entity<M>[];
    /**
     * When the subscription fails, read the first page once instead of
     * reporting the failure (which is only reported if that read fails too).
     */
    fallbackToFind?: boolean;
    /**
     * Read the first page once if the subscription has not answered by then.
     * The subscription still wins whenever it does answer.
     */
    firstPaintTimeoutMs?: number;
    onChange: (state: CollectionWindowState<M>) => void;
}

/**
 * A scrolled collection view's rows, read one page at a time.
 *
 * ## Why this exists
 *
 * The table, list, card and board views used to grow a single read: the next
 * page was the same query with `limit` raised by a page, so page *k* re-read
 * the *k − 1* pages before it, and the read that reached row 1,001 asked for a
 * `limit` the API refuses (`MAX_LIST_LIMIT`). Every row past 1,000 was out of
 * reach, behind a developer error. The board clamped at the ceiling instead,
 * and its columns then said they were finished while their own header counted
 * thousands more.
 *
 * ## How it reads
 *
 * - The **first page** is a subscription when the accessor can listen, else a
 *   one-shot read. It is the only live query the window holds.
 * - Every **later page** is a one-shot read by `offset`, of only the rows past
 *   the ones already held, never more than `MAX_LIST_LIMIT` at a time. Offset
 *   rather than the keyset cursor because it is the one paging every sort a
 *   view offers can express — a relevance-ordered search has no cursor — and
 *   because the server breaks ties on the id, so pages neither repeat nor skip
 *   rows under a sort with duplicates.
 * - **Realtime** covers every row held, not only the first page. The server
 *   re-runs a subscription on every write to its collection, so each push after
 *   the first says "something changed". The rows past the first page are then
 *   read again, in reads of at most `MAX_LIST_LIMIT`, and replaced in one step.
 *   Pushes that arrive while that re-read runs are folded into one more.
 *
 * Rows are de-duplicated by id: between a push moving the first page and the
 * re-read of the rest, a row can briefly belong to both.
 */
export class CollectionWindow<M extends Record<string, unknown>> {

    private readonly accessor: CollectionWindowOptions<M>["accessor"];
    private readonly query: CollectionWindowQuery<M>;
    private readonly pageSize: number;
    private readonly options: CollectionWindowOptions<M>;
    /** Rows the window must hold before it first shows any. */
    private readonly holdUntil: number;

    private target: number;
    private head: Entity<M>[] | undefined;
    /** The first page came back full, so there may be more past it. */
    private headFull = false;
    /** Rows past the first page, from offset `pageSize` on. */
    private tail: Entity<M>[] = [];
    /** The last read past the first page came back short. */
    private tailEnded = false;
    /** The first page changed after it first arrived: re-read the rest. */
    private stale = false;
    private pumping = false;
    private loadingMore = false;
    private headError: Error | undefined;
    private tailError: Error | undefined;
    private settled = false;
    private disposed = false;
    private headSequence = 0;
    private liveAnswered = false;
    private unsubscribe: (() => void) | undefined;
    private firstPaintTimer: ReturnType<typeof setTimeout> | undefined;

    constructor(options: CollectionWindowOptions<M>) {
        this.options = options;
        this.accessor = options.accessor;
        this.query = options.query;
        // A page the API would refuse is not a page; the ceiling is the page.
        this.pageSize = Math.max(1, Math.min(Math.floor(options.pageSize), MAX_LIST_LIMIT));
        this.target = normalizeTarget(options.target);
        // A restored scroll position asks for as many rows as it had on screen,
        // and showing the first page of them first would throw that position
        // away. "Everything" is the exception: the first page shows at once and
        // the rest follow.
        this.holdUntil = Number.isFinite(this.target) ? this.target : this.pageSize;
    }

    start(): void {
        if (this.disposed) return;
        const live = this.options.live !== false && Boolean(this.accessor.listen);
        if (!live) {
            this.readHeadOnce(true);
            return;
        }
        this.unsubscribe = this.accessor.listen!(
            { ...this.query, limit: this.pageSize },
            (response) => {
                this.liveAnswered = true;
                void this.receiveHead(response.data);
            },
            (error) => this.receiveLiveError(error)
        );
        const timeout = this.options.firstPaintTimeoutMs;
        if (timeout !== undefined) {
            this.firstPaintTimer = setTimeout(() => {
                if (this.disposed || this.liveAnswered || this.head !== undefined) return;
                this.readHeadOnce(false);
            }, timeout);
        }
    }

    /** Hold this many rows. Fewer than are held drops the rows past it. */
    setTarget(target: number): void {
        if (this.disposed) return;
        const next = normalizeTarget(target);
        if (next === this.target) return;
        this.target = next;
        const keep = Math.max(0, next - this.pageSize);
        if (this.tail.length > keep) {
            this.tail = this.tail.slice(0, keep);
            this.tailEnded = false;
        }
        // Asking for more is also how a view retries a page that failed.
        this.tailError = undefined;
        this.emit();
        void this.pump();
    }

    dispose(): void {
        this.disposed = true;
        if (this.firstPaintTimer !== undefined) clearTimeout(this.firstPaintTimer);
        this.unsubscribe?.();
        this.unsubscribe = undefined;
    }

    private readHeadOnce(reportFailure: boolean, liveError?: Error): void {
        let request: Promise<{ data: Entity<M>[] }>;
        try {
            request = Promise.resolve(this.accessor.find({ ...this.query, limit: this.pageSize }));
        } catch (error) {
            request = Promise.reject(error);
        }
        request
            .then((response) => {
                // The subscription answered while this was in flight: it wins.
                if (this.disposed || (!reportFailure && this.liveAnswered && !liveError)) return;
                return this.receiveHead(response.data);
            })
            .catch((error: unknown) => {
                if (this.disposed || !reportFailure) return;
                this.headError = liveError ?? toError(error);
                this.emit();
            });
    }

    private receiveLiveError(error: Error): void {
        if (this.disposed) return;
        if (this.options.fallbackToFind) {
            this.readHeadOnce(true, error);
            return;
        }
        this.headError = error;
        this.emit();
    }

    private async receiveHead(rows: Entity<M>[] | undefined): Promise<void> {
        const sequence = ++this.headSequence;
        const raw = rows ?? [];
        let processed: Entity<M>[];
        try {
            processed = await this.process(raw);
        } catch (error) {
            if (this.disposed || sequence !== this.headSequence) return;
            this.headError = toError(error);
            this.emit();
            return;
        }
        // A newer push overtook this one while it was being processed.
        if (this.disposed || sequence !== this.headSequence) return;
        const first = this.head === undefined;
        this.head = processed;
        this.headFull = raw.length >= this.pageSize;
        this.headError = undefined;
        if (!this.headFull) {
            // The whole set fits in the first page: nothing is held past it.
            this.tail = [];
            this.tailEnded = false;
            this.stale = false;
        } else if (!first) {
            this.stale = true;
            this.tailError = undefined;
        }
        this.emit();
        await this.pump();
    }

    /** Rows still wanted past the ones held. */
    private wanted(): number {
        if (this.head === undefined || !this.headFull || this.tailEnded || this.tailError) return 0;
        return Math.max(0, this.target - this.pageSize - this.tail.length);
    }

    /**
     * The one loop that reads past the first page, so a re-read and a next page
     * never run at the same time and interleave their offsets.
     */
    private async pump(): Promise<void> {
        if (this.pumping) return;
        this.pumping = true;
        try {
            while (!this.disposed && this.head !== undefined) {
                if (this.stale && this.headFull && !this.tailError) {
                    this.stale = false;
                    await this.reread();
                    continue;
                }
                const wanted = this.wanted();
                if (wanted > 0) {
                    await this.readNext(wanted);
                    continue;
                }
                break;
            }
        } finally {
            this.pumping = false;
        }
        this.emit();
    }

    private async readNext(wanted: number): Promise<void> {
        const offset = this.pageSize + this.tail.length;
        const limit = Math.min(MAX_LIST_LIMIT, wanted);
        this.loadingMore = true;
        this.emit();
        try {
            const response = await this.accessor.find({ ...this.query, limit, offset });
            if (this.disposed) return;
            const raw = response.data ?? [];
            const processed = await this.process(raw);
            if (this.disposed) return;
            this.tail = this.tail.concat(processed);
            if (raw.length < limit) this.tailEnded = true;
        } catch (error) {
            if (this.disposed) return;
            this.tailError = toError(error);
        } finally {
            this.loadingMore = false;
        }
        this.emit();
    }

    /** Read every held row past the first page again, and swap them in at once. */
    private async reread(): Promise<void> {
        const span = this.tail.length;
        if (span === 0) return;
        const fresh: Entity<M>[] = [];
        let ended = false;
        let offset = this.pageSize;
        try {
            while (fresh.length < span) {
                const limit = Math.min(MAX_LIST_LIMIT, span - fresh.length);
                const response = await this.accessor.find({ ...this.query, limit, offset });
                if (this.disposed) return;
                const raw = response.data ?? [];
                fresh.push(...await this.process(raw));
                if (this.disposed) return;
                offset += raw.length;
                if (raw.length < limit) {
                    ended = true;
                    break;
                }
            }
        } catch (error) {
            if (this.disposed) return;
            this.tailError = toError(error);
            this.emit();
            return;
        }
        // Rows held past a target that shrank while this ran stay dropped.
        const keep = Math.max(0, this.target - this.pageSize);
        this.tail = fresh.length > keep ? fresh.slice(0, keep) : fresh;
        this.tailEnded = ended && fresh.length <= keep;
        this.emit();
    }

    private async process(rows: Entity<M>[]): Promise<Entity<M>[]> {
        return this.options.process ? await this.options.process(rows) : rows;
    }

    private complete(): boolean {
        if (this.head === undefined) return false;
        return !this.headFull || this.tailEnded;
    }

    private emit(): void {
        if (this.disposed) return;
        const error = this.headError ?? this.tailError;
        if (!this.settled && this.head !== undefined) {
            const held = this.pageSize + this.tail.length;
            if (this.complete() || held >= Math.min(this.holdUntil, this.target) || this.tailError) {
                this.settled = true;
            }
        }
        const rows = this.settled ? this.rows() : undefined;
        this.options.onChange({
            rows,
            loading: (this.head === undefined && !this.headError) || this.loadingMore || (!this.settled && !error),
            error,
            complete: this.complete()
        });
    }

    private rows(): Entity<M>[] {
        const head = this.head ?? [];
        if (this.tail.length === 0) return head;
        const seen = new Set<string>();
        const out: Entity<M>[] = [];
        for (const row of head.concat(this.tail)) {
            const key = String(row.id);
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(row);
        }
        return out;
    }
}

function normalizeTarget(target: number): number {
    if (target === Infinity) return Infinity;
    if (!Number.isFinite(target)) return 0;
    return Math.max(0, Math.floor(target));
}

function toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}
