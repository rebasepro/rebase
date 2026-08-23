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
