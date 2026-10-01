/**
 * Tests for `pnpm ci:e2e`, the runner every end-to-end suite goes through.
 *
 * The bug it exists for: the e2e-vitest job ran three packages as one
 * `pnpm --filter … --filter … --filter … test:e2e`, and pnpm stops a recursive
 * run at the first package that fails. On 2026-09-30 a timing flake in
 * server-postgres meant the RLS scanner's fixture and the CLI e2e never ran —
 * and the CLI e2e had a real failure, from the day before, that the flake now
 * hid. So the first assertion is the one that matters: a failing suite does not
 * stop the next one, and the run still fails.
 *
 * Driven through `runSuites` with a fake `exec`, because what is under test is
 * the order and the bookkeeping, not the suites.
 *
 * Run: node --test tooling/scripts/test/ci-e2e.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { LANES, runSuites, startPostgres, suiteName, suiteSteps } from "../ci-e2e.mjs";

/** An `exec` that records every command and fails the ones named. */
function fakeExec(failing = new Map()) {
    const ran = [];
    const exec = (command) => {
        const line = command.join(" ");
        ran.push(line);
        for (const [needle, status] of failing) if (line.includes(needle)) return status;
        return 0;
    };
    return { ran, exec };
}

test("a failing suite does not stop the ones after it, and the run still fails", () => {
    const suites = [
        { pkg: "@rebasepro/server-postgres", script: "test:e2e" },
        { pkg: "@rebasepro/rls-check", script: "test:e2e" },
        { pkg: "@rebasepro/cli", script: "test:e2e" }
    ];
    const { ran, exec } = fakeExec(new Map([["server-postgres", 1]]));
    const results = runSuites(suites, { exec });

    assert.equal(ran.length, 3, "every suite ran");
    assert.ok(ran[1].includes("rls-check") && ran[2].includes("@rebasepro/cli"));
    assert.deepEqual(results.map((r) => r.ok), [false, true, true]);
});

test("a suite killed by a signal (status null) is a failure, not a pass", () => {
    const { exec } = fakeExec(new Map([["tests/e2e/tests/client-sdk-e2e.ts", null]]));
    const [result] = runSuites([{ tsx: "tests/e2e/tests/client-sdk-e2e.ts" }], { exec });
    assert.equal(result.ok, false);
});

test("inside one suite, a failed step ends that suite and only that suite", () => {
    const suites = [
        {
            name: "admin",
            steps: [
                { cwd: "app", command: ["pnpm", "exec", "rebase", "db", "push", "--yes"] },
                { cwd: ".", command: ["pnpm", "exec", "playwright", "test"] }
            ]
        },
        { run: "verify:corpus" }
    ];
    const { ran, exec } = fakeExec(new Map([["db push", 1]]));
    const results = runSuites(suites, { exec });

    assert.deepEqual(ran, ["pnpm exec rebase db push --yes", "pnpm run verify:corpus"]);
    assert.equal(results[0].ok, false);
    assert.match(results[0].failedStep, /db push/);
    assert.equal(results[1].ok, true);
});

test("a suite's env sees the lane's database", () => {
    const seen = [];
    const exec = (_command, { env }) => {
        seen.push(env.ACCEPTANCE_DATABASE_URL);
        return 0;
    };
    const database = { url: (db) => `postgres://x@127.0.0.1:1/${db}` };
    runSuites([{ run: "verify:selfhost", env: (pg) => ({ ACCEPTANCE_DATABASE_URL: pg.url("rebase_acceptance") }) }], { exec, database });
    assert.deepEqual(seen, ["postgres://x@127.0.0.1:1/rebase_acceptance"]);
});

test("the vitest lane runs each package on its own, with no retries", () => {
    const vitest = LANES.find((l) => l.lane === "vitest");
    const commands = vitest.suites.flatMap((s) => suiteSteps(s).map((step) => step.command.join(" ")));
    for (const command of commands) {
        assert.equal(command.match(/--filter/g)?.length, 1, `one package per command: ${command}`);
        assert.match(command, /--retry=0$/, `no retries: ${command}`);
    }
    // The four suites the job is for, including the CLI's managed-database suite,
    // which said "CI runs both" and was run by nothing.
    assert.deepEqual(vitest.suites.map(suiteName), [
        "pnpm --filter @rebasepro/server-postgres run test:e2e --retry=0",
        "pnpm --filter @rebasepro/rls-check run test:e2e --retry=0",
        "pnpm --filter @rebasepro/cli run test:e2e --retry=0",
        "pnpm --filter @rebasepro/cli run test:integration --retry=0"
    ]);
});

test("the RLS scan keeps its floors, so an empty database cannot pass it", () => {
    const selfhost = LANES.find((l) => l.lane === "selfhost");
    const scan = selfhost.suites.find((s) => s.run === "rls:check");
    assert.deepEqual(scan.args, ["--min-tables", "8", "--min-policies", "40"]);
});

test("a lane's Postgres is probed over TCP, and removed with its volume when setup fails", () => {
    const calls = [];
    const docker = (args) => {
        calls.push(args.join(" "));
        if (args[0] === "port") return { status: 0, stdout: "127.0.0.1:55123\n", stderr: "" };
        if (args[0] === "exec" && args.includes("createdb")) return { status: 1, stdout: "", stderr: "boom" };
        return { status: 0, stdout: "", stderr: "" };
    };
    assert.throws(() => startPostgres(["rebase_acceptance"], { docker }), /createdb rebase_acceptance: boom/);
    assert.ok(calls.some((c) => c.includes("pg_isready") && c.includes("-h 127.0.0.1")), "readiness over TCP");
    assert.match(calls.at(-1), /^rm -f -v rebase-ci-e2e-/);
});

test("a started Postgres hands out loopback URLs on the port Docker published", () => {
    const docker = (args) => args[0] === "port"
        ? { status: 0, stdout: "127.0.0.1:55123\n", stderr: "" }
        : { status: 0, stdout: "", stderr: "" };
    const pg = startPostgres(["rebase_corpus"], { docker });
    assert.equal(pg.url("rebase_corpus", "?sslmode=disable"), "postgres://rebase:rebase@127.0.0.1:55123/rebase_corpus?sslmode=disable");
});
