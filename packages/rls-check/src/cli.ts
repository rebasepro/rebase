/**
 * The command line: argument parsing, connection resolution, error translation
 * and exit codes. Everything a stranger's first thirty seconds with this tool
 * touches.
 *
 * Three invariants, in order of importance:
 *
 * 1. {@link runCli} never throws and never calls `process.exit`. `bin/rls-check.js`
 *    assigns its return value to `process.exitCode`, so an escaping exception
 *    would surface as a stack trace and exit code 1 — which CI would read as
 *    "findings", not "broken".
 *
 * 2. Exit 1 and exit 2 are never conflated. 1 means the database has a problem;
 *    2 means the scan did not happen. A pipeline that treats a DNS failure as a
 *    clean bill of health is worse than no tool at all.
 *
 * 3. The connection string never reaches an output stream. Every string that
 *    could have come from `pg`, Node or the user goes through `redactSecrets`
 *    on its way out.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { CHECKS, runChecks } from "./checks";
import { introspectWithDiagnostics, UnknownRoleError, unsupportedConnectionKeywords } from "./introspect";
import { formatEndpoint, isLoopbackEndpoint, parseConnectionString, redactSecrets } from "./redact";
import { exceedsThreshold, renderCheckCatalog, renderJson, renderReport } from "./report";
import { renderHtml } from "./report-html";
import type { DbSnapshot, Finding, ScanResult, Severity } from "./types";
import { SEVERITIES } from "./types";

/** Clean, or nothing at or above `--fail-on`. */
export const EXIT_OK = 0;
/** Findings at or above `--fail-on`. */
export const EXIT_FINDINGS = 1;
/** The scan did not happen: bad arguments, bad connection, timeout. */
export const EXIT_ERROR = 2;

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_FAIL_ON: Severity = "high";

const TABLE_KINDS = new Set(["table", "partitioned_table"]);

// ---------------------------------------------------------------------------
// Programmatic API
// ---------------------------------------------------------------------------

export interface ScanOptions {
    connectionString: string;
    /** Restrict to these schemas. Empty or omitted means "every user schema". */
    schemas?: string[];
    /**
     * Additional roles an untrusted caller can arrive as, on top of the names
     * this tool recognises. Needed by any stack whose app role is not called
     * `anon`, `authenticated`, `web_anon` or `rebase_user`.
     */
    roles?: string[];
    /** Run only these check ids. */
    only?: string[];
    /** Skip these check ids. */
    skip?: string[];
    statementTimeoutMs?: number;
    /** Injectable so callers (and tests) control the `scannedAt` stamp. */
    now?: Date;
}

/**
 * Connect, introspect, run the checks, and assemble a {@link ScanResult}.
 *
 * The one impure step in the pipeline. Everything downstream of `introspect`
 * is a pure function of the snapshot, which is why the checks have unit tests
 * and this has an integration test.
 */
export async function scan(options: ScanOptions): Promise<ScanResult> {
    // `introspectWithDiagnostics`, not `introspect`: the latter drops the record
    // of what could not be read, and a check whose inputs went missing returns
    // no findings — which is indistinguishable from a clean table.
    const { snapshot, diagnostics } = await introspectWithDiagnostics({
        connectionString: options.connectionString,
        schemas: options.schemas && options.schemas.length > 0 ? options.schemas : undefined,
        roles: options.roles && options.roles.length > 0 ? options.roles : undefined,
        statementTimeoutMs: options.statementTimeoutMs ?? DEFAULT_TIMEOUT_MS
    });

    const findings = runChecks(snapshot, { only: options.only, skip: options.skip });

    return buildScanResult(snapshot, findings, {
        connectionString: options.connectionString,
        checksRun: selectCheckIds(options).length,
        scannedAt: (options.now ?? new Date()).toISOString(),
        diagnostics
    });
}

/**
 * The check ids `runChecks` will actually execute for these options.
 *
 * Recomputed here rather than reported back by `runChecks`, because
 * {@link ScanResult.stats} needs the count and the contract has no channel for
 * it. Same filter, same order, so the number in the report is the number that
 * ran — as long as `runChecks` keeps `only` as a whitelist and `skip` as a
 * blacklist applied after it.
 */
export function selectCheckIds(options: { only?: string[]; skip?: string[] }): string[] {
    const skip = new Set(options.skip ?? []);
    const only = options.only && options.only.length > 0 ? new Set(options.only) : null;

    return CHECKS.filter((check) => (only === null || only.has(check.id)) && !skip.has(check.id)).map(
        (check) => check.id
    );
}

/**
 * The verdict, as an exit code.
 *
 * Pulled out of `runCli` so it can be tested: `runCli` needs a database, and
 * the one line that decides whether CI goes red had no coverage at all —
 * deleting it broke no test.
 *
 * A degraded scan exits 2, the same code a crash uses, rather than 0. Checks
 * whose catalogue reads failed return no findings, which is indistinguishable
 * from finding none, so exiting 0 would have the scanner answer "no problems"
 * to a question it never managed to ask. Both codes mean the same thing here:
 * no verdict.
 */
export function exitCodeFor(result: ScanResult, failOn: Severity | "none"): number {
    if (result.diagnostics.degraded.length > 0) return EXIT_ERROR;
    return exceedsThreshold(result.findings, failOn) ? EXIT_FINDINGS : EXIT_OK;
}

function buildScanResult(
    snapshot: DbSnapshot,
    findings: Finding[],
    meta: {
        connectionString: string;
        checksRun: number;
        scannedAt: string;
        diagnostics: ScanResult["diagnostics"];
    }
): ScanResult {
    const target = parseConnectionString(meta.connectionString);
    const tables = snapshot.relations.filter((relation) => TABLE_KINDS.has(relation.kind));

    return {
        scannedAt: meta.scannedAt,
        // Host and database only — never the user, password or full URL.
        database: {
            host: target?.host ?? "unknown",
            name: target?.database && target.database.length > 0 ? target.database : "unknown"
        },
        serverVersion: snapshot.serverVersion,
        platform: snapshot.platform,
        scannerIsPrivileged: snapshot.scannerIsPrivileged,
        exposedRoles: snapshot.exposedRoles,
        stats: {
            schemas: snapshot.schemas.length,
            tables: tables.length,
            policies: snapshot.policies.length,
            tablesWithoutRls: tables.filter((relation) => !relation.rlsEnabled).length,
            checksRun: meta.checksRun
        },
        findings,
        diagnostics: meta.diagnostics
    };
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

export interface CliOptions {
    connectionString: string | null;
    json: boolean;
    /**
     * `--html <path>`: also write a self-contained HTML report there.
     *
     * "Also", not "instead": the terminal output is what a CI log keeps, and
     * the file is what gets forwarded to whoever owns the database. Making the
     * flag replace stdout would trade one audience for the other.
     */
    html: string | null;
    schemas: string[];
    /** Extra roles to treat as reachable by an untrusted caller. */
    roles: string[];
    failOn: Severity | "none";
    skip: string[];
    only: string[];
    listChecks: boolean;
    /** `null` = decide from NO_COLOR / TTY. */
    color: boolean | null;
    quiet: boolean;
    timeoutMs: number;
    help: boolean;
    version: boolean;
}

export type ParseResult = { ok: true; options: CliOptions } | { ok: false; message: string };

const FAIL_ON_VALUES = [...SEVERITIES, "none"] as const;

function emptyOptions(): CliOptions {
    return {
        connectionString: null,
        json: false,
        html: null,
        schemas: [],
        roles: [],
        failOn: DEFAULT_FAIL_ON,
        skip: [],
        only: [],
        listChecks: false,
        color: null,
        quiet: false,
        timeoutMs: DEFAULT_TIMEOUT_MS,
        help: false,
        version: false
    };
}

/** `--schema a,b --schema c` and `--schema a --schema b` mean the same thing. */
function splitList(value: string): string[] {
    return value
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
}

export function parseArgs(argv: readonly string[]): ParseResult {
    const options = emptyOptions();
    let positionals = 0;

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];

        // Everything after `--` is positional, so a connection string that
        // somehow starts with a dash still works.
        if (arg === "--") {
            for (const rest of argv.slice(index + 1)) {
                positionals += 1;
                // Never echo the value: the extra argument is usually a second
                // connection string, and this message goes to a terminal.
                if (positionals > 1) {
                    return { ok: false, message: "Unexpected extra argument. Only one connection string is accepted." };
                }
                options.connectionString = rest;
            }
            break;
        }

        if (!arg.startsWith("-")) {
            positionals += 1;
            if (positionals > 1) {
                return {
                    ok: false,
                    message: `Unexpected extra argument. Only one connection string is accepted; quote it if it contains a "?" or "&".`
                };
            }
            options.connectionString = arg;
            continue;
        }

        // --flag=value and --flag value are both accepted.
        const eq = arg.indexOf("=");
        const flag = eq === -1 ? arg : arg.slice(0, eq);
        const inlineValue = eq === -1 ? null : arg.slice(eq + 1);

        const takeValue = (): string | null => {
            if (inlineValue !== null) return inlineValue;
            const next = argv[index + 1];
            if (next === undefined || (next.startsWith("-") && next.length > 1)) return null;
            index += 1;

            return next;
        };

        switch (flag) {
            case "-h":
            case "--help":
                options.help = true;
                break;
            case "-v":
            case "--version":
                options.version = true;
                break;
            case "--json":
                options.json = true;
                break;
            case "--quiet":
            case "-q":
                options.quiet = true;
                break;
            case "--list-checks":
                options.listChecks = true;
                break;
            case "--no-color":
            case "--no-colour":
                options.color = false;
                break;
            case "--color":
            case "--colour":
                options.color = true;
                break;
            case "--html": {
                const value = takeValue();
                if (value === null) {
                    return { ok: false, message: "--html needs a file path, e.g. --html rls-report.html." };
                }
                options.html = value;
                break;
            }
            case "--schema": {
                const value = takeValue();
                if (value === null) return { ok: false, message: "--schema needs a schema name." };
                options.schemas.push(...splitList(value));
                break;
            }
            case "--role": {
                const value = takeValue();
                if (value === null) {
                    return { ok: false, message: "--role needs a role name, e.g. --role app_user." };
                }
                options.roles.push(...splitList(value));
                break;
            }
            case "--skip": {
                const value = takeValue();
                if (value === null) return { ok: false, message: "--skip needs a check id. See --list-checks." };
                options.skip.push(...splitList(value));
                break;
            }
            case "--only": {
                const value = takeValue();
                if (value === null) return { ok: false, message: "--only needs a check id. See --list-checks." };
                options.only.push(...splitList(value));
                break;
            }
            case "--fail-on": {
                const value = takeValue();
                if (value === null) {
                    return { ok: false, message: `--fail-on needs one of: ${FAIL_ON_VALUES.join(", ")}.` };
                }
                const normalised = value.toLowerCase();
                if (!(FAIL_ON_VALUES as readonly string[]).includes(normalised)) {
                    return {
                        ok: false,
                        message: `--fail-on ${value} is not a severity. Use one of: ${FAIL_ON_VALUES.join(", ")}.`
                    };
                }
                options.failOn = normalised as Severity | "none";
                break;
            }
            case "--timeout": {
                const value = takeValue();
                if (value === null) return { ok: false, message: "--timeout needs a number of milliseconds." };
                const ms = Number(value);
                if (!Number.isFinite(ms) || ms <= 0) {
                    return { ok: false, message: `--timeout ${value} is not a positive number of milliseconds.` };
                }
                options.timeoutMs = Math.floor(ms);
                break;
            }
            default:
                return { ok: false, message: `Unknown option: ${flag}. Run --help for the full list.` };
        }
    }

    return { ok: true, options };
}

// ---------------------------------------------------------------------------
// Connection resolution
// ---------------------------------------------------------------------------

export interface ResolvedConnection {
    connectionString: string;
    /** Where it came from, for the "using DATABASE_URL from .env" line. */
    source: string;
}

/**
 * A three-line .env reader. Deliberately not `dotenv`: the whole promise of
 * this package is that `npx` installs `pg` and nothing else, and a transitive
 * dependency is a supply-chain surface on a tool people point at production.
 *
 * Handles what a Postgres URL actually needs: `export` prefixes, `#` comments,
 * and single or double quotes. It does not do variable interpolation.
 */
export function readDotEnv(directory: string): Map<string, string> {
    const values = new Map<string, string>();

    let raw: string;
    try {
        raw = readFileSync(join(directory, ".env"), "utf8");
    } catch {
        return values;
    }

    for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed.length === 0 || trimmed.startsWith("#")) continue;

        const body = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trim() : trimmed;
        const eq = body.indexOf("=");
        if (eq <= 0) continue;

        const key = body.slice(0, eq).trim();
        let value = body.slice(eq + 1).trim();

        const quoted =
            (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
        if (quoted && value.length >= 2) {
            value = value.slice(1, -1);
        } else {
            // An unquoted trailing comment. `#` inside a password is why this
            // only strips a `#` that follows whitespace.
            const comment = value.search(/\s#/);
            if (comment !== -1) value = value.slice(0, comment).trim();
        }

        if (key.length > 0) values.set(key, value);
    }

    return values;
}

export function resolveConnection(
    positional: string | null,
    env: NodeJS.ProcessEnv,
    cwd: string
): ResolvedConnection | null {
    if (positional && positional.trim().length > 0) {
        return { connectionString: positional.trim(), source: "the command line" };
    }

    if (env.DATABASE_URL && env.DATABASE_URL.trim().length > 0) {
        return { connectionString: env.DATABASE_URL.trim(), source: "$DATABASE_URL" };
    }

    if (env.POSTGRES_URL && env.POSTGRES_URL.trim().length > 0) {
        return { connectionString: env.POSTGRES_URL.trim(), source: "$POSTGRES_URL" };
    }

    const dotenv = readDotEnv(cwd);
    for (const key of ["DATABASE_URL", "POSTGRES_URL"]) {
        const value = dotenv.get(key);
        if (value && value.trim().length > 0) {
            return { connectionString: value.trim(), source: `${key} in .env` };
        }
    }

    return null;
}

// ---------------------------------------------------------------------------
// Error translation
// ---------------------------------------------------------------------------

export interface FriendlyError {
    headline: string;
    hint?: string;
    /** The driver's own words, redacted. Kept short — this is not a stack trace. */
    detail?: string;
}

/** `pg` sets `code` to either an errno string or a five-character SQLSTATE. */
function errorCode(error: unknown): string | undefined {
    let current: unknown = error;
    for (let depth = 0; depth < 5 && current !== null && current !== undefined; depth += 1) {
        const code = (current as { code?: unknown }).code;
        if (typeof code === "string" && code.length > 0) return code;
        current = (current as { cause?: unknown }).cause;
    }

    return undefined;
}

function errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;

    return String(error);
}

/**
 * Turn a driver failure into one sentence a human can act on.
 *
 * Deliberately covers the failures that account for nearly every first run:
 * wrong host, wrong password, wrong database, TLS, and a firewall that drops
 * rather than refuses. Anything unmapped still prints a redacted one-liner
 * rather than a stack trace.
 */
export function explainError(
    error: unknown,
    context: { endpoint: string; timeoutMs: number; connectionString?: string }
): FriendlyError {
    const code = errorCode(error);
    const raw = errorMessage(error);
    const message = redactSecrets(raw, context.connectionString).replace(/\s+/g, " ").trim();
    const detail = code ? `${code}: ${message}` : message;
    const at = context.endpoint;

    const friendly = (headline: string, hint?: string): FriendlyError => ({ headline, hint, detail });

    switch (code) {
        case "ECONNREFUSED":
            return friendly(
                `Nothing is accepting connections at ${at}.`,
                "Check the host and port, that the server is running, and that you are on the network it allows — a VPN, an SSH tunnel or an IP allowlist is the usual cause."
            );
        case "ENOTFOUND":
        case "EAI_AGAIN":
            return friendly(
                `The host in the connection string does not resolve (${at}).`,
                "Check it for a typo. A Supabase host looks like db.<project-ref>.supabase.co; a Neon host ends in .neon.tech."
            );
        case "ETIMEDOUT":
        case "ENETUNREACH":
        case "EHOSTUNREACH":
            return friendly(
                `Timed out reaching ${at}.`,
                "Packets are being dropped rather than refused, which almost always means a firewall or an IP allowlist. Add this machine's address to the database's allowed list."
            );
        case "ECONNRESET":
            // A loopback endpoint is a proxy or tunnel, never the database: it
            // accepted the TCP connection and then hung up because its own
            // upstream auth failed. sslmode cannot help — the proxy terminates
            // TLS itself — and the reason is only in the proxy's log.
            return isLoopbackEndpoint(at)
                ? friendly(
                      `A local proxy or tunnel on ${at} closed the connection before the handshake finished.`,
                      "Something is listening on that port and hung up — cloud-sql-proxy, an SSH -L forward or a local pooler. The real cause is in its log, not in your TLS mode."
                  )
                : friendly(
                      `${at} closed the connection before the handshake finished.`,
                      "Most often TLS. Try appending ?sslmode=require to the connection string; managed providers reject plaintext."
                  );
        case "EPROTO":
        case "DEPTH_ZERO_SELF_SIGNED_CERT":
        case "SELF_SIGNED_CERT_IN_CHAIN":
        case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
        case "ERR_TLS_CERT_ALTNAME_INVALID":
            return friendly(
                `The TLS certificate presented by ${at} could not be verified.`,
                "Append ?sslmode=no-verify to connect without verifying it, or point sslrootcert at your provider's CA bundle if you would rather keep verification on."
            );
        case "28P01":
            return friendly(
                `Password authentication failed on ${at}.`,
                "Check the password. If it contains / ? or #, it has to be percent-encoded inside a URL — that is the single most common cause of this error. An @ or a : needs no encoding: the userinfo is split at the last @ and the user at the first :."
            );
        case "28000":
            return friendly(
                `${at} refused the connection for this role.`,
                "Either the role does not exist, or pg_hba.conf has no rule matching this host, user and database combination."
            );
        case "3D000":
            return friendly(
                "That database does not exist on the server.",
                "The database name is the last path segment of the connection string. On Supabase it is usually `postgres`."
            );
        case "42501":
            return friendly(
                "The connected role is not allowed to read the catalogs this scan needs.",
                "Run it as the database owner or another role that can read pg_policies and pg_class. The scan itself only issues SELECTs."
            );
        case "53300":
            return friendly(
                `${at} has no connection slots left.`,
                "Retry when the pool frees up, or point the scan at a direct connection rather than a saturated pooler."
            );
        case "57014":
            return friendly(
                `A catalog query exceeded the ${context.timeoutMs}ms statement timeout.`,
                "Databases with tens of thousands of relations need longer: re-run with --timeout 60000."
            );
        case "08006":
        case "08001":
        case "08004":
            // Same trap as ECONNRESET above: on loopback there is no TLS mode
            // to get wrong, because the thing that refused you is a proxy.
            return isLoopbackEndpoint(at)
                ? friendly(
                      `Could not establish a connection through the local proxy or tunnel on ${at}.`,
                      "The port answered but the session never came up. That is the proxy's upstream failing, not your TLS mode — its log has the reason."
                  )
                : friendly(
                      `Could not establish a connection to ${at}.`,
                      "Check the host, port and TLS mode. Managed providers usually need ?sslmode=require."
                  );
        default:
            break;
    }

    if (/does not support SSL/i.test(raw)) {
        return friendly(
            `${at} is not configured for TLS.`,
            "Append ?sslmode=disable if this is a local database you trust the network path to."
        );
    }
    if (/self.signed certificate|certificate/i.test(raw) && /SSL|TLS|certificate/i.test(raw)) {
        return friendly(
            `The TLS certificate presented by ${at} could not be verified.`,
            "Append ?sslmode=no-verify, or point sslrootcert at your provider's CA bundle."
        );
    }
    if (/timeout/i.test(raw)) {
        return friendly(
            `Timed out talking to ${at}.`,
            `The scan uses a ${context.timeoutMs}ms statement timeout; raise it with --timeout <ms>, or check for a firewall dropping the connection.`
        );
    }
    if (/Connection terminated/i.test(raw)) {
        return friendly(
            `The connection to ${at} was closed unexpectedly.`,
            "A pooler or proxy in front of the database is the usual cause. Try a direct connection."
        );
    }

    return friendly(`The scan against ${at} failed.`);
}

// ---------------------------------------------------------------------------
// Presentation of operational failures
// ---------------------------------------------------------------------------

function formatFriendlyError(error: FriendlyError, color: boolean): string {
    const bold = (value: string): string => (color ? `\u001B[1m${value}\u001B[22m` : value);
    const dim = (value: string): string => (color ? `\u001B[2m${value}\u001B[22m` : value);
    const red = (value: string): string => (color ? `\u001B[31m${value}\u001B[39m` : value);

    const lines = [`${red("Error")}  ${bold(error.headline)}`];
    if (error.hint) lines.push(`       ${error.hint}`);
    if (error.detail) lines.push(`       ${dim(truncate(error.detail, 240))}`);

    return `${lines.join("\n")}\n`;
}

function truncate(value: string, max: number): string {
    return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

// ---------------------------------------------------------------------------
// Static text
// ---------------------------------------------------------------------------

function helpText(version: string): string {
    return `rls-check ${version} — audit Row-Level Security on any PostgreSQL database.

Usage
  DATABASE_URL="postgresql://user:pass@host:5432/db" npx @rebasepro/rls-check

The connection string is taken from, in order: the argument, $DATABASE_URL,
$POSTGRES_URL, then DATABASE_URL in a .env file in the current directory.

Prefer the environment. A connection string passed as an argument is echoed back
by npm before this program starts, and is written to your shell history — both
with the password in it, and neither is something rls-check can redact after the
fact. Its own output redacts the password everywhere.

Options
  --json                 Machine-readable ScanResult on stdout, and nothing else.
  --html <path>          Also write a self-contained HTML report to <path>. One file,
                         no network requests, safe to attach to a ticket.
  --schema <name>        Restrict the scan to a schema. Repeatable or comma-separated.
  --role <name>          Treat this role as one an untrusted caller arrives as, in
                         addition to anon, authenticated, web_anon and rebase_user.
                         Name the role your application connects as — the checks
                         only report a table as exposed when an exposed role can
                         reach it. Repeatable or comma-separated.
  --fail-on <severity>   Exit 1 at or above this severity: info, low, medium, high,
                         critical, or none to never fail. Default: high.
  --only <id>            Run only these checks. Repeatable or comma-separated.
  --skip <id>            Skip these checks. Repeatable or comma-separated.
  --list-checks          Print the check catalog and exit.
  --timeout <ms>         Statement timeout for each catalog query. Default: 15000.
  --quiet                Findings only: no banner, no summary.
  --no-color             Disable ANSI colour. NO_COLOR and a non-TTY stdout are
                         honoured automatically; --color forces it back on.
  -h, --help             Show this text.
  -v, --version          Print the version.

Exit codes
  0  Clean, or nothing at or above --fail-on.
  1  Findings at or above --fail-on.
  2  The scan did not run: bad arguments, connection refused, auth failed, timeout.

Examples
  DATABASE_URL="postgresql://user:pass@db.abcdef.supabase.co:5432/postgres" \\
      npx @rebasepro/rls-check
  npx @rebasepro/rls-check --schema public --schema billing --fail-on medium
  npx @rebasepro/rls-check --json > rls-report.json
  npx @rebasepro/rls-check --html rls-report.html

It is read-only: it issues SELECTs against the system catalogs, writes nothing,
and sends nothing anywhere.
`;
}

function usageText(): string {
    return `rls-check needs a PostgreSQL connection string.

  DATABASE_URL="postgresql://user:password@host:5432/database" npx @rebasepro/rls-check

Or put DATABASE_URL in a .env file in this directory, or set POSTGRES_URL. It
also accepts the string as an argument, but npm echoes the command line before
this program starts and your shell records it, so the password ends up in two
places rls-check cannot reach.

It is read-only — it reads the system catalogs and writes nothing. Run with
--help for all options.
`;
}

/**
 * Read the version out of the package manifest at runtime rather than inlining
 * it at build time, so a published tarball and a `pnpm build` never disagree.
 * `../package.json` is correct from both `src/cli.ts` and `dist/index.es.js`.
 */
export function resolveVersion(): string {
    for (const candidate of ["../package.json", "../../package.json"]) {
        try {
            const raw = readFileSync(new URL(candidate, import.meta.url), "utf8");
            const parsed = JSON.parse(raw) as { name?: string; version?: string };
            if (parsed.name === "@rebasepro/rls-check" && typeof parsed.version === "string") {
                return parsed.version;
            }
        } catch {
            // Fall through: a missing manifest must never break a scan.
        }
    }

    return "unknown";
}

// ---------------------------------------------------------------------------
// runCli
// ---------------------------------------------------------------------------

export interface CliIo {
    stdout(text: string): void;
    stderr(text: string): void;
    /**
     * Write a file, for `--html`. Injected rather than imported so the CLI
     * tests can exercise the whole path without touching a disk.
     */
    writeFile?(path: string, contents: string): void;
    env: NodeJS.ProcessEnv;
    cwd: string;
    /** Whether stdout is a terminal; drives colour when nothing else decides. */
    isTty: boolean;
    columns?: number;
}

function defaultIo(): CliIo {
    return {
        stdout: (text) => process.stdout.write(text),
        stderr: (text) => process.stderr.write(text),
        writeFile: (path, contents) => writeFileSync(path, contents, "utf8"),
        env: process.env,
        cwd: process.cwd(),
        isTty: Boolean(process.stdout.isTTY),
        columns: process.stdout.columns
    };
}

/**
 * Colour is on only when every signal agrees: not JSON, not NO_COLOR, not a
 * dumb terminal, and either a TTY or an explicit --color.
 */
export function resolveColor(explicit: boolean | null, json: boolean, env: NodeJS.ProcessEnv, isTty: boolean): boolean {
    if (json) return false;
    if (explicit !== null) return explicit;
    if (typeof env.NO_COLOR === "string" && env.NO_COLOR !== "") return false;
    if (env.TERM === "dumb") return false;
    if (typeof env.FORCE_COLOR === "string" && env.FORCE_COLOR !== "" && env.FORCE_COLOR !== "0") return true;

    return isTty;
}

/**
 * The entry point `bin/rls-check.js` calls. Returns the process exit code and
 * never throws — an unexpected failure becomes exit 2 with a redacted message.
 */
export async function runCli(argv: readonly string[], io: CliIo = defaultIo()): Promise<number> {
    let connectionString: string | undefined;

    try {
        const parsed = parseArgs(argv);
        if (!parsed.ok) {
            io.stderr(formatFriendlyError({ headline: parsed.message }, resolveColor(null, false, io.env, io.isTty)));

            return EXIT_ERROR;
        }

        const options = parsed.options;
        const color = resolveColor(options.color, options.json, io.env, io.isTty);
        const version = resolveVersion();

        if (options.help) {
            io.stdout(helpText(version));

            return EXIT_OK;
        }

        if (options.version) {
            io.stdout(`${version}\n`);

            return EXIT_OK;
        }

        if (options.listChecks) {
            if (options.json) {
                io.stdout(
                    `${JSON.stringify(
                        CHECKS.map((check) => ({ id: check.id, title: check.title, description: check.description })),
                        null,
                        2
                    )}\n`
                );
            } else {
                io.stdout(renderCheckCatalog(CHECKS, { color, width: io.columns }));
            }

            return EXIT_OK;
        }

        const unknownIds = [...options.only, ...options.skip].filter(
            (id) => !CHECKS.some((check) => check.id === id)
        );
        if (unknownIds.length > 0) {
            io.stderr(
                formatFriendlyError(
                    {
                        headline: `Unknown check ${unknownIds.length === 1 ? "id" : "ids"}: ${unknownIds.join(", ")}.`,
                        hint: "Run --list-checks for the catalog. Ids are stable, so a typo here silently weakens the scan rather than failing it — which is why this is an error."
                    },
                    color
                )
            );

            return EXIT_ERROR;
        }

        const resolved = resolveConnection(options.connectionString, io.env, io.cwd);
        if (!resolved) {
            io.stderr(usageText());

            return EXIT_ERROR;
        }
        connectionString = resolved.connectionString;

        const target = parseConnectionString(connectionString);
        const endpoint = formatEndpoint(target);

        if (!target) {
            io.stderr(
                formatFriendlyError(
                    {
                        headline: "That does not look like a PostgreSQL connection string.",
                        hint: "Expected postgresql://user:password@host:5432/database, or a libpq keyword string carrying at least one of host= dbname= user= (port, password, sslmode, application_name, connect_timeout and options are honoured too). A password containing / ? or # is the usual cause: those end the authority, so the split lands inside the credential and neither this tool nor libpq can tell where it ends — percent-encode them. An @ or a : inside a password is fine, and needs no encoding."
                    },
                    color
                )
            );

            return EXIT_ERROR;
        }

        // A keyword string this tool cannot translate in full is refused rather
        // than connected with the missing keyword dropped: every one of them
        // changes where the connection goes or how it is verified.
        const unsupported = unsupportedConnectionKeywords(connectionString);
        if (unsupported.length > 0) {
            io.stderr(
                formatFriendlyError(
                    {
                        headline: `This connection string uses ${unsupported.length === 1 ? "a keyword" : "keywords"} the scan cannot honour: ${unsupported.join(", ")}.`,
                        hint: "Rewrite it as a URL — postgresql://user:password@host:5432/database?sslmode=require. Connecting with those keywords dropped would send the scan somewhere you did not ask for, or verify TLS less strictly than you asked for."
                    },
                    color
                )
            );

            return EXIT_ERROR;
        }

        // There is no way to abort an in-flight libpq query from Node, so the
        // handler exits directly rather than unwinding. 130 is the shell's
        // convention for SIGINT and keeps it distinct from 1 and 2.
        const onSigint = (): void => {
            io.stderr("\nInterrupted. Nothing was written — the scan is read-only.\n");
            process.exit(130);
        };
        process.on("SIGINT", onSigint);

        let result: ScanResult;
        try {
            result = await scan({
                connectionString,
                schemas: options.schemas,
                roles: options.roles,
                only: options.only,
                skip: options.skip,
                statementTimeoutMs: options.timeoutMs
            });
        } catch (error) {
            // A typo in `--role` is the user's mistake, not the database's, and
            // `explainError` would bury it under "the scan failed".
            if (error instanceof UnknownRoleError) {
                io.stderr(
                    formatFriendlyError(
                        {
                            headline: `No such role on this database: ${error.roles.join(", ")}.`,
                            hint: "Check the spelling against `SELECT rolname FROM pg_roles`. This is an error rather than a warning for the same reason an unknown --skip id is: a name that matches nothing silently narrows the scan, and the run then prints a clean report of a database nobody looked at."
                        },
                        color
                    )
                );

                return EXIT_ERROR;
            }

            io.stderr(
                formatFriendlyError(explainError(error, { endpoint, timeoutMs: options.timeoutMs, connectionString }), color)
            );

            return EXIT_ERROR;
        } finally {
            process.removeListener("SIGINT", onSigint);
        }

        if (options.json) {
            io.stdout(`${renderJson(result)}\n`);
        } else {
            io.stdout(
                renderReport(result, {
                    color,
                    quiet: options.quiet,
                    failOn: options.failOn,
                    width: io.columns,
                    endpoint,
                    version
                })
            );
        }

        // The artifact is the whole point of asking for it, so failing to write
        // it is a failed run even though the scan itself succeeded — exit 2,
        // the "no verdict" code, rather than letting a missing report look like
        // a clean one. The findings are already on stdout either way.
        if (options.html !== null) {
            const write = io.writeFile;
            if (!write) {
                io.stderr(
                    formatFriendlyError(
                        { headline: "--html is not available: this environment cannot write files." },
                        color
                    )
                );

                return EXIT_ERROR;
            }
            try {
                write(options.html, renderHtml(result, { failOn: options.failOn, endpoint, version }));
                io.stderr(`Wrote ${options.html}\n`);
            } catch (error) {
                io.stderr(
                    formatFriendlyError(
                        {
                            headline: `Could not write ${options.html}.`,
                            hint: "Check the directory exists and is writable.",
                            detail: redactSecrets(errorMessage(error), connectionString)
                        },
                        color
                    )
                );

                return EXIT_ERROR;
            }
        }

        // A degraded scan is not a clean scan. Checks whose catalogue reads
        // failed return nothing, which is indistinguishable from finding
        // nothing — so reporting EXIT_OK here would be the scanner answering
        // "no problems" to a question it never managed to ask. Exit 2, the same
        // code an outright crash uses, because both mean "no verdict".
        return exitCodeFor(result, options.failOn);
    } catch (error) {
        // Anything that escapes the expected paths. Exit 2, never 1: a crash is
        // not a clean bill of health and it is not a finding either.
        io.stderr(
            formatFriendlyError(
                {
                    headline: "rls-check failed before it could report.",
                    hint: "This is a bug — please open an issue at https://github.com/rebasepro/rebase/issues.",
                    detail: redactSecrets(errorMessage(error), connectionString)
                },
                false
            )
        );

        return EXIT_ERROR;
    }
}
