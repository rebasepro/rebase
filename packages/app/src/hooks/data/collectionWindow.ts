import { MAX_LIST_LIMIT } from "@rebasepro/types";
import type { CollectionAccessor, Entity, FindParams } from "@rebasepro/types";

import { isConnectionLostError } from "../../util/realtime";

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
    /**
     * The same rows by position, with `undefined` where a row exists but has
     * not been read — the rows above a scroll position the window was
     * restored to ({@link CollectionWindowOptions.seed}), until the view
     * scrolls to them. Absent when nothing is missing, which is always the
     * case for a window no view reports a range to: `rows` is then complete
     * from the first row.
     */
    sparse?: (Entity<M> | undefined)[];
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
    /**
     * The quiet time kept between the end of one re-read of the rows past the
     * first page and the start of the next. Defaults to
     * {@link REREAD_INTERVAL_MS}. A push after a quiet spell is re-read at
     * once; pushes inside this window fold into one re-read at its end.
     */
    rereadIntervalMs?: number;
    /**
     * Rows already known, from a view this window replaces (a scroll position
     * kept while a record was open full screen): `rows` sit at `offset` and
     * on. They are shown at once and read again only when a view reports
     * them in range ({@link CollectionWindow.setVisibleRange}); the rows
     * between the first page and `offset` are not read until a view scrolls
     * to them. `target` should cover them.
     */
    seed?: { offset: number; rows: Entity<M>[] };
    onChange: (state: CollectionWindowState<M>) => void;
}

/**
 * A row held past the first page, and the version of the collection it was
 * read at. The version moves on with every push that says the collection
 * changed, so a row read before the last push is stale.
 */
type Slot<M extends Record<string, unknown>> = { row: Entity<M>; version: number };

/**
 * The quiet time between two re-reads of the rows held past the first page.
 *
 * The server pushes at most once per ~300 ms of quiet per subscription, and at
 * least once a second under a steady stream of writes; each push used to start
 * a re-read of every held row past the first page as soon as the last one
 * ended, so a table scrolled to 10,000 rows ran ten 1,000-row reads back to
 * back for as long as the writes went on. This keeps the duty cycle bounded:
 * at most one re-read per re-read time plus this.
 */
export const REREAD_INTERVAL_MS = 2_000;

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
 * - **Realtime.** The server re-runs a subscription on every write to its
 *   collection, so each push after the first says "something changed", and
 *   every row held past the first page is stale from then on. Which of them
 *   are read again depends on whether a view says what it shows:
 *   - A view that reports the rows it draws ({@link setVisibleRange}) has the
 *     rows on screen read again, plus a page either side — one read, however
 *     far it was scrolled. Rows further out stay stale and are read when they
 *     come within half a page of the screen, before they are on it.
 *   - Without a report, every row held is read again, in reads of at most
 *     `MAX_LIST_LIMIT`, and replaced in one step — the only way a view that
 *     cannot say what it shows never shows a stale row.
 *   Either way a push after a quiet spell is re-read at once; pushes that
 *   arrive while a re-read runs, or within `rereadIntervalMs` of the last one
 *   ending, fold into one re-read at the end of that interval — at once if the
 *   view asks for more rows or scrolls to rows not read since. The first page
 *   itself is applied the moment it is pushed, as always.
 *
 * Rows are de-duplicated by id, keeping the copy read last: an insert or a
 * delete above shifts every offset by one, so between a push and the re-read
 * of the rows it moved, a row can sit in two places — on the first page and in
 * the stale row below it, or in the rows just re-read and the stale ones next
 * to them.
 *
 * A window can hold **gaps**: a restored scroll position ({@link
 * CollectionWindowOptions.seed}) shows the rows that were on screen without
 * reading every row above them. A gap is read when a view scrolls to it; a
 * window no view reports a range to reads its gaps at once and shows nothing
 * until they are filled, as it would have read them all before.
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
    /**
     * Rows past the first page: `slots[i]` is the row at offset
     * `pageSize + i`, `undefined` where it has not been read (a gap).
     */
    private slots: (Slot<M> | undefined)[] = [];
    /** The last read reaching the end of the held rows came back short. */
    private tailEnded = false;
    /** Moves on with every push after the first: rows read before it are stale. */
    private version = 0;
    /**
     * The offsets a view says it draws, end exclusive. `undefined` until one
     * says so, and again when it goes: every held row is then kept current.
     */
    private range: { start: number; end: number } | undefined;
    /** The view moved to rows not read since: read them without waiting. */
    private rangeMoved = false;
    /** Offset of each row (or gap) of the last state reported, by position. */
    private emittedOffsets: number[] | undefined;
    private pumping = false;
    private pumpQueued = false;
    private loadingMore = false;
    private headError: Error | undefined;
    private tailError: Error | undefined;
    private settled = false;
    private disposed = false;
    private headSequence = 0;
    private liveAnswered = false;
    private unsubscribe: (() => void) | undefined;
    private firstPaintTimer: ReturnType<typeof setTimeout> | undefined;
    /** When the last re-read of the rows past the first page finished. */
    private lastRereadEndedAt: number | undefined;
    /** A re-read waiting out {@link REREAD_INTERVAL_MS}. */
    private rereadTimer: ReturnType<typeof setTimeout> | undefined;

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
        const seed = options.seed;
        if (seed && seed.rows.length > 0) {
            // Read at no version the collection has had: stale from the start.
            const start = Math.max(0, Math.floor(seed.offset) - this.pageSize);
            const skip = Math.max(0, this.pageSize - Math.floor(seed.offset));
            const rows = seed.rows.slice(skip);
            this.slots = Array.from({ length: start + rows.length },
                (_, i) => i < start ? undefined : { row: rows[i - start], version: -1 });
        }
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
        if (this.slots.length > keep) {
            this.slots = this.slots.slice(0, keep);
            this.tailEnded = false;
        }
        // Asking for more is also how a view retries a page that failed.
        this.tailError = undefined;
        this.emit();
        void this.pump();
    }

    /**
     * The rows a view draws, by position in the last `rows` (or `sparse`) it
     * was given, end exclusive; `undefined` when it stops drawing them. Rows
     * near the range are kept current and gaps near it are read; see the
     * class comment.
     */
    setVisibleRange(range: { start: number; end: number } | undefined): void {
        if (this.disposed) return;
        const next = range ? this.toOffsets(range) : undefined;
        if (next === undefined && this.range === undefined) return;
        if (next && this.range && next.start === this.range.start && next.end === this.range.end) return;
        this.range = next;
        this.rangeMoved = true;
        // Not at once: a view handing over to another reports `undefined`
        // and then the new range in the same breath, and reading for the
        // moment in between would read every held row.
        this.schedulePump();
    }

    /**
     * What to keep of this window to show it again later: the rows read
     * around the range a view last reported — or, with none reported, every
     * row from the first — the offset of the first of them, and how many
     * rows the window holds in all. See {@link CollectionWindowOptions.seed}.
     */
    snapshot(): { offset: number; rows: Entity<M>[]; held: number } {
        const held = this.head === undefined ? 0 : this.head.length + this.slots.length;
        if (!this.range) return { offset: 0, rows: this.rows().rows, held };
        const margin = this.pageSize;
        const from = Math.max(0, this.range.start - margin);
        const to = this.range.end + margin;
        const rows: Entity<M>[] = [];
        let offset: number | undefined;
        if (from < this.pageSize && this.head) {
            for (let i = from; i < Math.min(to, this.head.length); i++) rows.push(this.head[i]);
            offset = from;
        }
        for (let i = Math.max(0, from - this.pageSize); i < Math.min(this.slots.length, to - this.pageSize); i++) {
            const slot = this.slots[i];
            if (!slot) {
                // A gap ends the run: the rows kept are one block.
                if (rows.length > 0) break;
                continue;
            }
            if (offset === undefined) offset = this.pageSize + i;
            rows.push(slot.row);
        }
        return { offset: offset ?? 0, rows, held };
    }

    dispose(): void {
        this.disposed = true;
        if (this.firstPaintTimer !== undefined) clearTimeout(this.firstPaintTimer);
        if (this.rereadTimer !== undefined) clearTimeout(this.rereadTimer);
        this.rereadTimer = undefined;
        this.unsubscribe?.();
        this.unsubscribe = undefined;
    }

    private readHeadOnce(reportFailure: boolean, liveError?: Error): void {
        let request: Promise<{ data: Entity<M>[] }>;
        try {
            request = Promise.resolve(this.accessor.find(this.oneShot(this.pageSize)));
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
        // The socket is down, not the data: the SDK keeps the subscription and
        // its first push after the reconnect carries what changed meanwhile.
        // Rows already on screen stay there (the connection banner says they
        // may be stale) instead of turning into an error, as `useCollection`
        // and `useFetch` already do.
        if (this.head !== undefined && isConnectionLostError(error)) return;
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
            this.slots = [];
            this.tailEnded = false;
        } else if (!first) {
            this.version++;
            this.tailError = undefined;
        }
        this.emit();
        await this.pump();
    }

    /** Rows still wanted past the ones held. */
    private wanted(): number {
        if (this.head === undefined || !this.headFull || this.tailEnded || this.tailError) return 0;
        return Math.max(0, this.target - this.pageSize - this.slots.length);
    }

    private needsRead(index: number): boolean {
        const slot = this.slots[index];
        return slot === undefined || slot.version < this.version;
    }

    /**
     * The held rows to read again now, by slot, or `undefined` if none.
     *
     * With a range: the stale rows and gaps within a page of it, once any of
     * them is within half a page — so scrolling into stale rows reads a
     * stretch of them ahead of the screen rather than one row per frame.
     * Without: every stale row and gap, as one span.
     */
    private nextRefresh(): { start: number; end: number; urgent: boolean } | undefined {
        if (!this.headFull || this.slots.length === 0 || this.tailError) return undefined;
        let readFrom = 0;
        let readTo = this.slots.length;
        if (this.range) {
            const margin = this.pageSize;
            const half = Math.ceil(margin / 2);
            const triggerFrom = Math.max(0, this.range.start - half - this.pageSize);
            const triggerTo = Math.min(this.slots.length, this.range.end + half - this.pageSize);
            let triggered = false;
            for (let i = triggerFrom; i < triggerTo && !triggered; i++) triggered = this.needsRead(i);
            if (!triggered) return undefined;
            readFrom = Math.max(0, this.range.start - margin - this.pageSize);
            readTo = Math.min(this.slots.length, this.range.end + margin - this.pageSize);
        }
        let start = -1;
        let end = -1;
        let gap = false;
        for (let i = readFrom; i < readTo; i++) {
            if (!this.needsRead(i)) continue;
            if (start < 0) start = i;
            end = i + 1;
            if (this.slots[i] === undefined) gap = true;
        }
        if (start < 0) return undefined;
        return { start, end, urgent: gap || (this.range !== undefined && this.rangeMoved) };
    }

    private schedulePump(): void {
        if (this.pumpQueued) return;
        this.pumpQueued = true;
        queueMicrotask(() => {
            this.pumpQueued = false;
            void this.pump();
        });
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
                const refresh = this.nextRefresh();
                if (refresh) {
                    // A view asking for more rows, or looking at rows not read
                    // since, is not kept waiting: the re-read runs now.
                    const wait = refresh.urgent || this.wanted() > 0 ? 0 : this.rereadWait();
                    if (wait > 0) {
                        this.armReread(wait);
                    } else {
                        this.rangeMoved = false;
                        await this.reread(refresh.start, refresh.end);
                        this.lastRereadEndedAt = Date.now();
                        continue;
                    }
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

    /** How long a re-read due now still has to wait. 0 after a quiet spell. */
    private rereadWait(): number {
        if (this.lastRereadEndedAt === undefined) return 0;
        const interval = this.options.rereadIntervalMs ?? REREAD_INTERVAL_MS;
        return Math.max(0, this.lastRereadEndedAt + interval - Date.now());
    }

    private armReread(wait: number): void {
        if (this.rereadTimer !== undefined || this.disposed) return;
        this.rereadTimer = setTimeout(() => {
            this.rereadTimer = undefined;
            void this.pump();
        }, wait);
    }

    private async readNext(wanted: number): Promise<void> {
        const offset = this.pageSize + this.slots.length;
        const limit = Math.min(MAX_LIST_LIMIT, wanted);
        const version = this.version;
        this.loadingMore = true;
        this.emit();
        try {
            const response = await this.accessor.find(this.oneShot(limit, offset));
            if (this.disposed) return;
            const raw = response.data ?? [];
            const processed = await this.process(raw);
            if (this.disposed) return;
            this.slots = this.slots.concat(processed.map((row) => ({ row, version })));
            if (raw.length < limit) this.tailEnded = true;
        } catch (error) {
            if (this.disposed) return;
            this.tailError = toError(error);
        } finally {
            this.loadingMore = false;
        }
        this.emit();
    }

    /**
     * Read the held rows in slots `[from, to)` again, and swap them in at once.
     * A read that comes back short says where the collection ends now: the
     * rows held past that are dropped.
     */
    private async reread(from: number, to: number): Promise<void> {
        const span = to - from;
        if (span <= 0) return;
        const version = this.version;
        const fresh: Entity<M>[] = [];
        let ended = false;
        let offset = this.pageSize + from;
        try {
            while (fresh.length < span) {
                const limit = Math.min(MAX_LIST_LIMIT, span - fresh.length);
                const response = await this.accessor.find(this.oneShot(limit, offset));
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
        const slots = this.slots.slice(0, Math.min(from, keep));
        for (const row of fresh) {
            if (slots.length >= keep) break;
            slots.push({ row, version });
        }
        if (ended) {
            this.tailEnded = slots.length <= keep;
        } else {
            for (let i = to; i < this.slots.length && slots.length < keep; i++) slots.push(this.slots[i]);
        }
        this.slots = slots;
        this.emit();
    }

    /**
     * Every one-shot read the window makes: its query, never counted.
     *
     * Nothing here reads `meta.total` — a page ends the window by coming back
     * short — and the `COUNT(*)` beside each page read every matching row to
     * report a number that was thrown away: scrolling a table to 10,000 rows
     * ran 199 of them. The first page's subscription is the accessor's and is
     * left as it is.
     */
    private oneShot(limit: number, offset?: number): FindParams<M> {
        return { ...this.query, limit, ...(offset !== undefined && { offset }), count: "none" };
    }

    private async process(rows: Entity<M>[]): Promise<Entity<M>[]> {
        return this.options.process ? await this.options.process(rows) : rows;
    }

    private complete(): boolean {
        if (this.head === undefined) return false;
        return !this.headFull || this.tailEnded;
    }

    private hasGaps(): boolean {
        for (const slot of this.slots) if (slot === undefined) return true;
        return false;
    }

    private emit(): void {
        if (this.disposed) return;
        const error = this.headError ?? this.tailError;
        if (!this.settled && this.head !== undefined) {
            const held = this.pageSize + this.slots.length;
            const enough = this.complete() || held >= Math.min(this.holdUntil, this.target) || this.tailError;
            // Gaps are only shown to a view that draws them: one that reports
            // what it shows. Any other waits until they are read.
            if (enough && (this.range !== undefined || this.tailError || !this.hasGaps())) {
                this.settled = true;
            }
        }
        let rows: Entity<M>[] | undefined;
        let sparse: (Entity<M> | undefined)[] | undefined;
        if (this.settled) {
            const built = this.rows();
            rows = built.rows;
            sparse = built.sparse;
            this.emittedOffsets = built.offsets;
        }
        this.options.onChange({
            rows,
            ...(sparse && { sparse }),
            loading: (this.head === undefined && !this.headError) || this.loadingMore || (!this.settled && !error),
            error,
            complete: this.complete()
        });
    }

    /**
     * The rows to show, in order, each id once — the copy read last wins, the
     * first page counting as read now — with gaps kept as positions in
     * `sparse`, and the offset each position stands for.
     */
    private rows(): { rows: Entity<M>[]; sparse?: (Entity<M> | undefined)[]; offsets: number[] } {
        const head = this.head ?? [];
        if (this.slots.length === 0) {
            return { rows: head, offsets: head.map((_, i) => i) };
        }
        // Which copy of each id to keep: the newest version, then the first.
        const keep = new Map<string, { version: number; offset: number }>();
        const consider = (row: Entity<M>, version: number, offset: number) => {
            const key = String(row.id);
            const held = keep.get(key);
            if (!held || version > held.version) keep.set(key, { version, offset });
        };
        head.forEach((row, i) => consider(row, Infinity, i));
        this.slots.forEach((slot, i) => {
            if (slot) consider(slot.row, slot.version, this.pageSize + i);
        });
        const rows: Entity<M>[] = [];
        const positions: (Entity<M> | undefined)[] = [];
        const offsets: number[] = [];
        let gaps = false;
        const place = (row: Entity<M> | undefined, offset: number) => {
            if (row && keep.get(String(row.id))?.offset !== offset) return;
            if (row) rows.push(row);
            else gaps = true;
            positions.push(row);
            offsets.push(offset);
        };
        head.forEach((row, i) => place(row, i));
        // Gaps start where the first page ends: a page that came back with
        // fewer rows than it holds now (a delete) leaves no hole of its own.
        this.slots.forEach((slot, i) => place(slot?.row, this.pageSize + i));
        return gaps ? { rows, offsets, sparse: positions } : { rows, offsets };
    }

    /** Positions in the last state reported, as offsets in the collection. */
    private toOffsets(range: { start: number; end: number }): { start: number; end: number } {
        const offsets = this.emittedOffsets;
        const start = Math.max(0, Math.floor(range.start));
        const end = Math.max(start, Math.ceil(range.end));
        if (!offsets || offsets.length === 0) return { start, end };
        const at = (position: number) => position < offsets.length
            ? offsets[position]
            : offsets[offsets.length - 1] + 1 + (position - offsets.length);
        return { start: at(start), end: end > start ? at(end - 1) + 1 : at(start) };
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
