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
import { createShutdown } from "../src/init/shutdown";
import { createMetricsHistory } from "../src/metrics/history-recorder";
import { SAMPLE_INTERVAL_MS } from "../src/metrics/history-store";
import { fakeDataDriver } from "./helpers/server-b-fakes";

const histogram = { mean: 0, enable: jest.fn(), disable: jest.fn(), reset: jest.fn() };
jest.mock("node:perf_hooks", () => ({
    ...jest.requireActual<typeof import("node:perf_hooks")>("node:perf_hooks"),
    monitorEventLoopDelay: () => histogram
}));

function sqlDriver() {
    const executeSql = jest.fn(async (_sql: string, _options?: { params?: unknown[] }) => []);
    return { driver: fakeDataDriver({ admin: { executeSql } }), executeSql };
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

describe("the sampler's request history", () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.clearAllMocks();
    });
    afterEach(() => jest.useRealTimers());

    it("writes per-minute deltas from the registry it was pointed at", async () => {
        const { driver, executeSql } = sqlDriver();
        const history = createMetricsHistory(driver)!;
        let totals = { data: { requests: 5, errors: 1 } };
        history.countRequestsFrom(() => totals);
        const stop = history.start();
        await jest.advanceTimersByTimeAsync(0);

        const deltaWrites = () => executeSql.mock.calls
            .map(([, options]) => options?.params)
            .filter((params): params is unknown[] => Array.isArray(params) && String(params[1]).includes("_data"))
            .map(params => [params[1], params[3]]);

        // The first tick writes the count since boot.
        expect(deltaWrites()).toEqual([["requests_data", 5], ["errors_data", 1]]);

        totals = { data: { requests: 8, errors: 1 } };
        await jest.advanceTimersByTimeAsync(SAMPLE_INTERVAL_MS);
        // Then only the difference, and no row for the unchanged errors.
        expect(deltaWrites()).toEqual([["requests_data", 5], ["errors_data", 1], ["requests_data", 3]]);
        stop();
    });
});

describe("createShutdown", () => {
    it("stops the metrics sampler", async () => {
        const stopMetricsSampler = jest.fn();

        await createShutdown({ server: createServer(), realtimeServices: {}, stopMetricsSampler })(1_000);

        expect(stopMetricsSampler).toHaveBeenCalledTimes(1);
    });
});
