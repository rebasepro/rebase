import { ApiError } from "../errors";

/**
 * The two query parameters soft delete adds to the REST surface.
 *
 * Kept in their own module so the call sites in `query-parser.ts` and the
 * delete routes are a single line each: the parsing rules belong to soft
 * delete, not to the parser, and a rule spread across the two files that read
 * it is a rule that drifts.
 */

/** `?deleted=` — what to do about rows a soft delete has stamped. */
export const DELETED_QUERY_PARAM = "deleted";
/** `?hard=` — ask for a real `DELETE` on a soft-delete collection. */
export const HARD_DELETE_QUERY_PARAM = "hard";

/**
 * `?deleted=include|only` → the driver's `withDeleted`.
 *
 * Spelled `deleted` on the wire and `withDeleted` in the driver, deliberately:
 * the URL reads as a question about the rows (`?deleted=only` — "only the
 * deleted ones"), and the driver option reads as an instruction about the query.
 *
 * A value neither word is a 400 rather than a silent fallback to the default.
 * `?deleted=true` quietly hiding every deleted row is the worst of both: it
 * looks like it worked and answers the opposite question. Absent is the
 * default, which is "hide them".
 */
export function parseWithDeleted(raw: unknown): boolean | "only" | undefined {
    if (raw === undefined || raw === null || raw === "") return undefined;
    const value = String(raw).trim().toLowerCase();
    if (value === "include") return true;
    if (value === "only") return "only";
    throw ApiError.badRequest(
        `Invalid \`?${DELETED_QUERY_PARAM}=${String(raw)}\`. It takes 'include' (live rows and deleted ones) ` +
        "or 'only' (deleted rows alone). Omit it to see only the live rows.",
        "INVALID_DELETED_PARAM"
    );
}

/**
 * `?hard=true` → a real `DELETE` on a collection that soft-deletes.
 *
 * Needs no permission beyond the delete it replaces: it is the same verb, and a
 * second access-control surface for one operation is a second thing to get
 * wrong. What it changes is whether the row can be restored.
 *
 * Only the exact words `true` and `1` mean yes. Anything else is a 400, not a
 * "no" — a typo that silently soft-deletes when the caller asked to purge is a
 * caller who believes the data is gone.
 */
export function parseHardDelete(raw: unknown): boolean {
    if (raw === undefined || raw === null || raw === "") return false;
    const value = String(raw).trim().toLowerCase();
    if (value === "true" || value === "1") return true;
    if (value === "false" || value === "0") return false;
    throw ApiError.badRequest(
        `Invalid \`?${HARD_DELETE_QUERY_PARAM}=${String(raw)}\`. It takes 'true' or 'false'.`,
        "INVALID_HARD_PARAM"
    );
}
