/**
 * `--format agent`: the flag, and the document it prints.
 *
 * The remediations themselves are pinned per check id in `remediation.test.ts`;
 * this covers the envelope an agent parses around them, which has to stay
 * stable — every key present, `null` rather than absent — and the parsing of
 * the flag, which must not let `--json` and `--format agent` silently fight.
 */
import { describe, expect, it } from "vitest";

import { grant, snapshot, table } from "../test/fixtures/snapshot";
import { runChecks } from "./checks";
import { buildScanResult, parseArgs, runCli, type CliIo } from "./cli";
import { findingKey, renderAgentReport, type AgentReport } from "./report-agent";
import type { DbSnapshot } from "./types";

function scanOf(snap: DbSnapshot) {
    return buildScanResult(snap, runChecks(snap), {
        connectionString: "postgresql://u:secret@db.example.com:5432/app",
        checksRun: 15,
        scannedAt: "2026-10-20T00:00:00.000Z",
        diagnostics: { degraded: [], tlsVerificationDisabled: false, excludedSchemas: [], unrecognizedGrantees: [] }
    });
}

const SNAP = snapshot({
    platform: "supabase",
    relations: [table("public", "todos", { columns: ["id", { name: "user_id", type: "uuid" }] })],
    grants: [grant("public", "todos", "anon", ["SELECT", "INSERT"])]
});

/** The document as an agent would read it; its shape is pinned by the snapshot below. */
const parse = (output: string): AgentReport => JSON.parse(output) as AgentReport;

describe("parseArgs --format", () => {
    it("accepts agent, json and text", () => {
        for (const format of ["agent", "json", "text"] as const) {
            const parsed = parseArgs(["--format", format]);
            expect(parsed.ok && parsed.options.format).toBe(format);
        }
        const inline = parseArgs(["--format=AGENT"]);
        expect(inline.ok && inline.options.format).toBe("agent");
    });

    it("keeps --json as --format json", () => {
        const parsed = parseArgs(["--json"]);
        expect(parsed.ok && parsed.options.format).toBe("json");
        expect(parsed.ok && parsed.options.json).toBe(true);
        const both = parseArgs(["--json", "--format", "json"]);
        expect(both.ok).toBe(true);
    });

    it("refuses two different formats rather than letting one win", () => {
        const parsed = parseArgs(["--json", "--format", "agent"]);
        expect(parsed.ok).toBe(false);
        expect(!parsed.ok && parsed.message).toContain("Two output formats");
    });

    it("refuses an unknown format and a missing one", () => {
        const unknown = parseArgs(["--format", "yaml"]);
        expect(!unknown.ok && unknown.message).toContain("text, json, agent");
        expect(parseArgs(["--format"]).ok).toBe(false);
    });

    it("is listed in --help", async () => {
        const out: string[] = [];
        const io: CliIo = { stdout: (t) => out.push(t), stderr: () => {}, env: {}, cwd: process.cwd(), isTty: false };
        await runCli(["--help"], io);
        expect(out.join("")).toMatch(/^ {2}--format <name> {2,}\S/m);
    });

    it("prints the catalogue as JSON with --list-checks", async () => {
        const out: string[] = [];
        const io: CliIo = { stdout: (t) => out.push(t), stderr: () => {}, env: {}, cwd: process.cwd(), isTty: false };
        await runCli(["--format", "agent", "--list-checks"], io);
        const catalogue: unknown = JSON.parse(out.join(""));
        expect(Array.isArray(catalogue) && catalogue.length).toBe(15);
    });
});

describe("renderAgentReport", () => {
    const result = scanOf(SNAP);
    const output = renderAgentReport(result, SNAP, { failOn: "high", version: "0.0.0-test" });
    const report = parse(output);

    it("is the whole document, and stable", () => {
        expect(report).toMatchSnapshot();
    });

    it("carries every finding, with the failing object and a remediation", () => {
        expect(report.findings.map((f) => f.key).sort()).toEqual(result.findings.map(findingKey).sort());
        const [first] = report.findings;
        expect(first.checkId).toBe("rls-disabled");
        expect(first.target).toEqual({ schema: "public", table: "todos", policy: null, view: null, routine: null, column: null });
        expect(first.remediation.sql).toContain("ENABLE ROW LEVEL SECURITY");
        expect(first.remediation.rebase.snippet).toContain("ownerField: \"user_id\"");
    });

    it("agrees with the exit code the CLI uses", () => {
        expect(report.verdict.exitCode).toBe(1);
        expect(report.summary.failing).toBe(report.findings.filter((f) => f.failsRun).length);
        expect(report.complete).toBe(true);
    });

    it("never prints the connection string", () => {
        expect(output).not.toContain("secret");
    });

    it("says so when the scan was incomplete", () => {
        const degraded = { ...result, diagnostics: { ...result.diagnostics, degraded: [{ what: "grants", error: "timeout" }] } };
        const partial = parse(renderAgentReport(degraded, SNAP, { failOn: "high", version: "0.0.0-test" }));
        expect(partial.complete).toBe(false);
        expect(partial.verdict.exitCode).toBe(2);
        expect(partial.notes.join(" ")).toContain("incomplete");
    });
});
