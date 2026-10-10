import { sql } from "drizzle-orm";
import { PgTransaction } from "drizzle-orm/pg-core";
import type { DrizzleClient } from "../interfaces";

/**
 * pgvector's iterative index scans, for a vector read that also filters.
 *
 * An HNSW index answers a nearest-neighbour query with the `hnsw.ef_search`
 * (40 by default) candidates it found, and every other condition of the query
 * — a `where`, a search, a soft-delete stamp, a row-level-security policy — is
 * applied to those candidates afterwards. Where few of them pass, the page
 * comes back short, or empty, though plenty of rows match: measured on 20,000
 * rows with half of them matching a `status` filter far from the query vector,
 * `LIMIT 10` served 0 rows. Offset pages over the index were empty or short the
 * same way, while deeper pages, where the planner switched to an exact scan,
 * served rows, so a walk skipped some and could repeat others.
 *
 * From pgvector 0.8.0, `hnsw.iterative_scan` makes the index keep scanning
 * until the query has its rows (bounded by `hnsw.max_scan_tuples`, 20,000 by
 * default). `strict_order` and not `relaxed_order`: the planner reads the
 * index's output as already sorted by distance, so out-of-order rows would be
 * cut at the wrong place by `LIMIT` and the same row could land on two pages.
 * Measured on the case above: 0/10 → 10/10, and the first 200 rows by offset
 * pages of 10 with no duplicates (`relaxed_order`: 18).
 *
 * Set with `set_config(…, true)` — local to the transaction the read runs in,
 * so it never outlives it on a pooled connection. A read not in a transaction
 * is given one.
 *
 * pgvector before 0.8.0 has no such setting, and with its library loaded it
 * refuses an unknown `hnsw.` parameter, so the setting is applied only where
 * the extension's version has it; there a filtered vector read keeps the
 * behaviour above. IVFFlat indexes are not touched: their iterative scan only
 * comes in relaxed order.
 */

/** Whether a pgvector version (`extversion`, e.g. `"0.8.1"`) has iterative index scans. */
export function hasIterativeIndexScans(version: string | undefined | null): boolean {
    if (!version) return false;
    const [major, minor] = version.split(".").map(part => parseInt(part, 10));
    if (!Number.isFinite(major) || !Number.isFinite(minor)) return false;
    return major > 0 || minor >= 8;
}

/**
 * The answer per database, asked once. Keyed by an object that lives exactly as
 * long as the database connection does — the driver's collection registry,
 * shared by its request-scoped copies — so two data sources on two pgvector
 * versions each get their own.
 */
const support = new WeakMap<object, Promise<boolean>>();

/** Whether `db`'s pgvector has iterative index scans. Asked once per `key`. */
export function iterativeScansAvailable(db: DrizzleClient, key: object): Promise<boolean> {
    let known = support.get(key);
    if (!known) {
        // Through `then`, so a client that cannot `execute` at all rejects
        // into the `catch` below rather than throwing past it.
        known = Promise.resolve()
            .then(() => db.execute(sql`SELECT extversion FROM pg_extension WHERE extname = 'vector'`))
            .then(result => {
                const version = (result.rows[0] as Record<string, unknown> | undefined)?.extversion;
                return hasIterativeIndexScans(typeof version === "string" ? version : undefined);
            })
            .catch(() => {
                // Not remembered: a failed lookup says nothing about the
                // version, and the next read asks again.
                support.delete(key);
                return false;
            });
        support.set(key, known);
    }
    return known;
}

/** Whether `db` is a transaction, in which a `set_config(…, true)` stays. */
export function inTransaction(db: DrizzleClient): boolean {
    return db instanceof PgTransaction;
}

/** Turn on strict-order iterative HNSW scans for the rest of `db`'s transaction. */
export async function enableIterativeScan(db: DrizzleClient): Promise<void> {
    await db.execute(sql`SELECT set_config('hnsw.iterative_scan', 'strict_order', true)`);
}
