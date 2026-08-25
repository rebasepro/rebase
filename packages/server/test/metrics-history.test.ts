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
        await recordSamples(exec, [{ series: "memory_bytes", value: 123 }], new Date("2026-08-25T21:34:47.812Z"));
        expect(calls[0].sql).toContain("ON CONFLICT (series, at) DO UPDATE");
        expect((calls[0].params[0] as Date).toISOString()).toBe("2026-08-25T21:34:00.000Z");
    });

    it("drops a non-finite value rather than storing it", async () => {
        const { exec, calls } = fakeExec();
        await recordSamples(exec, [
            { series: "cpu_millicores", value: Infinity },
            { series: "memory_bytes", value: NaN },
            { series: "memory_bytes", value: 42 }
        ]);
        expect(calls).toHaveLength(1);
        expect(calls[0].params[2]).toBe(42);
    });

    it("writes nothing at all for an empty tick", async () => {
        const { exec, calls } = fakeExec();
        await recordSamples(exec, []);
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
            { at: "2026-08-25T21:00:00.000Z", value: 1 },
            { at: "2026-08-25T21:01:00.000Z", value: 2 }
        ]);
    });

    it("reads a driver that wraps its rows and one that does not", async () => {
        // Postgres clients disagree about whether a query returns the rows or
        // an object containing them, and this store is called from both the
        // bootstrapper's executor and a raw one.
        const wrapped = fakeExec({ rows: [{ at: "2026-08-25T21:00:00Z", value: 7 }] } as never);
        expect(await readSeries(wrapped.exec, "memory_bytes", 5)).toEqual([
            { at: "2026-08-25T21:00:00Z", value: 7 }
        ]);
    });
});
