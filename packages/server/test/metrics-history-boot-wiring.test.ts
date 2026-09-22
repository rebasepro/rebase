/**
 * `initializeRebaseBackend` keeps the metrics sampler's stop and its shutdown
 * calls it.
 *
 * The unit half is in `metrics-history-lifecycle.test.ts`; this is the wiring,
 * which is where the stop used to be dropped — `metricsHistory.start()` was
 * called as a statement, so there was no stop to hand the shutdown at all.
 */
import { createServer } from "http";
import { Hono } from "hono";
import type { BackendBootstrapper, InitializedDriver } from "@rebasepro/types";
import { initializeRebaseBackend } from "../src/init";

const stopSampler = jest.fn();
jest.mock("../src/metrics/history-recorder", () => ({
    createMetricsHistory: () => ({
        ensure: async () => undefined,
        read: async () => [],
        start: () => stopSampler
    })
}));

function bootstrapper(): BackendBootstrapper {
    const driver = {
        fetchCollection: async () => ({ data: [], meta: { total: 0, hasMore: false } }),
        fetchEntity: async () => undefined,
        saveEntity: async () => ({}),
        deleteEntity: async () => undefined,
        countCollection: async () => 0,
        checkUniqueField: async () => true,
        healthCheck: async () => ({ healthy: true, latencyMs: 1 }),
        admin: { executeSql: async () => [] }
    };
    return {
        type: "fake",
        isDefault: true,
        async initializeDriver(): Promise<InitializedDriver> {
            return { driver, collections: [], internals: {} } as unknown as InitializedDriver;
        },
        async initializeAuth() {
            return { userService: {}, authRepository: {} };
        }
    } as unknown as BackendBootstrapper;
}

it("stops the metrics sampler on backend.shutdown()", async () => {
    const backend = await initializeRebaseBackend({
        app: new Hono() as never,
        server: createServer(),
        collections: [],
        cronPersistence: false,
        bootstrappers: [bootstrapper()]
    } as never);
    expect(stopSampler).not.toHaveBeenCalled();

    await backend.shutdown(1_000);

    expect(stopSampler).toHaveBeenCalledTimes(1);
});
