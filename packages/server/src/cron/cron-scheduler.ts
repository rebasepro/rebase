import type {
    CronJobDefinition,
    CronJobStatus,
    CronJobLogEntry,
    CronJobRunState,
    CronJobContext
} from "@rebasepro/types";
import type { RebaseServerClient } from "@rebasepro/types";
import type { LoadedCronJob } from "./cron-loader";
import type { CronStore } from "./cron-store";
import { logger, redactSensitiveText } from "../utils/logger.js";
import { buildScaleToZeroWarning } from "./scale-to-zero.js";

// ─── Cron expression parser (minimal, no external dependency) ────────
// Supports standard 5-field cron (minute hour dom month dow).
// Returns the next Date after `after` that matches the expression.

/**
 * Expand a single cron field into an ordered array of allowed values.
 * Supports: `*`, `N`, `N-M`, `N/S`, `N-M/S`, `*\/S`, and comma-separated combinations.
 */
function expandCronField(field: string, min: number, max: number): number[] {
    const results = new Set<number>();
    for (const segment of field.split(",")) {
        const trimmed = segment.trim();
        if (trimmed === "*") {
            for (let i = min; i <= max; i++) results.add(i);
        } else if (trimmed.includes("/")) {
            const [rangeStr, stepStr] = trimmed.split("/");
            const step = parseInt(stepStr, 10);
            if (isNaN(step) || step <= 0) {
                throw new Error(`Invalid step value "${stepStr}" in cron field "${field}"`);
            }
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
        } else if (trimmed.includes("-")) {
            const [a, b] = trimmed.split("-").map(Number);
            for (let i = a; i <= b; i++) results.add(i);
        } else {
            const val = parseInt(trimmed, 10);
            if (isNaN(val)) {
                throw new Error(`Invalid value "${trimmed}" in cron field "${field}"`);
            }
            results.add(val);
        }
    }
    return [...results].sort((a, b) => a - b);
}

/**
 * Validates a standard 5-field cron expression structurally and semantically.
 * Returns `{ valid: true }` or `{ valid: false, reason: string }`.
 */
export function validateCronExpression(schedule: string): { valid: true } | { valid: false; reason: string } {
    if (!schedule || typeof schedule !== "string") {
        return { valid: false,
reason: "Schedule must be a non-empty string" };
    }
    const parts = schedule.trim().split(/\s+/);
    if (parts.length !== 5) {
        return { valid: false,
reason: `Expected 5 fields, got ${parts.length}` };
    }
    const fieldRanges: [string, number, number][] = [
        ["minute", 0, 59],
        ["hour", 0, 23],
        ["day of month", 1, 31],
        ["month", 1, 12],
        ["day of week", 0, 6]
    ];
    for (let i = 0; i < 5; i++) {
        const [name, min, max] = fieldRanges[i];
        try {
            const values = expandCronField(parts[i], min, max);
            if (values.length === 0) {
                return { valid: false,
reason: `${name} field "${parts[i]}" produces no values` };
            }
            for (const v of values) {
                if (v < min || v > max) {
                    return { valid: false,
reason: `${name} field value ${v} out of range [${min}–${max}]` };
                }
            }
        } catch (err) {
            return { valid: false,
reason: `${name} field: ${err instanceof Error ? err.message : String(err)}` };
        }
    }
    return { valid: true };
}

/** The five cron fields, pre-expanded into the values each one allows. */
interface CronFields {
    minutes: number[];
    hours: number[];
    doms: number[];
    months: number[];
    dows: number[];
}

/** Expand all five fields of an expression. Throws on invalid expressions. */
function parseCronFields(expression: string): CronFields {
    const parts = expression.trim().split(/\s+/);
    if (parts.length < 5) {
        throw new Error(`Invalid cron expression: "${expression}". Expected 5 fields.`);
    }
    const [minField, hourField, domField, monField, dowField] = parts;
    return {
        minutes: expandCronField(minField, 0, 59),
        hours: expandCronField(hourField, 0, 23),
        doms: expandCronField(domField, 1, 31),
        months: expandCronField(monField, 1, 12),
        dows: expandCronField(dowField, 0, 6) // 0=Sunday
    };
}

/** Whether a minute-precision instant matches every field of the expression. */
function matchesCronFields(candidate: Date, fields: CronFields): boolean {
    return fields.months.includes(candidate.getMonth() + 1) // getMonth is 0-11
        && fields.doms.includes(candidate.getDate())
        && fields.dows.includes(candidate.getDay())
        && fields.hours.includes(candidate.getHours())
        && fields.minutes.includes(candidate.getMinutes());
}

/** ~1 year in minutes — the walk bound for both search directions. */
/**
 * How far forward to look for the next matching slot.
 *
 * Four years and a day, not one year. `0 0 29 2 *` — run on 29 February — is a
 * legitimate expression whose slot can be almost four years out, and a one-year
 * search never found it.
 */
const MAX_SLOT_SEARCH_MINUTES = 4 * 525960 + 1440;

/**
 * Calculate the next Date after `after` that matches the cron expression.
 * Throws on invalid expressions.
 */
export function parseCronExpression(expression: string, after: Date): Date {
    const fields = parseCronFields(expression);

    // Forward-search from `after + 1 minute`
    const candidate = new Date(after);
    candidate.setSeconds(0, 0);
    candidate.setMinutes(candidate.getMinutes() + 1);

    for (let i = 0; i < MAX_SLOT_SEARCH_MINUTES; i++) {
        if (matchesCronFields(candidate, fields)) {
            return candidate;
        }
        candidate.setMinutes(candidate.getMinutes() + 1);
    }

    // No slot inside the window. Refuse rather than invent one.
    //
    // This used to return `after + 1 minute`, which is indistinguishable from a
    // schedule that really does fire every minute — so an expression with no
    // reachable slot ran sixty times an hour, forever. `0 0 29 2 *` was caught
    // by it while the search window was a single year: a job meant to run once
    // every four years became the busiest job on the deployment.
    //
    // The caller schedules inside a `try` and reports a job it could not
    // schedule, which is the correct outcome for an expression that names no
    // time. Genuinely impossible dates (`0 0 31 2 *`) land here too, and should.
    throw new Error(
        `Cron expression "${expression}" has no matching time within ` +
        `${Math.round(MAX_SLOT_SEARCH_MINUTES / 525960)} years of ${after.toISOString()}. ` +
        "Check the day-of-month and month fields — a date such as 31 February never occurs."
    );
}

/**
 * The latest slot matching `expression` within the inclusive window
 * `[from, to]`, or `undefined` when the expression has no slot in it.
 *
 * Walks backwards a minute at a time from `to`, so the first hit is already
 * the answer — in the common case (a job that ran normally moments ago) that
 * is a handful of iterations, not a scan of the whole window.
 *
 * `to`'s own minute is included: an instance booting at 06:00:30 has *not* run
 * the 06:00 slot — `parseCronExpression` already skipped past it to tomorrow —
 * so that slot is genuinely missed and must be a candidate.
 *
 * Seconds and milliseconds are zeroed to match how `parseCronExpression`
 * builds a slot, so the same wall-clock slot serialises to a byte-identical
 * ISO string down either path. The claim key depends on that.
 */
export function findMostRecentSlot(expression: string, from: Date, to: Date): Date | undefined {
    const fields = parseCronFields(expression);

    const candidate = new Date(to);
    candidate.setSeconds(0, 0);

    for (let i = 0; i < MAX_SLOT_SEARCH_MINUTES && candidate.getTime() >= from.getTime(); i++) {
        if (matchesCronFields(candidate, fields)) {
            return candidate;
        }
        candidate.setMinutes(candidate.getMinutes() - 1);
    }

    return undefined;
}

// ─── In-memory ring buffer for logs ──────────────────────────────────

const MAX_LOGS_PER_JOB = 50;

/**
 * Minimum milliseconds between scheduled executions of the same job.
 * Prevents tight re-execution loops caused by jitter or clock drift.
 */
const MIN_SCHEDULE_INTERVAL_MS = 5_000; // 5 seconds

/**
 * Largest delay setTimeout can hold. Node stores it in a 32-bit signed int;
 * anything larger silently clamps to 1ms and fires immediately, so a slot
 * further out than this must be reached in hops rather than one timer.
 */
const MAX_TIMER_DELAY_MS = 2_147_483_647; // 2^31 - 1, ~24.8 days

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
    /** True while a handler is actively executing (prevents concurrent runs). */
    executing: boolean;
}

export class CronScheduler {
    private jobs = new Map<string, RegisteredJob>();
    private started = false;
    private store?: CronStore;
    private client?: RebaseServerClient;

    /**
     * Set the server singleton to make it available to cron job handlers.
     *
     * `RebaseServerClient`, not `RebaseClient`: the object `init.ts` passes is
     * the same one it registers as the singleton, so this was always the true
     * type — and the wider annotation is what let `ctx.client.data` look like a
     * user-scoped plane inside a cron, when it is the admin-scoped one.
     */
    setClient(client: RebaseServerClient): void {
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
     *
     * If the scheduler is already started, newly registered jobs are
     * automatically scheduled (so late-registered jobs don't sit idle).
     *
     * Validates the cron schedule on registration — invalid schedules
     * are rejected with a warning and the job is NOT registered.
     */
    registerJobs(loadedJobs: LoadedCronJob[]): void {
        for (const loaded of loadedJobs) {
            // Validate schedule up-front — reject invalid schedules
            const validation = validateCronExpression(loaded.definition.schedule);
            if (!validation.valid) {
                logger.error(`[cron] Rejecting job "${loaded.id}": invalid schedule "${loaded.definition.schedule}" — ${validation.reason}`);
                continue;
            }

            const existing = this.jobs.get(loaded.id);
            if (existing) {
                logger.warn(`[cron] Duplicate cron job id: "${loaded.id}". Overwriting.`);
                this.stopJob(loaded.id);
            }

            const enabled = loaded.definition.enabled !== false;

            this.jobs.set(loaded.id, {
                id: loaded.id,
                definition: loaded.definition,
                enabled,
                state: enabled ? "idle" : "disabled",
                totalRuns: 0,
                totalFailures: 0,
                logs: [],
                executing: false
            });

            // If the scheduler is already running, auto-schedule new jobs
            if (this.started && enabled) {
                this.scheduleNext(loaded.id);
            }
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
                logger.warn("[cron] Failed to seed job stats from database", { error: err });
            });
        }

        for (const [id, job] of this.jobs) {
            if (job.enabled) {
                this.scheduleNext(id);
            }
        }
        if (!this.store) {
            logger.warn("[cron] No cron store attached — runs are uncoordinated; with multiple app instances every instance will execute every job");
        }
        this.warnIfScaleToZero();

        // Recover slots that elapsed while nothing was ticking. Deliberately
        // not awaited: catch-up reaches the database and runs handlers, and
        // boot must not wait on either. Its own errors are contained inside.
        void this.catchUpMissedSlots();

        logger.info(`⏰ Cron scheduler started with ${this.jobs.size} job(s)`);
    }

    /**
     * Stop the scheduler and clear all timers.
     *
     * Currently-executing handlers run to completion (they are async),
     * but no further scheduling occurs after stop.
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
     *
     * Returns `undefined` if the job doesn't exist.
     * If the job is currently executing, returns the log entry with
     * a `skipped: true` result rather than running concurrently.
     */
    async triggerJob(id: string): Promise<CronJobLogEntry | undefined> {
        const job = this.jobs.get(id);
        if (!job) return undefined;

        // Concurrency guard — don't run two instances simultaneously
        if (job.executing) {
            logger.warn(`[cron] Skipping manual trigger of "${id}" — already executing`);
            const logEntry: CronJobLogEntry = {
                jobId: id,
                startedAt: new Date().toISOString(),
                finishedAt: new Date().toISOString(),
                durationMs: 0,
                success: true,
                result: { skipped: true,
reason: "already_executing" },
                logs: ["Skipped: job is already running"],
                manual: true
            };
            job.logs.push(logEntry);
            if (job.logs.length > MAX_LOGS_PER_JOB) job.logs.shift();
            return logEntry;
        }

        return this.executeJob(job, true);
    }

    // ─── Internal ────────────────────────────────────────────────────

    /**
     * Warn once at start when the process looks like it is running on a
     * platform that freezes or evicts instances between requests, where the
     * in-process timers this scheduler relies on never fire.
     *
     * Advisory only: any failure here is swallowed so a detection bug can
     * never take a production boot down.
     */
    private warnIfScaleToZero(): void {
        try {
            const warning = buildScaleToZeroWarning(
                [...this.jobs.values()].map((job) => ({ id: job.id, enabled: job.enabled }))
            );
            if (warning) {
                logger.warn(warning.message, warning.data);
            }
        } catch {
            // Never let the advisory check affect startup.
        }
    }

    /**
     * Schedule the next execution for a job.
     *
     * Safety guarantees:
     * 1. Clears any existing timer first (prevents leaked/duplicate timers)
     * 2. Enforces a minimum delay to prevent tight loops from jitter
     * 3. Unref's the timer so it doesn't prevent process exit
     * 4. Re-checks enabled & started state before executing
     * 5. Concurrency guard prevents overlapping handler executions
     */
    private scheduleNext(id: string): void {
        const job = this.jobs.get(id);
        if (!job || !job.enabled || !this.started) return;

        // Clear any previously scheduled timer to prevent double-firing
        this.stopJob(id);

        try {
            const now = new Date();
            const nextRun = parseCronExpression(job.definition.schedule, now);
            job.nextRunAt = nextRun;

            const rawDelay = nextRun.getTime() - now.getTime();
            // Enforce a minimum delay to prevent tight re-execution loops
            // from event loop jitter or near-zero setTimeout drift
            const delay = Math.max(rawDelay, MIN_SCHEDULE_INTERVAL_MS);

            // A slot past the 32-bit timer ceiling cannot be armed directly:
            // setTimeout would clamp it to 1ms and fire at once, and since the
            // slot is already claimed by then, every wake re-schedules the same
            // overflowing delay — a permanent hot loop, not a late job. Sleep
            // to the ceiling and re-derive the delay on waking instead; the
            // cron expression stays the source of truth across the hops.
            if (delay > MAX_TIMER_DELAY_MS) {
                const hop = setTimeout(() => {
                    if (this.started && job.enabled) this.scheduleNext(id);
                }, MAX_TIMER_DELAY_MS);
                if (hop && typeof hop === "object" && "unref" in hop) {
                    hop.unref();
                }
                job.timerId = hop;
                return;
            }

            const timer = setTimeout(async () => {
                // Re-check state: scheduler may have been stopped or job disabled
                // between when we scheduled and when we fire
                if (!job.enabled || !this.started) return;

                // Concurrency guard: if somehow we're already executing, skip
                if (job.executing) {
                    logger.warn(`[cron] Skipping scheduled run of "${id}" — still executing from previous run`);
                    // Re-schedule to try again later
                    this.scheduleNext(id);
                    return;
                }

                // A timer can wake before its slot: a delay past the 32-bit
                // ceiling, a clock stepped backwards by NTP, a VM resuming from
                // suspend. Claiming on an early wake is unrecoverable — claims
                // are permanent, so the slot would be burned and the real run
                // silently skipped when it came due. Re-derive from the wall
                // clock and re-arm instead; only the fire that is genuinely due
                // may claim.
                if (Date.now() < nextRun.getTime()) {
                    this.scheduleNext(id);
                    return;
                }

                // Cross-instance guard: claim the scheduled slot in the store.
                // The slot is the scheduled fire time — deterministic across
                // instances — so exactly one instance wins each (job, slot) pair.
                // A store without tryClaimRun (pre-claims custom implementation)
                // runs uncoordinated; a throwing store fails open — either way
                // this callback must never reject, or the job would silently
                // stop rescheduling.
                if (this.store?.tryClaimRun) {
                    let claimed = true;
                    try {
                        claimed = await this.store.tryClaimRun(id, nextRun.toISOString());
                    } catch (err) {
                        logger.warn(`[cron] Claim check threw for "${id}" — running uncoordinated`, { error: err });
                    }
                    if (!claimed) {
                        logger.info(`[cron] Slot ${nextRun.toISOString()} for "${id}" claimed by another instance — skipping`);
                        if (this.started && job.enabled) {
                            this.scheduleNext(id);
                        }
                        return;
                    }
                }

                await this.executeJob(job, false);

                // Schedule the next tick (only if still started + enabled)
                if (this.started && job.enabled) {
                    this.scheduleNext(id);
                }
            }, delay);

            // Unref the timer so it doesn't prevent Node.js from exiting
            // during graceful shutdown
            if (timer && typeof timer === "object" && "unref" in timer) {
                timer.unref();
            }

            job.timerId = timer;
        } catch (err: unknown) {
            logger.error(`[cron] Failed to schedule "${id}"`, { error: err });
            job.state = "error";
            job.lastError = err instanceof Error ? err.message : String(err);
        }
    }

    /**
     * Run any slot that elapsed while no instance was holding a timer for it.
     *
     * Only jobs that opted in via `catchUpWindowSeconds` are considered, and
     * only their single most recent missed slot — see the field's docs for why
     * both limits are deliberate.
     *
     * The claim is what makes this safe. In the ordinary case — an instance
     * restarting minutes after a slot ran normally — the most recent slot is
     * already claimed, so this costs one `tryClaimRun` per job per boot and
     * does nothing. A slot is only executed when no instance, past or present,
     * ever claimed it.
     *
     * Never throws: a failure here must not take down a scheduler that is
     * otherwise ticking correctly.
     */
    private async catchUpMissedSlots(): Promise<void> {
        const candidates = [...this.jobs.values()].filter(
            job => job.enabled && (job.definition.catchUpWindowSeconds ?? 0) > 0
        );
        if (candidates.length === 0) return;

        // A claims-capable store is the whole safety mechanism. Without one,
        // every boot would look like "this slot never ran" and an instance
        // recycled twice an hour would re-run the same hourly job twice an
        // hour. Refusing to catch up is the correct degradation.
        if (!this.store?.tryClaimRun) {
            logger.warn(
                `[cron] Catch-up is configured on ${candidates.length} job(s) but no claims-capable store is attached — skipping. ` +
                "Without claims a restart cannot tell an unrun slot from one the previous instance already ran."
            );
            return;
        }

        const now = new Date();

        for (const job of candidates) {
            try {
                if (!this.started || !job.enabled || job.executing) continue;

                const windowSeconds = job.definition.catchUpWindowSeconds!;
                const from = new Date(now.getTime() - windowSeconds * 1000);
                const slot = findMostRecentSlot(job.definition.schedule, from, now);
                if (!slot) continue;

                const slotIso = slot.toISOString();

                // Same key the scheduled path claims with, so a slot that fired
                // normally is already taken and this is a no-op.
                let claimed: boolean;
                try {
                    claimed = await this.store.tryClaimRun(job.id, slotIso);
                } catch (err) {
                    // Fail closed, unlike the scheduled path. A missed slot is
                    // a recovery, not an obligation — running it against a
                    // store that cannot tell us whether it already ran risks a
                    // duplicate on every boot.
                    logger.warn(`[cron] Catch-up claim threw for "${job.id}" — skipping catch-up`, { error: err });
                    continue;
                }

                if (!claimed) continue;

                const lateBy = Math.round((now.getTime() - slot.getTime()) / 1000);
                logger.info(`[cron] Catching up missed slot ${slotIso} for "${job.id}" (${lateBy}s late)`);

                await this.executeJob(job, false, `⏰ Catch-up run for missed slot ${slotIso} (${lateBy}s late)`);
            } catch (err) {
                logger.error(`[cron] Catch-up failed for "${job.id}"`, { error: err });
            }
        }
    }

    /**
     * Stop a single job's timer and clear its next run state.
     */
    private stopJob(id: string): void {
        const job = this.jobs.get(id);
        if (job?.timerId) {
            clearTimeout(job.timerId);
            job.timerId = undefined;
            job.nextRunAt = undefined;
        }
    }

    /**
     * Execute a job's handler with full isolation and safety.
     *
     * - Sets a concurrency flag to prevent overlapping runs
     * - Wraps handler in a timeout race
     * - Captures all logs, errors, and results
     * - Persists to store (non-blocking) if available
     * - Always restores state even on catastrophic errors
     */
    private async executeJob(
        job: RegisteredJob,
        manual: boolean,
        seedLog?: string
    ): Promise<CronJobLogEntry> {
        const startedAt = new Date();
        // A caller-supplied first line, stored with the run's own output. A
        // catch-up uses it to say so in the persisted log, where an operator
        // reading `cron_logs` will actually see it — `manual` is the only other
        // provenance the entry carries, and a catch-up is not manual.
        const capturedLogs: string[] = seedLog ? [seedLog] : [];

        // Set executing flag — prevents concurrent runs
        job.executing = true;

        const ctx: CronJobContext = {
            jobId: job.id,
            scheduledAt: startedAt,
            log: (...args: unknown[]) => {
                const line = args.map((a) =>
                    typeof a === "string" ? a : JSON.stringify(a)
                ).join(" ");
                capturedLogs.push(line);
            },
            // `rebase`, and only `rebase`: it matches the singleton import and
            // `defineFunction`'s context. The old `client` alias re-exposed
            // `client.data`, the name `RebaseServerClient` deliberately omits so
            // that the RLS-bypassing plane is spelled `dataAsAdmin` everywhere.
            rebase: this.client!
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
            let timeoutHandle: ReturnType<typeof setTimeout>;
            const timeoutPromise = new Promise<never>((_, reject) => {
                timeoutHandle = setTimeout(
                    () => reject(new Error(`Cron job "${job.id}" timed out after ${timeout}ms`)),
                    timeout
                );
            });

            try {
                result = await Promise.race([handlerPromise, timeoutPromise]);
            } finally {
                clearTimeout(timeoutHandle!);
            }
        } catch (err: unknown) {
            success = false;
            // Redacted at the point of capture, not just on the way to the log:
            // this string is persisted into `cron_logs` and rendered in the
            // Studio cron panel, and a job that fails on a query would
            // otherwise store `Failed query: <sql>\nparams: <values>` — the
            // statement and every bound value — in a table, indefinitely.
            error = redactSensitiveText(err instanceof Error ? err.message : String(err));
            job.totalFailures++;
        } finally {
            // Always clear executing flag — even on catastrophic errors
            job.executing = false;
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
            this.store.insertLog(logEntry).catch((persistErr) => {
                logger.error(`[cron] Failed to persist log for "${job.id}"`, { error: persistErr });
            });
        }

        if (success) {
            logger.info(`✅ [cron] "${job.id}" completed in ${durationMs}ms`);
        } else {
            logger.error(`❌ [cron] "${job.id}" failed in ${durationMs}ms: ${error}`);
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
