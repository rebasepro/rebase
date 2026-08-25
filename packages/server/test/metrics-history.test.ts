import {
    ensureMetricsHistory,
    recordSamples,
    readSeries,
    sampleSelf,
    RETENTION_DAYS,
    METRICS_HISTORY_TABLE
} from "../src/metrics/history-store";

/** Records every statement so the SQL itself can be asserted. */
function fakeExec(rows: unknown[] = []) {
    const calls: { sql: string; params: unknown[] }[] = [];
    const exec = async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        return rows;
    };
    return { exec, calls };
}

describe("metrics history — the table", () => {
    it("creates the table and an index ordered the way reads go", async () => {
        const { exec, calls } = fakeExec();
        await ensureMetricsHistory(exec);
        const sql = calls.map(c => c.sql).join("\n");
        expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${METRICS_HISTORY_TABLE}`);
        // Descending, because every read is "this series, bounded by time,
        // newest end first". The primary key's ascending order makes that a
        // backwards scan.
        expect(sql).toMatch(/metric_samples_series_recent[\s\S]*series, at DESC/);
    });

    it("sweeps what has aged out, every boot", async () => {
        // Swept at boot rather than by a cron, so a deployment that runs no
        // scheduler — a functions-only role, a single-shot container — still
        // stays bounded rather than growing forever in silence.
        const { exec, calls } = fakeExec();
        await ensureMetricsHistory(exec);
        const sweep = calls.find(c => c.sql.includes("DELETE"));
        expect(sweep).toBeDefined();
        expect(sweep!.params).toContain(RETENTION_DAYS);
    });
});

describe("metrics history — sampling this process", () => {
    it("reports no CPU rate on the first sample", () => {
        // `process.cpuUsage()` is cumulative. One reading is a total since
        // boot, not a rate, and publishing it as millicores would show a
        // just-started process at whatever it spent starting up.
        const { samples, cursor } = sampleSelf(null);
        expect(samples.map(s => s.series)).toEqual(["memory_bytes"]);
        expect(cursor.cpu).toBeDefined();
    });

    it("turns two readings into millicores over the elapsed window", () => {
        const previous = { cpu: { user: 0, system: 0 }, at: 1_000 };
        // 500ms of CPU across a 1s window is half a core — 500 millicores.
        const spy = jest.spyOn(process, "cpuUsage").mockReturnValue({ user: 400_000, system: 100_000 });
        try {
            const { samples } = sampleSelf(previous, 2_000);
            const cpu = samples.find(s => s.series === "cpu_millicores");
            expect(cpu?.value).toBeCloseTo(500, 5);
        } finally {
            spy.mockRestore();
        }
    });

    it("does not divide by a zero window", () => {
        // Two samples in the same millisecond. Without the guard this is
        // Infinity, which then reaches the database as a value no chart can
        // scale against.
        const previous = { cpu: process.cpuUsage(), at: 5_000 };
        const { samples } = sampleSelf(previous, 5_000);
        expect(samples.every(s => Number.isFinite(s.value))).toBe(true);
    });
});

describe("metrics history — writing", () => {
    it("buckets to the minute so a restart overwrites rather than doubles", async () => {
        // Two processes sampling one database, or one process restarting
        // mid-minute, must converge on a single row per series per minute —
        // otherwise the row count tracks restarts instead of time.
        const { exec, calls } = fakeExec();
        await recordSamples(exec, [{ series: "memory_bytes", value: 123 }], "pod-a", new Date("2026-08-25T21:34:47.812Z"));
        expect(calls[0].sql).toContain("ON CONFLICT (series, instance, at) DO UPDATE");
        expect((calls[0].params[0] as Date).toISOString()).toBe("2026-08-25T21:34:00.000Z");
    });

    it("drops a non-finite value rather than storing it", async () => {
        const { exec, calls } = fakeExec();
        await recordSamples(exec, [
            { series: "cpu_millicores", value: Infinity },
            { series: "memory_bytes", value: NaN },
            { series: "memory_bytes", value: 42 }
        ], "pod-a");
        expect(calls).toHaveLength(1);
        expect(calls[0].params[3]).toBe(42);
    });

    it("writes nothing at all for an empty tick", async () => {
        const { exec, calls } = fakeExec();
        await recordSamples(exec, [], "pod-a");
        expect(calls).toHaveLength(0);
    });
});

describe("metrics history — reading", () => {
    it("returns points oldest first, which is the order a chart draws", async () => {
        const { exec, calls } = fakeExec([
            { at: new Date("2026-08-25T21:00:00Z"), value: 1 },
            { at: new Date("2026-08-25T21:01:00Z"), value: 2 }
        ]);
        const points = await readSeries(exec, "cpu_millicores", 60);
        expect(calls[0].sql).toContain("ORDER BY at ASC");
        expect(points).toEqual([
            { at: "2026-08-25T21:00:00.000Z", value: 1, instances: 1 },
            { at: "2026-08-25T21:01:00.000Z", value: 2, instances: 1 }
        ]);
    });

    it("reads a driver that wraps its rows and one that does not", async () => {
        // Postgres clients disagree about whether a query returns the rows or
        // an object containing them, and this store is called from both the
        // bootstrapper's executor and a raw one.
        const wrapped = fakeExec({ rows: [{ at: "2026-08-25T21:00:00Z", value: 7 }] } as never);
        expect(await readSeries(wrapped.exec, "memory_bytes", 5)).toEqual([
            { at: "2026-08-25T21:00:00Z", value: 7, instances: 1 }
        ]);
    });
});

describe("metrics history — combining across replicas", () => {
    it("sums consumption, so scaling out does not look like using less", async () => {
        // Two pods at 300m each is 600m of CPU, not 300m. A mean would make an
        // app that scaled out to handle load appear to have got cheaper.
        const { exec, calls } = fakeExec();
        await readSeries(exec, "cpu_millicores", 60);
        expect(calls[0].sql).toMatch(/sum\(value\)/);
        await readSeries(exec, "memory_bytes", 60);
        expect(calls[1].sql).toMatch(/sum\(value\)/);
    });

    it("averages a condition each process is independently in", async () => {
        // Event-loop delay is not consumption. Summing it produces a number no
        // single pod ever experienced — "600ms" from six pods at 100ms each,
        // which reads as an outage and is not one.
        const { exec, calls } = fakeExec();
        await readSeries(exec, "event_loop_delay_ms", 60);
        expect(calls[0].sql).toMatch(/avg\(value\)/);
        expect(calls[0].sql).not.toMatch(/sum\(value\)/);
    });

    it("reports how many instances made up each point", async () => {
        // A sum whose contributor count changed is not comparable with itself:
        // CPU doubling because the app got busy and CPU doubling because it
        // scaled from one replica to two are different events, and a line alone
        // cannot tell them apart.
        const { exec } = fakeExec([{ at: "2026-08-26T09:00:00Z", value: 600, instances: "2" }]);
        expect(await readSeries(exec, "cpu_millicores", 60)).toEqual([
            { at: "2026-08-26T09:00:00Z", value: 600, instances: 2 }
        ]);
    });

    it("groups by the bucket, not by the instance", async () => {
        // Without the GROUP BY the read returns one row per pod per minute and
        // a chart draws N overlapping lines it never asked for.
        const { exec, calls } = fakeExec();
        await readSeries(exec, "cpu_millicores", 60);
        expect(calls[0].sql).toMatch(/GROUP BY at/);
    });
});

describe("metrics history — the route's payload", () => {
    const { createMetricsRoutes, MetricsRegistry } = require("../src/metrics/index");

    const call = async (history?: unknown, path = "/history?series=cpu_millicores") => {
        const router = createMetricsRoutes(new MetricsRegistry(), undefined, history);
        return router.request(`http://local${path}`);
    };

    it("carries the instance count all the way to the wire", async () => {
        // The console draws a step line under the plot from this field. Nothing
        // between the store and the browser is allowed to narrow it away: a
        // `{at, value}` type here compiles, serialises fine by accident, and
        // silently removes the only thing that distinguishes "the app got
        // busier" from "the app scaled out".
        const res = await call(async () => [{ at: "2026-08-26T09:00:00.000Z", value: 600, instances: 2 }]);
        expect(res.status).toBe(200);
        expect((await res.json()).points).toEqual([
            { at: "2026-08-26T09:00:00.000Z", value: 600, instances: 2 }
        ]);
    });

    it("answers 501, not an empty chart, when nothing is recorded", async () => {
        // An empty `points: []` is indistinguishable from a quiet hour, and
        // that ambiguity is the entire reason this endpoint names its absence.
        const res = await call(undefined);
        expect(res.status).toBe(501);
        expect((await res.json()).error).toBe("history_unavailable");
    });

    it("names an unknown series rather than drawing nothing", async () => {
        const res = await call(async () => [], "/history?series=cpu_milicores");
        expect(res.status).toBe(400);
        expect((await res.json()).error).toBe("unknown_series");
    });

    it("clamps the window instead of scanning the whole table", async () => {
        let asked = -1;
        await call(async (_s: string, minutes: number) => { asked = minutes; return []; },
            "/history?series=cpu_millicores&minutes=999999");
        expect(asked).toBe(20_160);
    });
});
