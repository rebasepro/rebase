import chalk from "chalk";
import { outWarn, outError } from "./cli-output";

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
            outError(formatConnectionRefusedBanner(databaseUrl));
            process.exit(1);
        }
        if (isAuthFailure(err)) {
            outError(formatAuthFailureBanner(databaseUrl));
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
        return formatConnectionRefusedBanner(databaseUrl || "");
    }
    if (isAuthFailure(err)) {
        return formatAuthFailureBanner(databaseUrl || "");
    }
    if (isSslNotEnabled(err)) {
        return formatSslNotEnabledBanner(databaseUrl || "");
    }
    if (isDependencyDropError(err)) {
        return formatDependencyDropBanner();
    }
    return null;
}
