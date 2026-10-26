import { describe, it, expect, jest, afterEach } from "@jest/globals";
import { createIdempotencyStore } from "../src/api/rest/idempotency";
import { logger } from "../src/utils/logger";
import type { DataDriver } from "../../types/src/controllers/data_driver";

/**
 * The idempotency-key table is made on the first request that carries a key —
 * on the request path, long after boot. A backend that changes nothing in its
 * database must never get there: it uses the table if a provisioning run made
 * it, and otherwise turns the mechanism off, once, out loud.
 */
function driverWith(tableExists: boolean) {
    const sent: string[] = [];
    const driver = {
        admin: {
            executeSql: jest.fn(async (sql: string) => {
                sent.push(sql);
                if (/WHERE false/.test(sql) && !tableExists) {
                    throw new Error('relation "rebase.idempotency_keys" does not exist');
                }
                if (/^\s*INSERT/i.test(sql)) return [{ claimed: 1 }];
                return [];
            })
        }
    } as unknown as DataDriver;
    return { driver, sent };
}

const SCHEMA_CHANGE = /^\s*(CREATE|ALTER|DROP|GRANT|REVOKE|DO)\b/i;

afterEach(() => jest.restoreAllMocks());

describe("idempotency keys on a backend that provisions nothing", () => {
    it("uses a table a provisioning run made, and creates nothing", async () => {
        const { driver, sent } = driverWith(true);
        const store = createIdempotencyStore(driver, { provision: false })!;

        expect(await store.claim("k-1", "u-1", "fp")).toEqual({ status: "claimed" });

        expect(sent.filter(sql => SCHEMA_CHANGE.test(sql))).toEqual([]);
        expect(sent.some(sql => /^\s*INSERT INTO "rebase"\."idempotency_keys"/.test(sql))).toBe(true);
    });

    it("without the table, lets the write through unkeyed — and says why once, not per request", async () => {
        const warn = jest.spyOn(logger, "warn").mockImplementation(() => undefined);
        const { driver, sent } = driverWith(false);
        const store = createIdempotencyStore(driver, { provision: false })!;

        expect(await store.claim("k-1", "u-1", "fp")).toEqual({ status: "claimed" });
        expect(await store.claim("k-2", "u-1", "fp")).toEqual({ status: "claimed" });

        expect(sent.filter(sql => SCHEMA_CHANGE.test(sql))).toEqual([]);
        expect(sent.some(sql => /^\s*INSERT/i.test(sql))).toBe(false);
        const said = warn.mock.calls.map(call => String(call[0])).filter(line => line.includes("Idempotency keys unavailable"));
        expect(said).toHaveLength(1);
        expect(said[0]).toContain("changes nothing in its database");
    });

    it("still creates the table by default — the request-path behaviour every other deployment has", async () => {
        const { driver, sent } = driverWith(false);
        const store = createIdempotencyStore(driver)!;

        await store.claim("k-1", "u-1", "fp");

        expect(sent.some(sql => /CREATE TABLE IF NOT EXISTS "rebase"\."idempotency_keys"/.test(sql))).toBe(true);
    });
});
