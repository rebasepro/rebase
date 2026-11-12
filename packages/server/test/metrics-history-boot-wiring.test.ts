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
import type { BackendBootstrapper } from "@rebasepro/types";
import { initializeRebaseBackend } from "../src/init";
import type { HonoEnv } from "../src/api/types";
import { fakeBootstrapper, fakeDataDriver } from "./helpers/server-b-fakes";
import { tablesFrom } from "./helpers/tables";

const stopSampler = jest.fn();
jest.mock("../src/metrics/history-recorder", () => ({
    createMetricsHistory: () => ({
        ensure: async () => undefined,
        read: async () => [],
        start: () => stopSampler
    })
}));

function bootstrapper(): BackendBootstrapper {
    return fakeBootstrapper({ driver: fakeDataDriver({ admin: { executeSql: async () => [] } }) }, {
        async initializeAuth() {
            return { userService: {}, authRepository: {} };
        }
    });
}

it("stops the metrics sampler on backend.shutdown()", async () => {
    const backend = await initializeRebaseBackend({
        app: new Hono<HonoEnv>(),
        server: createServer(),
        cronPersistence: false,
        bootstrappers: [bootstrapper()]
    });
    expect(stopSampler).not.toHaveBeenCalled();

    await backend.shutdown(1_000);

    expect(stopSampler).toHaveBeenCalledTimes(1);
});
