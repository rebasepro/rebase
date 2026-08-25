/**
 * A little history for the metrics this process already keeps.
 *
 * ## Why this is in the framework and not in the cloud console
 *
 * The console wants to draw "CPU over the last hour". The obvious way to get it
 * on GKE is Cloud Monitoring, which already collects exactly this — and which
 * would make the panel unportable the day the platform moves, for a feature
 * every self-hoster also wants. So the history lives where the runtime lives:
 * the process samples ITSELF, into its OWN database, and anything that can read
 * the database can draw the chart. No cluster, no metrics-server, no vendor.
 *
 * That is the same rule the binder follows — the cloud is a better
 * implementation behind the same interface, never a different one.
 *
 * ## Why it stays cheap
 *
 * One row per series per instance per minute. Three series across two replicas
 * is 8,640 rows a day, and the sweep below bounds the window, so the table settles
 * at a size measured in megabytes. It is deliberately NOT a general time-series
 * store: no labels, no cardinality to explode, no per-request rows.
 *
 * A minute is the resolution because that is what the question needs — "was it
 * slow at 15:40", "did my deploy cause that" — and because a finer grain buys
 * nothing a reader can see on a chart of an hour.
 */
/**
 * The positional-parameter shape every store in this package settles on.
 *
 * The bootstrapper's own `SqlExec` takes an options object; each store wraps it
 * once and reads better for it. Same two shapes, same reason, as `job-store`.
 */
export type Exec = (sql: string, params?: unknown[]) => Promise<unknown>;

/** Where the samples live. Framework-owned, like `rebase.jobs`. */
export const METRICS_HISTORY_TABLE = "rebase.metric_samples";

/**
 * How long a sample is kept.
 *
 * Two weeks answers "is this worse than last week" and stops well short of
 * being an archive. Anything that needs to outlive it — billing, capacity
 * planning — is a rollup somebody else owns, not a longer retention here.
 *
 * Read it as "14 days, or since this process started, whichever is longer": the
 * sweep runs at boot and nowhere else, so a pod up for 90 days holds 90 days.
 * That is a deliberate trade rather than an oversight — a cron for it would be
 * machinery for a table that stays trivial either way, and reads are bounded by
 * the index regardless — but the table does not "reach a steady size and stay
 * there" on a long-lived pod, which an earlier version of this comment claimed.
 */
export const RETENTION_DAYS = 14;

/** How often the process samples itself. Matched to the resolution it stores. */
export const SAMPLE_INTERVAL_MS = 60_000;

/**
 * The series this records. A closed set on purpose — see the cardinality note.
 *
 * A list rather than only a union, because the route validates against it: an
 * unknown `?series=` must be a named 400 rather than an empty chart, which
 * reads exactly like a quiet period.
 *
 * **It lists what `sampleSelf` actually writes, and nothing else.** It used to
 * also name `requests_total`, `errors_total` and `event_loop_delay_ms`, none of
 * which anything ever recorded — so those three were *valid* parameters that
 * returned `points: []`, which is precisely the empty chart the 400 two
 * paragraphs up exists to prevent. A declared-but-unwritten series is worse
 * than an absent one: the 400 tells you the name is wrong, and the empty array
 * tells you the app was quiet.
 *
 * `event_loop_delay_ms` kept its place by gaining a sampler, because it is the
 * one signal here that says whether the process is *healthy* rather than how
 * much it is using, and it has no counter semantics to get wrong.
 *
 * `requests_total` and `errors_total` were dropped rather than wired up. The
 * registry does hold them, but they reset on restart, and a resetting counter
 * summed across replicas is not monotonic — a rolling deploy would draw a
 * cliff that looks like traffic collapsing. That needs a deliberate decision
 * about deltas and resets, not a line added at 2am. Adding either back means
 * adding its sampler in the same commit.
 */
export const METRIC_SERIES = [
    "cpu_millicores",
    "memory_bytes",
    "event_loop_delay_ms"
] as const;

export type MetricSeries = (typeof METRIC_SERIES)[number];

export interface MetricSample {
    at: Date;
    series: MetricSeries;
    value: number;
}

/**
 * Create the table and sweep what has aged out.
 *
 * Called at boot, beside the job and cron stores, and for the same reason they
 * do it there: the only moment the schema is guaranteed to be reachable and
 * nobody is mid-request.
 */
export async function ensureMetricsHistory(exec: Exec): Promise<void> {
    await exec(`
        CREATE TABLE IF NOT EXISTS ${METRICS_HISTORY_TABLE} (
            at        timestamptz      NOT NULL,
            series    text             NOT NULL,
            instance  text             NOT NULL,
            value     double precision NOT NULL,
            PRIMARY KEY (series, instance, at)
        )
    `, []);

    // (series, at DESC) rather than the primary key's order: every read is
    // "this series across all instances, bounded by time", and the PK leads with
    // instance, which is the wrong first column for that scan.
    await exec(`
        CREATE INDEX IF NOT EXISTS metric_samples_series_recent
            ON ${METRICS_HISTORY_TABLE} (series, at DESC)
    `, []);

    // Swept here rather than by a cron, so a deployment that runs no scheduler
    // still stays bounded. A DELETE is the right tool at this size — a few
    // thousand rows a day — and partitioning would be machinery for a table
    // that never gets big.
    await exec(
        `DELETE FROM ${METRICS_HISTORY_TABLE} WHERE at < now() - make_interval(days => $1)`,
        [RETENTION_DAYS]
    );
}

/**
 * What this process is using right now.
 *
 * `process.cpuUsage()` is cumulative, so a rate needs two readings and the gap
 * between them — which is why the previous one is threaded through rather than
 * held in a module global: a module global is shared by every test in a file
 * and makes the first assertion depend on whatever ran before it.
 */
export function sampleSelf(
    previous: { cpu: NodeJS.CpuUsage; at: number } | null,
    now = Date.now(),
    /**
     * Mean event-loop delay over the last window, in milliseconds, or undefined
     * where it cannot be measured. Passed in rather than read here so this
     * function stays pure: the histogram is a stateful handle the recorder owns.
     */
    eventLoopDelayMs?: number
): { samples: Omit<MetricSample, "at">[]; cursor: { cpu: NodeJS.CpuUsage; at: number } } {
    const cpu = process.cpuUsage();
    const memory = process.memoryUsage();
    const samples: Omit<MetricSample, "at">[] = [
        { series: "memory_bytes", value: memory.rss }
    ];

    // Only when it was actually measured. Zero is a real and common reading for
    // an idle process, so a `?? 0` here would be indistinguishable from a
    // healthy one — the same substitution this module rejects everywhere else.
    if (typeof eventLoopDelayMs === "number" && Number.isFinite(eventLoopDelayMs)) {
        samples.push({ series: "event_loop_delay_ms", value: eventLoopDelayMs });
    }

    if (previous) {
        const elapsedMs = now - previous.at;
        if (elapsedMs > 0) {
            // Microseconds of CPU over milliseconds of wall clock, as
            // millicores: 1000m is one core saturated for the whole window.
            const usedMicros = (cpu.user - previous.cpu.user) + (cpu.system - previous.cpu.system);
            samples.push({ series: "cpu_millicores", value: (usedMicros / 1000 / elapsedMs) * 1000 });
        }
    }

    return { samples, cursor: { cpu, at: now } };
}

/**
 * Write one tick's samples, for one instance.
 *
 * ## Why `instance` is part of the key
 *
 * A tenant's replicas share one database, and each records its OWN process. Key
 * a row by `(series, minute)` alone and the pods overwrite each other every
 * tick: one pod at 5m and another at 500m leave whichever wrote last, so a
 * scaled-out tenant charts one arbitrary replica and calls it the app. Adding
 * the instance makes each pod its own row, and lets the read decide whether the
 * question is "the whole deployment" or "which pod is hot".
 *
 * Cardinality stays bounded: rows are series × replicas × minutes, and replicas
 * are capped by the autoscaling ceiling. Six pods is ~43k rows a day and a
 * fortnight of them is well under a million.
 */
export async function recordSamples(
    exec: Exec,
    samples: Omit<MetricSample, "at">[],
    instance: string,
    at: Date = new Date()
): Promise<void> {
    if (samples.length === 0) return;
    // Truncated to the minute, so a pod restarting mid-minute overwrites its own
    // earlier row rather than adding a second one for the same instant.
    const bucket = new Date(Math.floor(at.getTime() / 60_000) * 60_000);
    for (const s of samples) {
        if (!Number.isFinite(s.value)) continue;
        await exec(
            `INSERT INTO ${METRICS_HISTORY_TABLE} (at, series, instance, value)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (series, instance, at) DO UPDATE SET value = EXCLUDED.value`,
            [bucket, s.series, instance, s.value]
        );
    }
}

/**
 * How a series combines across the replicas that reported it.
 *
 * Not one answer for everything, because the right one differs by what the
 * number means. CPU and memory are consumption: the deployment's figure is the
 * sum, and a mean would make scaling out look like it reduced usage. A queue
 * depth or an event-loop delay is a condition each process is independently in,
 * and summing those produces a number no single pod ever experienced.
 */
const COMBINE: Record<MetricSeries, "sum" | "avg"> = {
    cpu_millicores: "sum",
    memory_bytes: "sum",
    event_loop_delay_ms: "avg"
};

export interface SeriesPoint {
    at: string;
    /** The deployment's figure, combined per `COMBINE`. */
    value: number;
    /** How many instances reported in this bucket. */
    instances: number;
}

/**
 * Read one series over a window, oldest first — the order a chart draws in.
 *
 * Combined across instances rather than returned per-pod. A chart of "this
 * app's CPU" is the question people ask; "which pod is hot" is answered by the
 * live panel, which already lists instances individually and does not need
 * history to do it.
 *
 * `instances` rides along because a sum whose contributor count changed is not
 * comparable with itself: CPU doubling because the app got busy and CPU
 * doubling because it scaled from one replica to two are different events, and
 * a line chart alone cannot tell them apart.
 */
export async function readSeries(
    exec: Exec,
    series: MetricSeries,
    sinceMinutes: number
): Promise<SeriesPoint[]> {
    const combine = COMBINE[series] === "avg" ? "avg" : "sum";
    // The current minute is EXCLUDED, and that is not tidiness.
    //
    // Each replica samples on its own phase — `setInterval` from whenever that
    // pod booted — so at 10:45:20 the bucket for 10:45 holds rows from whichever
    // pods have ticked so far, typically one of three. The chart takes the last
    // point as its headline figure, so a three-replica app displayed one
    // replica's CPU as the deployment's, the line ended in a cliff, and the
    // instance step dropped underneath it — which the chart's own caption
    // explains to the reader as a scale-down that never happened.
    //
    // Every live pod has written bucket M-1 before the clock enters M, so the
    // newest bucket returned is complete and its `instances` is the true
    // contributor count. `date_trunc` rather than arithmetic because it matches
    // the recorder's `floor(t / 60_000) * 60_000` exactly, and is
    // timezone-independent on a timestamptz.
    const rows = await exec(
        `SELECT at, ${combine}(value) AS value, count(*) AS instances
           FROM ${METRICS_HISTORY_TABLE}
          WHERE series = $1
            AND at >= now() - make_interval(mins => $2)
            AND at < date_trunc('minute', now())
          GROUP BY at
          ORDER BY at ASC`,
        [series, sinceMinutes]
    ) as unknown as { rows?: RawPoint[] } | RawPoint[];

    const list = Array.isArray(rows) ? rows : (rows?.rows ?? []);
    return list.map(r => ({
        at: r.at instanceof Date ? r.at.toISOString() : String(r.at),
        value: Number(r.value),
        instances: Number(r.instances ?? 1)
    }));
}

interface RawPoint { at: Date | string; value: number; instances?: number | string }
