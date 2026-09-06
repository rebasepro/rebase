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
 *
 * - **An error that has already printed its own diagnosis**, marked
 *   `alreadyReported`. `CollectionsPathMissing` is one: it prints the path, what
 *   it resolved to and the cwd it resolved against, and then throws so the entry
 *   point owns the exit code. Repeating its one-line summary underneath would
 *   undo the "printed once" this whole path exists for.
 */
export function reportCommandFailure(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error ?? "");

    if ((error as { alreadyReported?: boolean } | null)?.alreadyReported) return;
    if (!message || /Command failed|exited with code/i.test(message)) return;

    outError("");
    outError(chalk.red(`  ✗ ${message}`));

    const cause = extractCauseMessage(error);
    if (cause && !message.includes(cause)) {
        outError(chalk.gray(`    ${cause}`));
    }
    outError("");
}

/* ------------------------------------------------------------------------- *
 * Atlas failures that have a remedy
 *
 * Atlas runs with a teed stderr, so what reaches these is its output as text,
 * not a `pg` error object carrying a `code`. They are deliberately NOT part of
 * `diagnoseDbError`: that one is shared with the boot path, and "record a
 * baseline with `rebase db migrate`" is advice for somebody standing at a
 * terminal, not for a container that has just failed to start.
 * ------------------------------------------------------------------------- */

/**
 * `migrate apply` refusing because the database already has the schema.
 *
 * `42710` (duplicate_object) and `42P07` (duplicate_table) are what a migration
 * hits when boot-ensure — or a `db push` — has already provisioned the objects
 * it was going to create. Since boot-ensure provisions *every* production
 * database, this is the normal case rather than the exotic one, and the raw
 * failure (`pq: type "posts_status" already exists (42710)`, then `sql/migrate:
 * write revision: … current transaction is aborted`) names no way forward.
 */
export function parseAlreadyProvisioned(text: string): { object: string; code: string } | null {
    const withCode = /(?:type|relation|constraint|schema) "([^"]+)" already exists \((42710|42P07)\)/.exec(text);
    if (withCode) return { object: withCode[1], code: withCode[2] };
    // Some Atlas builds keep the SQLSTATE on a following line instead.
    const bare = /(?:type|relation|constraint|schema) "([^"]+)" already exists/.exec(text);
    if (bare && /42710|42P07/.test(text)) return { object: bare[1], code: /42P07/.test(text) ? "42P07" : "42710" };
    return null;
}

/**
 * What to do about it: tell Atlas the database is already at a version.
 *
 * Atlas's own mechanism (`migrate apply --baseline <version>`), not a ledger of
 * ours — it writes the revision row Atlas reads, so every later `rebase db
 * migrate` is an ordinary one.
 */
export function formatBaselineRemedy(version: string | null, object?: string): string {
    const versionToken = version ?? "<version>";
    return (
        `\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `  ❌  This database already has the schema this migration creates\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `\n` +
        (object ? `  ${chalk.gray(`"${object}" is already there, so the migration cannot create it.`)}\n\n` : "") +
        `  Nothing is wrong with the migration — the database was provisioned\n` +
        `  another way. Every Rebase boot ensures the schema, and ${chalk.bold("rebase db push")}\n` +
        `  applies it directly, so a database that has ever run either one is\n` +
        `  ahead of a migration history that was never recorded.\n` +
        `\n` +
        `  Record where it already is, then migrate normally:\n` +
        `\n` +
        `    ${chalk.bold.green(`rebase db migrate --baseline ${versionToken}`)}\n` +
        `    ${chalk.bold.green("rebase db migrate")}\n` +
        `\n` +
        `  The baseline is the version already applied — the numeric prefix of\n` +
        `  the migration file describing what is in the database now. Migrations\n` +
        `  after it run; it and everything before it are marked done.\n` +
        `\n` +
        `  On a database nothing has ever booted against, none of this is needed.\n` +
        `\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`
    );
}

/** `ALTER TABLE … SET NOT NULL` on a table that already holds rows (23502). */
export function parseNotNullViolation(text: string): { table: string; column: string } | null {
    const match = /column "([^"]+)" of relation "([^"]+)" contains null values/.exec(text);
    return match ? { table: match[2], column: match[1] } : null;
}

/**
 * The three ways out, because there is no fourth.
 *
 * Boot-ensure handles this case — it adds the column nullable and sets NOT NULL
 * only when the table is empty — so a push that dies here is strictly worse
 * than the boot that would have run instead, and the developer deserves to be
 * told which of the three they want rather than left with `pq: … contains null
 * values (23502)` and no next step.
 */
export function formatNotNullViolationBanner(
    violation: { table: string; column: string },
    rowCount: number | null
): string {
    const { table, column } = violation;
    const rows = rowCount === null
        ? `  "${table}" already holds rows, and none of them has a value for "${column}".\n`
        : `  "${table}" already holds ${rowCount} row${rowCount === 1 ? "" : "s"}, and they have no value for "${column}".\n`;
    return (
        `\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `  ❌  Cannot make "${table}"."${column}" required: existing rows are null\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `\n` +
        rows +
        `  PostgreSQL will not add the NOT NULL until every one of them does.\n` +
        `\n` +
        `  Three ways forward:\n` +
        `\n` +
        `    1. Give the property a default, so the push can backfill:\n` +
        `         ${chalk.gray(`{ type: "string", defaultValue: "…", validation: { required: true } }`)}\n` +
        `    2. Backfill by hand first, then push again:\n` +
        `         ${chalk.gray(`psql "$DATABASE_URL" -c 'UPDATE "${table}" SET "${column}" = … WHERE "${column}" IS NULL;'`)}\n` +
        `    3. Leave it optional — take \`validation.required\` off the property.\n` +
        `\n` +
        `  ${chalk.gray("Nothing was applied for this column. `rebase dev` would have added it")}\n` +
        `  ${chalk.gray("nullable instead: boot sets NOT NULL only when it is safe.")}\n` +
        `\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`
    );
}

/** Atlas refusing to remove a label from an enum — a renamed `enum` option id. */
export function parseEnumLabelDrop(text: string): { label: string; enumType: string } | null {
    const match = /dropping (?:enum )?value "([^"]+)" from enum "([^"]+)" is not supported/.exec(text);
    return match ? { label: match[1], enumType: match[2] } : null;
}

/**
 * Why the two paths disagree, and what retiring an option id actually costs.
 *
 * Boot-ensure adds enum labels and never removes one, so `rebase dev` accepts
 * the very edit that stops `db push` dead. PostgreSQL has no `ALTER TYPE …
 * DROP VALUE`: a label goes only by rewriting the type, which is a data
 * migration and not a schema push.
 */
export function formatEnumLabelDropBanner(drop: { label: string; enumType: string }): string {
    const { label, enumType } = drop;
    return (
        `\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `  ❌  "${label}" cannot be removed from the enum "${enumType}"\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `\n` +
        `  PostgreSQL has no ALTER TYPE … DROP VALUE. An option id can be added\n` +
        `  to an enum but never taken out of one, so renaming an id reads as a\n` +
        `  removal and a push cannot carry it.\n` +
        `\n` +
        `  ${chalk.yellow("Nothing was applied.")} ${chalk.bold("rebase dev")} accepts this same edit — boot adds\n` +
        `  new labels and never removes one — so the two paths disagree by\n` +
        `  design, and the old label would simply have stayed behind, unused.\n` +
        `\n` +
        `  To keep the id: put "${label}" back and change only its label text.\n` +
        `\n` +
        `  To retire it for real, it is a data migration:\n` +
        `\n` +
        `    1. Add the new id alongside the old one, and push.\n` +
        `    2. Move the rows:  ${chalk.gray(`UPDATE … SET … = '<new>' WHERE … = '${label}';`)}\n` +
        `    3. Rewrite the type, which is what actually drops the label:\n` +
        `       ${chalk.gray("rebase db generate retire_option && rebase db migrate")}\n` +
        `       ${chalk.gray("(a migration can CREATE TYPE …, ALTER TABLE … TYPE … USING, DROP TYPE)")}\n` +
        `\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`
    );
}

/** How many rows a table holds, or `null` when we cannot say. */
async function countRows(databaseUrl: string | undefined, table: string): Promise<number | null> {
    if (!databaseUrl) return null;
    try {
        const { Client } = await import("pg");
        const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
        await client.connect();
        try {
            // Identifier interpolation, and it has to be: the name comes from
            // PostgreSQL's own error text, and `count(*)` takes no parameter in
            // that position. Quoted, with any embedded quote doubled.
            const res = await client.query(`SELECT count(*)::int AS n FROM "${table.replace(/"/g, "\"\"")}"`);
            return (res.rows[0] as { n: number } | undefined)?.n ?? null;
        } finally {
            await client.end();
        }
    } catch {
        return null;
    }
}

/**
 * The remedy for an Atlas invocation that failed, or `null`.
 *
 * Scoped by the invocation, because the same database state means different
 * things to different subcommands: "already exists" under `migrate apply` wants
 * a baseline, while under `schema apply` it is a genuine conflict.
 */
export async function diagnoseAtlasFailure(context: {
    domain: string;
    args: string[];
    stderr: string;
    databaseUrl?: string;
    /** The newest migration version on disk, named in the baseline remedy. */
    latestMigrationVersion?: string | null;
}): Promise<string | null> {
    const { domain, args, stderr, databaseUrl } = context;

    if (domain === "migrate" && args.includes("apply")) {
        const provisioned = parseAlreadyProvisioned(stderr);
        if (provisioned) {
            return formatBaselineRemedy(context.latestMigrationVersion ?? null, provisioned.object);
        }
    }

    if (domain === "schema" && args.includes("apply")) {
        const enumDrop = parseEnumLabelDrop(stderr);
        if (enumDrop) return formatEnumLabelDropBanner(enumDrop);

        const notNull = parseNotNullViolation(stderr);
        if (notNull) return formatNotNullViolationBanner(notNull, await countRows(databaseUrl, notNull.table));
    }

    return null;
}
