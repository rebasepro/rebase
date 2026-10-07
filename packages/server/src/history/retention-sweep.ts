/**
 * Deleting row history past its retention period, on a schedule.
 *
 * History was pruned only inline: right after a row was written, for that
 * row. A row nobody writes again — every deleted row, every row of a table
 * that churns — kept its history for good, whatever `retention` said: a
 * collection that creates and deletes a million rows a month grew by its full
 * history every month and never gave any of it back. `pruneExpired` (one
 * batched DELETE per few thousand entries, through an index on their age) had
 * no caller.
 *
 * Runs where the timers do (`ownership.cronScheduler`), once an hour, and once
 * an hour across the fleet: each tick claims its hour's slot in
 * `rebase.cron_claims`, as the expired-token sweep does, and only the instance
 * that wins it sweeps. Without a store to claim through every instance sweeps,
 * which is wasted work but harmless — deleting what has expired is idempotent,
 * and the batches skip rows another sweep has locked.
 *
 * The inline prune stays: it keeps a busy row within its newest 200 entries,
 * which no age-based sweep does.
 *
 * @module
 */

import type { DataDriver } from "@rebasepro/types";
import { isSQLAdmin } from "@rebasepro/types";
import { createCronStore } from "../cron/cron-store";
import { logger } from "../utils/logger";

/** The slot key in `rebase.cron_claims`. Namespaced so no job file can take it. */
export const HISTORY_RETENTION_SWEEP_JOB_ID = "rebase:history:retention";

/** One sweep an hour, fleet-wide. */
export const HISTORY_RETENTION_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

export interface HistoryRetentionSweepOptions {
    /** Delete every entry past retention; resolves to how many went. */
    pruneExpired: () => Promise<number>;
    /**
     * Claim `slot` for `jobId` across every instance: `true` for the one that
     * wins it. Throws when the store cannot tell. Absent, every instance sweeps.
     */
    claimSlot?: (jobId: string, slot: string) => Promise<boolean>;
    intervalMs?: number;
    /** Clock, for tests. */
    now?: () => number;
}

/** What one tick did. */
export type HistoryRetentionSweepOutcome = "swept" | "claimed-elsewhere" | "unclaimed" | "failed";

export interface HistoryRetentionSweep {
    /** Sweep now, then once per interval. */
    start(): void;
    /**
     * No more ticks. Resolves once a tick already running has finished, so a
     * caller about to close the pool can wait for the sweep still using it.
     */
    stop(): Promise<void>;
    /** One tick: claim this interval's slot and, if it is ours, sweep. */
    runSlot(): Promise<HistoryRetentionSweepOutcome>;
}

export function createHistoryRetentionSweep(options: HistoryRetentionSweepOptions): HistoryRetentionSweep {
    const intervalMs = options.intervalMs ?? HISTORY_RETENTION_SWEEP_INTERVAL_MS;
    const now = options.now ?? Date.now;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight: Promise<HistoryRetentionSweepOutcome> | undefined;

    /** The interval this instant falls in, by its start: the same key on every instance. */
    const currentSlot = (): string => new Date(Math.floor(now() / intervalMs) * intervalMs).toISOString();

    async function sweepOnce(): Promise<HistoryRetentionSweepOutcome> {
        const slot = currentSlot();
        if (options.claimSlot) {
            let claimed: boolean;
            try {
                claimed = await options.claimSlot(HISTORY_RETENTION_SWEEP_JOB_ID, slot);
            } catch (error) {
                logger.warn("[history] Could not claim this hour's retention sweep; skipping it", {
                    slot,
                    error: error instanceof Error ? error.message : String(error)
                });
                return "unclaimed";
            }
            if (!claimed) return "claimed-elsewhere";
        }
        try {
            const deleted = await options.pruneExpired();
            if (deleted > 0) logger.info(`[history] Deleted ${deleted} history entr${deleted === 1 ? "y" : "ies"} past retention`, { slot });
            return "swept";
        } catch (error) {
            // A sweep that fails leaves extra history, not missing history;
            // the next one tries again.
            logger.warn("[history] Retention sweep failed", {
                slot,
                error: error instanceof Error ? error.message : String(error)
            });
            return "failed";
        }
    }

    // One at a time: a tick that lands while the last one is still running
    // joins it instead of starting a second.
    const runSlot = (): Promise<HistoryRetentionSweepOutcome> => {
        inFlight ??= sweepOnce().finally(() => { inFlight = undefined; });
        return inFlight;
    };

    const schedule = (): void => {
        timer = setTimeout(() => {
            schedule();
            void runSlot();
        }, intervalMs);
        // Never the reason a process stays up.
        timer.unref?.();
    };

    return {
        start() {
            if (timer) return;
            schedule();
            // Not awaited: boot does not wait on housekeeping.
            void runSlot();
        },
        async stop() {
            if (timer) clearTimeout(timer);
            timer = undefined;
            // A tick never rejects (it reports its failures), so this only waits.
            await inFlight;
        },
        runSlot
    };
}

/** What {@link startHistoryRetentionSweep} is given by the boot. */
export interface HistoryRetentionSweepWiring {
    /** The history service the driver records through, when history is on. */
    historyService?: { pruneExpired?(): Promise<number> };
    /** The default data driver: its SQL admin backs the slot claim. */
    driver: DataDriver;
    /** Whether this process owns the timers (`ownership.cronScheduler`). */
    ownsTimers: boolean;
    /** `cronPersistence: false` keeps the claims table out of the database, here too. */
    persistClaims?: boolean;
}

/**
 * Start the sweep where it belongs, or answer `undefined` where it does not:
 * a process that does not own the timers, or a history service that cannot
 * prune by age.
 */
export function startHistoryRetentionSweep(wiring: HistoryRetentionSweepWiring): HistoryRetentionSweep | undefined {
    const service = wiring.historyService;
    if (!wiring.ownsTimers || !service || typeof service.pruneExpired !== "function") return undefined;
    const pruneExpired = service.pruneExpired.bind(service);
    const store = wiring.persistClaims !== false && isSQLAdmin(wiring.driver.admin)
        ? createCronStore(wiring.driver)
        : undefined;
    let ready: Promise<void> | undefined;
    const sweep = createHistoryRetentionSweep({
        pruneExpired,
        claimSlot: store
            ? async (jobId, slot) => {
                ready ??= store.ensureTable();
                await ready;
                return store.tryClaimRun(jobId, slot);
            }
            : undefined
    });
    sweep.start();
    return sweep;
}
