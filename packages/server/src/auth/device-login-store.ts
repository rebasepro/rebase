/**
 * Persistence for device sign-in: RFC 8628's device authorization grant, the
 * way a terminal signs in through a browser.
 *
 * One table in the `rebase` schema, revoked from `rebase_user` like every
 * other internal table: a live row is a pending sign-in, and the role RLS
 * scopes must never be able to read or approve one.
 *
 * The device code — the secret the polling client holds — is stored as its
 * SHA-256 and looked up by it, so a database disclosure yields nothing a
 * poller could present. The user code is stored as it is: it is shown on two
 * screens by design, is useless without a signed-in browser to approve it,
 * and lives ten minutes.
 *
 * Every decision that must happen once is a conditional `UPDATE`: approving or
 * denying flips a `pending` row, and handing out the session flips an
 * `approved` one to `consumed`. Two requests racing for either find one row
 * to change between them, so one wins and the other is told it lost.
 *
 * @module
 */
import type { DataDriver } from "@rebasepro/types";
import { isSQLAdmin } from "@rebasepro/types";
import { revokeInternalTableSql } from "@rebasepro/common";
import { logger } from "../utils/logger";
import { createDdlBootstrapper, provisioningExec, type SqlExec } from "../boot/ddl-bootstrap";
import { sha256Hex } from "../utils/portable-crypto";

const TABLE = "rebase.auth_device_logins";

/** Where a device sign-in stands. */
export type DeviceLoginStatus = "pending" | "approved" | "denied" | "consumed";

/** What starting a device sign-in stores. */
export interface NewDeviceLogin {
    userCode: string;
    /** What the device calls itself — shown on the approval page. */
    clientName: string;
    requestIp: string;
    requestUserAgent: string;
    expiresAt: Date;
    intervalSeconds: number;
}

/** A device sign-in as the approval page describes it. */
export interface DeviceLoginRecord {
    userCode: string;
    clientName: string;
    requestIp: string;
    requestUserAgent: string;
    status: DeviceLoginStatus;
    createdAt: Date;
    expiresAt: Date;
    /** Whether it has expired, by the database's clock. */
    expired: boolean;
}

/** What one poll found, by the database's clock. */
export interface DeviceLoginPoll {
    status: DeviceLoginStatus;
    expired: boolean;
    intervalSeconds: number;
    /** Seconds since the poll before this one, or null for the first poll. */
    secondsSincePreviousPoll: number | null;
}

/** The account a device sign-in was approved for, handed out once. */
export interface ApprovedDeviceLogin {
    uid: string;
    aal: "aal1" | "aal2";
}

export interface DeviceLoginStore {
    ensureTables(): Promise<void>;
    /** Store a pending sign-in under the SHA-256 of `deviceCode`. False when the user code is taken. */
    create(deviceCode: string, login: NewDeviceLogin): Promise<boolean>;
    /** The sign-in a user code names, in any state, or null. */
    findByUserCode(userCode: string): Promise<DeviceLoginRecord | null>;
    /**
     * Approve or deny a pending, unexpired sign-in. False when it is not
     * pending any more — decided already, or expired — or does not exist.
     */
    decide(userCode: string, decision: { approve: true; uid: string; aal: "aal1" | "aal2" } | { approve: false; uid: string }): Promise<boolean>;
    /** Record a poll and report what it found. Null for a device code nobody issued. */
    poll(deviceCode: string): Promise<DeviceLoginPoll | null>;
    /** Lengthen the interval a too-eager poller is held to. */
    slowDown(deviceCode: string, byStepSeconds: number): Promise<void>;
    /**
     * Take an approved sign-in's account, once. Null when it was not approved,
     * was already taken, or has expired.
     */
    consume(deviceCode: string): Promise<ApprovedDeviceLogin | null>;
}

/** How long a finished or abandoned sign-in is kept before the sweep removes it. */
const KEEP_AFTER_EXPIRY = "1 day";
/** How often, at most, starting a sign-in also sweeps old ones. */
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * A store backed by the driver's SQL escape hatch, or null when the driver
 * cannot run SQL. Device sign-in is then not offered at all: a grant whose
 * pending state cannot be kept would hand a session to whoever polls first.
 */
export function createDeviceLoginStore(
    /** Only its SQL escape hatch is read. */
    driver: Pick<DataDriver, "admin">,
    options: {
        /**
         * Default `true`. `false` is a backend that changes nothing in its
         * database: `ensureTables` creates nothing, and throws when the table
         * is not already there.
         */
        provision?: boolean;
    } = {}
): DeviceLoginStore | null {
    const admin = driver.admin;
    if (!isSQLAdmin(admin)) return null;

    const run: SqlExec = provisioningExec(
        (sql, execOptions) => admin.executeSql(sql, execOptions?.params ? { params: execOptions.params } : undefined),
        options.provision
    );
    const exec = (sql: string, params?: unknown[]) => run(sql, params ? { params } : undefined);
    const ddl = createDdlBootstrapper(run, "device-login-store");

    const sweep = () => exec(`DELETE FROM ${TABLE} WHERE expires_at < now() - interval '${KEEP_AFTER_EXPIRY}'`);
    let lastSweep = Date.now();
    const sweepIfDue = () => {
        if (Date.now() - lastSweep < SWEEP_INTERVAL_MS) return;
        lastSweep = Date.now();
        sweep().catch(error => logger.warn("[device-login] Sweeping old device sign-ins failed", { error }));
    };

    return {
        async ensureTables() {
            await ddl.ensureObject(TABLE, `
                CREATE TABLE IF NOT EXISTS ${TABLE} (
                    device_code_hash   text PRIMARY KEY,
                    user_code          text NOT NULL UNIQUE,
                    client_name        text NOT NULL,
                    request_ip         text NOT NULL,
                    request_user_agent text NOT NULL,
                    status             text NOT NULL DEFAULT 'pending',
                    uid                text,
                    aal                text,
                    interval_seconds   integer NOT NULL,
                    last_polled_at     timestamptz,
                    created_at         timestamptz NOT NULL DEFAULT now(),
                    decided_at         timestamptz,
                    expires_at         timestamptz NOT NULL
                )
            `);
            const [schema, name] = TABLE.split(".");
            await ddl.step(`revoke ${TABLE}`, () => exec(revokeInternalTableSql(schema, name)));
            await ddl.step("sweep old device sign-ins", sweep);
            lastSweep = Date.now();

            // The bootstrapper logs a failed statement rather than throwing.
            // Here that would mount routes with nowhere to keep their state, so
            // ask whether the table is really there.
            const rows = await exec(`SELECT to_regclass($1) AS present`, [TABLE]);
            if (rows[0]?.present == null) {
                throw new Error(options.provision === false
                    ? `The device sign-in table ${TABLE} does not exist, and this backend changes nothing in its database. `
                      + "A provisioning run with auth.deviceLogin on creates it."
                    : `The device sign-in table ${TABLE} was not created. Check the boot log above for the statement `
                      + "that failed, which is usually a permissions problem on the `rebase` schema.");
            }
        },

        async create(deviceCode, login) {
            sweepIfDue();
            const rows = await exec(
                `INSERT INTO ${TABLE}
                    (device_code_hash, user_code, client_name, request_ip, request_user_agent, interval_seconds, expires_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 ON CONFLICT (user_code) DO NOTHING
                 RETURNING device_code_hash`,
                [
                    await sha256Hex(deviceCode),
                    login.userCode,
                    login.clientName,
                    login.requestIp,
                    login.requestUserAgent,
                    login.intervalSeconds,
                    login.expiresAt.toISOString()
                ]
            );
            return rows.length > 0;
        },

        async findByUserCode(userCode) {
            const rows = await exec(
                `SELECT user_code, client_name, request_ip, request_user_agent, status, created_at, expires_at,
                        expires_at <= now() AS expired
                   FROM ${TABLE} WHERE user_code = $1`,
                [userCode]
            );
            const row = rows[0];
            if (!row) return null;
            return {
                userCode: String(row.user_code),
                clientName: String(row.client_name),
                requestIp: String(row.request_ip),
                requestUserAgent: String(row.request_user_agent),
                status: toStatus(row.status),
                createdAt: toDate(row.created_at),
                expiresAt: toDate(row.expires_at),
                expired: row.expired === true
            };
        },

        async decide(userCode, decision) {
            const rows = await exec(
                `UPDATE ${TABLE}
                    SET status = $2, uid = $3, aal = $4, decided_at = now()
                  WHERE user_code = $1 AND status = 'pending' AND expires_at > now()
                  RETURNING user_code`,
                [
                    userCode,
                    decision.approve ? "approved" : "denied",
                    decision.uid,
                    decision.approve ? decision.aal : null
                ]
            );
            return rows.length > 0;
        },

        async poll(deviceCode) {
            // The previous poll's time is read under the row's lock and
            // replaced in the same statement, so two polls in flight at once
            // each see the other's time rather than both seeing the older one.
            const rows = await exec(
                `UPDATE ${TABLE} d
                    SET last_polled_at = now()
                   FROM (SELECT device_code_hash, last_polled_at FROM ${TABLE}
                          WHERE device_code_hash = $1 FOR UPDATE) previous
                  WHERE d.device_code_hash = previous.device_code_hash
                  RETURNING d.status, d.interval_seconds, d.expires_at <= now() AS expired,
                            EXTRACT(EPOCH FROM (now() - previous.last_polled_at))::float8 AS since_previous`,
                [await sha256Hex(deviceCode)]
            );
            const row = rows[0];
            if (!row) return null;
            return {
                status: toStatus(row.status),
                expired: row.expired === true,
                intervalSeconds: Number(row.interval_seconds),
                secondsSincePreviousPoll: row.since_previous == null ? null : Number(row.since_previous)
            };
        },

        async slowDown(deviceCode, byStepSeconds) {
            await exec(
                `UPDATE ${TABLE} SET interval_seconds = interval_seconds + $2 WHERE device_code_hash = $1`,
                [await sha256Hex(deviceCode), byStepSeconds]
            );
        },

        async consume(deviceCode) {
            const rows = await exec(
                `UPDATE ${TABLE} SET status = 'consumed'
                  WHERE device_code_hash = $1 AND status = 'approved' AND expires_at > now()
                  RETURNING uid, aal`,
                [await sha256Hex(deviceCode)]
            );
            const row = rows[0];
            if (!row || row.uid == null) return null;
            return { uid: String(row.uid), aal: row.aal === "aal2" ? "aal2" : "aal1" };
        }
    };
}

function toStatus(value: unknown): DeviceLoginStatus {
    return value === "approved" || value === "denied" || value === "consumed" ? value : "pending";
}

function toDate(value: unknown): Date {
    return value instanceof Date ? value : new Date(String(value));
}
