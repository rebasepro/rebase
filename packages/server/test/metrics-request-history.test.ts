/**
 * Request and error history: per-minute deltas per surface, the read that
 * zero-fills them against liveness, and the batched, bucketed route.
 *
 * The SQL here is asserted by shape against a fake executor, like the rest of
 * the history store's tests; its arithmetic (gaps, zero-fill, replica sums,
 * bucketing) was also run against a real Postgres while it was written.
 */
import {
    METRIC_SERIES,
    REQUEST_DELTA_SERIES,
    RECORDED_SURFACES,
    combineOf,
    readSeries,
    readSeriesBatch,
    recordRequestDeltas,
    requestDeltas,
    type HistoryBucket,
    type MetricSeries,
    type SeriesPoint
} from "../src/metrics/history-store";
import { MetricsRegistry, createMetricsRoutes, isErrorStatus } from "../src/metrics/index";

function fakeExec(rows: unknown = [], failOn?: (params: unknown[]) => boolean) {
    const calls: { sql: string; params: unknown[] }[] = [];
    const exec = async (sql: string, params: unknown[] = []) => {
        if (failOn?.(params)) throw new Error("write failed");
        calls.push({ sql, params });
        return rows;
    };
    return { exec, calls };
}

describe("request history — the series", () => {
    it("adds ten delta series, all summed across replicas", () => {
        expect([...REQUEST_DELTA_SERIES].sort()).toEqual([
            "errors_app", "errors_auth", "errors_data", "errors_functions", "errors_storage",
            "requests_app", "requests_auth", "requests_data", "requests_functions", "requests_storage"
        ]);
        for (const series of REQUEST_DELTA_SERIES) {
            expect(METRIC_SERIES).toContain(series);
            expect(combineOf(series)).toBe("sum");
        }
    });

    it("does not record the console's and tooling's own surfaces", () => {
        // admin, meta and other are somebody reading the backend, and on a
        // quiet project they are most of the traffic.
        expect(RECORDED_SURFACES).toEqual(["data", "auth", "storage", "functions", "app"]);
        for (const s of ["admin", "meta", "other"]) {
            expect(METRIC_SERIES.some(name => name.endsWith(`_${s}`))).toBe(false);
        }
    });
});

describe("request history — what counts as an error", () => {
    // The control plane's rollup (`saas/backend/src/managed/metrics-rollup.ts`)
    // counts an error as a `status` label starting with "5". Its own test pins
    // the rollup to this same table; change one side and that side's test
    // fails.
    const TABLE: [string | undefined, boolean][] = [
        ["200", false], ["201", false], ["204", false], ["301", false], ["304", false],
        ["400", false], ["401", false], ["403", false], ["404", false], ["429", false],
        ["500", true], ["502", true], ["503", true], ["504", true],
        ["0", false], ["", false], [undefined, false]
    ];

    it.each(TABLE)("status %p is an error: %p", (status, expected) => {
        expect(isErrorStatus(status)).toBe(expected);
    });

    it("is the predicate the registry's per-surface totals use", () => {
        const registry = new MetricsRegistry();
        for (const [status] of TABLE) {
            registry.recordRequest({ surface: "data", method: "GET", status: status ?? "" }, 1);
        }
        const totals = registry.requestTotalsBySurface();
        expect(totals.data).toEqual({ requests: TABLE.length, errors: TABLE.filter(([, e]) => e).length });
    });

    it("sums per recorded surface and leaves the others out", () => {
        const registry = new MetricsRegistry();
        registry.recordRequest({ surface: "data", method: "GET", status: "200", collection: "posts" }, 1);
        registry.recordRequest({ surface: "data", method: "POST", status: "500", collection: "posts" }, 1);
        registry.recordRequest({ surface: "data", method: "GET", status: "200", collection: "users" }, 1);
        registry.recordRequest({ surface: "admin", method: "GET", status: "200" }, 1);
        registry.recordRequest({ surface: "meta", method: "GET", status: "500" }, 1);
        registry.recordRequest({ surface: "app", method: "GET", status: "200" }, 1);
        expect(registry.requestTotalsBySurface()).toEqual({
            data: { requests: 3, errors: 1 },
            app: { requests: 1, errors: 0 }
        });
    });
});

describe("request history — deltas", () => {
    it("writes the difference between two ticks", () => {
        const first = requestDeltas({ data: { requests: 10, errors: 2 } }, {});
        expect(first).toEqual([
            { series: "requests_data", value: 10, cumulative: 10 },
            { series: "errors_data", value: 2, cumulative: 2 }
        ]);
        const second = requestDeltas({ data: { requests: 15, errors: 2 } }, { requests_data: 10, errors_data: 2 });
        expect(second).toEqual([{ series: "requests_data", value: 5, cumulative: 15 }]);
    });

    it("takes a counter lower than its cursor as a restart: the new count, never a negative", () => {
        const deltas = requestDeltas({ auth: { requests: 3, errors: 0 } }, { requests_auth: 500 });
        expect(deltas).toEqual([{ series: "requests_auth", value: 3, cumulative: 3 }]);
    });

    it("writes no row for a zero delta", async () => {
        const { exec, calls } = fakeExec();
        await recordRequestDeltas(exec, { data: { requests: 4, errors: 0 } }, { requests_data: 4 }, "pod-a");
        await recordRequestDeltas(exec, {}, {}, "pod-a");
        expect(calls).toHaveLength(0);
    });

    it("buckets to the minute and ADDS on conflict, so two writes in one minute both count", async () => {
        const { exec, calls } = fakeExec();
        await recordRequestDeltas(exec, { storage: { requests: 2, errors: 0 } }, {}, "pod-a", new Date("2026-11-18T10:00:42.123Z"));
        expect(calls).toHaveLength(1);
        expect((calls[0].params[0] as Date).toISOString()).toBe("2026-11-18T10:00:00.000Z");
        expect(calls[0].params.slice(1)).toEqual(["requests_storage", "pod-a", 2]);
        expect(calls[0].sql).toMatch(/DO UPDATE SET value = rebase\.metric_samples\.value \+ EXCLUDED\.value/);
    });

    it("carries a failed write into the next delta, and only that series", async () => {
        const failing = fakeExec([], params => params[1] === "requests_data");
        const after = await recordRequestDeltas(failing.exec,
            { data: { requests: 10, errors: 1 } }, {}, "pod-a");
        // errors_data landed and advanced; requests_data did not.
        expect(after.failed).toHaveLength(1);
        expect(after.cursor).toEqual({ errors_data: 1 });

        const ok = fakeExec();
        const next = await recordRequestDeltas(ok.exec,
            { data: { requests: 16, errors: 1 } }, after.cursor, "pod-a");
        // Both minutes' requests in one row; the error is not counted twice.
        expect(ok.calls.map(c => [c.params[1], c.params[3]])).toEqual([["requests_data", 16]]);
        expect(next.cursor).toEqual({ requests_data: 16, errors_data: 1 });
    });
});

describe("request history — reading", () => {
    it("zero-fills only the minutes some instance was alive, using memory_bytes", async () => {
        const { exec, calls } = fakeExec();
        await readSeriesBatch(exec, ["requests_data"], 60, 1);
        const sql = calls[0].sql;
        // The liveness CTE reads memory_bytes; the delta series are cross-joined
        // with it and coalesced to zero, so a dead minute has no row at all.
        expect(sql).toMatch(/series = 'memory_bytes'/);
        expect(sql).toMatch(/CROSS JOIN live/);
        expect(sql).toMatch(/coalesce\(p\.total, 0\)/);
        expect(calls[0].params[3]).toEqual(["requests_data"]);
    });

    it("counts live instances on each point and sums replicas", async () => {
        const { exec } = fakeExec([
            { series: "requests_data", at: new Date("2026-11-18T10:00:00Z"), value: "10", instances: "2" },
            { series: "requests_data", at: new Date("2026-11-18T10:02:00Z"), value: "0", instances: "1" }
        ]);
        const out = await readSeriesBatch(exec, ["requests_data", "errors_data"], 60, 1);
        expect(out).toEqual({
            requests_data: [
                { at: "2026-11-18T10:00:00.000Z", value: 10, instances: 2 },
                { at: "2026-11-18T10:02:00.000Z", value: 0, instances: 1 }
            ],
            // Named and empty: recorded, and nothing in the window.
            errors_data: []
        });
    });

    it("excludes the current, incomplete bucket", async () => {
        const { exec, calls } = fakeExec();
        await readSeriesBatch(exec, ["requests_data"], 1440, 30);
        // The window ends at the start of the current bucket, aligned to the epoch.
        expect(calls[0].sql).toMatch(/to_timestamp\(floor\(extract\(epoch FROM now\(\)\) \/ \$3::int\) \* \$3::int\) AS hi/);
        expect(calls[0].sql).toMatch(/s\.at < win\.hi/);
        expect(calls[0].params[2]).toBe(30 * 60);
    });

    it("sums a delta series within a bucket and averages the others", async () => {
        const { exec, calls } = fakeExec();
        await readSeriesBatch(exec, ["requests_auth", "event_loop_delay_ms", "cpu_millicores"], 10080, 180);
        const sql = calls[0].sql;
        expect(sql).toMatch(/CASE WHEN bool_or\(is_delta\) THEN sum\(value\) ELSE avg\(value\) END/);
        // Per minute, an avg series takes the mean across replicas, a sum gauge
        // the total.
        expect(sql).toMatch(/CASE WHEN p\.series = ANY\(\$5::text\[\]\) THEN p\.mean ELSE p\.total END/);
        expect(calls[0].params[3]).toEqual(["requests_auth"]);
        expect(calls[0].params[4]).toEqual(["event_loop_delay_ms"]);
        expect(sql).toMatch(/max\(instances\)/);
    });

    it("routes a single delta series read through the zero-filling batch", async () => {
        const { exec, calls } = fakeExec();
        await readSeries(exec, "requests_functions", 60);
        expect(calls[0].sql).toMatch(/CROSS JOIN live/);
        expect(calls[0].params[2]).toBe(60);
    });
});

describe("request history — the batch route", () => {
    type Batch = (series: MetricSeries[], minutes: number, bucket: HistoryBucket) => Promise<Record<string, SeriesPoint[]>>;
    const call = async (path: string, batch?: Batch, token?: string, auth?: string) => {
        const router = createMetricsRoutes(new MetricsRegistry(), token, async () => [], batch);
        return router.request(`http://local${path}`, auth ? { headers: { authorization: auth } } : undefined);
    };
    const echo: Batch = async (series, minutes, bucket) =>
        Object.fromEntries(series.map(s => [s, [{ at: "2026-11-18T10:00:00.000Z", value: minutes + bucket, instances: 1 }]]));

    it("answers the shape the console reads", async () => {
        const res = await call("/history/batch?series=requests_data,errors_data&minutes=1440&bucket=30", echo);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({
            minutes: 1440,
            bucket: 30,
            series: {
                requests_data: [{ at: "2026-11-18T10:00:00.000Z", value: 1470, instances: 1 }],
                errors_data: [{ at: "2026-11-18T10:00:00.000Z", value: 1470, instances: 1 }]
            }
        });
    });

    it("defaults the bucket to one minute", async () => {
        let asked = -1;
        await call("/history/batch?series=requests_app&minutes=60", async (s, m, b) => { asked = b; return {}; });
        expect(asked).toBe(1);
    });

    it("names an unknown series with a 400", async () => {
        const res = await call("/history/batch?series=requests_data,requests_admin", echo);
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toBe("unknown_series");
        expect(body.message).toContain("requests_admin");
    });

    it("refuses no series and more than sixteen", async () => {
        expect((await call("/history/batch?minutes=60", echo)).status).toBe(400);
        const seventeen = Array.from({ length: 17 }, () => "requests_data").join(",");
        expect((await call(`/history/batch?series=${seventeen}`, echo)).status).toBe(400);
    });

    it.each(["0", "7", "60", "abc", "-5"])("refuses bucket=%s", async (bucket) => {
        const res = await call(`/history/batch?series=requests_data&bucket=${bucket}`, echo);
        expect(res.status).toBe(400);
        expect((await res.json()).error).toBe("invalid_bucket");
    });

    it.each(["0", "20161", "1.5", "x"])("refuses minutes=%s", async (minutes) => {
        const res = await call(`/history/batch?series=requests_data&minutes=${minutes}`, echo);
        expect(res.status).toBe(400);
        expect((await res.json()).error).toBe("invalid_minutes");
    });

    it("answers 501 when the deployment keeps no history", async () => {
        const res = await call("/history/batch?series=requests_data", undefined);
        expect(res.status).toBe(501);
        expect((await res.json()).error).toBe("history_unavailable");
    });

    it("takes the same token as /metrics/history", async () => {
        expect((await call("/history/batch?series=requests_data", echo, "s3cret")).status).toBe(401);
        expect((await call("/history/batch?series=requests_data", echo, "s3cret", "Bearer s3cret")).status).toBe(200);
    });

    it("leaves /metrics/history answering as before", async () => {
        const router = createMetricsRoutes(new MetricsRegistry(), undefined,
            async () => [{ at: "2026-11-18T10:00:00.000Z", value: 5, instances: 1 }], echo);
        const res = await router.request("http://local/history?series=cpu_millicores&minutes=60");
        expect(await res.json()).toEqual({
            series: "cpu_millicores",
            minutes: 60,
            points: [{ at: "2026-11-18T10:00:00.000Z", value: 5, instances: 1 }]
        });
    });
});
