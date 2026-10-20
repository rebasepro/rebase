/**
 * Integration: the SQL `--format agent` hands a coding agent, run against a real
 * PostgreSQL.
 *
 * The unit suite applies each remediation to a snapshot. This applies it to the
 * database the snapshot was read from — fixture.sql, which carries one defect
 * per check — and asks two things of Postgres that no model of it can answer:
 *
 *   - does every statement run? A remediation that fails on paste is worse than
 *     none, because an agent reports the migration as written;
 *   - does the finding it was attached to go away on the next scan?
 *
 * Alternatives are run too, inside a transaction that is rolled back: they are
 * offered for a different intent, so they only have to be valid SQL.
 *
 * Skips itself when Docker is unavailable, as `scan.e2e.test.ts` does.
 */
import { readFileSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runCli, scanWithSnapshot, type CliIo } from "../../src/index";
import type { AgentReport } from "../../src/report-agent";
import { remediationFor, type Remediation } from "../../src/remediation";
import { findingKey } from "../../src/report-agent";
import type { DbSnapshot, Finding, ScanResult } from "../../src/types";
import { applySql, isDockerAvailable, startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup";

const dockerAvailable = await isDockerAvailable();

if (!dockerAvailable) {
    if (process.env.RLS_CHECK_REQUIRE_DOCKER === "1") {
        throw new Error("[rls-check e2e] Docker is unavailable and RLS_CHECK_REQUIRE_DOCKER=1 — refusing to skip.");
    }
    console.warn("[rls-check e2e] Docker is not available — skipping the agent remediation suite.");
}

/**
 * What an agent would put in each placeholder, decided the way it would: the
 * owner column is a uuid column of the table, and the application role is
 * `authenticated`. `null` when there is no honest value — a table with no uuid
 * column has no owner to scope to — and the caller then takes the revoke
 * alternative instead, as an agent reading the remediation would.
 */
function fillFor(snapshot: DbSnapshot, finding: Finding, remediation: Remediation, sql: string): string | null {
    let out = sql;
    for (const placeholder of remediation.placeholders) {
        let value: string | undefined;
        if (placeholder.token === "<app_role>") value = "\"authenticated\"";
        if (placeholder.token === "<owner_column>") {
            const rel = snapshot.relations.find((r) => r.schema === finding.target.schema && r.name === finding.target.table);
            const column = rel?.columns.find((c) => c.type === "uuid");
            if (column) value = `"${column.name}"`;
        }
        if (value === undefined) return null;
        out = out.split(placeholder.token).join(value);
    }
    return out;
}

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

describe.skipIf(!dockerAvailable)("--format agent remediations against a real PostgreSQL", () => {
    let container: PgContainer;
    let before: { result: ScanResult; snapshot: DbSnapshot };

    beforeAll(async () => {
        container = await startPgContainer();
        await applySql(container.connectionString, readFileSync(new URL("./fixture.sql", import.meta.url), "utf8"));
        before = await scanWithSnapshot({ connectionString: container.connectionString });
    });

    afterAll(async () => {
        if (container) await stopPgContainer(container.containerName);
    });

    it("prints one parseable document on stdout, with a remediation on every finding", async () => {
        const out: string[] = [];
        const io: CliIo = { stdout: (t) => out.push(t), stderr: () => {}, env: {}, cwd: process.cwd(), isTty: false };

        const code = await runCli([container.connectionString, "--format", "agent"], io);
        const report = JSON.parse(out.join("")) as AgentReport;

        expect(code).toBe(1);
        expect(report.format).toBe("agent");
        expect(report.verdict.exitCode).toBe(code);
        expect(report.findings.length).toBe(before.result.findings.length);
        for (const finding of report.findings) {
            expect(finding.remediation.summary.length, finding.key).toBeGreaterThan(0);
            expect(["sql", "rebase-config", "manual"], finding.key).toContain(finding.remediation.apply);
        }
    });

    it("offers every alternative as SQL Postgres accepts", async () => {
        const failures: string[] = [];
        for (const finding of before.result.findings) {
            const remediation = remediationFor(before.snapshot, finding);
            for (const alternative of remediation.alternatives) {
                const sql = fillFor(before.snapshot, finding, remediation, alternative.sql);
                if (sql === null) continue;
                try {
                    await applySql(container.connectionString, `BEGIN;\n${sql}\nROLLBACK;`);
                } catch (error) {
                    failures.push(`${findingKey(finding)} (alternative): ${errorMessage(error)}`);
                }
            }
        }
        expect(failures).toEqual([]);
    });

    it("runs every remediation, and each clears its finding", async () => {
        const applied: string[] = [];
        const failures: string[] = [];

        for (const finding of before.result.findings) {
            const remediation = remediationFor(before.snapshot, finding);
            if (remediation.apply !== "sql" || remediation.sql === null) continue;
            const sql = fillFor(before.snapshot, finding, remediation, remediation.sql)
                ?? remediation.alternatives.find((a) => a.sql.startsWith("REVOKE"))?.sql
                ?? null;
            if (sql === null) {
                failures.push(`${findingKey(finding)}: no value for a placeholder and no revoke to fall back on`);
                continue;
            }
            try {
                await applySql(container.connectionString, sql);
                applied.push(findingKey(finding));
            } catch (error) {
                failures.push(`${findingKey(finding)}: ${errorMessage(error)}`);
            }
        }

        expect(failures).toEqual([]);
        // Every check in the fixture has a SQL remediation on a Supabase-shaped
        // database; none of them is "manual" here.
        expect(new Set(applied.map((key) => key.split(":")[0])).size).toBeGreaterThanOrEqual(15);

        const after = await scanWithSnapshot({ connectionString: container.connectionString });
        const remaining = new Set(after.result.findings.map(findingKey));
        expect(applied.filter((key) => remaining.has(key))).toEqual([]);

        // Fixing one thing must not open a worse one.
        const introduced = after.result.findings
            .filter((f) => !before.result.findings.some((b) => findingKey(b) === findingKey(f)))
            .filter((f) => f.severity === "critical" || f.severity === "high")
            .map(findingKey);
        expect(introduced).toEqual([]);
    });
});
