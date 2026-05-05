import type {
    CronJobDefinition,
    CronJobStatus,
    CronJobLogEntry,
    CronJobRunState,
    CronJobContext
} from "@rebasepro/types";
import type { RebaseClient } from "@rebasepro/client";
import type { LoadedCronJob } from "./cron-loader";
import type { CronStore } from "./cron-store";

/**
 * Validates a standard cron expression.
 */
function isValidCronExpression(schedule: string): boolean {
    if (!schedule) return false;
    const parts = schedule.trim().split(/\s+/);
    // Typical cron has 5 fields.
    return parts.length === 5 && parts.every(p => p.length > 0);
}

// ─── Cron expression parser (minimal, no external dependency) ────────
// Supports standard 5-field cron (minute hour dom month dow).
// Returns the next Date after `after` that matches the expression.

function parseCronExpression(expression: string, after: Date): Date {
    // We implement a simple forward-search. For production-grade parsing
    // one would use a library, but we avoid adding dependencies.
    const parts = expression.trim().split(/\s+/);
    if (parts.length < 5) {
        throw new Error(`Invalid cron expression: "${expression}". Expected 5 fields.`);
    }

    const [minField, hourField, domField, monField, dowField] = parts;

    const expand = (field: string, min: number, max: number): number[] => {
        const results = new Set<number>();
        for (const segment of field.split(",")) {
            if (segment === "*") {
                for (let i = min; i <= max; i++) results.add(i);
            } else if (segment.includes("/")) {
                const [rangeStr, stepStr] = segment.split("/");
                const step = parseInt(stepStr, 10);
                let start = min;
                let end = max;
                if (rangeStr !== "*") {
                    if (rangeStr.includes("-")) {
                        const [a, b] = rangeStr.split("-").map(Number);
                        start = a;
                        end = b;
                    } else {
                        start = parseInt(rangeStr, 10);
                    }
                }
                for (let i = start; i <= end; i += step) results.add(i);
            } else if (segment.includes("-")) {
                const [a, b] = segment.split("-").map(Number);
                for (let i = a; i <= b; i++) results.add(i);
            } else {
                results.add(parseInt(segment, 10));
            }
        }
        return [...results].sort((a, b) => a - b);
    };

    const minutes = expand(minField, 0, 59);
    const hours = expand(hourField, 0, 23);
    const doms = expand(domField, 1, 31);
    const months = expand(monField, 1, 12);
    const dows = expand(dowField, 0, 6); // 0=Sunday

    // Forward-search from `after + 1 minute`
    const candidate = new Date(after);
    candidate.setSeconds(0, 0);
    candidate.setMinutes(candidate.getMinutes() + 1);

    const maxIterations = 525960; // ~1 year in minutes
    for (let i = 0; i < maxIterations; i++) {
        const month = candidate.getMonth() + 1; // 1-12
        const dom = candidate.getDate();
        const dow = candidate.getDay(); // 0=Sunday
        const hour = candidate.getHours();
        const minute = candidate.getMinutes();

        if (
            months.includes(month) &&
            doms.includes(dom) &&
            dows.includes(dow) &&
            hours.includes(hour) &&
            minutes.includes(minute)
        ) {
            return candidate;
        }
        candidate.setMinutes(candidate.getMinutes() + 1);
    }

    // Fallback — should not happen with valid expressions
    const fallback = new Date(after);
    fallback.setMinutes(fallback.getMinutes() + 1);
    return fallback;
}

// ─── In-memory ring buffer for logs ──────────────────────────────────

const MAX_LOGS_PER_JOB = 50;

// ─── CronScheduler ───────────────────────────────────────────────────

interface RegisteredJob {
    id: string;
    definition: CronJobDefinition;
    enabled: boolean;
    state: CronJobRunState;
    lastRunAt?: Date;
    nextRunAt?: Date;
    lastDurationMs?: number;
    lastError?: string;
    totalRuns: number;
    totalFailures: number;
    timerId?: ReturnType<typeof setTimeout>;
    logs: CronJobLogEntry[];
}

export class CronScheduler {
    private jobs = new Map<string, RegisteredJob>();
    private started = false;
    private store?: CronStore;
    private client?: RebaseClient;

    /**
     * Set the RebaseClient instance to make it available to cron job handlers.
     */
    setClient(client: RebaseClient): void {
        this.client = client;
    }

    /**
     * Attach a persistence store for cron logs.
     * When set, execution logs are written to the database after each run,
     * and counters are seeded from the database on start.
     */
    setStore(store: CronStore): void {
        this.store = store;
    }

    /**
     * Register a batch of loaded cron jobs.
     */
    registerJobs(loadedJobs: LoadedCronJob[]): void {
        for (const loaded of loadedJobs) {
            const existing = this.jobs.get(loaded.id);
            if (existing) {
                console.warn(`[cron] Duplicate cron job id: "${loaded.id}". Overwriting.`);
                this.stopJob(loaded.id);
            }

            this.jobs.set(loaded.id, {
                id: loaded.id,
                definition: loaded.definition,
                enabled: loaded.definition.enabled !== false,
                state: loaded.definition.enabled !== false ? "idle" : "disabled",
                totalRuns: 0,
                totalFailures: 0,
                logs: []
            });
        }
    }

    /**
     * Start the scheduler — begins ticking all enabled jobs.
     */
    start(): void {
        if (this.started) return;
        this.started = true;

        // Seed counters from DB (non-blocking — scheduler starts immediately)
        if (this.store) {
            this.store.fetchJobStats().then((stats) => {
                for (const [jobId, data] of stats) {
                    const job = this.jobs.get(jobId);
                    if (job) {
                        job.totalRuns = data.totalRuns;
                        job.totalFailures = data.totalFailures;
                        if (data.lastRunAt) {
                            job.lastRunAt = new Date(data.lastRunAt);
                        }
                    }
                }
            }).catch((err) => {
                console.warn("[cron] Failed to seed job stats from database:", err);
            });
        }

        for (const [id, job] of this.jobs) {
            if (job.enabled) {
                this.scheduleNext(id);
            }
        }
        console.log(`⏰ Cron scheduler started with ${this.jobs.size} job(s)`);
    }

    /**
     * Stop the scheduler and clear all timers.
     */
    stop(): void {
        this.started = false;
        for (const [id] of this.jobs) {
            this.stopJob(id);
        }
    }

    /**
     * List all registered jobs with their current status.
     */
    listJobs(): CronJobStatus[] {
        return [...this.jobs.values()].map((job) => this.toStatus(job));
    }

    /**
     * Get a single job status by ID.
     */
    getJob(id: string): CronJobStatus | undefined {
        const job = this.jobs.get(id);
        return job ? this.toStatus(job) : undefined;
    }

    /**
     * Get log entries for a job.
     */
    getJobLogs(id: string, limit?: number): CronJobLogEntry[] {
        const job = this.jobs.get(id);
        if (!job) return [];
        const logs = [...job.logs].reverse(); // newest first
        return limit ? logs.slice(0, limit) : logs;
    }

    /**
     * Get log entries for a job from the database (if store is available).
     * Falls back to in-memory logs if no store is configured.
     */
    async getJobLogsFromDb(id: string, limit?: number): Promise<CronJobLogEntry[]> {
        if (this.store) {
            const dbLogs = await this.store.fetchLogs(id, limit);
            if (dbLogs.length > 0) return dbLogs;
        }
        // Fallback to in-memory
        return this.getJobLogs(id, limit);
    }

    /**
     * Enable or disable a job at runtime.
     */
    setJobEnabled(id: string, enabled: boolean): CronJobStatus | undefined {
        const job = this.jobs.get(id);
        if (!job) return undefined;

        job.enabled = enabled;

        if (enabled && this.started) {
            job.state = "idle";
            this.scheduleNext(id);
        } else if (!enabled) {
            this.stopJob(id);
            job.state = "disabled";
        }

        return this.toStatus(job);
    }

    /**
     * Manually trigger a job execution immediately.
     */
    async triggerJob(id: string): Promise<CronJobLogEntry | undefined> {
        const job = this.jobs.get(id);
        if (!job) return undefined;
        return this.executeJob(job, true);
    }

    // ─── Internal ────────────────────────────────────────────────────

    private scheduleNext(id: string): void {
        const job = this.jobs.get(id);
        if (!job || !job.enabled || !this.started) return;

        try {
            const now = new Date();
            const nextRun = parseCronExpression(job.definition.schedule, now);
            job.nextRunAt = nextRun;

            const delay = Math.max(nextRun.getTime() - now.getTime(), 0);

            job.timerId = setTimeout(async () => {
                if (!job.enabled || !this.started) return;
                await this.executeJob(job, false);
                // Schedule the next tick
                this.scheduleNext(id);
            }, delay);
        } catch (err: unknown) {
            console.error(`[cron] Failed to schedule "${id}":`, err);
            job.state = "error";
            job.lastError = err instanceof Error ? err.message : String(err);
        }
    }

    private stopJob(id: string): void {
        const job = this.jobs.get(id);
        if (job?.timerId) {
            clearTimeout(job.timerId);
            job.timerId = undefined;
            job.nextRunAt = undefined;
        }
    }

    private async executeJob(
        job: RegisteredJob,
        manual: boolean
    ): Promise<CronJobLogEntry> {
        const startedAt = new Date();
        const capturedLogs: string[] = [];

        const ctx: CronJobContext = {
            jobId: job.id,
            scheduledAt: startedAt,
            log: (...args: unknown[]) => {
                const line = args.map((a) =>
                    typeof a === "string" ? a : JSON.stringify(a)
                ).join(" ");
                capturedLogs.push(line);
            },
            client: this.client!
        };

        job.state = "running";
        job.lastRunAt = startedAt;
        job.totalRuns++;

        let success = true;
        let error: string | undefined;
        let result: unknown;

        try {
            // Race with timeout
            const timeout = (job.definition.timeoutSeconds ?? 300) * 1000;
            const handlerPromise = Promise.resolve(job.definition.handler(ctx));
            const timeoutPromise = new Promise<never>((_, reject) => {
                setTimeout(() => reject(new Error(`Cron job "${job.id}" timed out after ${timeout}ms`)), timeout);
            });

            result = await Promise.race([handlerPromise, timeoutPromise]);
        } catch (err: unknown) {
            success = false;
            error = err instanceof Error ? err.message : String(err);
            job.totalFailures++;
        }

        const finishedAt = new Date();
        const durationMs = finishedAt.getTime() - startedAt.getTime();

        job.state = success ? (job.enabled ? "idle" : "disabled") : "error";
        job.lastDurationMs = durationMs;
        job.lastError = error;

        const logEntry: CronJobLogEntry = {
            jobId: job.id,
            startedAt: startedAt.toISOString(),
            finishedAt: finishedAt.toISOString(),
            durationMs,
            success,
            error,
            result: result !== undefined ? result : undefined,
            logs: capturedLogs,
            manual
        };

        // Push to ring buffer
        job.logs.push(logEntry);
        if (job.logs.length > MAX_LOGS_PER_JOB) {
            job.logs.shift();
        }

        // Persist to database (non-blocking)
        if (this.store) {
            this.store.insertLog(logEntry).catch((err) => {
                console.error(`[cron] Failed to persist log for "${job.id}":`, err);
            });
        }

        if (success) {
            console.log(`✅ [cron] "${job.id}" completed in ${durationMs}ms`);
        } else {
            console.error(`❌ [cron] "${job.id}" failed in ${durationMs}ms: ${error}`);
        }

        return logEntry;
    }

    private toStatus(job: RegisteredJob): CronJobStatus {
        return {
            id: job.id,
            name: job.definition.name,
            description: job.definition.description,
            schedule: job.definition.schedule,
            enabled: job.enabled,
            state: job.state,
            lastRunAt: job.lastRunAt?.toISOString(),
            nextRunAt: job.nextRunAt?.toISOString(),
            lastDurationMs: job.lastDurationMs,
            lastError: job.lastError,
            totalRuns: job.totalRuns,
            totalFailures: job.totalFailures
        };
    }
}
