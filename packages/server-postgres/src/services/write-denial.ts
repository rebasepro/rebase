import { and, sql, SQL } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { ApiError } from "@rebasepro/server";
import { DrizzleClient } from "../interfaces";

/**
 * Explain a write that matched no rows.
 *
 * Row-level security filters UPDATE and DELETE through the policy's USING
 * clause instead of raising: a denied write is reported by Postgres exactly
 * like a successful one that happened to match nothing. Left unchecked, a
 * caller cannot tell "denied" from "done" — the write returns 200/204 and the
 * row is untouched. An agent handed a key with `orders:delete` and no delete
 * policy is the case that makes it concrete: it deletes nothing, forever, and
 * is told it worked every time.
 *
 * Re-reading the target over the *same* RLS-scoped handle separates the two
 * cases. A visible row means the policy rejected the write (403); an invisible
 * one means there is nothing there to write for this caller (404, matching what
 * a GET would say). The re-read is bound by the caller's own policies, so it
 * discloses nothing a plain read wouldn't.
 *
 * Only reached when zero rows matched, so the happy path pays nothing.
 *
 * It lives here, rather than beside its first caller, because every zero-row
 * write has to answer the same question and answer it identically: the rule
 * that a readable-but-unwritable target is a 403 is the contract, and a second
 * copy of it is a second chance to get it wrong.
 *
 * @param handle     The RLS-scoped connection the write ran on — not a fresh
 *                   one, or the re-read would answer for a different caller.
 * @param table      The table the write targeted (the junction, for a link).
 * @param conditions The write's own WHERE terms, reused verbatim.
 * @param denied     Message for the 403: the target is there and was refused.
 * @param missing    Message for the 404: there is nothing there for this caller.
 */
export async function explainZeroRowWrite(
    handle: DrizzleClient,
    table: PgTable,
    conditions: SQL[],
    denied: string,
    missing: string
): Promise<ApiError> {
    const visible = await handle
        .select({ present: sql<number>`1` })
        .from(table)
        .where(and(...conditions))
        .limit(1);

    if (visible.length > 0) {
        return ApiError.forbidden(denied, "WRITE_DENIED");
    }

    return ApiError.notFound(missing);
}
