/**
 * The metrics sampler stops when the backend does.
 *
 * `initializeRebaseBackend` started it and threw away the stop it returned, so
 * nothing could end it: after `backend.shutdown()` the one-minute interval kept
 * firing into a pool the embedder had just closed, and the event-loop histogram
 * stayed enabled for the life of the process. In a test suite or anything else
 * that boots and shuts a backend down in-process, every boot added one more.
 */
import { createServer } from "http";
import type { DataDriver } from "@rebasepro/types";
import { createShutdown } from "../src/init/shutdown";
import { createMetricsHistory } from "../src/metrics/history-recorder";
import { SAMPLE_INTERVAL_MS } from "../src/metrics/history-store";

const histogram = { mean: 0, enable: jest.fn(), disable: jest.fn(), reset: jest.fn() };
jest.mock("node:perf_hooks", () => ({
    ...jest.requireActual<typeof import("node:perf_hooks")>("node:perf_hooks"),
    monitorEventLoopDelay: () => histogram
}));

function sqlDriver() {
    const executeSql = jest.fn(async () => []);
    return { driver: { admin: { executeSql } } as unknown as DataDriver, executeSql };
}

describe("the metrics sampler's stop", () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.clearAllMocks();
    });
    afterEach(() => jest.useRealTimers());

    it("ends the interval and disables the event-loop histogram", async () => {
        const { driver, executeSql } = sqlDriver();
        const stop = createMetricsHistory(driver)!.start();
        await jest.advanceTimersByTimeAsync(SAMPLE_INTERVAL_MS);
        expect(histogram.enable).toHaveBeenCalledTimes(1);
        const written = executeSql.mock.calls.length;
        expect(written).toBeGreaterThan(0);

        stop();
        await jest.advanceTimersByTimeAsync(5 * SAMPLE_INTERVAL_MS);

        expect(executeSql.mock.calls.length).toBe(written);
        expect(histogram.disable).toHaveBeenCalledTimes(1);
    });
});

describe("createShutdown", () => {
    it("stops the metrics sampler", async () => {
        const stopMetricsSampler = jest.fn();

        await createShutdown({ server: createServer(), realtimeServices: {}, stopMetricsSampler })(1_000);

        expect(stopMetricsSampler).toHaveBeenCalledTimes(1);
    });
});
