/**
 * Integration: the whole pipeline — connect, introspect, run every check,
 * render — against a real PostgreSQL in Docker.
 *
 * The unit suite proves the checks reason correctly about a hand-written
 * snapshot. This suite proves the snapshot is real: that introspection reads
 * what Postgres actually stores, including the parts (deparsed policy
 * expressions, `relforcerowsecurity`, view security options, resolved role
 * membership) that no fixture can be trusted to imitate.
 *
 * It has two halves, and the second one matters more:
 *
 *   - every `vuln_*` object in fixture.sql must produce the finding it was
 *     built to produce;
 *   - every `secure_*` object must produce nothing at all. A scanner that
 *     flags correct schemas gets uninstalled after one run, so the negative
 *     assertions are the ones protecting the tool's usefulness.
 *
 * Skips itself when Docker is unavailable. It must never be the reason a
 * contributor cannot run the test suite.
 */

import { readFileSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { renderReport, runCli, scan, type CliIo } from "../../src/index";
import type { Finding, ScanResult } from "../../src/types";
import {
    applySql,
    isDockerAvailable,
    querySql,
    startPgContainer,
    stopPgContainer,
    type PgContainer
} from "./pg-setup";

const dockerAvailable = await isDockerAvailable();

if (!dockerAvailable) {
    // In CI the skip is the dangerous outcome, not the safe one: this suite is
    // the only thing proving the scanner still detects anything, so a runner
    // that lost Docker would turn the RLS gate green while checking nothing.
    // The pipeline sets RLS_CHECK_REQUIRE_DOCKER=1 to make that a failure; a
    // contributor without Docker still gets a skip and a green `pnpm test`.
    if (process.env.RLS_CHECK_REQUIRE_DOCKER === "1") {
        throw new Error(
            "[rls-check e2e] Docker is unavailable and RLS_CHECK_REQUIRE_DOCKER=1 — refusing to " +
                "skip. A skipped integration suite reports success for a scan that never ran."
        );
    }
    console.warn("[rls-check e2e] Docker is not available — skipping the integration suite.");
}

/**
 * The contract this suite exists to hold: one defect, one object, one finding.
 * `object` is the relation, view or routine name the finding must point at.
 */
const EXPECTED: { id: string; object: string }[] = [
    { id: "rls-disabled", object: "vuln_rls_disabled" },
    { id: "policy-always-true", object: "vuln_policy_always_true" },
    { id: "policy-anonymous-tautology", object: "vuln_anon_tautology" },
    { id: "view-bypasses-rls", object: "vuln_ledger_view" },
    { id: "matview-bypasses-rls", object: "vuln_ledger_matview" },
    { id: "anonymous-write-allowed", object: "vuln_anon_write" },
    { id: "junction-table-unprotected", object: "vuln_post_tags" },
    { id: "rls-enabled-not-forced", object: "vuln_not_forced" },
    { id: "rls-enabled-no-policies", object: "vuln_no_policies" },
    { id: "policy-role-unreachable", object: "vuln_unreachable_policy" },
    { id: "grant-to-public", object: "vuln_grant_public" },
    { id: "security-definer-mutable-search-path", object: "vuln_definer_fn" },
    { id: "current-setting-throws", object: "vuln_current_setting" }
];

/** Correct objects. Not one finding may name any of these. */
const SECURE_OBJECTS = [
    "secure_documents",
    "secure_tenanted",
    "secure_project_members",
    "projects",
    "people"
];

function objectName(finding: Finding): string {
    return finding.target.table ?? finding.target.view ?? finding.target.routine ?? "";
}

function describeFinding(finding: Finding): string {
    return `${finding.id} → ${finding.target.schema}.${objectName(finding)}`;
}

describe.skipIf(!dockerAvailable)("rls-check against a real PostgreSQL", () => {
    let container: PgContainer;
    let full: ScanResult;
    let publicOnly: ScanResult;

    /** The same database, connected as the SELECT-only app role from the fixture. */
    const readonlyConnectionString = (): string =>
        `postgresql://readonly_reports:readonly-reports-e2e@localhost:${container.port}/rlscheck?sslmode=disable`;

    beforeAll(async () => {
        container = await startPgContainer();
        await applySql(container.connectionString, readFileSync(new URL("./fixture.sql", import.meta.url), "utf8"));

        full = await scan({ connectionString: container.connectionString });
        publicOnly = await scan({ connectionString: container.connectionString, schemas: ["public"] });
    });

    afterAll(async () => {
        if (container) await stopPgContainer(container.containerName);
    });

    // -----------------------------------------------------------------------
    // The snapshot itself
    // -----------------------------------------------------------------------

    it("reads the server it actually connected to", () => {
        expect(full.serverVersion).toMatch(/\d+(\.\d+)?/);
        expect(full.stats.tables).toBeGreaterThan(10);
        expect(full.stats.policies).toBeGreaterThan(10);
        expect(full.stats.checksRun).toBeGreaterThan(EXPECTED.length);
        expect(full.database.name).toBe("rlscheck");
        expect(full.database.host).toBe("localhost");
    });

    it("recognises the platform from its schemas and roles", () => {
        // An `auth` schema, a `storage` schema and an `anon` role: Supabase.
        expect(full.platform).toBe("supabase");
    });

    it("leaves the platform's own schemas alone unless asked for them", () => {
        // storage.objects has no RLS and grants SELECT to anon. On a real
        // Supabase project that is true of dozens of tables, by design — a scan
        // that reported them would bury the one finding in `public` that counts.
        expect(full.findings.some((finding) => finding.target.schema === "storage")).toBe(false);
    });

    it("knows the scanning role bypasses RLS, and says so in the report", () => {
        // The container superuser owns everything, so every policy is a no-op
        // for this connection. A report that hid that would be lying by
        // omission — the caveat is the whole reason this assertion exists.
        expect(full.scannerIsPrivileged).toBe(true);
    });

    // -----------------------------------------------------------------------
    // Positive half: one defect, one finding
    // -----------------------------------------------------------------------

    it.each(EXPECTED)("reports $id on $object", ({ id, object }) => {
        const matches = full.findings.filter((finding) => finding.id === id);
        expect(
            matches.length,
            `no finding with id "${id}". Findings: ${full.findings.map(describeFinding).join(", ")}`
        ).toBeGreaterThan(0);

        expect(
            matches.map(objectName),
            `"${id}" did not point at ${object}`
        ).toContain(object);
    });

    it("emits every check id in the catalog at least once", () => {
        const seen = new Set(full.findings.map((finding) => finding.id));
        const missing = EXPECTED.map((entry) => entry.id).filter((id) => !seen.has(id));

        expect(missing, "the fixture no longer exercises these checks").toEqual([]);
    });

    it("gives every finding the fields the report and the JSON contract need", () => {
        for (const finding of full.findings) {
            expect(finding.title.length, describeFinding(finding)).toBeGreaterThan(0);
            expect(finding.detail.length, describeFinding(finding)).toBeGreaterThan(0);
            expect(finding.impact.length, describeFinding(finding)).toBeGreaterThan(0);
            expect(["certain", "heuristic"], describeFinding(finding)).toContain(finding.confidence);
            expect(finding.target.schema.length, describeFinding(finding)).toBeGreaterThan(0);
        }
    });

    // -----------------------------------------------------------------------
    // Negative half: correct objects stay silent
    // -----------------------------------------------------------------------

    it.each(SECURE_OBJECTS)("reports nothing at all about %s", (name) => {
        const offenders = full.findings.filter((finding) => objectName(finding) === name);

        expect(
            offenders.map(describeFinding),
            `${name} is correctly secured and must not be flagged`
        ).toEqual([]);
    });

    it("does not flag a SECURITY DEFINER function whose search_path is pinned", () => {
        const flagged = full.findings
            .filter((finding) => finding.id === "security-definer-mutable-search-path")
            .map(objectName);

        expect(flagged).toContain("vuln_definer_fn");
        expect(flagged).not.toContain("secure_definer_fn");
    });

    /**
     * The regression that matters most in this file: it is the one the unit
     * tests cannot fully prove, because what broke the previous version of this
     * check was the shape Postgres rewrites an expression *into* — the parens it
     * adds around each conjunct, and the `::text` casts it inserts next to every
     * literal. A hand-written qual string is the author guessing at that.
     */
    it("flags a guard that excludes the wrong literal, and not one that excludes the right ones", () => {
        const flagged = full.findings
            .filter((finding) => finding.id === "policy-anonymous-tautology")
            .map(objectName);

        expect(flagged).toContain("vuln_anon_decoy_guard");
        expect(flagged).not.toContain("secure_anon_real_guard");
    });

    it("names the useless literal in the finding, so the reader can see the typo", () => {
        const [f] = full.findings.filter(
            (finding) =>
                finding.id === "policy-anonymous-tautology" &&
                finding.target.table === "vuln_anon_decoy_guard"
        );

        expect(f.title).toContain("'anon'");
        expect(f.detail).toContain("the guard excludes nobody");
    });

    it("records what Postgres rewrote the guard into, because that is what broke it", async () => {
        const [row] = await querySql<{ qual: string }>(
            container.connectionString,
            "SELECT qual FROM pg_policies WHERE policyname = 'vuln_anon_decoy_guard_all'"
        );

        // Neither the parens nor the cast were written in fixture.sql. Both are
        // Postgres's, and both are what a naive split or a literal-string bail
        // fails on. If this assertion ever breaks, the parse needs re-checking
        // before the check is trusted again.
        expect(row.qual).toContain("::text");
        expect(row.qual).toMatch(/\(current_setting/);
    });

    it("does not flag correct tenant scoping as a throwing current_setting", () => {
        const flagged = full.findings
            .filter((finding) => finding.id === "current-setting-throws")
            .map(objectName);

        expect(flagged).toContain("vuln_current_setting");
        expect(flagged).not.toContain("secure_tenanted");
    });

    /**
     * `unqualified-column-in-subquery` is the one check this suite cannot
     * provoke, and the reason is worth recording rather than papering over.
     *
     * The fixture contains the exact bug (`... WHERE memberships.user_id =
     * auth.uid() AND org_id = org_id`, where the second `org_id` was meant to
     * correlate with the outer row). Postgres accepts it — and then stores the
     * policy as a parse tree. `pg_policies.qual` is a re-rendering of that tree,
     * and the renderer qualifies every column reference, so what comes back is
     * `memberships.org_id = memberships.org_id`: the ambiguity is gone from the
     * text even though the bug is still in the database.
     *
     * So the check can only fire on an ambiguity that survives the rewrite, and
     * its real coverage is the unit suite, against snapshots written by hand.
     * This test pins the catalog behaviour that makes that true — if a future
     * Postgres stops re-qualifying, it fails and the check becomes testable
     * end to end.
     */
    it("cannot see the unqualified-column bug through pg_policies, because Postgres re-qualifies it", async () => {
        const [row] = await querySql<{ qual: string }>(
            container.connectionString,
            "SELECT qual FROM pg_policies WHERE policyname = 'vuln_unqualified_select'"
        );

        // The bug is in the database: this predicate compares a column to
        // itself, so the subquery is true for anyone who is a member of
        // anything. The text no longer shows a bare name, which is exactly why
        // a text-matching check cannot catch it here.
        expect(row.qual).toContain("memberships.org_id = memberships.org_id");
        expect(full.findings.filter((finding) => finding.id === "unqualified-column-in-subquery")).toEqual([]);
    });

    it("does not flag a junction table that follows its endpoints", () => {
        const flagged = full.findings
            .filter((finding) => finding.id === "junction-table-unprotected")
            .map(objectName);

        expect(flagged).toContain("vuln_post_tags");
        expect(flagged).not.toContain("secure_project_members");
    });

    // -----------------------------------------------------------------------
    // Selection
    // -----------------------------------------------------------------------

    it("honours --schema", () => {
        expect(full.findings.some((finding) => finding.target.schema === "private_ops")).toBe(true);
        expect(publicOnly.findings.some((finding) => finding.target.schema === "private_ops")).toBe(false);
        expect(publicOnly.findings.some((finding) => finding.target.schema === "public")).toBe(true);
    });

    it("honours --only and --skip", async () => {
        const only = await scan({ connectionString: container.connectionString, only: ["rls-disabled"] });
        expect(only.findings.length).toBeGreaterThan(0);
        expect(new Set(only.findings.map((finding) => finding.id))).toEqual(new Set(["rls-disabled"]));
        expect(only.stats.checksRun).toBe(1);

        const skipped = await scan({ connectionString: container.connectionString, skip: ["rls-disabled"] });
        expect(skipped.findings.some((finding) => finding.id === "rls-disabled")).toBe(false);
        expect(skipped.stats.checksRun).toBe(full.stats.checksRun - 1);
    });

    // -----------------------------------------------------------------------
    // Roles the tool does not know by name
    //
    // The exposed-role set is recognised by name, which is the one place this
    // scanner is not framework-agnostic. These four assertions are the whole
    // contract around that: silence is never the same as a pass.
    // -----------------------------------------------------------------------

    it("does not report a table exposed only to an unrecognised role", () => {
        // Not a bug — a guess. The scan has no evidence that anything arrives
        // as `app_user`, and inventing a critical for every service account
        // would flag half of every real database.
        expect(full.findings.some((finding) => objectName(finding) === "custom_role_table")).toBe(false);
    });

    it("names the unrecognised role instead of reporting a clean database", async () => {
        // The actual fix. Without this the run above is indistinguishable from
        // a database that is genuinely locked down.
        expect(full.diagnostics.unrecognizedGrantees).toContain("app_user");

        const rendered = renderReport(full, { color: false, quiet: false, failOn: "high", width: 100 });
        expect(rendered).toContain("app_user");
        expect(rendered).toContain("--role");
    });

    it("finds the table once the role is named", async () => {
        const scoped = await scan({
            connectionString: container.connectionString,
            roles: ["app_user"]
        });

        const hits = scoped.findings.filter(
            (finding) => finding.id === "rls-disabled" && objectName(finding) === "custom_role_table"
        );
        expect(hits.length, "naming the app role must expose the table the default scan missed").toBe(1);

        // Named explicitly, the role is no longer unexplained.
        expect(scoped.diagnostics.unrecognizedGrantees).not.toContain("app_user");
    });

    it("adds to the recognised roles rather than replacing them", async () => {
        // A union, not an override: passing --role on a Supabase database must
        // not stop the scan reasoning about `anon`. The safe direction for a
        // wrong guess is more coverage, never less.
        const scoped = await scan({
            connectionString: container.connectionString,
            roles: ["app_user"]
        });

        for (const { id, object } of EXPECTED) {
            const stillFound = scoped.findings.some(
                (finding) => finding.id === id && objectName(finding) === object
            );
            expect(stillFound, `--role dropped the default finding ${id} on ${object}`).toBe(true);
        }
    });

    it("names a SELECT-only unrecognised role, because an RLS-disabled table hands it every row", () => {
        // The caveat used to filter on write privileges, which reads the risk
        // backwards: the finding this tool exists for is `rls-disabled`, and
        // what that hands a SELECT-only reporting role is the whole table.
        expect(full.diagnostics.unrecognizedGrantees).toContain("readonly_reports");
    });

    it("refuses a --role that is not in pg_roles instead of quietly narrowing the scan", async () => {
        await expect(
            scan({ connectionString: container.connectionString, roles: ["app_usr"] })
        ).rejects.toThrow(/app_usr/);

        const err: string[] = [];
        const io: CliIo = {
            stdout: () => {},
            stderr: (text) => err.push(text),
            env: {},
            cwd: process.cwd(),
            isTty: false,
            columns: 88
        };

        // Exit 2, not 0 and not 1: same reasoning as an unknown --skip id. A
        // typo that matches no role silently removes coverage, and the run then
        // prints a clean report of a database nobody looked at.
        expect(await runCli([container.connectionString, "--role", "app_usr"], io)).toBe(2);
        expect(err.join("")).toContain("app_usr");
    });

    it("still accepts a --role that exists", async () => {
        const scoped = await scan({ connectionString: container.connectionString, roles: ["app_user"] });
        expect(scoped.exposedRoles).toContain("app_user");
    });

    // -----------------------------------------------------------------------
    // Scanning as the application's own role
    //
    // The way anyone without the superuser password runs this tool. The
    // connecting role was not part of the exposed set, so a scan as
    // `readonly_reports` reported nothing at all about the table
    // `readonly_reports` can read in full.
    // -----------------------------------------------------------------------

    it("treats an unprivileged connecting role as exposed, and reports what it reaches", async () => {
        const asApp = await scan({ connectionString: readonlyConnectionString() });

        expect(asApp.scannerIsPrivileged).toBe(false);
        expect(asApp.exposedRoles).toContain("readonly_reports");
        expect(asApp.diagnostics.scanningAsExposedRole).toBe("readonly_reports");

        const hits = asApp.findings.filter(
            (finding) => finding.id === "rls-disabled" && objectName(finding) === "select_only_table"
        );
        expect(
            hits.length,
            "scanning as a SELECT-only app role must report the RLS-disabled table it can read"
        ).toBe(1);
    });

    it("says in the report that the connecting role was treated as exposed", async () => {
        const asApp = await scan({ connectionString: readonlyConnectionString() });
        const rendered = renderReport(asApp, { color: false, quiet: false, failOn: "high", width: 100 });

        expect(rendered).toContain("readonly_reports");
        expect(rendered).toContain("row-level security does constrain");
    });

    it("does not treat the connecting role as exposed when RLS cannot constrain it", () => {
        // The container superuser: `scannerIsPrivileged` already says nothing
        // below describes this connection, and adding it to the exposed set
        // would flag every table in the database.
        expect(full.exposedRoles).not.toContain("rlscheck");
        expect(full.diagnostics.scanningAsExposedRole ?? null).toBeNull();
    });

    it("names the exposed roles in the report header", () => {
        const rendered = renderReport(full, { color: false, quiet: false, failOn: "high", width: 100 });

        // Every check gates on this set. A reader who cannot see it cannot tell
        // whether "No findings" covered their API role.
        expect(rendered).toMatch(/Exposed\s+PUBLIC, anon, authenticated \(add yours with --role\)/);
    });

    it("honours --role from the command line", async () => {
        const out: string[] = [];
        const io: CliIo = {
            stdout: (text) => out.push(text),
            stderr: () => {},
            env: {},
            cwd: process.cwd(),
            isTty: false,
            columns: 88
        };

        await runCli([container.connectionString, "--json", "--role", "app_user"], io);
        const parsed = JSON.parse(out.join("")) as ScanResult;

        expect(
            parsed.findings.some(
                (finding) => finding.id === "rls-disabled" && objectName(finding) === "custom_role_table"
            )
        ).toBe(true);
    });

    // -----------------------------------------------------------------------
    // The CLI, end to end
    // -----------------------------------------------------------------------

    it("exits 1 with JSON on stdout and nothing else", async () => {
        const out: string[] = [];
        const err: string[] = [];
        const io: CliIo = {
            stdout: (text) => out.push(text),
            stderr: (text) => err.push(text),
            env: {},
            cwd: process.cwd(),
            isTty: false,
            columns: 88
        };

        const code = await runCli([container.connectionString, "--json"], io);

        expect(code).toBe(1);
        const parsed = JSON.parse(out.join("")) as ScanResult;
        expect(parsed.findings.length).toBeGreaterThan(0);
        expect(parsed.database).toEqual({ host: "localhost", name: "rlscheck" });
        // The credential must not survive into either stream, ever.
        expect(out.join("") + err.join("")).not.toContain("rls-check-e2e-secret");
    });

    it("exits 0 with --fail-on none, and 1 by default", async () => {
        const sink: CliIo = {
            stdout: () => {},
            stderr: () => {},
            env: {},
            cwd: process.cwd(),
            isTty: false,
            columns: 88
        };

        expect(await runCli([container.connectionString, "--fail-on", "none", "--quiet"], sink)).toBe(0);
        expect(await runCli([container.connectionString, "--no-color"], sink)).toBe(1);
    });

    it("renders a plain-text report that carries the privilege caveat and no credential", async () => {
        const out: string[] = [];
        const io: CliIo = {
            stdout: (text) => out.push(text),
            stderr: () => {},
            env: { NO_COLOR: "1" },
            cwd: process.cwd(),
            isTty: false,
            columns: 88
        };

        await runCli([container.connectionString], io);
        const text = out.join("");

        expect(text).toContain("row-level security cannot constrain");
        expect(text).toContain("vuln_rls_disabled");
        expect(text).not.toContain("rls-check-e2e-secret");
        // eslint-disable-next-line no-control-regex
        expect(text).not.toMatch(/\u001B\[[0-9;]*m/);
    });
});
