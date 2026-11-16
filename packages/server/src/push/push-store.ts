/**
 * The subscriptions, as SQL against `rebase.push_subscriptions`.
 *
 * One row per browser, keyed by the endpoint's hash and owned by the account it
 * subscribed under. The server reads and writes on the owner connection, with
 * the owner named in every statement that acts for a caller. Row-level
 * security is the second wall: the request roles may only read and delete,
 * and only rows whose `user_id` is `rebase.uid()`, so SQL run as a caller
 * (`getSql`) sees that caller's browsers and nobody else's.
 */
import type { PushSubscriptionInfo, PushTarget } from "@rebasepro/types";
import { LOAD_REQUEST_ROLES_PLPGSQL } from "@rebasepro/common";

export const PUSH_SUBSCRIPTIONS_TABLE = "rebase.push_subscriptions";

/** The driver's SQL, on the owner connection. */
export type PushExec = (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

/** A stored subscription: what a sender needs and what application code sees. */
export interface StoredPushSubscription extends PushTarget {
    info: PushSubscriptionInfo;
}

export interface PushStore {
    /** Create the table, its index and its policies. */
    ensure(): Promise<void>;
    /** Check the table is there, for a backend that changes nothing in its database. */
    adopt(): Promise<void>;
    /**
     * Insert or take over the row for this endpoint. A browser that signs in to
     * another account moves to it, and starts again as a new subscription.
     */
    upsert(row: { id: string; userId: string; endpoint: string; p256dh: string; auth: string; lang: string | null; userAgent: string | null }): Promise<void>;
    /** Delete the caller's row for this id. `false` when there was none of theirs. */
    removeOwn(id: string, userId: string): Promise<boolean>;
    /** Delete a row the push service said is gone, unless it was re-subscribed with new keys meanwhile. */
    removeGone(id: string, p256dh: string): Promise<void>;
    listForUser(userId: string): Promise<StoredPushSubscription[]>;
    listByIds(ids: readonly string[]): Promise<StoredPushSubscription[]>;
    markSent(ids: readonly string[]): Promise<void>;
}

const COLUMNS = "id, user_id, endpoint, p256dh, auth, lang, created_at, last_sent_at";

function toDate(value: unknown): Date {
    return value instanceof Date ? value : new Date(String(value));
}

function toStored(row: Record<string, unknown>): StoredPushSubscription {
    const endpoint = String(row.endpoint);
    let endpointHost = "";
    try {
        endpointHost = new URL(endpoint).host;
    } catch { /* stored rows were checked on the way in */ }
    return {
        endpoint,
        p256dh: String(row.p256dh),
        auth: String(row.auth),
        info: {
            id: String(row.id),
            userId: String(row.user_id),
            endpointHost,
            lang: row.lang == null ? null : String(row.lang),
            createdAt: toDate(row.created_at),
            lastSentAt: row.last_sent_at == null ? null : toDate(row.last_sent_at)
        }
    };
}

/**
 * The request roles may read and delete their own rows, and nothing else: the
 * schema-wide grant gives them full DML on every table created later, so the
 * insert and update rights are taken back explicitly.
 */
const REQUEST_ROLE_GRANTS_SQL = `
    DO $rebase_push_grants$
    DECLARE
        request_roles text[];
        request_role text;
    BEGIN
        ${LOAD_REQUEST_ROLES_PLPGSQL}
        FOREACH request_role IN ARRAY request_roles LOOP
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = request_role) THEN
                EXECUTE format('REVOKE ALL ON ${PUSH_SUBSCRIPTIONS_TABLE} FROM %I', request_role);
                EXECUTE format('GRANT SELECT, DELETE ON ${PUSH_SUBSCRIPTIONS_TABLE} TO %I', request_role);
            END IF;
        END LOOP;
    END
    $rebase_push_grants$`;

/** Own rows only. Guarded on `rebase.uid()`, which the RLS bootstrap creates. */
const POLICIES_SQL = `
    DO $rebase_push_policies$
    BEGIN
        IF to_regprocedure('rebase.uid()') IS NULL THEN
            RETURN;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'rebase' AND tablename = 'push_subscriptions' AND policyname = 'push_subscriptions_own_select') THEN
            CREATE POLICY push_subscriptions_own_select ON ${PUSH_SUBSCRIPTIONS_TABLE} FOR SELECT USING (user_id = rebase.uid());
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'rebase' AND tablename = 'push_subscriptions' AND policyname = 'push_subscriptions_own_delete') THEN
            CREATE POLICY push_subscriptions_own_delete ON ${PUSH_SUBSCRIPTIONS_TABLE} FOR DELETE USING (user_id = rebase.uid());
        END IF;
    END
    $rebase_push_policies$`;

export function createPushStore(exec: PushExec): PushStore {
    return {
        async ensure() {
            await exec(`
                CREATE TABLE IF NOT EXISTS ${PUSH_SUBSCRIPTIONS_TABLE} (
                    id           text        PRIMARY KEY,
                    user_id      text        NOT NULL,
                    endpoint     text        NOT NULL,
                    p256dh       text        NOT NULL,
                    auth         text        NOT NULL,
                    lang         text,
                    user_agent   text,
                    created_at   timestamptz NOT NULL DEFAULT now(),
                    updated_at   timestamptz NOT NULL DEFAULT now(),
                    last_sent_at timestamptz
                )`);
            await exec(`CREATE INDEX IF NOT EXISTS push_subscriptions_user_id ON ${PUSH_SUBSCRIPTIONS_TABLE} (user_id)`);
            await exec(`ALTER TABLE ${PUSH_SUBSCRIPTIONS_TABLE} ENABLE ROW LEVEL SECURITY`);
            await exec(POLICIES_SQL);
            await exec(REQUEST_ROLE_GRANTS_SQL);
        },

        async adopt() {
            try {
                await exec(`SELECT ${COLUMNS} FROM ${PUSH_SUBSCRIPTIONS_TABLE} WHERE false`);
            } catch (error) {
                throw new Error(
                    `${PUSH_SUBSCRIPTIONS_TABLE} is missing or out of date, and this backend changes nothing in its database. ` +
                    "Boot once with provisioning on to create it.",
                    { cause: error }
                );
            }
        },

        async upsert(row) {
            // A browser that changes hands starts over: created_at and
            // last_sent_at describe this account's subscription, not the last one's.
            await exec(`
                INSERT INTO ${PUSH_SUBSCRIPTIONS_TABLE} (id, user_id, endpoint, p256dh, auth, lang, user_agent)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (id) DO UPDATE SET
                    created_at   = CASE WHEN ${PUSH_SUBSCRIPTIONS_TABLE}.user_id = EXCLUDED.user_id THEN ${PUSH_SUBSCRIPTIONS_TABLE}.created_at ELSE now() END,
                    last_sent_at = CASE WHEN ${PUSH_SUBSCRIPTIONS_TABLE}.user_id = EXCLUDED.user_id THEN ${PUSH_SUBSCRIPTIONS_TABLE}.last_sent_at ELSE NULL END,
                    user_id      = EXCLUDED.user_id,
                    endpoint     = EXCLUDED.endpoint,
                    p256dh       = EXCLUDED.p256dh,
                    auth         = EXCLUDED.auth,
                    lang         = EXCLUDED.lang,
                    user_agent   = EXCLUDED.user_agent,
                    updated_at   = now()`,
            [row.id, row.userId, row.endpoint, row.p256dh, row.auth, row.lang, row.userAgent]);
        },

        async removeOwn(id, userId) {
            const rows = await exec(`DELETE FROM ${PUSH_SUBSCRIPTIONS_TABLE} WHERE id = $1 AND user_id = $2 RETURNING id`, [id, userId]);
            return rows.length > 0;
        },

        async removeGone(id, p256dh) {
            await exec(`DELETE FROM ${PUSH_SUBSCRIPTIONS_TABLE} WHERE id = $1 AND p256dh = $2`, [id, p256dh]);
        },

        async listForUser(userId) {
            const rows = await exec(`SELECT ${COLUMNS} FROM ${PUSH_SUBSCRIPTIONS_TABLE} WHERE user_id = $1 ORDER BY created_at`, [userId]);
            return rows.map(toStored);
        },

        async listByIds(ids) {
            if (ids.length === 0) return [];
            const rows = await exec(`SELECT ${COLUMNS} FROM ${PUSH_SUBSCRIPTIONS_TABLE} WHERE id = ANY($1::text[]) ORDER BY created_at`, [[...ids]]);
            return rows.map(toStored);
        },

        async markSent(ids) {
            if (ids.length === 0) return;
            await exec(`UPDATE ${PUSH_SUBSCRIPTIONS_TABLE} SET last_sent_at = now() WHERE id = ANY($1::text[])`, [[...ids]]);
        }
    };
}
