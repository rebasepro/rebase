/**
 * Deleting the auth tokens nobody can use any more, on a schedule.
 *
 * `TokenRepository.deleteExpiredTokens` was declared, implemented and never
 * called. Every expired reset link, magic link, email code, abandoned refresh
 * token and stale MFA challenge stayed in the database for good: the tables
 * grew by a row per sign-in attempt and nothing took one away.
 *
 * Runs on the process that owns the timers (`ownership.cronScheduler`), once
 * an hour, and across instances once per hour in all: each tick claims its
 * hour's slot in `rebase.cron_claims` — the claim the cron scheduler takes for
 * a job's run — and only the instance that wins it sweeps. A store that cannot
 * answer the claim means no sweep this hour rather than every instance at
 * once; the tokens are already refused when presented, so a late sweep costs
 * space, not safety.
 *
 * @module
 */

import type { DataDriver } from "@rebasepro/types";
import { isSQLAdmin } from "@rebasepro/types";
import { createCronStore } from "../cron/cron-store";
import { logger } from "../utils/logger";
import type { TokenRepository } from "./interfaces";

/** The slot key in `rebase.cron_claims`. Namespaced so no job file can take it. */
export const EXPIRED_TOKEN_SWEEP_JOB_ID = "rebase:auth:expired-tokens";

/** One sweep an hour, fleet-wide. */
export const EXPIRED_TOKEN_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

export interface ExpiredTokenSweepOptions {
    authRepo: Pick<TokenRepository, "deleteExpiredTokens">;
    /**
     * Claim `slot` for `jobId` across every instance: `true` for the one that
     * wins it. Throws when the store cannot tell. Without it — a driver with
     * no SQL, cron persistence switched off — every instance sweeps, which is
     * wasted work but harmless: deleting what has expired is idempotent.
     */
    claimSlot?: (jobId: string, slot: string) => Promise<boolean>;
    intervalMs?: number;
    /** Clock, for tests. */
    now?: () => number;
}

/** What one tick did. */
export type ExpiredTokenSweepOutcome = "swept" | "claimed-elsewhere" | "unclaimed" | "failed";

export interface ExpiredTokenSweep {
    /** Sweep now, then once per interval. */
    start(): void;
    stop(): void;
    /** One tick: claim this interval's slot and, if it is ours, sweep. */
    runSlot(): Promise<ExpiredTokenSweepOutcome>;
}

export function createExpiredTokenSweep(options: ExpiredTokenSweepOptions): ExpiredTokenSweep {
    const intervalMs = options.intervalMs ?? EXPIRED_TOKEN_SWEEP_INTERVAL_MS;
    const now = options.now ?? Date.now;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight: Promise<ExpiredTokenSweepOutcome> | undefined;

    /**
     * The interval this instant falls in, by its start. Every instance derives
     * the same key from its own clock, so they contend on one row however far
     * apart their ticks are.
     */
    const currentSlot = (): string => new Date(Math.floor(now() / intervalMs) * intervalMs).toISOString();

    async function sweepOnce(): Promise<ExpiredTokenSweepOutcome> {
        const slot = currentSlot();
        if (options.claimSlot) {
            let claimed: boolean;
            try {
                claimed = await options.claimSlot(EXPIRED_TOKEN_SWEEP_JOB_ID, slot);
            } catch (error) {
                logger.warn("[auth] Could not claim this hour's expired-token sweep; skipping it", {
                    slot,
                    error: error instanceof Error ? error.message : String(error)
                });
                return "unclaimed";
            }
            if (!claimed) return "claimed-elsewhere";
        }
        try {
            await options.authRepo.deleteExpiredTokens();
            logger.debug("[auth] Deleted expired auth tokens", { slot });
            return "swept";
        } catch (error) {
            // A failed sweep is not an outage: the next one tries again.
            logger.warn("[auth] Expired-token sweep failed", {
                slot,
                error: error instanceof Error ? error.message : String(error)
            });
            return "failed";
        }
    }

    // One at a time: a tick that lands while the last one is still running
    // joins it instead of starting a second.
    const runSlot = (): Promise<ExpiredTokenSweepOutcome> => {
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
        stop() {
            if (timer) clearTimeout(timer);
            timer = undefined;
        },
        runSlot
    };
}

/** What {@link startExpiredTokenSweep} is given by the boot. */
export interface ExpiredTokenSweepWiring {
    /** The auth repository, when the backend has one. */
    authRepo?: Partial<Pick<TokenRepository, "deleteExpiredTokens">>;
    /** The default data driver: its SQL admin backs the slot claim. */
    driver: DataDriver;
    /** Whether this process owns the timers (`ownership.cronScheduler`). */
    ownsTimers: boolean;
    /** `cronPersistence: false` keeps the claims table out of the database, here too. */
    persistClaims?: boolean;
}

/**
 * Start the sweep where it belongs, or answer `undefined` where it does not:
 * a process that does not own the timers, or a backend whose auth repository
 * cannot delete expired tokens.
 *
 * The claim is the cron store's, made on the first tick rather than at boot so
 * the boot does not wait on its tables.
 */
export function startExpiredTokenSweep(wiring: ExpiredTokenSweepWiring): ExpiredTokenSweep | undefined {
    const repo = wiring.authRepo;
    if (!wiring.ownsTimers || !repo || typeof repo.deleteExpiredTokens !== "function") return undefined;
    const deleteExpiredTokens = repo.deleteExpiredTokens.bind(repo);
    const store = wiring.persistClaims !== false && isSQLAdmin(wiring.driver.admin)
        ? createCronStore(wiring.driver)
        : undefined;
    let ready: Promise<void> | undefined;
    const sweep = createExpiredTokenSweep({
        authRepo: { deleteExpiredTokens },
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
