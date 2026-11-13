import { describe, expect, it, jest } from "@jest/globals";
import type { DatabaseAdapter, InitializedDriver } from "@rebasepro/types";

import { adapterToBootstrapper } from "./driver";

/**
 * The wrapper that turns a driver's `DatabaseAdapter` into the
 * `BackendBootstrapper` the boot path calls — including the boot-time schema
 * and RLS provisioning.
 *
 * Regression guard for a real, shipped-but-dead feature: boot-time table
 * creation existed on the bootstrapper, but this wrapper listed the methods it
 * forwarded explicitly and did not list `ensureTableSchema`. So on the
 * only path that reaches it — `initializeDataSource` → here — the runtime saw
 * no method and skipped, and every managed tenant came up 500ing every data
 * route. `ensureTablePolicies` (the RLS half) would fail the same way.
 * A dropped forward is invisible in types (the methods are optional), so it is
 * asserted here directly.
 */

const driverResult = {} as InitializedDriver;

function baseAdapter(): DatabaseAdapter {
    return {
        type: "postgres",
        initializeDriver: jest.fn(async () => driverResult) as DatabaseAdapter["initializeDriver"]
    };
}

describe("adapterToBootstrapper", () => {
    it("forwards ensureTableSchema through to the adapter", async () => {
        const ensureTableSchema = jest.fn(async () => ({ applied: 3 }));
        const bootstrapper = adapterToBootstrapper(
            { ...baseAdapter(), ensureTableSchema },
            "default",
            true
        );

        expect(typeof bootstrapper.ensureTableSchema).toBe("function");
        const out = await bootstrapper.ensureTableSchema!([{}], driverResult);
        expect(out).toEqual({ applied: 3 });
        expect(ensureTableSchema).toHaveBeenCalledTimes(1);
    });

    it("forwards ensureTablePolicies through to the adapter", async () => {
        const ensureTablePolicies = jest.fn(async () => ({ applied: 5 }));
        const bootstrapper = adapterToBootstrapper(
            { ...baseAdapter(), ensureTablePolicies },
            "default",
            true
        );

        expect(typeof bootstrapper.ensureTablePolicies).toBe("function");
        const out = await bootstrapper.ensureTablePolicies!([{}], driverResult);
        expect(out).toEqual({ applied: 5 });
        expect(ensureTablePolicies).toHaveBeenCalledTimes(1);
    });

    it("leaves both undefined when the adapter implements neither (schemaless driver)", () => {
        const bootstrapper = adapterToBootstrapper(baseAdapter(), "default", true);
        expect(bootstrapper.ensureTableSchema).toBeUndefined();
        expect(bootstrapper.ensureTablePolicies).toBeUndefined();
    });
});
