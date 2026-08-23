/**
 * Unit tests for the three parts of this package that never touch Postgres:
 * redaction, rendering, and the CLI's pure decision functions.
 *
 * The redaction block is the important one. Everything else here is a
 * regression net; those tests are the reason it is safe to point this tool at
 * a production connection string in front of an audience.
 */

import { describe, expect, it } from "vitest";

import {
    explainError,
    parseArgs,
    readDotEnv,
    resolveColor,
    resolveConnection,
    runCli,
    type CliIo, exitCodeFor } from "./cli";
import {
    formatEndpoint,
    isLoopbackEndpoint,
    parseConnectionString,
    redactConnectionString,
    redactSecrets
} from "./redact";
import {
    exceedsThreshold,
    formatTarget,
    maxSeverity,
    renderJson,
    renderReport,
    severityRank
} from "./report";
import type { Finding, ScanResult } from "./types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PASSWORD = "hunter2-Sup3r$ecret";
const CONNECTION = `postgresql://postgres:${PASSWORD}@db.abcdefghijkl.supabase.co:5432/postgres?sslmode=require`;

function finding(overrides: Partial<Finding> = {}): Finding {
    return {
        id: "rls-disabled",
        severity: "critical",
        title: "Row-level security is not enabled on public.profiles",
        target: { schema: "public", table: "profiles" },
        detail: "The table has row-level security disabled, so every policy on it is inert.",
        impact: "Any caller reaching this table over an API reads and writes every row.",
        fix: "ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;\nALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;",
        docs: "https://rebase.pro/docs/rls-check#rls-disabled",
        confidence: "certain",
        ...overrides
    };
}

function result(overrides: Partial<ScanResult> = {}): ScanResult {
    return {
        // A clean bill of health by default: nothing failed to read. Tests that
        // care about the degraded path override it.
        diagnostics: { degraded: [],
tlsVerificationDisabled: false,
excludedSchemas: [], unrecognizedGrantees: [] },
        scannedAt: "2026-07-26T09:00:00.000Z",
        database: { host: "db.abcdefghijkl.supabase.co", name: "postgres" },
        serverVersion: "PostgreSQL 15.6 on aarch64-unknown-linux-gnu",
        platform: "supabase",
        scannerIsPrivileged: false,
        stats: { schemas: 2, tables: 18, policies: 24, tablesWithoutRls: 3, checksRun: 14 },
        findings: [finding()],
        ...overrides
    };
}

function captureIo(overrides: Partial<CliIo> = {}): CliIo & { out: string[]; err: string[] } {
    const out: string[] = [];
    const err: string[] = [];

    return {
        out,
        err,
        stdout: (text) => out.push(text),
        stderr: (text) => err.push(text),
        env: {},
        cwd: "/nonexistent-directory-for-tests",
        isTty: false,
        columns: 88,
        ...overrides
    };
}

/**
 * The first five-character run of `secret` that survived into `haystack`, or
 * `null`. Whole-string comparison is too weak: the interesting bug is a parser
 * that splits a URL in the wrong place and prints half the password.
 */
function leakedFragment(haystack: string, secret: string): string | null {
    for (let start = 0; start + 5 <= secret.length; start += 1) {
        const window = secret.slice(start, start + 5);
        if (haystack.includes(window)) return window;
    }

    return null;
}

// An ANSI colour code *is* an escape sequence, so matching one necessarily
// matches a control character. That is what the rule guards against, and here
// it is the point — this asserts the report strips its own colouring.
// eslint-disable-next-line no-control-regex
const ANSI = /\u001B\[[0-9;]*m/;

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

describe("redaction", () => {
    it("keeps scheme, host, port and database and drops the credentials", () => {
        expect(redactConnectionString(CONNECTION)).toBe(
            "postgresql://***:***@db.abcdefghijkl.supabase.co:5432/postgres?sslmode=require"
        );
    });

    it("never lets a password survive, whatever it contains", () => {
        // Every shape a password shows up in, including the ones that make the
        // URL genuinely ambiguous. The tool is allowed to give up on those; it
        // is not allowed to print any part of the credential.
        const passwords = [
            "hunter2",
            "p@ssw0rd/with:everything?in&it",
            "with spaces and #hash",
            "sl/ash",
            "trailing@@@",
            "AbC%2Fencoded",
            "-dash-start"
        ];

        for (const password of passwords) {
            const url = `postgres://admin:${password}@10.0.0.7:6543/app`;
            const redacted = redactConnectionString(url);

            // Substring-level, not whole-string: a half-parsed URL leaks
            // fragments, which is the failure mode worth catching.
            expect(leakedFragment(redacted, password), `leak for password: ${password}`).toBeNull();

            // Either it parsed cleanly, or it refused. Never something between.
            if (redacted !== "<connection string>") {
                expect(redacted).toBe("postgres://***:***@10.0.0.7:6543/app");
            }
        }
    });

    it("keeps the endpoint when the password is percent-encoded, as it should be", () => {
        expect(redactConnectionString("postgres://admin:p%40ss%2Fword@10.0.0.7:6543/app")).toBe(
            "postgres://***:***@10.0.0.7:6543/app"
        );
    });

    it("redacts a password passed as a query parameter", () => {
        const url = "postgres://neondb_owner@ep-x.eu-central-1.aws.neon.tech/neondb?password=npg_SECRET&sslmode=require";
        const redacted = redactConnectionString(url);
        expect(redacted).not.toContain("npg_SECRET");
        expect(redacted).toContain("sslmode=require");
    });

    it("handles a libpq keyword string", () => {
        const target = parseConnectionString("host=db.internal port=6432 dbname=billing user=svc password='s3 cret'");
        expect(target).toMatchObject({ host: "db.internal", port: 6432, database: "billing", user: "svc" });
        expect(redactConnectionString("host=db.internal dbname=billing user=svc password=hunter2")).not.toContain(
            "hunter2"
        );
    });

    it("handles IPv6 literals and strings with no credentials at all", () => {
        expect(parseConnectionString("postgres://[::1]:5432/app")).toMatchObject({
            host: "[::1]",
            port: 5432,
            database: "app",
            user: null
        });
        expect(redactConnectionString("postgres://[::1]:5432/app")).toBe("postgres://[::1]:5432/app");
    });

    it("refuses to echo something it cannot parse", () => {
        expect(redactConnectionString("this is not a connection string")).toBe("<connection string>");
    });

    it("scrubs the credential out of driver error text", () => {
        const message = `error: connect ECONNREFUSED at ${CONNECTION} (password authentication failed for user "postgres")`;
        const scrubbed = redactSecrets(message, CONNECTION);
        expect(scrubbed).not.toContain(PASSWORD);
        expect(scrubbed).not.toContain('"postgres"');
        expect(scrubbed).toContain("db.abcdefghijkl.supabase.co");
    });

    it("still scrubs a URL it was never told about", () => {
        const scrubbed = redactSecrets("nested cause: postgres://root:leaked-pw@10.1.2.3/other failed");
        expect(scrubbed).not.toContain("leaked-pw");
        expect(scrubbed).toContain("10.1.2.3");
    });

    it("scrubs a libpq password= in any quoting", () => {
        expect(redactSecrets("PGOPTIONS host=x password='quoted secret'")).not.toContain("quoted secret");
        expect(redactSecrets("host=x password=bare-secret")).not.toContain("bare-secret");
    });

    it("formats an endpoint without inventing a port", () => {
        expect(formatEndpoint(parseConnectionString("postgres://u:p@host/db"))).toBe("host");
        expect(formatEndpoint(parseConnectionString("postgres://u:p@host:5433/db"))).toBe("host:5433");
        expect(formatEndpoint(null)).toBe("unknown host");
    });

    it("tells a loopback endpoint from a remote one", () => {
        expect(isLoopbackEndpoint("127.0.0.1:5434")).toBe(true);
        expect(isLoopbackEndpoint("127.0.0.1")).toBe(true);
        expect(isLoopbackEndpoint("127.9.9.9:5432")).toBe(true);
        expect(isLoopbackEndpoint("localhost")).toBe(true);
        expect(isLoopbackEndpoint("db.localhost:5432")).toBe(true);
        expect(isLoopbackEndpoint("[::1]:5432")).toBe(true);
        expect(isLoopbackEndpoint(formatEndpoint(parseConnectionString("postgres://u:p@[::1]:5432/db")))).toBe(true);

        expect(isLoopbackEndpoint("db.abcdefghijkl.supabase.co:5432")).toBe(false);
        expect(isLoopbackEndpoint("10.0.0.1:5432")).toBe(false);
        // Not loopback despite the digits: a real host that merely starts with 127.
        expect(isLoopbackEndpoint("127.example.com")).toBe(false);
        expect(isLoopbackEndpoint("notlocalhost")).toBe(false);
        expect(isLoopbackEndpoint("unknown host")).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Severity helpers
// ---------------------------------------------------------------------------

describe("severity", () => {
    it("orders least to most severe", () => {
        expect(severityRank("info")).toBeLessThan(severityRank("low"));
        expect(severityRank("high")).toBeLessThan(severityRank("critical"));
    });

    it("reports the worst severity present", () => {
        expect(maxSeverity([])).toBeNull();
        expect(maxSeverity([finding({ severity: "low" }), finding({ severity: "high" })])).toBe("high");
    });

    it("compares --fail-on inclusively, and never fails on none", () => {
        const findings = [finding({ severity: "medium" })];
        expect(exceedsThreshold(findings, "medium")).toBe(true);
        expect(exceedsThreshold(findings, "high")).toBe(false);
        expect(exceedsThreshold(findings, "none")).toBe(false);
        expect(exceedsThreshold([finding({ severity: "critical" })], "none")).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

describe("renderReport", () => {
    const options = { color: false, failOn: "high" as const, width: 88 };

    it("puts the header, the finding and one Rebase line in that order", () => {
        const text = renderReport(result(), options);

        expect(text).toContain("Database");
        expect(text).toContain("db.abcdefghijkl.supabase.co/postgres");
        expect(text).toContain("PostgreSQL 15.6");
        expect(text).toContain("Supabase");
        expect(text).toContain("[critical] rls-disabled");
        expect(text).toContain("public.profiles");
        expect(text).toContain("Impact");

        // Exactly one line that is about Rebase rather than about the finding.
        // Per-finding `Docs` links are documentation, not promotion.
        const promotional = text
            .split("\n")
            .filter((line) => line.includes("rebase.pro") && !line.trimStart().startsWith("Docs"));
        expect(promotional).toHaveLength(1);
        expect(text.trimEnd().split("\n").at(-1)).toContain("rebase.pro");
    });

    it("keeps the fix block copy-pasteable, one statement per line", () => {
        const text = renderReport(result(), options);
        expect(text).toContain("          ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;");
        expect(text).toContain("          ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;");
    });

    it("carries every fact without colour", () => {
        const plain = renderReport(result(), options);
        expect(plain).not.toMatch(ANSI);
        // Severity is a word, not a hue.
        expect(plain).toContain("[critical]");
        expect(plain).toContain("CRITICAL");

        const coloured = renderReport(result(), { ...options, color: true });
        expect(coloured).toMatch(ANSI);
        expect(coloured.replace(new RegExp(ANSI.source, "g"), "")).toBe(plain);
    });

    it("separates heuristic findings and never mixes them into the confident ones", () => {
        const text = renderReport(
            result({
                findings: [
                    finding({ id: "rls-disabled", severity: "critical" }),
                    finding({
                        id: "junction-table-unprotected",
                        severity: "medium",
                        confidence: "heuristic",
                        target: { schema: "public", table: "post_tags" }
                    })
                ]
            }),
            options
        );

        const heuristicHeading = text.indexOf("WORTH CHECKING");
        expect(heuristicHeading).toBeGreaterThan(text.indexOf("rls-disabled"));
        expect(text.indexOf("junction-table-unprotected")).toBeGreaterThan(heuristicHeading);
        expect(text).toContain("heuristics, not proofs");
    });

    it("orders severity groups worst first", () => {
        const text = renderReport(
            result({
                findings: [
                    finding({ id: "grant-to-public", severity: "low" }),
                    finding({ id: "rls-disabled", severity: "critical" }),
                    finding({ id: "rls-enabled-not-forced", severity: "medium" })
                ]
            }),
            options
        );

        expect(text.indexOf("CRITICAL")).toBeLessThan(text.indexOf("MEDIUM"));
        expect(text.indexOf("MEDIUM")).toBeLessThan(text.indexOf("LOW"));
    });

    it("prints the privilege caveat only when the scanner bypasses RLS", () => {
        expect(renderReport(result({ scannerIsPrivileged: true }), options)).toContain(
            "row-level security cannot constrain"
        );
        expect(renderReport(result({ scannerIsPrivileged: false }), options)).not.toContain(
            "row-level security cannot constrain"
        );
    });

    it("keeps the privilege caveat under --quiet, where the banner and summary go", () => {
        const quiet = renderReport(result({ scannerIsPrivileged: true }), { ...options, quiet: true });

        expect(quiet).not.toContain("Summary");
        expect(quiet).not.toContain("Platform");
        expect(quiet).toContain("row-level security cannot constrain");
        expect(quiet).toContain("rls-disabled");
    });

    it("says what the exit code will be, and why", () => {
        expect(renderReport(result(), options)).toContain("Exit code 1");
        expect(renderReport(result({ findings: [finding({ severity: "low" })] }), options)).toContain("Exit code 0");
        expect(renderReport(result(), { ...options, failOn: "none" })).toContain("--fail-on none");
    });

    it("is explicit when there is nothing to report", () => {
        const text = renderReport(result({ findings: [] }), options);
        expect(text).toContain("No findings");
        expect(text).toContain("Exit code 0");
    });
});

describe("formatTarget", () => {
    it("names the object precisely", () => {
        expect(formatTarget({ schema: "public", table: "profiles" })).toBe("public.profiles");
        expect(formatTarget({ schema: "public", table: "profiles", policy: "read all" })).toBe(
            'public.profiles · policy "read all"'
        );
        expect(formatTarget({ schema: "api", view: "v_users" })).toBe("api.v_users");
        expect(formatTarget({ schema: "public", routine: "is_admin" })).toBe("public.is_admin()");
        expect(formatTarget({ schema: "public", table: "users", column: "email" })).toBe("public.users.email");
        expect(formatTarget({ schema: "billing" })).toBe("schema billing");
    });
});

describe("renderJson", () => {
    it("emits exactly the ScanResult shape, with no colour and no extra keys", () => {
        const parsed = JSON.parse(renderJson(result())) as ScanResult;

        // `diagnostics` is part of the JSON contract on purpose: a consumer
        // reading `findings: []` needs to be able to tell "nothing was wrong"
        // from "the scan could not look". Without it the two are the same
        // document.
        expect(Object.keys(parsed).sort()).toEqual(
            ["database", "diagnostics", "findings", "platform", "scannedAt", "scannerIsPrivileged", "serverVersion", "stats"].sort()
        );
        expect(parsed.database).toEqual({ host: "db.abcdefghijkl.supabase.co", name: "postgres" });
        expect(parsed.scannedAt).toBe("2026-07-26T09:00:00.000Z");
        expect(renderJson(result())).not.toMatch(ANSI);
    });

    it("sorts findings worst first so two runs of the same database diff cleanly", () => {
        const json = JSON.parse(
            renderJson(
                result({
                    findings: [finding({ id: "grant-to-public", severity: "low" }), finding({ severity: "critical" })]
                })
            )
        ) as ScanResult;

        expect(json.findings.map((item) => item.severity)).toEqual(["critical", "low"]);
    });
});

// ---------------------------------------------------------------------------
// CLI: argument parsing
// ---------------------------------------------------------------------------

describe("parseArgs", () => {
    const ok = (argv: string[]) => {
        const parsed = parseArgs(argv);
        if (!parsed.ok) throw new Error(`expected success, got: ${parsed.message}`);

        return parsed.options;
    };

    it("takes a path for --html, and defaults to not writing one", () => {
        expect(ok([]).html).toBeNull();
        expect(ok(["--html", "rls-report.html"]).html).toBe("rls-report.html");
        expect(ok(["--html=rls-report.html"]).html).toBe("rls-report.html");
    });

    it("rejects --html without a path, rather than writing somewhere surprising", () => {
        const parsed = parseArgs(["--html"]);
        expect(parsed.ok).toBe(false);
        if (!parsed.ok) expect(parsed.message).toContain("--html needs a file path");
    });

    it("defaults to failing on high with colour undecided", () => {
        const options = ok([]);
        expect(options.failOn).toBe("high");
        expect(options.timeoutMs).toBe(15000);
        expect(options.color).toBeNull();
        expect(options.connectionString).toBeNull();
    });

    it("takes the connection string as a positional", () => {
        expect(ok([CONNECTION]).connectionString).toBe(CONNECTION);
    });

    it("accepts repeated and comma-separated list flags interchangeably", () => {
        expect(ok(["--schema", "public", "--schema", "billing"]).schemas).toEqual(["public", "billing"]);
        expect(ok(["--schema=public,billing"]).schemas).toEqual(["public", "billing"]);
        expect(ok(["--skip", "rls-enabled-not-forced", "--skip=grant-to-public"]).skip).toEqual([
            "rls-enabled-not-forced",
            "grant-to-public"
        ]);
        expect(ok(["--only", "rls-disabled"]).only).toEqual(["rls-disabled"]);
    });

    it("validates --fail-on against the severity set", () => {
        expect(ok(["--fail-on", "none"]).failOn).toBe("none");
        expect(ok(["--fail-on", "CRITICAL"]).failOn).toBe("critical");

        const bad = parseArgs(["--fail-on", "catastrophic"]);
        expect(bad.ok).toBe(false);
        if (!bad.ok) expect(bad.message).toContain("critical");
    });

    it("validates --timeout", () => {
        expect(ok(["--timeout", "60000"]).timeoutMs).toBe(60000);
        expect(parseArgs(["--timeout", "banana"]).ok).toBe(false);
        expect(parseArgs(["--timeout=0"]).ok).toBe(false);
    });

    it("rejects an unknown option rather than ignoring it", () => {
        const parsed = parseArgs(["--fail-fast"]);
        expect(parsed.ok).toBe(false);
        if (!parsed.ok) expect(parsed.message).toContain("--fail-fast");
    });

    it("rejects a second positional without echoing it", () => {
        const parsed = parseArgs([CONNECTION, CONNECTION]);
        expect(parsed.ok).toBe(false);
        if (!parsed.ok) expect(parsed.message).not.toContain(PASSWORD);
    });

    it("reports a missing value instead of eating the next flag", () => {
        expect(parseArgs(["--schema", "--json"]).ok).toBe(false);
    });

    it("understands the colour flags", () => {
        expect(ok(["--no-color"]).color).toBe(false);
        expect(ok(["--color"]).color).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// CLI: colour and connection resolution
// ---------------------------------------------------------------------------

describe("resolveColor", () => {
    it("is off for JSON no matter what", () => {
        expect(resolveColor(true, true, { FORCE_COLOR: "1" }, true)).toBe(false);
    });

    it("honours NO_COLOR, a dumb terminal and a pipe", () => {
        expect(resolveColor(null, false, { NO_COLOR: "1" }, true)).toBe(false);
        expect(resolveColor(null, false, { TERM: "dumb" }, true)).toBe(false);
        expect(resolveColor(null, false, {}, false)).toBe(false);
        expect(resolveColor(null, false, {}, true)).toBe(true);
    });

    it("lets an explicit flag win over the environment", () => {
        expect(resolveColor(false, false, {}, true)).toBe(false);
        expect(resolveColor(true, false, {}, false)).toBe(true);
    });
});

describe("resolveConnection", () => {
    it("prefers the argument, then DATABASE_URL, then POSTGRES_URL", () => {
        const env = { DATABASE_URL: "postgres://a@h/one", POSTGRES_URL: "postgres://b@h/two" };
        expect(resolveConnection("postgres://c@h/three", env, "/nope")?.connectionString).toBe("postgres://c@h/three");
        expect(resolveConnection(null, env, "/nope")?.connectionString).toBe("postgres://a@h/one");
        expect(resolveConnection(null, { POSTGRES_URL: "postgres://b@h/two" }, "/nope")?.connectionString).toBe(
            "postgres://b@h/two"
        );
        expect(resolveConnection(null, {}, "/nonexistent-directory-for-tests")).toBeNull();
    });
});

describe("readDotEnv", () => {
    it("returns nothing rather than throwing when there is no .env", () => {
        expect(readDotEnv("/nonexistent-directory-for-tests").size).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// CLI: error translation
// ---------------------------------------------------------------------------

describe("explainError", () => {
    const context = { endpoint: "db.example.com:5432", timeoutMs: 15000, connectionString: CONNECTION };

    const explain = (code: string, message = "boom") => {
        const error = Object.assign(new Error(message), { code });

        return explainError(error, context);
    };

    it("translates the failures people actually hit", () => {
        expect(explain("ECONNREFUSED").headline).toContain("Nothing is accepting connections");
        expect(explain("ENOTFOUND").headline).toContain("does not resolve");
        expect(explain("ETIMEDOUT").hint).toContain("firewall");
        expect(explain("28P01").headline).toContain("Password authentication failed");
        expect(explain("28P01").hint).toContain("percent-encoded");
        expect(explain("3D000").headline).toContain("does not exist");
        expect(explain("28000").headline).toContain("refused the connection");
        expect(explain("57014").hint).toContain("--timeout");
        expect(explain("42501").headline).toContain("not allowed to read the catalogs");
    });

    // Every code a connection dying mid-handshake arrives as: the driver's
    // errno, and the SQLSTATE class the server uses. All of them used to reach
    // for TLS unconditionally.
    const HANDSHAKE_CODES = ["ECONNRESET", "08006", "08001", "08004"];

    const explainAt = (code: string, endpoint: string) =>
        explainError(Object.assign(new Error("connection failed"), { code }), { ...context, endpoint });

    it("suggests TLS when the handshake dies against a remote host", () => {
        for (const code of HANDSHAKE_CODES) {
            const explained = explainAt(code, "db.abcdefghijkl.supabase.co:5432");

            expect(explained.hint, code).toContain("sslmode=require");
            expect(explained.headline, code).not.toContain("proxy");
        }
    });

    it("blames the proxy, not TLS, when the handshake dies against a loopback endpoint", () => {
        // cloud-sql-proxy, an SSH -L forward or a local pooler: it accepted the
        // connection and then failed its own upstream auth. Telling the user to
        // set sslmode here sends them somewhere the fix is not — the proxy
        // terminates TLS itself, so there is no mode of ours to get wrong.
        for (const code of HANDSHAKE_CODES) {
            for (const endpoint of ["127.0.0.1:5434", "localhost:5432", "[::1]:5432"]) {
                const explained = explainAt(code, endpoint);
                const where = `${code} at ${endpoint}`;

                expect(explained.headline, where).toContain("local proxy or tunnel");
                expect(explained.headline, where).toContain(endpoint);
                expect(explained.hint, where).toContain("log");
                expect(explained.hint, where).not.toContain("sslmode");
            }
        }
    });

    it("recognises TLS failures from the message when there is no code", () => {
        expect(explainError(new Error("The server does not support SSL connections"), context).hint).toContain(
            "sslmode=disable"
        );
        expect(
            explainError(new Error("self-signed certificate in certificate chain (SSL)"), context).headline
        ).toContain("TLS certificate");
    });

    it("digs the code out of a wrapped cause", () => {
        const wrapped = new Error("query failed", { cause: Object.assign(new Error("inner"), { code: "28P01" }) });
        expect(explainError(wrapped, context).headline).toContain("Password authentication failed");
    });

    it("never leaks the credential into the detail line", () => {
        const noisy = Object.assign(new Error(`could not connect using ${CONNECTION}`), { code: "ECONNREFUSED" });
        const explained = explainError(noisy, context);
        expect(JSON.stringify(explained)).not.toContain(PASSWORD);
    });

    it("falls back to a one-liner rather than a stack trace", () => {
        const explained = explainError(new Error("something unforeseen"), context);
        expect(explained.headline).toContain("failed");
        expect(explained.detail).toContain("something unforeseen");
    });
});

// ---------------------------------------------------------------------------
// CLI: end to end, without a database
// ---------------------------------------------------------------------------

describe("runCli", () => {
    it("prints help and exits 0", async () => {
        const io = captureIo();
        expect(await runCli(["--help"], io)).toBe(0);
        expect(io.out.join("")).toContain("Usage");
        expect(io.out.join("")).toContain("Exit codes");
    });

    it("documents --html in the help text", async () => {
        const io = captureIo();
        await runCli(["--help"], io);
        expect(io.out.join("")).toContain("--html <path>");
    });

    it("prints the version and exits 0", async () => {
        const io = captureIo();
        expect(await runCli(["--version"], io)).toBe(0);
        expect(io.out.join("").trim()).toMatch(/^\d+\.\d+\.\d+/);
    });

    it("lists the checks and exits 0", async () => {
        const io = captureIo();
        expect(await runCli(["--list-checks"], io)).toBe(0);
        expect(io.out.join("")).toContain("rls-disabled");
    });

    it("exits 2 with a usage message when no connection string resolves", async () => {
        const io = captureIo();
        expect(await runCli([], io)).toBe(2);
        expect(io.out.join("")).toBe("");
        expect(io.err.join("")).toContain("needs a PostgreSQL connection string");
    });

    it("exits 2 on a bad argument, not 1", async () => {
        const io = captureIo();
        expect(await runCli(["--nope"], io)).toBe(2);
    });

    it("exits 2 on an unknown check id rather than silently scanning less", async () => {
        const io = captureIo();
        expect(await runCli([CONNECTION, "--only", "rls-disabledd"], io)).toBe(2);
        expect(io.err.join("")).toContain("Unknown check id");
    });

    it("exits 2 on an unparseable connection string", async () => {
        const io = captureIo();
        expect(await runCli(["not-a-url"], io)).toBe(2);
        expect(io.err.join("")).toContain("does not look like a PostgreSQL connection string");
    });

    it("never writes the password to either stream when the connection fails", async () => {
        const io = captureIo();
        const code = await runCli([`postgres://user:${PASSWORD}@rls-check-does-not-resolve.invalid:5432/app`], io);

        expect(code).toBe(2);
        expect(io.out.join("") + io.err.join("")).not.toContain(PASSWORD);
    }, 30_000);
});

/**
 * A scan that could not read the catalogue must not read as a clean scan.
 *
 * `introspect` records every failed catalogue query; `introspect()` threw that
 * record away before `scan` saw it, `ScanResult` had no field for it, and
 * neither the report nor the exit code mentioned it. A single failed grants
 * read silently disables `rls-disabled`, both view checks and
 * `anonymous-write-allowed` — and the run then printed "No findings" and
 * exited 0.
 */
describe("degraded scans", () => {
    const degradedResult = () => result({
        findings: [],
        diagnostics: {
            degraded: [{ what: "table grants", error: "permission denied for table pg_class" }],
            tlsVerificationDisabled: false,
            excludedSchemas: [],
            unrecognizedGrantees: []
        }
    });

    it("does not claim a clean bill of health", () => {
        const out = renderReport(degradedResult(), { color: false, quiet: false, failOn: "high", width: 100 });

        expect(out).not.toContain("No findings. Every table, view and policy in scope passed all checks.");
        expect(out).toContain("incomplete");
    });

    it("names what could not be read, and why it matters", () => {
        const out = renderReport(degradedResult(), { color: false, quiet: false, failOn: "high", width: 100 });

        expect(out).toContain("table grants");
        expect(out).toContain("permission denied for table pg_class");
        // Which check went quiet is the reader's call to make, so the cost is
        // stated rather than the conclusion.
        expect(out).toMatch(/looks exactly like finding nothing|inconclusive/);
    });

    it("survives --quiet, like the privilege caveat", () => {
        // Suppressing it would let someone read a clean report from a scan that
        // could not look.
        const out = renderReport(degradedResult(), { color: false, quiet: true, failOn: "high", width: 100 });
        expect(out).toContain("incomplete");
    });

    it("still says clean when nothing failed", () => {
        // The control: a report that always warned would satisfy the above.
        const out = renderReport(result({ findings: [] }), { color: false, quiet: false, failOn: "high", width: 100 });
        expect(out).toContain("No findings.");
        expect(out).not.toContain("incomplete");
    });
});

/**
 * The one line that decides whether CI goes red.
 *
 * It lived inside `runCli`, which needs a database, so it had no coverage:
 * deleting it broke no test. It is a pure function now.
 */
describe("exitCodeFor", () => {
    const clean = { degraded: [], tlsVerificationDisabled: false, excludedSchemas: [], unrecognizedGrantees: [] };
    const broken = {
        degraded: [{ what: "table grants", error: "permission denied" }],
        tlsVerificationDisabled: false,
        excludedSchemas: [],
        unrecognizedGrantees: []
    };

    it("is 0 for a clean scan with no findings", () => {
        expect(exitCodeFor(result({ findings: [], diagnostics: clean }), "high")).toBe(0);
    });

    it("is 1 when a finding meets the threshold", () => {
        expect(exitCodeFor(result({ findings: [finding()], diagnostics: clean }), "high")).toBe(1);
    });

    it("is 2 for a degraded scan, even with no findings", () => {
        // The whole point: no findings from a scan that could not look is not
        // the same answer as no findings from a scan that did.
        expect(exitCodeFor(result({ findings: [], diagnostics: broken }), "high")).toBe(2);
    });

    it("is 2 for a degraded scan even when findings would not meet the threshold", () => {
        expect(exitCodeFor(result({ findings: [], diagnostics: broken }), "none")).toBe(2);
    });
});
