/**
 * Every end-to-end suite, as one command — the four `e2e-*` jobs of
 * .github/workflows/verify.yml, and the half of "what CI runs" that
 * `verify-quality.sh` left out.
 *
 * `ci:static` and `ci:build-gates` made the gate lists something a contributor
 * can run. The end-to-end suites stayed YAML steps, with the cost those two were
 * written to remove: `verify-quality.sh` — "what CI runs" in AGENTS.md — ran
 * Playwright and none of the rest. Not the RLS enforcement suite, not policy
 * agreement, not the CLI scaffold, not self-host. The CLI e2e failed on main for
 * days after a commit "verified end to end" by hand, because nothing a developer
 * runs before pushing ran it.
 *
 * And a list run as one `pnpm --filter a --filter b --filter c test:e2e` bails
 * at the first package that fails: on 2026-09-30 a timing flake in
 * server-postgres meant the RLS scanner's detection fixture and the CLI e2e
 * never started, and the CLI e2e's real failure from the day before hid behind
 * it. So every suite here runs on its own, every one runs whatever the one
 * before it did, and the run fails at the end if any of them failed.
 *
 *   pnpm run build && pnpm ci:e2e      every lane, one after another
 *   pnpm ci:e2e --lane vitest          one lane: what one CI job runs
 *   pnpm ci:e2e --list                 the lanes and their suites
 *
 * A lane is a CI job. The job installs what a runner image lacks (Playwright's
 * browser and its system libraries) and uploads what the suites leave behind;
 * everything between those two is the lane, here, so the job and a developer
 * run the same thing. A lane that needs a database server starts its own —
 * a throwaway `postgres:18` container on a free port, removed afterwards —
 * rather than assuming one on 5432, which on a developer's machine is
 * somebody else's database.
 *
 * No retries anywhere. Every vitest suite runs with `--retry=0`, so a flake
 * fails the run and gets fixed, rather than turning a 1-in-15 failure into
 * one in 3,375 that nobody hears about.
 */
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PROBE_TIMEOUT_MS, probeTool } from "./probe-tool.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

/** ~4GB: the scaffolds and the bundle builds OOM at the default. */
const BIG_HEAP = { NODE_OPTIONS: "--max_old_space_size=4096" };

/**
 * The lanes, in the order `pnpm ci:e2e` runs them, and their suites.
 *
 * A suite is one of:
 *   - `run`  — a root package.json script (`check:gates-doc` holds these against
 *              the "End to end" section of docs/gates.md);
 *   - `pkg` + `script` — a workspace package's own suite;
 *   - `tsx`  — a driver under tests/e2e/tests, run with tsx;
 *   - `steps` — commands that only mean something in order (`db push`, then the
 *              seed, then the browser), each one stopping the suite if it fails.
 *
 * `env` receives the lane's database, when the lane has one. `why` is the
 * rationale that used to be a YAML comment above the step, printed when the
 * suite fails: it is the fastest answer to "what is this even for".
 */
export const LANES = [
    {
        lane: "vitest",
        job: "e2e-vitest",
        needs: ["docker"],
        suites: [
            {
                pkg: "@rebasepro/server-postgres", script: "test:e2e", args: ["--retry=0"],
                why: `The product's real security coverage, orphaned until it joined CI (this
suite ran in NO pipeline, so a change breaking RLS shipped green — AUDIT P0 #2).
rls-enforcement boots a real Postgres and asserts DB state after every RLS
denial; policy-agreement proves the Postgres and JS policy backends agree;
cdc/db/channel-history/cron round out the integration surface. Each file boots
and tears down its own Postgres via Docker on a random host port, and the
config sets \`fileParallelism: false\`, so one container is live at a time.`
            },
            {
                pkg: "@rebasepro/rls-check", script: "test:e2e", args: ["--retry=0"],
                env: () => ({ RLS_CHECK_REQUIRE_DOCKER: "1" }),
                why: `Its fixture asserts that each of the fourteen checks fires on the object
built to trip it AND that nothing fires on the \`secure_*\` objects — the only
thing standing between the RLS scan in the selfhost lane and a scanner that has
quietly stopped detecting anything. RLS_CHECK_REQUIRE_DOCKER turns its "no
Docker, skip" escape hatch into a failure: a skipped suite reports success for a
scan that never ran.`
            },
            {
                pkg: "@rebasepro/cli", script: "test:e2e", args: ["--retry=0"],
                why: `\`rebase init\` → install → schema generate → db push → dev → auth reset →
db generate → db migrate from scratch → branches, against a real Postgres. It
failed on main from 2026-09-28 (generated SQL moved to .rebase/sql) and nobody
saw it: the step that ran it bailed on an earlier package's flake.`
            },
            {
                pkg: "@rebasepro/cli", script: "test:integration", args: ["--retry=0"],
                why: `\`rebase dev\`'s zero-setup database: the PGlite daemon, RLS really enforced on
it, daemon adoption (two processes on one data directory would corrupt it),
LISTEN through the notification proxy, and two-database provisioning. Its
config said "CI runs both"; until this lane, nothing ran it.`
            }
        ]
    },
    {
        lane: "cli",
        job: "e2e-cli",
        needs: ["docker"],
        suites: [
            {
                run: "check:contributor-setup:live",
                // Off 5432, which is the port a developer's own Postgres has —
                // which also makes this the override the docs teach, exercised.
                env: () => ({ REBASE_DB_PORT: process.env.REBASE_DB_PORT ?? "5433" }),
                why: `CONTRIBUTING's Getting Started, executed rather than compared.
\`check:contributor-setup\` reads the compose file, \`app/.env.example\` and the
steps and checks they agree; all three can agree on \`localhost:5432\` and the
URL still not reach the container, because Docker publishes on \`0.0.0.0\` and a
native Postgres binds the more specific \`127.0.0.1\`, which wins for
\`localhost\`. Compose then reports \`Up (healthy)\` while \`db push\` writes the
schema into the developer's own database, with no error anywhere on the path.`
            },
            {
                tsx: "tests/e2e/tests/cli-init-e2e.ts",
                env: () => ({
                    SCREENSHOT_DIR: process.env.SCREENSHOT_DIR ?? path.join(repoRoot, ".artifacts", "e2e-screenshots")
                }),
                why: `The CMS scaffold, installed and booted for real, with screenshots of what it
serves (the job uploads them).`
            },
            {
                tsx: "tests/e2e/tests/cli-init-baas-e2e.ts",
                why: `The only place a scaffolded BaaS project is installed and booted for real —
workspace: deps resolve nowhere else — so it is what proves the baas template
rather than just the library behind it.`
            },
            {
                tsx: "tests/e2e/tests/client-sdk-e2e.ts",
                why: `\`@rebasepro/client\`, driven the way a browser application drives it: register,
sign in, have the server derive auth.uid() from the token, have Postgres scope
rows to it, refresh, upload a file, receive a realtime event, sign out. Every
tier of this path was covered and the composition of them was not — the BaaS
e2e authenticates with a SERVICE KEY, which bypasses user identity and never
exercises RLS. It boots the reference backend on a real socket, because a token
that never crosses one proves nothing about headers, and realtime is a WebSocket
upgrade an in-process fetch cannot perform. It found that \`client.close()\` left
the token-refresh timer armed, so any signed-in Node script hung forever.`
            }
        ]
    },
    {
        lane: "selfhost",
        job: "e2e-selfhost",
        needs: ["docker"],
        databases: ["rebase_acceptance", "rebase_corpus"],
        suites: [
            {
                run: "verify:selfhost",
                env: (pg) => ({ ACCEPTANCE_DATABASE_URL: pg.url("rebase_acceptance") }),
                why: `Build a real bundle from the reference app's collections, fold two static apps
in at different paths, boot it against a real database and fetch it as a
browser would. The script says to run it when you touch the manifest, the bundle
format, folding or serveSPA — and until CI did, nothing did, so the multi-app
serving path had no automated proof at any tier.`
            },
            {
                run: "verify:selfhost:docker",
                why: `The same recipe through the artifact a stranger actually runs: builds the image
from this commit, brings \`infra/docker/docker-compose.selfhost.yml\` up on
non-default ports and fetches from OUTSIDE the container — the SPA, a 401 on an
unauthenticated read, the collections served to a service key, a seeded admin
who can sign in — then restarts the api, because provisioning runs on every boot
and the second one is where a non-idempotent step surfaces. Then again with the
compose file \`rebase init\` generates, whose environment contract is a different
one answered by a different writer.`
            },
            {
                run: "verify:corpus",
                env: (pg) => ({ CORPUS_DATABASE_URL: pg.url("rebase_corpus") }),
                why: `Every bundle shape ever shipped, booted on the runtime as it is now — and the
representative one once per published \`@rebasepro/server-postgres\`, with
today's server over it, the pairing every managed project runs. The managed
tier moves projects onto new images without anyone rebuilding them, so these
are the regressions a fleet-wide upgrade turns into one simultaneous outage.
The fixtures are frozen and hand-authored; see tests/fixtures/bundles/README.md.`
            },
            {
                run: "rls:check",
                args: ["--min-tables", "8", "--min-policies", "40"],
                env: (pg) => ({ RLS_CHECK_DATABASE_URL: pg.url("rebase_acceptance", "?sslmode=disable") }),
                why: `The scan, pointed at a database this lane generated: \`verify:selfhost\` runs
\`rebase db push\` over the reference app's collections into rebase_acceptance,
so it holds the same artefact a user gets. Findings the collections declare on
purpose live in tooling/scripts/rls-baseline.json, per table, with a reason.
The floors are what stop it being vacuous: it runs even when the push above
failed, and against the empty database that leaves it would find nothing and
exit 0. They are floors, not equality — set well below the ~11 tables / ~88
policies the reference app generates.`
            }
        ]
    },
    {
        lane: "admin",
        job: "e2e-admin",
        needs: ["docker"],
        databases: ["rebase_admin_e2e"],
        suites: [
            {
                name: "admin panel: db push, seed, Playwright",
                env: (pg) => ({
                    // sslmode=disable: the container serves no TLS, and Atlas
                    // (which `db push` shells out to) negotiates SSL first and
                    // fails with "SSL is not enabled on the server".
                    DATABASE_URL: pg.url("rebase_admin_e2e", "?sslmode=disable"),
                    JWT_SECRET: process.env.JWT_SECRET ?? "ci-admin-e2e-secret-ci-admin-e2e-secret-0123456789"
                }),
                steps: [
                    { cwd: "app", command: ["pnpm", "exec", "rebase", "db", "push", "--yes"] },
                    { cwd: "app/backend", command: ["pnpm", "exec", "tsx", "src/seed.ts"] },
                    // A test that passes only on a retry fails the run. Retried
                    // away, a 1-in-15 failure reaches the log about once in 3,375
                    // runs, and the html report was the only place it was written.
                    {
                        cwd: ".",
                        command: ["pnpm", "exec", "playwright", "test", "-c", "tests/e2e/playwright.config.ts", "--fail-on-flaky-tests"]
                    }
                ],
                why: `The admin panel itself, driven in a browser: every collection view, the
collection editor and the SQL console. Schema then seed into a database made
here — \`db push\` is what a developer runs, so a break in it fails here rather
than in somebody's first ten minutes — and since that database starts empty,
globalSetup drives the first-admin bootstrap, the first thing every new user
of Rebase does. \`collections-crud\` lost about one run in fifteen to a list
whose order is random, and re-runs taught everyone it was a flake: a suite this
size is green by luck often enough that "I ran it a few times" is not evidence —
repeat the individual test.`
            }
        ]
    }
];

/** A suite's display name, which is also how to run it by hand. */
export function suiteName(suite) {
    if (suite.name) return suite.name;
    if (suite.run) return `pnpm run ${[suite.run, ...(suite.args ?? [])].join(" ")}`;
    if (suite.pkg) return `pnpm --filter ${suite.pkg} run ${[suite.script, ...(suite.args ?? [])].join(" ")}`;
    if (suite.tsx) return `pnpm exec tsx ${suite.tsx}`;
    throw new Error(`A suite with no run, pkg, tsx or steps: ${JSON.stringify(suite)}`);
}

/** The commands a suite runs, in order, each with the directory it runs in. */
export function suiteSteps(suite) {
    if (suite.steps) return suite.steps.map(({ cwd, command }) => ({ cwd: path.join(repoRoot, cwd), command }));
    if (suite.run) return [{ cwd: repoRoot, command: ["pnpm", "run", suite.run, ...(suite.args ?? [])] }];
    if (suite.pkg) {
        return [{ cwd: repoRoot, command: ["pnpm", "--filter", suite.pkg, "run", suite.script, ...(suite.args ?? [])] }];
    }
    if (suite.tsx) return [{ cwd: repoRoot, command: ["pnpm", "exec", "tsx", suite.tsx] }];
    throw new Error(`A suite with no run, pkg, tsx or steps: ${JSON.stringify(suite)}`);
}

/**
 * Run every suite, whatever happened to the one before it.
 *
 * `exec` runs one command and returns its exit status — `spawnSync` by default,
 * a fake in the runner's own tests. A `null` status (killed, or never started)
 * is a failure, not a pass. Within a suite's `steps`, a failed step ends that
 * suite: the browser run means nothing against a database the push never built.
 * Across suites nothing ends anything.
 *
 * @returns {{ name: string, ok: boolean, failedStep?: string }[]}
 */
export function runSuites(suites, { exec, database = null, log = () => {} }) {
    const results = [];
    for (const suite of suites) {
        const name = suiteName(suite);
        log(name);
        const env = { ...BIG_HEAP, ...(suite.env ? suite.env(database) : {}) };
        let failedStep;
        for (const step of suiteSteps(suite)) {
            const status = exec(step.command, { cwd: step.cwd, env });
            if (status !== 0) {
                failedStep = step.command.join(" ");
                break;
            }
        }
        results.push({ name, ok: failedStep === undefined, ...(failedStep ? { failedStep } : {}) });
    }
    return results;
}

/**
 * A throwaway Postgres, the way the CI jobs used to start theirs, minus the
 * fixed port.
 *
 * Readiness is asked over TCP (`-h 127.0.0.1`): the image runs a temporary
 * server during initdb that listens on the unix socket only, so a socket probe
 * reports ready against the server that is about to shut down, and the next
 * command lands in the gap between the two. That is what took e2e-selfhost
 * down mid-release.
 *
 * Removed with `-v`: a `docker rm` without it keeps the image's anonymous data
 * volume, and 577 of them once filled a disk.
 */
export function startPostgres(databases, { docker = dockerSync } = {}) {
    const container = `rebase-ci-e2e-${crypto.randomUUID().slice(0, 8)}`;
    const run = docker([
        "run", "-d", "--name", container,
        "-e", "POSTGRES_USER=rebase", "-e", "POSTGRES_PASSWORD=rebase", "-e", "POSTGRES_DB=rebase",
        "-p", "127.0.0.1::5432",
        "postgres:18"
    ]);
    if (run.status !== 0) throw new Error(`could not start a Postgres container: ${run.stderr.trim()}`);

    const stop = () => docker(["rm", "-f", "-v", container]);
    try {
        const mapping = docker(["port", container, "5432/tcp"]).stdout;
        const port = mapping.match(/:(\d+)\s*$/m)?.[1];
        if (!port) throw new Error(`no host port published for ${container}: ${JSON.stringify(mapping)}`);

        const deadline = Date.now() + 120_000;
        while (docker(["exec", container, "pg_isready", "-U", "rebase", "-d", "rebase", "-h", "127.0.0.1"]).status !== 0) {
            if (Date.now() > deadline) throw new Error(`${container} did not accept TCP connections within 120s`);
            spawnSync("sleep", ["1"]);
        }
        for (const database of databases) {
            const created = docker(["exec", container, "createdb", "-U", "rebase", database]);
            if (created.status !== 0) throw new Error(`createdb ${database}: ${created.stderr.trim()}`);
        }
        return {
            container,
            /** 127.0.0.1, not localhost: the port is published on IPv4 only, and localhost may resolve to ::1 first. */
            url: (database, query = "") => `postgres://rebase:rebase@127.0.0.1:${port}/${database}${query}`,
            stop
        };
    } catch (error) {
        stop();
        throw error;
    }
}

function dockerSync(args) {
    const result = spawnSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function execInherit(command, { cwd, env }) {
    const result = spawnSync(command[0], command.slice(1), {
        cwd,
        stdio: "inherit",
        env: { ...process.env, ...env }
    });
    return result.status;
}

/** Packages with a build script and no `dist`: the suites spawn the built CLI and server. */
function unbuiltPackages() {
    const dir = path.join(repoRoot, "packages");
    return fs.readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .filter((name) => {
            const manifest = path.join(dir, name, "package.json");
            if (!fs.existsSync(manifest)) return false;
            const { scripts = {} } = JSON.parse(fs.readFileSync(manifest, "utf8"));
            return Boolean(scripts.build) && !fs.existsSync(path.join(dir, name, "dist"));
        });
}

function main(argv) {
    const bold = (s) => `\x1b[1m${s}\x1b[0m`;
    const dim = (s) => `\x1b[2m${s}\x1b[0m`;
    const red = (s) => `\x1b[31m${s}\x1b[0m`;
    const green = (s) => `\x1b[32m${s}\x1b[0m`;

    if (argv.includes("--list")) {
        for (const { lane, job, suites } of LANES) {
            console.log(`${lane} (${job})`);
            for (const suite of suites) console.log(`    ${suiteName(suite)}`);
        }
        return 0;
    }

    const wanted = argv.flatMap((arg, i) => (argv[i - 1] === "--lane" ? arg.split(",") : []));
    const unknown = wanted.filter((name) => !LANES.some((l) => l.lane === name));
    if (unknown.length) {
        console.error(red(`✗ ci:e2e — no lane named ${unknown.join(", ")}. Lanes: ${LANES.map((l) => l.lane).join(", ")}.`));
        return 2;
    }
    const lanes = wanted.length ? LANES.filter((l) => wanted.includes(l.lane)) : LANES;

    const unbuilt = unbuiltPackages();
    if (unbuilt.length) {
        console.error(red(`✗ ci:e2e — ${unbuilt.length} package(s) are not built: ${unbuilt.join(", ")}.\n`));
        console.error(dim(
            "  These suites spawn the built CLI and server and scaffold projects that\n" +
            "  consume every package as built output.\n\n" +
            "    pnpm --filter './packages/*' -r run build\n"
        ));
        return 1;
    }

    const started = Date.now();
    const results = [];
    for (const lane of lanes) {
        console.log(`\n${bold(`━━━ lane: ${lane.lane} (CI job ${lane.job}) ━━━`)}`);

        const missing = (lane.needs ?? [])
            .map((tool) => ({ tool, probe: probeTool(tool) }))
            .filter(({ probe }) => !probe.ok);
        if (missing.length) {
            // Not a skip. A lane that did not run passes nothing, and this
            // command's whole claim is that passing it means CI will pass.
            for (const { tool, probe } of missing) {
                console.error(red(`✗ ${lane.lane} needs ${tool}: ${probe.reason} (asked for up to ${PROBE_TIMEOUT_MS / 1000}s).`));
            }
            for (const suite of lane.suites) results.push({ lane: lane.lane, name: suiteName(suite), ok: false, failedStep: "not run" });
            continue;
        }

        let database = null;
        if (lane.databases?.length) {
            try {
                database = startPostgres(lane.databases);
                console.log(dim(`· Postgres for this lane: ${database.container} (${lane.databases.join(", ")})`));
            } catch (error) {
                console.error(red(`✗ ${lane.lane}: ${error.message}`));
                for (const suite of lane.suites) results.push({ lane: lane.lane, name: suiteName(suite), ok: false, failedStep: "not run" });
                continue;
            }
        }
        const reap = () => database?.stop();
        process.once("exit", reap);
        try {
            const laneResults = runSuites(lane.suites, {
                exec: execInherit,
                database,
                log: (name) => console.log(`\n${bold(`── ${name}`)}`)
            });
            laneResults.forEach((result, i) => {
                results.push({ lane: lane.lane, ...result });
                const { why } = lane.suites[i];
                if (!result.ok && why) console.error(dim(`\n  ${result.name}:\n${why.split("\n").map((line) => `  ${line}`).join("\n")}\n`));
            });
        } finally {
            reap();
            process.removeListener("exit", reap);
        }
    }

    const minutes = ((Date.now() - started) / 60000).toFixed(1);
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${bold("━━━ ci:e2e summary ━━━")}`);
    for (const r of results) {
        console.log(`${r.ok ? green("✓") : red("✗")} ${dim(`[${r.lane}]`)} ${r.name}${r.ok ? "" : red(`  — failed: ${r.failedStep}`)}`);
    }
    if (failed.length === 0) {
        console.log(green(`\n✓ ci:e2e — ${results.length} suite(s) passed in ${minutes}m`));
        return 0;
    }
    console.error(red(`\n✗ ci:e2e — ${failed.length} of ${results.length} suite(s) failed in ${minutes}m.`));
    return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    for (const signal of ["SIGINT", "SIGTERM"]) {
        // Turn a signal into an exit, so the "exit" handler that removes a
        // lane's container runs. Without this a Ctrl-C leaves it up, holding a port.
        process.once(signal, () => process.exit(130));
    }
    process.exit(main(process.argv.slice(2)));
}
