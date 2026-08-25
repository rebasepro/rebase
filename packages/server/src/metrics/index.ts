import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { METRIC_SERIES, type MetricSeries } from "./history-store.js";
import type { HonoEnv } from "../api/types";
import { safeCompare } from "../auth/crypto-utils";
import { extractBearerToken } from "../auth/bearer-token";

/**
 * Runtime metrics, in Prometheus text format.
 *
 * The point of emitting these from the runtime rather than scraping the
 * container is that only the runtime knows what a request *was*. A pod-level CPU
 * graph cannot tell you that auth is slow while data is fine, or that one app is
 * generating all the traffic. Surface by surface is the difference between a
 * chart that looks like observability and one you can act on.
 *
 * Self-hosters get the same endpoint — this is a plain Prometheus target, not a
 * hook into a hosted platform.
 */

/** Which part of the API served a request. */
export type MetricSurface = "data" | "auth" | "storage" | "functions" | "admin" | "meta" | "other";

const LATENCY_BUCKETS_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

/**
 * Separators for the composite map keys used internally.
 *
 * ASCII unit/record separators, which cannot appear in a Prometheus metric name
 * and are vanishingly unlikely in a label value. They are written as escape
 * sequences rather than literal control characters so the source stays greppable
 * and diffable.
 */
const LABEL_SEP = "\u001f";
const NAME_SEP = "\u001e";

interface HistogramState {
    counts: number[];
    sum: number;
    total: number;
}

/**
 * In-process metric store.
 *
 * Counters reset when the process does, which is exactly what Prometheus
 * expects — it handles resets natively, and a restart is a real event a
 * dashboard should be able to see.
 */
/**
 * Ceiling on distinct label combinations per metric family.
 *
 * Label values that vary without bound are the classic way to take down a
 * Prometheus — and, before that, the process emitting them, since every distinct
 * combination allocates a permanent series. The label set here is derived partly
 * from request paths, so it is reachable by anyone who can send a request.
 * Beyond the cap, series collapse into a single `(other)` bucket: the totals stay
 * correct and memory stops growing.
 */
const MAX_SERIES = 512;

export class MetricsRegistry {
    private requests = new Map<string, number>();
    private latency = new Map<string, HistogramState>();
    private gauges = new Map<string, number>();
    private counters = new Map<string, number>();
    readonly startedAt = Date.now();

    private static labelKey(labels: Record<string, string>): string {
        return Object.entries(labels)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([k, v]) => `${k}=${v}`)
            .join(LABEL_SEP);
    }

    private static parseLabels(key: string): Record<string, string> {
        if (!key) return {};
        return Object.fromEntries(
            key.split(LABEL_SEP).filter(Boolean).map(pair => {
                const index = pair.indexOf("=");
                return [pair.slice(0, index), pair.slice(index + 1)];
            })
        );
    }

    /**
     * Key a named series.
     *
     * Concatenating a name and its labels without a separator would let metric
     * `rebase_x` with label `y=1` collide with a metric literally named
     * `rebase_xy=1`.
     */
    private static namedKey(name: string, labels: Record<string, string>): string {
        return `${name}${NAME_SEP}${MetricsRegistry.labelKey(labels)}`;
    }

    private static splitNamedKey(key: string): [string, string] {
        const index = key.indexOf(NAME_SEP);
        if (index === -1) return [key, ""];
        return [key.slice(0, index), key.slice(index + NAME_SEP.length)];
    }

    recordRequest(labels: Record<string, string>, durationMs: number): void {
        let key = MetricsRegistry.labelKey(labels);

        if (!this.requests.has(key) && this.requests.size >= MAX_SERIES) {
            // Only the collection label can grow without bound, so only it is
            // collapsed — rewriting a request that never had one would invent a
            // `collection="(other)"` on, say, an auth request and make the
            // output misleading rather than merely coarser.
            const { collection: _dropped, ...rest } = labels;
            key = MetricsRegistry.labelKey(
                "collection" in labels ? { ...rest,
                    collection: "(other)" } : rest
            );
        }

        this.requests.set(key, (this.requests.get(key) ?? 0) + 1);

        let hist = this.latency.get(key);
        if (!hist) {
            hist = { counts: new Array(LATENCY_BUCKETS_MS.length + 1).fill(0),
sum: 0,
total: 0 };
            this.latency.set(key, hist);
        }
        hist.sum += durationMs;
        hist.total += 1;
        let bucket = LATENCY_BUCKETS_MS.findIndex(upper => durationMs <= upper);
        if (bucket === -1) bucket = LATENCY_BUCKETS_MS.length;
        hist.counts[bucket] += 1;
    }

    incrementCounter(name: string, labels: Record<string, string> = {}, by = 1): void {
        const key = MetricsRegistry.namedKey(name, labels);
        // Capped for the same reason request series are: whatever calls this
        // next may well pass something request-derived.
        if (!this.counters.has(key) && this.counters.size >= MAX_SERIES) return;
        this.counters.set(key, (this.counters.get(key) ?? 0) + by);
    }

    setGauge(name: string, value: number, labels: Record<string, string> = {}): void {
        const key = MetricsRegistry.namedKey(name, labels);
        if (!this.gauges.has(key) && this.gauges.size >= MAX_SERIES) return;
        this.gauges.set(key, value);
    }

    /** Prometheus escaping: backslash, quote and newline, in that order. */
    private static formatLabels(labels: Record<string, string>, extra?: Record<string, string>): string {
        const all = { ...labels,
...extra };
        const entries = Object.entries(all).filter(([, v]) => v !== undefined && v !== "");
        if (entries.length === 0) return "";
        const body = entries
            .map(([k, v]) => `${k}="${String(v).replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/\n/g, "\\n")}"`)
            .join(",");
        return `{${body}}`;
    }

    /** Group `name -> [[labelKey, value]]` for one-HELP-per-metric rendering. */
    private static group(source: Map<string, number>): Map<string, [string, number][]> {
        const grouped = new Map<string, [string, number][]>();
        for (const [key, value] of source) {
            const [name, labelKey] = MetricsRegistry.splitNamedKey(key);
            const list = grouped.get(name) ?? [];
            list.push([labelKey, value]);
            grouped.set(name, list);
        }
        return grouped;
    }

    render(): string {
        const lines: string[] = [];

        lines.push("# HELP rebase_uptime_seconds Seconds since this runtime started.");
        lines.push("# TYPE rebase_uptime_seconds gauge");
        lines.push(`rebase_uptime_seconds ${((Date.now() - this.startedAt) / 1000).toFixed(0)}`);

        lines.push("# HELP rebase_requests_total Requests handled, by surface, method and status.");
        lines.push("# TYPE rebase_requests_total counter");
        for (const [key, value] of this.requests) {
            lines.push(`rebase_requests_total${MetricsRegistry.formatLabels(MetricsRegistry.parseLabels(key))} ${value}`);
        }

        lines.push("# HELP rebase_request_duration_ms Request latency in milliseconds.");
        lines.push("# TYPE rebase_request_duration_ms histogram");
        for (const [key, hist] of this.latency) {
            const labels = MetricsRegistry.parseLabels(key);
            let cumulative = 0;
            for (let i = 0; i < LATENCY_BUCKETS_MS.length; i++) {
                cumulative += hist.counts[i];
                lines.push(
                    `rebase_request_duration_ms_bucket${MetricsRegistry.formatLabels(labels, { le: String(LATENCY_BUCKETS_MS[i]) })} ${cumulative}`
                );
            }
            cumulative += hist.counts[LATENCY_BUCKETS_MS.length];
            lines.push(`rebase_request_duration_ms_bucket${MetricsRegistry.formatLabels(labels, { le: "+Inf" })} ${cumulative}`);
            lines.push(`rebase_request_duration_ms_sum${MetricsRegistry.formatLabels(labels)} ${hist.sum.toFixed(3)}`);
            lines.push(`rebase_request_duration_ms_count${MetricsRegistry.formatLabels(labels)} ${hist.total}`);
        }

        for (const [name, entries] of MetricsRegistry.group(this.counters)) {
            lines.push(`# TYPE ${name} counter`);
            for (const [labelKey, value] of entries) {
                lines.push(`${name}${MetricsRegistry.formatLabels(MetricsRegistry.parseLabels(labelKey))} ${value}`);
            }
        }

        for (const [name, entries] of MetricsRegistry.group(this.gauges)) {
            lines.push(`# TYPE ${name} gauge`);
            for (const [labelKey, value] of entries) {
                lines.push(`${name}${MetricsRegistry.formatLabels(MetricsRegistry.parseLabels(labelKey))} ${value}`);
            }
        }

        const memory = process.memoryUsage();
        lines.push("# TYPE rebase_process_heap_bytes gauge");
        lines.push(`rebase_process_heap_bytes ${memory.heapUsed}`);
        lines.push("# TYPE rebase_process_rss_bytes gauge");
        lines.push(`rebase_process_rss_bytes ${memory.rss}`);

        return lines.join("\n") + "\n";
    }
}

/**
 * Classify a path into the surface that served it.
 *
 * Path *shape*, never the full path: a label per entity id would create an
 * unbounded set of time series, which is the classic way to take down a
 * Prometheus. Collection slugs are bounded by the schema, so those are safe and
 * genuinely useful.
 */
export function classifySurface(pathname: string, basePath = "/api"): {
    surface: MetricSurface;
    collection?: string;
} {
    const prefix = basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;
    if (!pathname.startsWith(prefix)) {
        return { surface: "other" };
    }

    const rest = pathname.slice(prefix.length).replace(/^\/+/, "");
    const [head, second] = rest.split("/");

    switch (head) {
        case "data":
            return { surface: "data",
collection: second || undefined };
        case "auth":
            return { surface: "auth" };
        case "storage":
            return { surface: "storage" };
        case "functions":
            return { surface: "functions",
collection: second || undefined };
        case "admin":
            return { surface: "admin" };
        case "meta":
            return { surface: "meta" };
        default:
            return { surface: "other" };
    }
}

export interface MetricsHandle {
    registry: MetricsRegistry;
    middleware: MiddlewareHandler<HonoEnv>;
    /**
     * Restrict the `collection` label to names that actually exist.
     *
     * Called once the collections are known — the middleware has to be installed
     * before them, since it must wrap every request. Until it is called, and for
     * any name not in the set, the label is dropped: a path segment is attacker-
     * controlled, and one series per value invented is unbounded memory.
     */
    setKnownCollections(slugs: Iterable<string>): void;
}

/**
 * Build the request-timing middleware and the registry it feeds.
 *
 * Timing wraps `next()` in a `finally`, so a request that throws is still
 * counted — an endpoint that only ever fails would otherwise be invisible in
 * exactly the situation the metrics exist for.
 */
export function createMetricsMiddleware(basePath = "/api"): MetricsHandle {
    const registry = new MetricsRegistry();
    let known: Set<string> | undefined;

    const middleware: MiddlewareHandler<HonoEnv> = async (c, next) => {
        const started = performance.now();
        const { surface, collection } = classifySurface(new URL(c.req.url).pathname, basePath);

        try {
            await next();
        } finally {
            const duration = performance.now() - started;
            const labels: Record<string, string> = {
                surface,
                method: c.req.method,
                status: String(c.res?.status ?? 0)
            };
            // Only a name the schema knows about becomes a label. A request for
            // `/api/data/<random>` is a 404, and recording it by name would let
            // anyone mint unlimited time series just by sending requests.
            if (collection && known?.has(collection)) labels.collection = collection;
            registry.recordRequest(labels, duration);
        }
    };

    return {
        registry,
        middleware,
        setKnownCollections(slugs: Iterable<string>) {
            known = new Set(slugs);
        }
    };
}

/**
 * Mount the scrape endpoint.
 *
 * When a token is configured it is required, and compared in constant time — a
 * timing oracle on a metrics token is a small thing, but it is free to avoid.
 */
export function createMetricsRoutes(
    registry: MetricsRegistry,
    token?: string,
    /**
     * Reads a stored series. Absent when the deployment keeps no history — a
     * driver with no SQL admin, or a role that does not provision — and the
     * route then answers 501 rather than pretending an empty chart is a quiet
     * period.
     */
    history?: (series: MetricSeries, sinceMinutes: number) => Promise<{ at: string; value: number }[]>
): Hono<HonoEnv> {
    const router = new Hono<HonoEnv>();

    const authorized = (c: { req: { header(name: string): string | undefined } }): boolean => {
        if (!token) return true;
        const provided = extractBearerToken(c.req.header("authorization")) ?? "";
        return Boolean(provided) && safeCompare(provided, token);
    };

    router.get("/", (c) => {
        if (!authorized(c)) return c.text("Unauthorized", 401);
        return c.text(registry.render(), 200, {
            "Content-Type": "text/plain; version=0.0.4; charset=utf-8"
        });
    });

    /**
     * The same numbers, over time.
     *
     * Deliberately part of the runtime rather than of any console: a
     * self-hosted deployment gets the same history from the same URL, and
     * nothing here depends on a cluster or a cloud monitoring product.
     */
    router.get("/history", async (c) => {
        if (!authorized(c)) return c.text("Unauthorized", 401);
        if (!history) {
            return c.json({
                error: "history_unavailable",
                message: "This deployment stores no metrics history. It needs a SQL driver and a role that provisions schema."
            }, 501);
        }

        const series = c.req.query("series") as MetricSeries | undefined;
        if (!series || !METRIC_SERIES.includes(series)) {
            return c.json({
                error: "unknown_series",
                message: `Unknown series. Available: ${METRIC_SERIES.join(", ")}.`
            }, 400);
        }

        // Bounded rather than defaulted-and-forgotten: an unbounded window on a
        // per-minute table is a full scan, and nothing draws a year.
        const raw = Number(c.req.query("minutes") ?? 60);
        const minutes = Number.isFinite(raw) ? Math.min(Math.max(Math.round(raw), 1), 20_160) : 60;

        return c.json({ series, minutes, points: await history(series, minutes) });
    });

    return router;
}
