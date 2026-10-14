/**
 * A backend boot that lost its database part-way, which booting again fixes.
 *
 * `rebase db branch create --force` closes the database it copies: it ends
 * every connection to it and refuses new ones until the copy is done. A
 * backend booting at that moment failed with `Failed to start the Rebase
 * runtime … terminating connection due to administrator command (57P01)`, and
 * `rebase dev` then said "Fix the error above; the watcher restarts it on the
 * next change", about an error nobody could fix and that the next boot would
 * not have. The same holds for a database that is restarting.
 *
 * This reads the backend's output and says when a failed boot is worth another
 * try, and after how long: a few tries, each waiting twice as long as the one
 * before, and none once the backend has failed for a reason of its own.
 */

/** The sentence that starts a boot failure, as `reportBootFailure` in `@rebasepro/server` writes it. */
const BOOT_FAILED = /Failed to start the Rebase runtime/;

/**
 * Why a boot failed that a later boot does not, by what PostgreSQL said:
 * the server ended the connection (57P01 `pg_terminate_backend`, 57P02, 57P03
 * a server starting or stopping), or the database is closed to new
 * connections (55000, what a forced branch create does while it copies).
 */
const PASSING_CAUSES: readonly RegExp[] = [
    /terminating connection due to administrator command/i,
    /\(57P0[123]\)/,
    /is not currently accepting connections/i,
    /the database system is (?:starting up|shutting down|in recovery mode)/i
];

/** One more boot, and how long to wait for it. */
export interface BootRetryPlan {
    /** 1 for the first retry. */
    attempt: number;
    /** Of {@link BootRetry}'s `maxAttempts`. */
    of: number;
    delayMs: number;
    /** The line that said why, as the backend printed it. */
    reason: string;
}

export class BootRetry {
    private failing = false;
    private planned = false;
    private attempts = 0;

    constructor(private readonly maxAttempts = 3, private readonly firstDelayMs = 1_000) {}

    /**
     * Read one line of the backend's output, colour removed. Returns a plan
     * the first time a failing boot names a passing cause, and null otherwise,
     * including once the tries are spent.
     */
    line(text: string): BootRetryPlan | null {
        if (BOOT_FAILED.test(text)) {
            this.failing = true;
            this.planned = false;
        }
        if (!this.failing || this.planned) return null;
        if (!PASSING_CAUSES.some(cause => cause.test(text))) return null;
        this.planned = true;
        if (this.attempts >= this.maxAttempts) return null;
        this.attempts += 1;
        return {
            attempt: this.attempts,
            of: this.maxAttempts,
            delayMs: this.firstDelayMs * 2 ** (this.attempts - 1),
            reason: text.trim()
        };
    }

    /** The backend is serving: a later failure is a new one, with every try left. */
    up(): void {
        this.failing = false;
        this.planned = false;
        this.attempts = 0;
    }
}
