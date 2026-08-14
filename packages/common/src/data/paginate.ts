import {
    DEFAULT_LIST_LIMIT,
    FilterValues,
    FieldPath,
    FindAllParams,
    FindParams,
    FindResult,
    IterateParams,
    WhereFilterOp
} from "@rebasepro/types";
import { normalizeOrderBy } from "./sort-dialect";

/**
 * The pagination engine behind `iterate()` / `findAll()`.
 *
 * It lives here, above both transports, on purpose: the HTTP client and the
 * in-process accessor implement the same `SDKCollectionClient` contract, and a
 * helper written twice is a helper that drifts. Both call into this file, so
 * "the SDK paginates like *this*" has exactly one definition.
 *
 * Everything below is expressed in terms of a single `find(params)` function,
 * which is all either transport has to supply.
 */

/** Rows requested per page when the caller does not say. */
export const DEFAULT_PAGE_SIZE = 200;

/** Rows `findAll()` will materialise before it refuses to continue. */
export const DEFAULT_FIND_ALL_MAX_ROWS = 10_000;

/**
 * Requests one walk may make before it gives up on the server ever saying
 * `hasMore: false`. At the default page size that is two million rows — far
 * past any legitimate walk, and short of running forever.
 */
export const DEFAULT_MAX_PAGES = 10_000;

/** Why a pagination walk refused to continue. */
export type PaginationErrorCode =
    /** `findAll()` matched more rows than its ceiling allows. */
    | "max-rows"
    /** The walk made its maximum number of requests without the server finishing. */
    | "max-pages"
    /** A cursor row carried no value for the cursor column. */
    | "cursor-missing"
    /** Two consecutive pages ended on the same cursor value, so the walk cannot advance. */
    | "cursor-stalled"
    /** A `cursor` was asked for on one column while `orderBy` sorted by another. */
    | "cursor-order-mismatch";

/**
 * Thrown when a walk stops for a reason the caller needs to know about.
 *
 * Every one of these is a case where the alternative would be silent: a
 * truncated array that looks complete, or a loop that never returns. Check
 * {@link code} to tell them apart.
 */
export class RebasePaginationError extends Error {
    readonly code: PaginationErrorCode;

    constructor(code: PaginationErrorCode, message: string) {
        super(message);
        this.name = "RebasePaginationError";
        this.code = code;
        // Keeps `instanceof` working when this is compiled down for an older
        // target, where extending a builtin otherwise loses the prototype.
        Object.setPrototypeOf(this, RebasePaginationError.prototype);
    }
}

/** The one thing a transport has to provide to be paginated. */
export type PageFinder<M extends Record<string, unknown> = Record<string, unknown>> =
    (params: FindParams<M>) => Promise<FindResult<M>>;

/**
 * Resolve `limit`/`offset`/`page` into the window a read will actually use.
 *
 * Lives here, next to the walk, for the reason at the top of this file: every
 * transport has to mean the same thing by "page two". Four of them did not —
 * the REST layer strode by {@link DEFAULT_LIST_LIMIT}, the local-first
 * evaluator by {@link DEFAULT_PAGE_SIZE}, the in-process accessor by 20, and
 * the published type documented a fourth number. Pages that overlap or skip
 * rows are the mildest of those outcomes.
 *
 * `page` wins over `offset`, as {@link FindParams} documents. `driverOffset`
 * is the value to hand a driver: it stays `undefined` when the caller named no
 * offset, because keyset pagination seeks with a `where` clause and must not
 * look like it is paging by offset.
 */
export function resolveFindWindow(
    params?: Pick<FindParams, "limit" | "offset" | "page">
): { limit: number; offset: number; driverOffset: number | undefined } {
    const limit = params?.limit ?? DEFAULT_LIST_LIMIT;
    const offset = params?.page != null
        ? Math.max(0, (params.page - 1) * limit)
        : (params?.offset ?? 0);
    return {
        limit,
        offset,
        driverOffset: params?.page != null ? offset : params?.offset
    };
}

function normalizePageSize(raw: number | undefined): number {
    if (raw === undefined || !Number.isFinite(raw)) return DEFAULT_PAGE_SIZE;
    return Math.max(1, Math.floor(raw));
}

function normalizeMaxPages(raw: number | undefined): number {
    if (raw === undefined) return DEFAULT_MAX_PAGES;
    if (raw === Number.POSITIVE_INFINITY) return raw;
    if (!Number.isFinite(raw)) return DEFAULT_MAX_PAGES;
    return Math.max(1, Math.floor(raw));
}

function normalizeMaxRows(raw: number | undefined): number {
    if (raw === undefined) return DEFAULT_FIND_ALL_MAX_ROWS;
    if (raw === Number.POSITIVE_INFINITY) return raw;
    if (!Number.isFinite(raw)) return DEFAULT_FIND_ALL_MAX_ROWS;
    return Math.max(0, Math.floor(raw));
}

/**
 * Add one condition to a `where` map without disturbing what is already there.
 *
 * The caller's own filter on the cursor column has to survive — dropping it
 * would widen the query, which is the silent-filter-loss failure mode — so a
 * second condition on the same column becomes the array-of-tuples form that
 * `FindParams.where` already accepts, and both are AND-ed.
 */
function appendCondition<M extends Record<string, unknown>>(
    where: FilterValues<FieldPath<M>> | undefined,
    column: string,
    condition: [WhereFilterOp, unknown]
): FilterValues<FieldPath<M>> {
    const next = { ...(where ?? {}) } as Record<string, unknown>;
    const existing = next[column];
    if (existing === undefined) {
        next[column] = condition;
    } else if (Array.isArray(existing) && existing.length > 0 && Array.isArray(existing[0])) {
        next[column] = [...(existing as [WhereFilterOp, unknown][]), condition];
    } else {
        next[column] = [existing, condition];
    }
    return next as FilterValues<FieldPath<M>>;
}

function cursorEquals(a: unknown, b: unknown): boolean {
    if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
    return Object.is(a, b);
}

/**
 * Walk every row a query matches, yielding one row at a time and fetching the
 * next page only when the consumer asks for it.
 *
 * See {@link SDKCollectionClient.iterate} for the caller-facing contract,
 * including the offset-drift caveat and the `cursor` alternative.
 *
 * @param find   the transport's single-page read
 * @param params `find()` parameters minus the window, plus the walk options
 * @param label  the collection name, so an error says which walk failed
 */
export async function* paginateFind<M extends Record<string, unknown> = Record<string, unknown>>(
    find: PageFinder<M>,
    params?: IterateParams<M>,
    label = "collection"
): AsyncGenerator<M, void, undefined> {
    const {
        pageSize,
        cursor,
        maxPages,
        ...rest
    } = (params ?? {}) as IterateParams<M> & Record<string, unknown>;

    const findParams = { ...rest } as FindParams<M>;
    const size = normalizePageSize(pageSize as number | undefined);
    const pageCap = normalizeMaxPages(maxPages as number | undefined);

    // ── Cursor (keyset) setup ────────────────────────────────────────────────
    const cursorField = typeof cursor === "string" ? cursor : cursor?.field;
    const requestedDirection = (typeof cursor === "object" && cursor !== null)
        ? cursor.direction
        : undefined;

    let direction: "asc" | "desc" = "asc";
    if (cursorField) {
        const orderBy = normalizeOrderBy(findParams.orderBy);
        // A seek is one `>`/`<` on one column, so it can only follow a sort of
        // one column. Over a multi-key sort the same comparison both repeats
        // rows (every later key's ties) and skips them, which is the failure
        // this error exists to prevent — name it rather than seek anyway.
        if (orderBy && orderBy.length > 1) {
            throw new RebasePaginationError(
                "cursor-order-mismatch",
                `Cannot seek on "${cursorField}" while ordering "${label}" by ` +
                `${orderBy.map(([field]) => `"${field}"`).join(", ")}: ` +
                `keyset pagination advances along a single column. ` +
                `Order by "${cursorField}" alone, or drop the cursor and page by offset.`
            );
        }
        if (orderBy && orderBy[0][0] !== cursorField) {
            throw new RebasePaginationError(
                "cursor-order-mismatch",
                `Cannot seek on "${cursorField}" while ordering "${label}" by "${orderBy[0][0]}": ` +
                `keyset pagination only advances along the column the query is sorted by. ` +
                `Order by "${cursorField}", or drop the cursor and page by offset.`
            );
        }
        direction = requestedDirection ?? orderBy?.[0][1] ?? "asc";
        findParams.orderBy = [cursorField, direction] as FindParams<M>["orderBy"];
    }
    const seekOp: WhereFilterOp = direction === "desc" ? "<" : ">";
    const baseWhere = findParams.where;

    let offset = 0;
    let pages = 0;
    let cursorValue: unknown;
    let seeking = false;

    for (;;) {
        if (pages >= pageCap) {
            throw new RebasePaginationError(
                "max-pages",
                `Iterating "${label}" made ${pages} requests without the server reporting the end of ` +
                `the collection. Stopping rather than looping forever — raise \`maxPages\` if the walk ` +
                `is genuinely this long, or check that the backend sets \`meta.hasMore\`.`
            );
        }

        const pageParams: FindParams<M> = { ...findParams, limit: size };
        if (cursorField) {
            if (seeking) {
                pageParams.where = appendCondition<M>(baseWhere, cursorField, [seekOp, cursorValue]);
            }
        } else {
            pageParams.offset = offset;
        }

        const page = await find(pageParams);
        pages += 1;

        const rows = page?.data ?? [];
        // A page with nothing on it always ends the walk, whatever the server
        // claims about `hasMore` — there is no cursor to advance and no offset
        // that would ever move past it.
        if (rows.length === 0) return;

        for (const row of rows) {
            yield row;
        }

        // The server is the only authority on whether more rows exist. Never
        // infer it from `rows.length >= size`: a last page that happens to be
        // exactly full is indistinguishable from a middle one, and guessing
        // there drops every row after it.
        if (page?.meta?.hasMore !== true) return;

        if (cursorField) {
            const last = rows[rows.length - 1] as Record<string, unknown>;
            const nextValue = last?.[cursorField];
            if (nextValue === undefined || nextValue === null) {
                throw new RebasePaginationError(
                    "cursor-missing",
                    `Cannot seek past the last row of "${label}": it has no value for the cursor ` +
                    `column "${cursorField}". Pick a column that is present and non-null on every row.`
                );
            }
            if (seeking && cursorEquals(nextValue, cursorValue)) {
                throw new RebasePaginationError(
                    "cursor-stalled",
                    `Iterating "${label}" is stuck: two pages in a row ended at ` +
                    `${cursorField}=${String(nextValue)}. The cursor column has to be unique — a ` +
                    `repeated value cannot be seeked past, and continuing would either loop forever ` +
                    `or skip the duplicates. Use the primary key, or page by offset.`
                );
            }
            cursorValue = nextValue;
            seeking = true;
        } else {
            // Advance by what actually arrived, not by the page size: a server
            // free to return fewer rows than asked for would otherwise leave a
            // hole in the walk.
            offset += rows.length;
        }
    }
}

/**
 * {@link paginateFind}, collected into an array under a ceiling.
 *
 * See {@link SDKCollectionClient.findAll}.
 */
export async function collectAllPages<M extends Record<string, unknown> = Record<string, unknown>>(
    find: PageFinder<M>,
    params?: FindAllParams<M>,
    label = "collection"
): Promise<M[]> {
    const { maxRows, ...rest } = (params ?? {}) as FindAllParams<M> & Record<string, unknown>;
    const cap = normalizeMaxRows(maxRows as number | undefined);

    const out: M[] = [];
    for await (const row of paginateFind<M>(find, rest as IterateParams<M>, label)) {
        out.push(row);
        if (out.length > cap) {
            throw new RebasePaginationError(
                "max-rows",
                `findAll("${label}") matched more than ${cap} rows. Returning the first ${cap} would ` +
                `look like the whole answer and quietly not be one, so this throws instead. Raise ` +
                `\`maxRows\` if you meant to load them all, or stream with \`iterate()\`.`
            );
        }
    }
    return out;
}

/**
 * Build the `iterate` / `findAll` pair for one collection from its `find`.
 *
 * Both transports call this, which is what keeps the two implementations from
 * being two implementations.
 */
export function createPaginationHelpers<M extends Record<string, unknown> = Record<string, unknown>>(
    find: PageFinder<M>,
    label: string
): {
    iterate: (params?: IterateParams<M>) => AsyncIterableIterator<M>;
    findAll: (params?: FindAllParams<M>) => Promise<M[]>;
} {
    return {
        iterate: (params?: IterateParams<M>) => paginateFind<M>(find, params, label),
        findAll: (params?: FindAllParams<M>) => collectAllPages<M>(find, params, label)
    };
}
