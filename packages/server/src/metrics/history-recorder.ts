/**
 * Wiring the history store to a driver and a timer.
 *
 * Split from `history-store.ts` so the store stays pure — every rule in it is
 * testable with a fake executor, and nothing there knows what a DataDriver is.
 * This half is the part that cannot be unit-tested meaningfully: it opens a
 * connection and starts an interval.
 */
import { monitorEventLoopDelay } from "node:perf_hooks";
import { logger } from "../utils/logger.js";
import type { DataDriver } from "@rebasepro/types";
import {
    ensureMetricsHistory,
    recordSamples,
    readSeries,
    sampleSelf,
    SAMPLE_INTERVAL_MS,
    type Exec,
    type MetricSeries,
    type SeriesPoint
} from "./history-store.js";

export interface MetricsHistory {
    /** Create the table and sweep what has aged out. */
    ensure(): Promise<void>;
    /** Begin sampling this process. Returns a stop. */
    start(): () => void;
    /** Read one series, for the route and for anything else that asks. */
    read(series: MetricSeries, sinceMinutes: number): Promise<SeriesPoint[]>;
}

/** Narrow structural check, matching how the job store decides the same thing. */
function sqlExecutorOf(driver: DataDriver): Exec | undefined {
    const admin = (driver as { admin?: { executeSql?: unknown } }).admin;
    if (!admin || typeof admin.executeSql !== "function") return undefined;
    const executeSql = admin.executeSql as (sql: string, opts?: { params?: unknown[] }) => Promise<unknown>;
    return (sql, params) => executeSql(sql, params ? { params } : undefined);
}

/**
 * History for this deployment, or `undefined` when it cannot have any.
 *
 * Undefined rather than a no-op: the route turns it into a named 501, because a
 * chart that renders empty is indistinguishable from a quiet period and this is
 * exactly the class of silence the panel it feeds exists to remove.
 */
export function createMetricsHistory(driver: DataDriver): MetricsHistory | undefined {
    const exec = sqlExecutorOf(driver);
    if (!exec) {
        logger.debug("[metrics] driver has no SQL admin — no metrics history will be kept.");
        return undefined;
    }

    return {
        ensure: () => ensureMetricsHistory(exec),
        read: (series, sinceMinutes) => readSeries(exec, series, sinceMinutes),
        start(): () => void {
            // Which process this is. A tenant's replicas share one database and
            // each records its own numbers, so a row needs to say whose they
            // are — without it they overwrite each other and a scaled-out app
            // charts one arbitrary pod.
            //
            // HOSTNAME is the pod name on Kubernetes and the container id under
            // Docker; the pid fallback keeps two local processes distinct.
            const instance = process.env.HOSTNAME?.trim() || `pid-${process.pid}`;
            let cursor: { cpu: NodeJS.CpuUsage; at: number } | null = null;
            let stopped = false;

            // Event-loop delay: how long a callback waited past its schedule.
            // The one number here that says whether this process is *healthy*
            // rather than how much it is consuming — a pod can sit at 20% CPU
            // and still be unable to answer, and nothing else recorded would
            // show it.
            //
            // `monitorEventLoopDelay` samples in libuv at a fixed resolution and
            // costs effectively nothing; `.enable()` is required, and the
            // histogram is reset each tick so every sample describes its own
            // minute rather than the process's whole life.
            interface LoopHistogram { mean: number; enable(): void; reset(): void }
            let loop: LoopHistogram | null = null;
            try {
                loop = monitorEventLoopDelay({ resolution: 20 }) as unknown as LoopHistogram;
                loop.enable();
            } catch {
                // A runtime without it still records the other two.
                loop = null;
            }

            const tick = async () => {
                if (stopped) return;
                // Nanoseconds from the histogram, milliseconds on the wire.
                const delayMs = loop ? loop.mean / 1e6 : undefined;
                loop?.reset();
                const { samples, cursor: next } = sampleSelf(cursor, Date.now(), delayMs);
                cursor = next;
                try {
                    await recordSamples(exec, samples, instance);
                } catch (err) {
                    // Never fatal, and never noisy: a sampler that crash-loops a
                    // pod over a chart would be a far worse trade than a gap in
                    // one. The gap is visible in the data; a restart loop is not.
                    logger.debug("[metrics] could not record a sample", { err });
                }
            };

            // The first tick establishes the CPU cursor and publishes memory;
            // the rate needs a second reading, which is why nothing claims a CPU
            // figure until one interval has passed.
            void tick();
            const timer = setInterval(() => void tick(), SAMPLE_INTERVAL_MS);
            // Not the reason this process should stay alive.
            timer.unref?.();

            return () => { stopped = true; clearInterval(timer); };
        }
    };
}
