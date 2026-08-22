/**
 * The row-level-security audit, on a schedule.
 *
 * `@rebasepro/rls-check` is a thorough, read-only audit of a database's RLS —
 * more thorough, on security specifically, than the dashboard advisors it
 * competes with. And nobody runs it, because it is a command, and a command is
 * something you have to remember. A check that has to be remembered is a check
 * that reports a clean database right up until the day it matters.
 *
 * This runs it on a timer against the database the server is already using, and
 * makes the result readable without a terminal. Nothing else about the checker
 * changes: same package, same checks, same output.
 *
 * ## Why it is off by default
 *
 * It opens its own connection and introspects the whole catalog. That is cheap
 * and read-only, but it is not nothing, and a background query nobody asked for
 * is a poor default for a library. Enabling it is one line, and the boot log
 * says so when it is off.
 *
 * ## Why the scanner is injected rather than imported
 *
 * `@rebasepro/server` is engine-agnostic — it has no `pg` and no other database
 * driver, deliberately. `@rebasepro/rls-check` has `pg`, because it connects to
 * Postgres. Importing it here would put a Postgres driver in the install of
 * every Mongo and Firebase user, for a feature none of them can use, and an
 * audit of row-level security is a Postgres concept living in the one package
 * that is supposed to know nothing about Postgres.
 *
 * So the scan function is handed in:
 *
 * ```ts
 * import { scan } from "@rebasepro/rls-check";
 * rlsAudit: { enabled: true, scan }
 * ```
 *
 * Everything else — the schedule, the summary, the status, the admin route —
 * lives here and is engine-agnostic in fact as well as in principle.
 */
import { logger } from "../utils/logger";

/**
 * The shape `@rebasepro/rls-check` returns. Declared structurally rather than
 * imported as a type, so this module carries no dependency on it at all — see
 * the module comment.
 */
export interface RlsScanFinding {
    id: string;
    severity: "info" | "low" | "medium" | "high" | "critical";
    title: string;
    target: { schema: string; table?: string; policy?: string };
}

export interface RlsScanResult {
    scannedAt: string;
    /** Host and database name only — the checker never returns credentials. */
    database: { host: string; name: string };
    stats: {
        schemas: number;
        tables: number;
        policies: number;
        tablesWithoutRls: number;
        checksRun: number;
    };
    findings: RlsScanFinding[];
}

const SEVERITY_ORDER = ["info", "low", "medium", "high", "critical"] as const;
export type RlsSeverity = (typeof SEVERITY_ORDER)[number];

/** Rank for comparison. Unknown severities sort lowest rather than throwing. */
const rank = (severity: string): number => {
    const index = SEVERITY_ORDER.indexOf(severity as RlsSeverity);
    return index === -1 ? 0 : index;
};

export interface RlsAuditConfig {
    /** Off unless set. See the module comment for why. */
    enabled?: boolean;
    /**
     * How often to run, in milliseconds. Default 24 hours.
     *
     * The thing being watched is a schema, which changes on deploys, not on
     * traffic — so this is a daily safety net, not a monitor.
     */
    intervalMs?: number;
    /** Run once at startup as well as on the interval. Default true. */
    runOnBoot?: boolean;
    /** Restrict the scan to these schemas. Default: every user schema. */
    schemas?: string[];
    /**
     * Where to connect. Defaults to `DATABASE_URL`.
     *
     * Taken as a string rather than borrowed from the driver because the checker
     * connects on its own terms — its own session, its own statement timeout —
     * and threading it through a driver would make the audit's behaviour depend
     * on the pool it borrowed from.
     */
    connectionString?: string;
    /**
     * Severity at or above which a completed run logs a warning rather than an
     * info line. Default `high`.
     */
    warnAtSeverity?: RlsSeverity;
    /** Statement timeout for the scan's own queries. Default 30s. */
    statementTimeoutMs?: number;
    /**
     * The scanner. Pass `scan` from `@rebasepro/rls-check`:
     *
     * ```ts
     * import { scan } from "@rebasepro/rls-check";
     * rlsAudit: { enabled: true, scan }
     * ```
     *
     * Required when `enabled`. See the module comment for why it is not
     * imported here.
     */
    scan?: RlsScanner;
}

/** The one function this module needs from `@rebasepro/rls-check`. */
export type RlsScanner = (options: {
    connectionString: string;
    schemas?: string[];
    statementTimeoutMs?: number;
}) => Promise<RlsScanResult>;

export interface RlsAuditStatus {
    enabled: boolean;
    /** Why it is not running, when it is not. */
    reason?: string;
    lastRunAt?: string;
    lastError?: string;
    result?: RlsScanResult;
}

export interface RlsAudit {
    start(): void;
    stop(): void;
    /** Run now, outside the schedule. Resolves when the run finishes. */
    runNow(): Promise<void>;
    status(): RlsAuditStatus;
}

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;

/** One line naming what the run found, at the right level to be noticed. */
export function summarize(result: RlsScanResult, warnAt: RlsSeverity): {
    level: "warn" | "info";
    message: string;
} {
    const counts = new Map<string, number>();
    for (const finding of result.findings) {
        counts.set(finding.severity, (counts.get(finding.severity) ?? 0) + 1);
    }

    const worst = result.findings.reduce(
        (acc, f) => (rank(f.severity) > rank(acc) ? f.severity : acc),
        "info" as string
    );

    if (result.findings.length === 0) {
        return {
            level: "info",
            message:
                `RLS audit clean: ${result.stats.tables} table(s), ${result.stats.policies} polic(ies), ` +
                `${result.stats.checksRun} check(s), no findings.`
        };
    }

    // Counted highest-first, because that is the order anyone reads it in.
    const breakdown = [...SEVERITY_ORDER]
        .reverse()
        .filter(severity => counts.get(severity))
        .map(severity => `${counts.get(severity)} ${severity}`)
        .join(", ");

    const message =
        `RLS audit found ${result.findings.length} issue(s) — ${breakdown}. ` +
        `${result.stats.tablesWithoutRls} table(s) without RLS. ` +
        "Read the detail at GET /api/admin/rls-audit, or run `npx @rebasepro/rls-check` for the full report.";

    return { level: rank(worst) >= rank(warnAt) ? "warn" : "info", message };
}

/**
 * Create the audit. Nothing runs until {@link RlsAudit.start}.
 *
 * Because the scanner is supplied by the caller, the schedule, the summary and
 * the failure handling are all testable without a database and without
 * `@rebasepro/rls-check` present.
 */
export function createRlsAudit(config: RlsAuditConfig): RlsAudit {
    const enabled = config.enabled === true;
    const intervalMs = config.intervalMs ?? DEFAULT_INTERVAL_MS;
    const warnAt = config.warnAtSeverity ?? "high";
    const connectionString = config.connectionString ?? process.env.DATABASE_URL;

    let timer: NodeJS.Timeout | undefined;
    let status: RlsAuditStatus = { enabled };

    if (enabled && !config.scan) {
        status = {
            enabled: false,
            reason:
                "The scheduled RLS audit is enabled but no scanner was supplied. Pass `scan` from " +
                "`@rebasepro/rls-check`: `rlsAudit: { enabled: true, scan }`."
        };
    } else if (enabled && !connectionString) {
        status = {
            enabled: false,
            reason:
                "The scheduled RLS audit is enabled but no connection string is available. " +
                "Set DATABASE_URL, or pass `rlsAudit.connectionString`."
        };
    }

    const runnable = enabled && !!connectionString && !!config.scan;

    const run = async (): Promise<void> => {
        if (!runnable) return;
        try {
            const result = await config.scan!({
                connectionString: connectionString!,
                schemas: config.schemas,
                statementTimeoutMs: config.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS
            });

            const { level, message } = summarize(result, warnAt);
            logger[level](`[rls-audit] ${message}`);

            status = { enabled: true, lastRunAt: result.scannedAt, result };
        } catch (err) {
            const detail = err instanceof Error ? err.message : String(err);
            // Reported, never thrown: a failed audit is a failed audit. Taking
            // the process down over one would make a security *check* into an
            // availability risk, which is a bad trade in both directions.
            logger.error(`[rls-audit] Scan failed: ${detail}`);
            status = { ...status, enabled: true, lastRunAt: new Date().toISOString(), lastError: detail };
        }
    };

    return {
        start() {
            if (!runnable) {
                if (status.reason) logger.warn(`[rls-audit] ${status.reason}`);
                return;
            }
            if (timer) return;

            // `unref` so a scheduled audit never holds the process open. A
            // server that would otherwise have exited should exit.
            timer = setInterval(() => { void run(); }, intervalMs);
            timer.unref?.();

            if (config.runOnBoot !== false) {
                // Not awaited: boot does not wait on an audit, and a slow
                // introspection would delay the first request for no reason.
                void run();
            }
        },
        stop() {
            if (timer) clearInterval(timer);
            timer = undefined;
        },
        runNow: run,
        status: () => status
    };
}
