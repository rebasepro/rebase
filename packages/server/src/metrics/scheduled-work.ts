/**
 * Work this app does on its own, with no request to start it.
 *
 * A platform that puts an idle project to sleep stops its timers with it: a
 * cron job does not fire and a job worker does not poll while the project is
 * asleep. These two gauges let it see that before it decides — refuse sleep,
 * or warn — rather than learn it from a customer whose nightly job stopped.
 *
 * - `rebase_scheduled_jobs`: the enabled cron jobs registered in this app,
 *   the project's own and the storage sweeps a bucket asks for. Registered,
 *   not scheduled here: a process that does not own the timers still lists
 *   the jobs another process runs, and they stop all the same when the
 *   project sleeps.
 * - `rebase_background_workers`: job-queue workers running in this process
 *   (0 or 1). A worker runs delayed and retried jobs, topics and queues.
 *
 * Both are emitted as 0 when there is nothing, so a scrape can tell "no
 * scheduled work" from a runtime too old to report it (no series at all).
 *
 * @module
 */
import type { MetricsRegistry } from "./index.js";

export const SCHEDULED_JOBS_METRIC = "rebase_scheduled_jobs";
export const BACKGROUND_WORKERS_METRIC = "rebase_background_workers";

/** What the gauges read from the cron scheduler. */
export interface ScheduledJobsSource {
    listJobs(): readonly { enabled: boolean }[];
}

/** What the gauges read from the job queue. */
export interface BackgroundWorkersSource {
    isRunning(): boolean;
}

/** Report the app's scheduled work in `registry` at each render. */
export function recordScheduledWork(
    registry: MetricsRegistry,
    scheduler: ScheduledJobsSource | undefined,
    jobQueue: BackgroundWorkersSource | undefined
): void {
    registry.onRender(() => {
        const jobs = scheduler?.listJobs().filter(job => job.enabled).length ?? 0;
        registry.setGauge(SCHEDULED_JOBS_METRIC, jobs);
        registry.setGauge(BACKGROUND_WORKERS_METRIC, jobQueue?.isRunning() ? 1 : 0);
    });
}
