import { DataDriver, isSQLAdmin } from "@rebasepro/types";
import { logger } from "../../utils/logger";

/**
 * Remembering what a write already answered, so replaying it does not do it twice.
 *
 * The offline queue replays a mutation whenever it did not see the response —
 * which includes every case where the write *committed* and the ACK was lost to
 * a dropped connection. For a collection whose id the client chooses, the replay
 * collides on that id and the client can recognise its own earlier attempt. For
 * a collection with a serial id it cannot: the server ignored the id the client
 * invented and assigned its own, so the replay is indistinguishable from a new
 * row and inserts a second one. The scaffold's own collections use
 * `isId: "increment"`, so that is the default case, not an exotic one.
 *
 * A key is honoured only for the principal that created it. Mutation ids are
 * generated on the client, so keying on the id alone would let anyone who
 * learned (or guessed) another user's id replay their key and be handed that
 * user's row back — a read of someone else's data through a write endpoint.
 */
const TABLE = "\"rebase\".\"idempotency_keys\"";

/**
 * How long a replay is recognised. Long enough to cover an offline stretch and
 * a retry schedule; short enough that the table stays small and a key cannot be
 * replayed indefinitely. Rows past this are pruned opportunistically rather than
 * by a scheduled job — there is no cron guaranteed to be running.
 */
const TTL_HOURS = 24;

/**
 * The principal a key belongs to; anonymous and service writes share a sentinel.
 *
 * The NUL is written as an escape, not as a raw byte in the source. The
 * sentinel itself is deliberate — a uid can never contain one — but written
 * literally it makes this file test as binary, and every repo-wide grep then
 * skips all 124 lines of it silently. Identical at runtime.
 */
function principal(uid: string | undefined): string {
    return uid && uid.length > 0 ? uid : "\u0000anon";
}

/**
 * What a caller may do with a key.
 *
 * `claimed` is the only outcome that permits the write. Recalling and then
 * writing was not atomic: two requests carrying one key both missed the recall,
 * both wrote, and `ON CONFLICT DO NOTHING` protected only the second row in
 * *this* table — the duplicate row in the caller's collection, which is the
 * thing the mechanism exists to prevent, was inserted anyway. The offline queue
 * is shared across tabs, so two tabs reconnecting together is the ordinary case
 * rather than an exotic one.
 */
export type IdempotencyClaim =
    /** This key has already been answered; serve that answer again. */
    | { status: "replay"; response: unknown }
    /** Another request holds this key and has not answered yet. */
    | { status: "in-flight" }
    /** The key is ours; do the write, then `complete` or `release` it. */
    | { status: "claimed" };

export interface IdempotencyStore {
    /**
     * Take the key if it is free, atomically. Never throws — a store that
     * cannot answer reports `claimed`, which degrades to no idempotency rather
     * than to a refused write.
     */
    claim(key: string, uid: string | undefined): Promise<IdempotencyClaim>;
    /** Record what this key answered. Never throws. */
    complete(key: string, uid: string | undefined, response: unknown): Promise<void>;
    /**
     * Give the key back after the write it was claimed for failed.
     *
     * Without this a transient failure strands the key: every retry would be
     * told `in-flight` until the row aged out, turning one failed write into a
     * day of refusals.
     */
    release(key: string, uid: string | undefined): Promise<void>;
}

/**
 * Returns `undefined` when the driver cannot run SQL, which disables the whole
 * mechanism rather than failing writes: a document backend has no table to put
 * this in, and refusing to serve is far worse than the duplicate this prevents.
 *
 * Every method swallows its own errors for the same reason. A write must not
 * fail because the bookkeeping around it did — the worst case of a failed
 * `remember` is the duplicate we already have today, while a thrown error would
 * reject a write the database has already accepted.
 */
export function createIdempotencyStore(driver: DataDriver): IdempotencyStore | undefined {
    const admin = driver.admin;
    if (!isSQLAdmin(admin)) return undefined;
    const exec = (sql: string, params?: unknown[]) => admin.executeSql(sql, params ? { params } : undefined);

    let ready: Promise<boolean> | undefined;
    /** Created on first use: most deployments never send a key at all. */
    const ensure = (): Promise<boolean> => {
        ready ??= (async () => {
            try {
                await exec("CREATE SCHEMA IF NOT EXISTS rebase");
                await exec(`
                    CREATE TABLE IF NOT EXISTS ${TABLE} (
                        key TEXT NOT NULL,
                        uid TEXT NOT NULL,
                        response JSONB,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        PRIMARY KEY (uid, key)
                    )
                `);
                await exec(`CREATE INDEX IF NOT EXISTS idx_idempotency_created ON ${TABLE}(created_at)`);
                return true;
            } catch (error) {
                logger.warn(
                    "Idempotency keys unavailable — a replayed offline write may insert a duplicate row.",
                    { detail: error instanceof Error ? error.message : String(error) }
                );
                return false;
            }
        })();
        return ready;
    };

    return {
        async claim(key, uid) {
            if (!key || !(await ensure())) return { status: "claimed" };
            try {
                // One statement decides it. A free key inserts; an expired one
                // is taken over by the DO UPDATE, whose WHERE fails for a live
                // row so the claim is refused. `RETURNING` therefore yields a
                // row exactly when this request owns the key.
                const claimed = await exec(
                    `INSERT INTO ${TABLE} (key, uid, response, created_at)
                     VALUES ($1, $2, NULL, NOW())
                     ON CONFLICT (uid, key) DO UPDATE
                       SET response = NULL, created_at = NOW()
                       WHERE ${TABLE}.created_at < NOW() - INTERVAL '${TTL_HOURS} hours'
                     RETURNING 1 AS claimed`,
                    [key, principal(uid)]
                );
                if (claimed.length > 0) return { status: "claimed" };

                // Refused, so a live row holds the key. A SQL NULL response
                // means it is still being written; a JSONB `null` is a
                // legitimate stored body, and the two are indistinguishable
                // once node-pg has turned both into JS `null` — hence the
                // explicit `IS NULL` column.
                const rows = await exec(
                    `SELECT response, response IS NULL AS pending FROM ${TABLE}
                     WHERE uid = $1 AND key = $2`,
                    [principal(uid), key]
                );
                const row = rows[0];
                if (!row) return { status: "claimed" };
                if (row.pending) return { status: "in-flight" };
                return { status: "replay", response: row.response };
            } catch {
                // Bookkeeping must never refuse a write: fall back to no
                // idempotency, which is the behaviour without this table.
                return { status: "claimed" };
            }
        },

        async complete(key, uid, response) {
            if (!key || !(await ensure())) return;
            try {
                await exec(
                    `UPDATE ${TABLE} SET response = $3::jsonb WHERE uid = $1 AND key = $2`,
                    [principal(uid), key, JSON.stringify(response ?? null)]
                );
                // Cheap and unsynchronised on purpose: an occasional extra pass
                // costs less than a scheduler this package cannot assume exists.
                if (Math.random() < 0.01) {
                    await exec(`DELETE FROM ${TABLE} WHERE created_at < NOW() - INTERVAL '${TTL_HOURS} hours'`);
                }
            } catch {
                /* Bookkeeping only — never fail the write it describes. */
            }
        },

        async release(key, uid) {
            if (!key || !(await ensure())) return;
            try {
                // Only an unanswered claim. A completed key must survive, or a
                // later failure would erase a reply that is still owed.
                await exec(
                    `DELETE FROM ${TABLE} WHERE uid = $1 AND key = $2 AND response IS NULL`,
                    [principal(uid), key]
                );
            } catch {
                /* The row ages out on its own. */
            }
        }
    };
}

/** The header the client sends. Matches the widely used Stripe/IETF spelling. */
export const IDEMPOTENCY_HEADER = "Idempotency-Key";
