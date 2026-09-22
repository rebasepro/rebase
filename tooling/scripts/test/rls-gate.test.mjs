/**
 * Tests for the `pnpm rls:check` verdict.
 *
 * Two ways it used to pass a database it should have failed, both on the path
 * CI reads ("RLS scan of the generated schema" in verify.yml):
 *
 *   - The baseline key was check id + table. The reference app baselines its
 *     public-read SELECT policies, so a new always-true DELETE policy on the
 *     same table — a generator regression turning an admin-only write rule into
 *     `USING (true)` — matched the SELECT entry and exited 0.
 *   - A degraded scan (a catalogue read failed, so whole checks saw nothing)
 *     printed "No unexpected RLS findings" and exited 0.
 *
 * Run: node --test tooling/scripts/test/
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { entryKey, findingKey, verdict } from "../rls-gate.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** A `policy-always-true` finding, in the shape rls-check emits it. */
function alwaysTrue(table, policy) {
    return {
        id: "policy-always-true",
        severity: "critical",
        confidence: "certain",
        title: `Policy "${policy}" on public.${table} is USING (true) for PUBLIC`,
        target: { schema: "public", table, policy }
    };
}

const SELECT_ENTRY = {
    check: "policy-always-true",
    target: "public.posts",
    command: "SELECT",
    reason: "Reference app: public read by default."
};

const POLICIES = [
    { schema: "public", table: "posts", name: "posts_select_841c287", command: "SELECT" },
    { schema: "public", table: "posts", name: "posts_delete_1a2b3c4", command: "DELETE" }
];

function run(overrides) {
    return verdict({
        stats: { tables: 10, policies: 40 },
        findings: [],
        diagnostics: { degraded: [] },
        policies: POLICIES,
        baseline: [SELECT_ENTRY],
        isGating: () => true,
        minTables: 1,
        minPolicies: 1,
        ...overrides
    });
}

test("a baselined public-read SELECT policy passes", () => {
    const result = run({ findings: [alwaysTrue("posts", "posts_select_841c287")] });
    assert.equal(result.code, 0);
    assert.deepEqual(result.stale, []);
});

test("an always-true write policy on a table baselined for public reads fails", () => {
    const deletePolicy = alwaysTrue("posts", "posts_delete_1a2b3c4");
    const result = run({ findings: [alwaysTrue("posts", "posts_select_841c287"), deletePolicy] });
    assert.equal(result.code, 1, "the SELECT entry must not accept a DELETE policy on the same table");
    assert.deepEqual(result.unexpected, [deletePolicy]);
    assert.equal(findingKey(deletePolicy, POLICIES), "policy-always-true public.posts DELETE");
});

test("a finding on a policy the snapshot does not know matches no entry", () => {
    const orphan = alwaysTrue("posts", "posts_select_ffffff0");
    assert.equal(findingKey(orphan, POLICIES), "policy-always-true public.posts ?");
    assert.equal(run({ findings: [orphan] }).code, 1);
});

test("an entry without a command never accepts a policy finding", () => {
    const { command: _command, ...commandless } = SELECT_ENTRY;
    const result = run({ findings: [alwaysTrue("posts", "posts_select_841c287")], baseline: [commandless] });
    assert.equal(result.code, 1);
    assert.deepEqual(result.stale, [commandless]);
});

test("a finding about a table, not a policy, keys on the table alone", () => {
    const finding = { id: "rls-disabled", severity: "critical", title: "", target: { schema: "public", table: "tags" } };
    const entry = { check: "rls-disabled", target: "public.tags", reason: "test" };
    assert.equal(findingKey(finding, POLICIES), entryKey(entry));
    assert.equal(run({ findings: [finding], baseline: [entry] }).code, 0);
});

test("a degraded scan is not a clean one", () => {
    const result = run({
        findings: [alwaysTrue("posts", "posts_select_841c287")],
        diagnostics: { degraded: [{ what: "grants", error: "permission denied for table pg_class" }] }
    });
    assert.equal(result.code, 2, "a catalogue read that failed must exit 2 even with nothing unexpected");
    assert.equal(result.degraded.length, 1);
});

test("an empty database is a setup failure, not a pass", () => {
    const result = run({ stats: { tables: 0, policies: 0 } });
    assert.equal(result.code, 2);
    assert.equal(result.shortfall.length, 2);
});

test("every policy entry in the committed baseline names its command", () => {
    const { accepted } = JSON.parse(fs.readFileSync(path.join(ROOT, "tooling/scripts/rls-baseline.json"), "utf8"));
    const policyEntries = accepted.filter((entry) => entry.check === "policy-always-true");
    assert.ok(policyEntries.length > 0);
    for (const entry of policyEntries) {
        assert.equal(entry.command, "SELECT", `${entry.target}: only a public READ is intended; name the command`);
    }
});
