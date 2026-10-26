import { describe, it, expect, jest, afterEach } from "@jest/globals";
import { createApiKeyStore } from "../src/auth/api-keys/api-key-store";
import { logger } from "../src/utils/logger";
import type { DataDriver } from "../../types/src/controllers/data_driver";

/**
 * `rebase.api_keys` on a backend that changes nothing in its database: read,
 * never made or altered, and a table an older release left behind — present,
 * but without the columns this one reads — named at boot rather than met as a
 * failed key lookup.
 */
function driverWith(behaviour: (sql: string) => Record<string, unknown>[]) {
    const sent: string[] = [];
    const driver = {
        admin: {
            executeSql: jest.fn(async (sql: string) => {
                sent.push(sql);
                return behaviour(sql);
            })
        }
    } as unknown as DataDriver;
    return { driver, sent };
}

const SCHEMA_CHANGE = /^\s*(CREATE|ALTER|DROP|GRANT|REVOKE|DO)\b/i;

afterEach(() => jest.restoreAllMocks());

describe("the API key table on a backend that provisions nothing", () => {
    it("names a table that lacks this release's columns, and alters nothing", async () => {
        const errors = jest.spyOn(logger, "error").mockImplementation(() => undefined);
        const { driver, sent } = driverWith(sql => {
            if (/SELECT kind, scopes, roles, owner_uid FROM/.test(sql)) throw new Error('column "owner_uid" does not exist');
            return [];
        });

        await createApiKeyStore(driver, { provision: false })!.ensureTable();

        expect(sent.filter(sql => SCHEMA_CHANGE.test(sql))).toEqual([]);
        const said = errors.mock.calls.map(call => String(call[0]));
        expect(said.some(line => /rebase\.api_keys is out of date/.test(line))).toBe(true);
    });

    it("says nothing when the table is current", async () => {
        const errors = jest.spyOn(logger, "error").mockImplementation(() => undefined);
        const { driver } = driverWith(() => []);

        await createApiKeyStore(driver, { provision: false })!.ensureTable();

        expect(errors).not.toHaveBeenCalled();
    });
});
