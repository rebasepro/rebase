import chalk from "chalk";
import { outWarn, outError } from "./cli-output";
import { extractCauseMessage } from "./utils/pg-error-utils";

/**
 * Detect whether an error (or AggregateError wrapping multiple attempts)
 * represents an ECONNREFUSED — i.e. the database is simply not running.
 *
 * Handles:
 * - Direct `{ code: "ECONNREFUSED" }` errors from Node `net`
 * - `AggregateError` from dual-stack IPv4+IPv6 connection attempts
 * - Drizzle's `cause`-wrapped pg errors
 */
export function isEconnrefused(err: unknown): boolean {
    if (!err || typeof err !== "object") return false;
    const e = err as { code?: string; cause?: unknown; errors?: unknown[] };
    if (e.code === "ECONNREFUSED") return true;
    // AggregateError from Node net (dual-stack IPv4 + IPv6)
    if (Array.isArray(e.errors)) {
        return e.errors.some(inner =>
            inner && typeof inner === "object" && (inner as { code?: string }).code === "ECONNREFUSED"
        );
    }
    // Drizzle wraps the pg error in `cause`
    if (e.cause && typeof e.cause === "object") {
        return isEconnrefused(e.cause);
    }
    return false;
}

/**
 * Detect PostgreSQL authentication failures.
 * PG error codes: 28P01 (invalid_password), 28000 (invalid_authorization_specification)
 */
export function isAuthFailure(err: unknown): boolean {
    if (!err || typeof err !== "object") return false;
    const e = err as { code?: string; cause?: unknown };
    if (e.code === "28P01" || e.code === "28000") return true;
    if (e.cause && typeof e.cause === "object") {
        return isAuthFailure(e.cause);
    }
    // Also check the message for common pg auth failure text
    if ("message" in e && typeof (e as { message?: string }).message === "string") {
        const msg = (e as { message: string }).message.toLowerCase();
        if (msg.includes("password authentication failed") || msg.includes("no pg_hba.conf entry")) {
            return true;
        }
    }
    return false;
}

/**
 * Detect the "SSL is not enabled on the server" failure — the client attempted
 * an SSL handshake against a Postgres server that doesn't support it (common
 * with a plain local dev database). The fix is `?sslmode=disable` on the URL.
 */
export function isSslNotEnabled(err: unknown): boolean {
    if (!err || typeof err !== "object") return false;
    const e = err as { message?: string; cause?: unknown };
    if (typeof e.message === "string" && e.message.toLowerCase().includes("ssl is not enabled on the server")) {
        return true;
    }
    if (e.cause && typeof e.cause === "object") {
        return isSslNotEnabled(e.cause);
    }
    return false;
}

/**
 * Detect PostgreSQL "cannot drop ... because other objects depend on it"
 * (error code 2BP01, dependent_objects_still_exist). This is the failure that
 * strands a declarative `db push` half-applied when a collection is removed but
 * an enum type it defined is still referenced by another object.
 */
export function isDependencyDropError(err: unknown): boolean {
    if (!err || typeof err !== "object") return false;
    const e = err as { code?: string; message?: string; cause?: unknown };
    if (e.code === "2BP01") return true;
    if (typeof e.message === "string") {
        const msg = e.message.toLowerCase();
        if (msg.includes("other objects depend on it") || msg.includes("cannot drop type")) {
            return true;
        }
    }
    if (e.cause && typeof e.cause === "object") {
        return isDependencyDropError(e.cause);
    }
    return false;
}

/**
 * Parse host:port from a DATABASE_URL for display purposes.
 *
 * Exported because every message about a connection has to name the thing it
 * could not reach, and the boot path needs the same rendering the CLI banners
 * use — including the same refusal to print the URL itself, which carries the
 * password.
 */
export function parseHostInfo(databaseUrl: string): string {
    try {
        const parsed = new URL(databaseUrl);
        return `${parsed.hostname}:${parsed.port || 5432}`;
    } catch {
        return "unknown";
    }
}

/**
 * The sentence the operating system actually produced, dug out of the wrappers.
 *
 * `connect ECONNREFUSED 127.0.0.1:5432` is written by `net`, then wrapped by
 * `pg`, then wrapped again by Drizzle as `Failed query: …` — and on a
 * dual-stack host it is not in `.cause` at all but inside the
 * `AggregateError.errors` array of one attempt per resolved address. Printing
 * the banner without it loses the one token every search engine, runbook and
 * colleague recognises.
 */
export function deepestErrorMessage(err: unknown): string | null {
    if (!err || typeof err !== "object") return null;
    const e = err as { message?: string; code?: string; cause?: unknown; errors?: unknown[] };

    if (Array.isArray(e.errors)) {
        for (const inner of e.errors) {
            const deeper = deepestErrorMessage(inner);
            if (deeper) return deeper;
        }
    }
    if (e.cause) {
        const deeper = deepestErrorMessage(e.cause);
        if (deeper) return deeper;
    }
    if (typeof e.message === "string" && e.message && !e.message.startsWith("Failed query:")) {
        return e.code ? `${e.message} (${e.code})` : e.message;
    }
    return null;
}

/** One indented line naming the driver's own reason, or nothing. */
function driverReasonLine(err: unknown): string {
    const reason = err === undefined ? null : deepestErrorMessage(err);
    return reason ? `  The driver said: ${reason}\n\n` : "";
}

/**
 * Format a diagnostic banner for ECONNREFUSED errors.
 */
function formatConnectionRefusedBanner(databaseUrl: string, err?: unknown): string {
    const hostInfo = parseHostInfo(databaseUrl);
    return (
        `\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `  ❌  Cannot connect to PostgreSQL at ${hostInfo}\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `\n` +
        driverReasonLine(err) +
        `  The database server is not running or is not accepting\n` +
        `  connections. Common fixes:\n` +
        `\n` +
        `    • docker compose up -d db          (the service a Rebase scaffold ships)\n` +
        `    • brew services start postgresql@18\n` +
        `    • Verify DATABASE_URL in your .env file\n` +
        `\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`
    );
}

/**
 * Format a diagnostic banner for authentication failures.
 */
function formatAuthFailureBanner(databaseUrl: string, err?: unknown): string {
    const hostInfo = parseHostInfo(databaseUrl);
    let username = "unknown";
    try {
        username = new URL(databaseUrl).username || "unknown";
    } catch { /* ignore */ }

    return (
        `\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `  ❌  Authentication failed for user "${username}" at ${hostInfo}\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `\n` +
        driverReasonLine(err) +
        `  PostgreSQL rejected the credentials. Common fixes:\n` +
        `\n` +
        `    • Check the username and password in DATABASE_URL\n` +
        `    • Verify the user exists:  psql -c "\\du"\n` +
        `    • Reset the password:  ALTER USER ${username} PASSWORD 'new_password';\n` +
        `\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`
    );
}

/**
 * Format a diagnostic banner for "SSL is not enabled on the server".
 */
function formatSslNotEnabledBanner(databaseUrl: string): string {
    const hostInfo = parseHostInfo(databaseUrl);
    const suggestion = databaseUrl.includes("?") ? "&sslmode=disable" : "?sslmode=disable";
    return (
        `\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `  ❌  SSL is not enabled on the PostgreSQL server at ${hostInfo}\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `\n` +
        `  The client tried to connect over SSL, but the server does not\n` +
        `  support it. This is normal for a plain local dev database.\n` +
        `\n` +
        `  Fix: append ${chalk.bold("sslmode=disable")} to DATABASE_URL, e.g.\n` +
        `\n` +
        `    DATABASE_URL=...${suggestion}\n` +
        `\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`
    );
}

/**
 * Format a diagnostic banner for a dependency-drop failure during `db push`.
 * Explains that the database may be left partially migrated and how to recover.
 */
function formatDependencyDropBanner(): string {
    return (
        `\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `  ❌  Schema push failed: a type/table could not be dropped\n` +
        `      because other objects still depend on it.\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `\n` +
        `  ${chalk.yellow("The database may now be partially migrated.")} Atlas applies\n` +
        `  statements individually, so earlier changes in this push may\n` +
        `  already be committed while later ones failed.\n` +
        `\n` +
        `  This commonly happens when a collection is removed but an enum\n` +
        `  type it defined is still referenced. To recover:\n` +
        `\n` +
        `    1. Inspect the leftover object named in the error above.\n` +
        `    2. Drop it with CASCADE, e.g.:\n` +
        `         psql "$DATABASE_URL" -c 'DROP TYPE "<name>" CASCADE;'\n` +
        `    3. Re-run:  ${chalk.bold.green("rebase db push")}\n` +
        `\n` +
        `  Prefer a safe, versioned workflow? Use ${chalk.bold("rebase db generate")}\n` +
        `  + ${chalk.bold("rebase db migrate")} instead of push for destructive changes.\n` +
        `\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`
    );
}

/**
 * Pre-flight check: verify that the database is reachable before running
 * a heavy subprocess (Atlas, migrations, etc.).
 *
 * Exits with code 1 and a friendly banner on known failure modes.
 * On unknown errors, logs a warning and allows the caller to proceed.
 */
export async function checkDatabaseConnectivity(databaseUrl: string): Promise<void> {
    let client: import("pg").Client | undefined;
    try {
        const { Client } = await import("pg");
        client = new Client({
            connectionString: databaseUrl,
            connectionTimeoutMillis: 5000
        });
        await client.connect();
        await client.query("SELECT 1");
    } catch (err: unknown) {
        if (isEconnrefused(err)) {
            outError(formatConnectionRefusedBanner(databaseUrl, err));
            process.exit(1);
        }
        if (isAuthFailure(err)) {
            outError(formatAuthFailureBanner(databaseUrl, err));
            process.exit(1);
        }
        if (isSslNotEnabled(err)) {
            outError(formatSslNotEnabledBanner(databaseUrl));
            process.exit(1);
        }
        // Unknown error — warn but don't block; let the downstream tool surface details
        outWarn(chalk.yellow(`  ⚠  Could not verify database connectivity: ${err instanceof Error ? err.message : String(err)}`));
        outWarn(chalk.gray("    Proceeding anyway — the command may fail if the database is unreachable."));
    } finally {
        try {
            await client?.end();
        } catch {
            // ignore cleanup errors
        }
    }
}

/**
 * Post-hoc error diagnosis for direct database operations (e.g. applyPolicies).
 * Returns a formatted diagnostic string if the error matches a known pattern,
 * or null if unrecognized.
 */
export function diagnoseDbError(err: unknown, databaseUrl?: string): string | null {
    if (isEconnrefused(err)) {
        return formatConnectionRefusedBanner(databaseUrl || "", err);
    }
    if (isAuthFailure(err)) {
        return formatAuthFailureBanner(databaseUrl || "", err);
    }
    if (isSslNotEnabled(err)) {
        return formatSslNotEnabledBanner(databaseUrl || "");
    }
    if (isDependencyDropError(err)) {
        return formatDependencyDropBanner();
    }
    return null;
}

/**
 * Say why the command failed, on the way out.
 *
 * The entry point below used to be `.catch(() => process.exit(1))`, which threw
 * the error away. Every message this file and its services raise — "Branch
 * \"x\" already exists.", "the source database has active connections", "Branch
 * name is too long" — was written, wrapped in the right PG error code, and then
 * discarded one frame before it reached a terminal. What a developer saw was a
 * header line, no error, and exit 1.
 *
 * Two shapes are deliberately kept quiet:
 *
 * - **A child process that already spoke.** Atlas, `pg_dump` and `psql` run
 *   with inherited stdio, so their diagnosis is on the terminal already and
 *   execa's wrapper adds only `Command failed with exit code 1: atlas …`.
 *   `packages/cli` filters exactly these two phrasings one level up
 *   (`runDbCommand`), and this is that filter, for the process that is actually
 *   throwing.
 *
 * - **A message that is only a query.** Drizzle reports failures as
 *   `Failed query: <sql> params:` and hides the real PostgreSQL error in
 *   `cause`, so the wrapper alone tells a reader nothing they can act on. The
 *   cause is appended when it says something the message does not.
 */
export function reportCommandFailure(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error ?? "");

    if (!message || /Command failed|exited with code/i.test(message)) return;

    outError("");
    outError(chalk.red(`  ✗ ${message}`));

    const cause = extractCauseMessage(error);
    if (cause && !message.includes(cause)) {
        outError(chalk.gray(`    ${cause}`));
    }
    outError("");
}
