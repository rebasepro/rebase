/**
 * The device sign-in store's SQL, executed against a real Postgres.
 *
 * `server/test/auth-device-login.test.ts` drives the protocol against an
 * in-memory store; this proves the statements that store stands in for. The
 * claims worth a database: the table is really there after `ensureTables`
 * (the bootstrapper logs a failed statement rather than throwing) and closed
 * to `rebase_user`; a decision and a hand-out each happen once; the poll
 * reports the gap since the poll before it; and expiry is the database's.
 */
import { describe, expect, it, beforeEach, afterEach } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import type { DataDriver } from "@rebasepro/types";
import { REBASE_USER_ROLE } from "@rebasepro/common";

import { createDeviceLoginStore, type DeviceLoginStore } from "../../server/src/auth/device-login-store";

function pgliteDriver(db: PGlite): Pick<DataDriver, "admin"> {
    return {
        admin: {
            async executeSql(sql: string, options?: { params?: unknown[] }) {
                return (await db.query<Record<string, unknown>>(sql, options?.params)).rows;
            }
        }
    };
}

let db: PGlite;
let store: DeviceLoginStore;

const login = (userCode: string, expiresInSeconds = 600) => ({
    userCode,
    clientName: "Rebase CLI on laptop",
    requestIp: "203.0.113.7",
    requestUserAgent: "rebase-cli/0.30.0",
    expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
    intervalSeconds: 5
});

beforeEach(async () => {
    db = new PGlite();
    await db.exec(`CREATE ROLE ${REBASE_USER_ROLE} NOLOGIN`);
    await db.exec("CREATE SCHEMA IF NOT EXISTS rebase");
    const created = createDeviceLoginStore(pgliteDriver(db));
    if (!created) throw new Error("createDeviceLoginStore returned null for a SQL-capable driver");
    store = created;
    await store.ensureTables();
});

afterEach(async () => {
    await db.close();
});

describe("the device sign-in store", () => {
    it("makes its table, closed to the role RLS scopes, and makes it again harmlessly", async () => {
        const present = await db.query<{ present: string | null }>("SELECT to_regclass('rebase.auth_device_logins')::text AS present");
        expect(present.rows[0].present).toBe("rebase.auth_device_logins");
        const readable = await db.query<{ holds: boolean }>(
            `SELECT has_table_privilege('${REBASE_USER_ROLE}', 'rebase.auth_device_logins', 'SELECT') AS holds`
        );
        expect(readable.rows[0].holds).toBe(false);
        await expect(store.ensureTables()).resolves.toBeUndefined();
    });

    it("keeps the device code as a hash, and refuses a user code already taken", async () => {
        expect(await store.create("device-secret", login("BCDFGHJK"))).toBe(true);
        expect(await store.create("another-secret", login("BCDFGHJK"))).toBe(false);
        const stored = await db.query<{ device_code_hash: string }>("SELECT device_code_hash FROM rebase.auth_device_logins");
        expect(stored.rows).toHaveLength(1);
        expect(stored.rows[0].device_code_hash).not.toContain("device-secret");
        expect(stored.rows[0].device_code_hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("describes a sign-in by its user code", async () => {
        await store.create("device-secret", login("BCDFGHJK"));
        const record = await store.findByUserCode("BCDFGHJK");
        expect(record).toMatchObject({
            userCode: "BCDFGHJK",
            clientName: "Rebase CLI on laptop",
            requestIp: "203.0.113.7",
            requestUserAgent: "rebase-cli/0.30.0",
            status: "pending",
            expired: false
        });
        expect(record?.createdAt).toBeInstanceOf(Date);
        expect(await store.findByUserCode("ZZZZZZZZ")).toBeNull();
    });

    it("decides once, and hands the account out once", async () => {
        await store.create("device-secret", login("BCDFGHJK"));
        expect(await store.consume("device-secret")).toBeNull();

        expect(await store.decide("BCDFGHJK", { approve: true, uid: "user-1", aal: "aal2" })).toBe(true);
        expect(await store.decide("BCDFGHJK", { approve: false, uid: "user-1" })).toBe(false);

        expect(await store.consume("device-secret")).toEqual({ uid: "user-1", aal: "aal2" });
        expect(await store.consume("device-secret")).toBeNull();
        expect((await store.findByUserCode("BCDFGHJK"))?.status).toBe("consumed");
    });

    it("gives nothing out for a denied sign-in", async () => {
        await store.create("device-secret", login("BCDFGHJK"));
        expect(await store.decide("BCDFGHJK", { approve: false, uid: "user-1" })).toBe(true);
        expect(await store.consume("device-secret")).toBeNull();
        expect((await store.poll("device-secret"))?.status).toBe("denied");
    });

    it("lets nobody decide or take an expired sign-in", async () => {
        await store.create("device-secret", login("BCDFGHJK", -1));
        expect((await store.findByUserCode("BCDFGHJK"))?.expired).toBe(true);
        expect(await store.decide("BCDFGHJK", { approve: true, uid: "user-1", aal: "aal1" })).toBe(false);
        expect((await store.poll("device-secret"))?.expired).toBe(true);

        await db.query("UPDATE rebase.auth_device_logins SET status = 'approved', uid = 'user-1'");
        expect(await store.consume("device-secret")).toBeNull();
    });

    it("reports the gap since the previous poll, and slows a poller down", async () => {
        await store.create("device-secret", login("BCDFGHJK"));
        const first = await store.poll("device-secret");
        expect(first).toEqual({ status: "pending", expired: false, intervalSeconds: 5, secondsSincePreviousPoll: null });

        await db.query("UPDATE rebase.auth_device_logins SET last_polled_at = now() - interval '7 seconds'");
        const second = await store.poll("device-secret");
        expect(second?.secondsSincePreviousPoll).toBeGreaterThanOrEqual(7);
        expect(second?.secondsSincePreviousPoll).toBeLessThan(9);

        await store.slowDown("device-secret", 5);
        expect((await store.poll("device-secret"))?.intervalSeconds).toBe(10);
        expect(await store.poll("unknown")).toBeNull();
    });
});
