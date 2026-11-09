import { Pool } from "pg";
import { guardPoolAgainstDirtyRelease } from "../src/connection";

jest.mock("@rebasepro/server", () => ({
    logger: {
        error: jest.fn(),
        warn: jest.fn(),
        info: jest.fn(),
        debug: jest.fn()
    }
}));

import { logger } from "@rebasepro/server";

/**
 * A real pg-pool, never connected, with its private `_expired` set swapped
 * for one the test can read — or taken away, as an upstream change might.
 */
function makeFakePool(withExpired = true): { pool: Pool; expired: Set<unknown> } {
    const pool = new Pool();
    const expired = new Set<unknown>();
    if (withExpired) Reflect.set(pool, "_expired", expired);
    else Reflect.deleteProperty(pool, "_expired");
    return { pool, expired };
}

describe("guardPoolAgainstDirtyRelease", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("marks a client released mid-transaction ('T') as expired so pg-pool destroys it", () => {
        const { pool, expired } = makeFakePool();
        guardPoolAgainstDirtyRelease(pool, "test-pool");

        const client = { _txStatus: "T" };
        pool.emit("release", undefined, client);

        expect(expired.has(client)).toBe(true);
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("still in a transaction"));
    });

    it("marks a client released in a failed transaction ('E') as expired", () => {
        const { pool, expired } = makeFakePool();
        guardPoolAgainstDirtyRelease(pool, "test-pool");

        const client = { _txStatus: "E" };
        pool.emit("release", undefined, client);

        expect(expired.has(client)).toBe(true);
    });

    it("leaves an idle client ('I') alone", () => {
        const { pool, expired } = makeFakePool();
        guardPoolAgainstDirtyRelease(pool, "test-pool");

        const client = { _txStatus: "I" };
        pool.emit("release", undefined, client);

        expect(expired.size).toBe(0);
        expect(logger.error).not.toHaveBeenCalled();
    });

    it("ignores clients released with an error (pg-pool destroys those itself)", () => {
        const { pool, expired } = makeFakePool();
        guardPoolAgainstDirtyRelease(pool, "test-pool");

        const client = { _txStatus: "T" };
        pool.emit("release", new Error("boom"), client);

        expect(expired.size).toBe(0);
    });

    it("does nothing when the client does not expose _txStatus (pg internals changed)", () => {
        const { pool, expired } = makeFakePool();
        guardPoolAgainstDirtyRelease(pool, "test-pool");

        pool.emit("release", undefined, {});
        pool.emit("release", undefined, { _txStatus: null });

        expect(expired.size).toBe(0);
        expect(logger.error).not.toHaveBeenCalled();
    });

    it("logs loudly when the pool's _expired set is unavailable instead of failing", () => {
        const { pool } = makeFakePool(false);
        guardPoolAgainstDirtyRelease(pool, "test-pool");

        const client = { _txStatus: "T" };
        expect(() => pool.emit("release", undefined, client)).not.toThrow();
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("internal expiry set is unavailable"));
    });
});
