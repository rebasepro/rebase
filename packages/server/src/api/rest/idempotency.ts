import { createHash } from "node:crypto";
import { DataDriver, isSQLAdmin } from "@rebasepro/types";
import { revokeInternalTableSql } from "@rebasepro/common";
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
 * That is also why an unauthenticated caller gets no idempotency at all: every
 * anonymous request shares one principal, so honouring a key there would hand
 * one visitor's stored response to the next one who sent the same string.
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
 * How long a claim that has not answered yet is presumed to still be running.
 *
 * A claim is taken before the write and given back after it, so every exit the
 * process does not survive — a rolled pod, an OOM kill, a node drain, a
 * `complete` that itself fails — leaves the row pending with nobody coming back
 * for it. Reusing the 24-hour replay window as the lease made that
 * indistinguishable from a request still in flight, so every retry of that key
 * was refused for a day: the mechanism turned a write that plain retrying would
 * have completed into permanent loss, which is worse than not having it at all.
 *
 * The number trades the two ways it can be wrong, and both are bounded. Too
 * short and a genuinely slow write has its key taken over by its own retry —
 * the duplicate this exists to prevent. Too long and a crashed claim refuses
 * its retries for that long. A minute outlasts any write the row cap allows
 * and stays well inside the window the offline queue keeps retrying for.
 */
const PENDING_LEASE_SECONDS = 60;

/**
 * How long to wait before attempting the table creation again after it failed.
 *
 * `ensure`'s answer used to be memoised unconditionally, so one transient DDL
 * failure — a database still starting, a lock on the `rebase` schema, a sibling
 * pod running the same `CREATE TABLE IF NOT EXISTS` — disabled idempotency on
 * that pod for the life of the process after a single log line. A failure is
 * retried instead, and the cooldown is what stops every keyed request re-running
 * DDL against a database that is genuinely unhappy.
 */
const ENSURE_RETRY_COOLDOWN_MS = 30_000;

/**
 * The principal a key belongs to, or `undefined` when there is nobody to scope
 * it to and the key must therefore be ignored.
 *
 * Anonymous callers are a supported configuration — `auth.requireAuth: false`
 * delegates access control to RLS — and they used to share one sentinel
 * principal, which is exactly the cross-principal replay the note above says
 * must not happen: two visitors of a public form who send the same key string
 * are handed each other's stored response. Refusing the key degrades them to no
 * idempotency, which is what they had before this table existed.
 */
function principal(uid: string | undefined): string | undefined {
    return uid && uid.length > 0 ? uid : undefined;
}

/**
 * A stable rendering of a JSON value: one body always produces one string,
 * whatever order its keys arrived in.
 *
 * `JSON.stringify` preserves insertion order, so two encodings of the same
 * object would fingerprint differently and a legitimate retry would be refused
 * as a reused key. Only JSON types reach here — the value came from `JSON.parse`.
 */
function stableStringify(value: unknown): string {
    if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
    const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

/**
 * What a key was claimed *for*, so presenting it on a different request is
 * caught instead of silently replaying the first one's answer.
 *
 * Nothing about the request used to enter the key, so `createMany(rows, { key })`
 * followed by `deleteMany(ids, { key })` — the reusable business id the docs
 * recommended — answered the delete with the create's `200` body and deleted
 * nothing. Method and path separate the routes; the body separates a re-run
 * carrying corrected rows from the retry of an unanswered one, which is the
 * difference between "here is your earlier answer" and silently discarding a
 * correction.
 */
export function requestFingerprint(method: string, path: string, body: unknown): string {
    return createHash("sha256")
        .update(`${method.toUpperCase()} ${path}\n${stableStringify(body)}`)
        .digest("hex");
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
    /** This key is live, but it was claimed for a different request. */
    | { status: "mismatch" }
    /** The key is ours; do the write, then `complete` or `release` it. */
    | { status: "claimed" };

export interface IdempotencyStore {
    /**
     * Take the key if it is free, atomically. Never throws — a store that
     * cannot answer reports `claimed`, which degrades to no idempotency rather
     * than to a refused write.
     *
     * `fingerprint` says what the key is being claimed for (see
     * {@link requestFingerprint}); a live key presented with a different one is
     * a reused key, not a replay, and is reported as `mismatch`.
     */
    claim(key: string, uid: string | undefined, fingerprint: string): Promise<IdempotencyClaim>;
    /** Record what this key answered. Never throws. */
    complete(key: string, uid: string | undefined, response: unknown): Promise<void>;
    /**
     * Give the key back after the write it was claimed for failed.
     *
     * Without this a transient failure strands the key until its lease runs
     * out, turning one failed write into a minute of refused retries. The lease
     * is the floor, not the mechanism: it only covers the exits no code runs on.
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
    let retryEnsureAt = 0;
    let warnedAnonymous = false;
    /** Said once per process: it is a deployment fact, not a per-request event. */
    const warnAnonymous = (): void => {
        if (warnedAnonymous) return;
        warnedAnonymous = true;
        logger.warn(
            "Idempotency-Key ignored for an unauthenticated request — keys are scoped to a signed-in " +
            "principal, and honouring one here would replay a stored response to whoever sends the " +
            "same key next. A replayed write from an anonymous client may insert a duplicate row."
        );
    };
    /** Created on first use: most deployments never send a key at all. */
    const ensure = (): Promise<boolean> => {
        if (ready) return ready;
        // A failure is retried, but not by every request that arrives in the
        // meantime: the database is the thing that is unwell.
        if (Date.now() < retryEnsureAt) return Promise.resolve(false);
        const attempt = (async () => {
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
                // Added separately: a deployment that already has the table
                // from an earlier version keeps it, and `CREATE TABLE IF NOT
                // EXISTS` would not add the column to it. A row written before
                // this has no fingerprint and is never treated as a mismatch.
                await exec(`ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS fingerprint TEXT`);
                await exec(`CREATE INDEX IF NOT EXISTS idx_idempotency_created ON ${TABLE}(created_at)`);
                // Rows here are keyed by uid and hold a previous response body,
                // so a readable table is one user's writes replayed to another.
                // No RLS (not a collection), and the driver's schema-wide grant
                // reaches it — created lazily, long after that grant ran.
                await exec(revokeInternalTableSql("rebase", "idempotency_keys"));
                return true;
            } catch (error) {
                retryEnsureAt = Date.now() + ENSURE_RETRY_COOLDOWN_MS;
                logger.warn(
                    "Idempotency keys unavailable — a replayed offline write may insert a duplicate row.",
                    { detail: error instanceof Error ? error.message : String(error) }
                );
                return false;
            }
        })();
        // Cleared in a `then` rather than in the `catch` above, which can run
        // before the assignment below and would leave the failure memoised —
        // the bug this replaces.
        ready = attempt.then((ok) => {
            if (!ok) ready = undefined;
            return ok;
        });
        return ready;
    };

    return {
        async claim(key, uid, fingerprint) {
            const owner = principal(uid);
            if (key && !owner) warnAnonymous();
            if (!key || !owner || !(await ensure())) return { status: "claimed" };
            try {
                // One statement decides it. A free key inserts; an expired one
                // is taken over by the DO UPDATE, whose WHERE fails for a live
                // row so the claim is refused. `RETURNING` therefore yields a
                // row exactly when this request owns the key.
                //
                // Two expiries, not one. A row that has answered holds its
                // reply for the whole replay window; a row that has not is only
                // held for as long as a request could still be running, because
                // the process that claimed it may no longer exist and nothing
                // else will ever hand the key back.
                const claimed = await exec(
                    `INSERT INTO ${TABLE} (key, uid, fingerprint, response, created_at)
                     VALUES ($1, $2, $3, NULL, NOW())
                     ON CONFLICT (uid, key) DO UPDATE
                       SET response = NULL, created_at = NOW(), fingerprint = EXCLUDED.fingerprint
                       WHERE (${TABLE}.response IS NULL
                              AND ${TABLE}.created_at < NOW() - INTERVAL '${PENDING_LEASE_SECONDS} seconds')
                          OR (${TABLE}.response IS NOT NULL
                              AND ${TABLE}.created_at < NOW() - INTERVAL '${TTL_HOURS} hours')
                     RETURNING 1 AS claimed`,
                    [key, owner, fingerprint]
                );
                if (claimed.length > 0) return { status: "claimed" };

                // Refused, so a live row holds the key. A SQL NULL response
                // means it is still being written; a JSONB `null` is a
                // legitimate stored body, and the two are indistinguishable
                // once node-pg has turned both into JS `null` — hence the
                // explicit `IS NULL` column.
                const rows = await exec(
                    `SELECT response, response IS NULL AS pending, fingerprint FROM ${TABLE}
                     WHERE uid = $1 AND key = $2`,
                    [owner, key]
                );
                const row = rows[0];
                if (!row) return { status: "claimed" };
                // A key claimed for one request and presented on another is a
                // caller mistake, not a replay: answering it with the first
                // request's body would tell a delete it succeeded. Rows written
                // before the column existed carry no fingerprint and keep the
                // old, permissive behaviour rather than failing every retry
                // that spans the upgrade.
                if (row.fingerprint != null && row.fingerprint !== fingerprint) return { status: "mismatch" };
                if (row.pending) return { status: "in-flight" };
                return { status: "replay", response: row.response };
            } catch {
                // Bookkeeping must never refuse a write: fall back to no
                // idempotency, which is the behaviour without this table.
                return { status: "claimed" };
            }
        },

        async complete(key, uid, response) {
            const owner = principal(uid);
            if (!key || !owner || !(await ensure())) return;
            try {
                await exec(
                    `UPDATE ${TABLE} SET response = $3::jsonb WHERE uid = $1 AND key = $2`,
                    [owner, key, JSON.stringify(response ?? null)]
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
            const owner = principal(uid);
            if (!key || !owner || !(await ensure())) return;
            try {
                // Only an unanswered claim. A completed key must survive, or a
                // later failure would erase a reply that is still owed.
                await exec(
                    `DELETE FROM ${TABLE} WHERE uid = $1 AND key = $2 AND response IS NULL`,
                    [owner, key]
                );
            } catch {
                /* The row ages out on its own. */
            }
        }
    };
}

/** The header the client sends. Matches the widely used Stripe/IETF spelling. */
export const IDEMPOTENCY_HEADER = "Idempotency-Key";
