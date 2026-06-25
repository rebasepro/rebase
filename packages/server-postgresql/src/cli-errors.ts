import chalk from "chalk";
import { logger } from "@rebasepro/server-core";

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
 * Parse host:port from a DATABASE_URL for display purposes.
 */
function parseHostInfo(databaseUrl: string): string {
    try {
        const parsed = new URL(databaseUrl);
        return `${parsed.hostname}:${parsed.port || 5432}`;
    } catch {
        return "unknown";
    }
}

/**
 * Format a diagnostic banner for ECONNREFUSED errors.
 */
function formatConnectionRefusedBanner(databaseUrl: string): string {
    const hostInfo = parseHostInfo(databaseUrl);
    return (
        `\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `  ❌  Cannot connect to PostgreSQL at ${hostInfo}\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `\n` +
        `  The database server is not running or is not accepting\n` +
        `  connections. Common fixes:\n` +
        `\n` +
        `    • brew services start postgresql@18\n` +
        `    • docker compose up -d postgres\n` +
        `    • Verify DATABASE_URL in your .env file\n` +
        `\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`
    );
}

/**
 * Format a diagnostic banner for authentication failures.
 */
function formatAuthFailureBanner(databaseUrl: string): string {
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
            logger.error(formatConnectionRefusedBanner(databaseUrl));
            process.exit(1);
        }
        if (isAuthFailure(err)) {
            logger.error(formatAuthFailureBanner(databaseUrl));
            process.exit(1);
        }
        // Unknown error — warn but don't block; let the downstream tool surface details
        logger.warn(chalk.yellow(`  ⚠  Could not verify database connectivity: ${err instanceof Error ? err.message : String(err)}`));
        logger.warn(chalk.gray("    Proceeding anyway — the command may fail if the database is unreachable."));
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
        return formatConnectionRefusedBanner(databaseUrl || "");
    }
    if (isAuthFailure(err)) {
        return formatAuthFailureBanner(databaseUrl || "");
    }
    return null;
}
