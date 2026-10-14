/**
 * `rebase db url` and `rebase console -e` after `rebase dev --docker`, with the
 * container stopped.
 *
 * `db url` prints the connection string "and nothing else, so it pipes" — and
 * that held only while the container was up. Stopped (any reboot, any Docker
 * restart), `db url` starts it first, and the start-up lines went to stdout:
 *
 *     $ rebase db url 2>/dev/null
 *       Database not running — starting it…
 *       ✓ Database ready on port 5508
 *     postgresql://rebase_app:…@127.0.0.1:5508/rebase?…
 *
 * so `psql "$(rebase db url)"` failed on `missing "=" after "Database"`, and
 * `DATABASE_URL="$(rebase db url)"` held three lines — the line `rebase start`
 * prints, and the restore-then-pull route `db restore` prints, both use it.
 * `rebase console -e … | jq` broke the same way, through the same step. The
 * second run worked, because the container was up by then, which made it look
 * flaky.
 *
 * Against a real compose container, started and then stopped, because the
 * lines come from the step that starts it. Needs Docker; a missing Docker
 * fails the suite rather than skipping it, since a skipped suite reports a pass.
 */
import { execa } from "execa";
import crypto from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { findFreePort } from "../dev-db/state";

const state = vi.hoisted(() => ({ root: "" }));

vi.mock("../utils/project", async importOriginal => ({
    ...await importOriginal<typeof import("../utils/project")>(),
    requireProjectRoot: () => state.root
}));

// The driver child stood in for: it would print the `--eval` result, and the
// assertion is about everything the CLI prints around it.
vi.mock("./db", async importOriginal => ({
    ...await importOriginal<typeof import("./db")>(),
    resolveDriverCli: async () => ({
        projectRoot: state.root,
        backendDir: path.join(state.root, "backend"),
        pluginCli: "driver-cli.js",
        env: {}
    }),
    spawnDriverCli: async () => {
        console.log(JSON.stringify({ count: 1 }));
    }
}));

const { dbCommand } = await import("./db");
const { consoleCommand } = await import("./console");

const composeProject = `${process.env.REBASE_E2E_CONTAINER_PREFIX || "rebase-db-url-it-"}${crypto.randomUUID().slice(0, 8)}`;
let port = 0;

const compose = (...args: string[]) => execa("docker", ["compose", ...args], { cwd: state.root });

beforeAll(async () => {
    state.root = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-db-url-docker-"));
    port = await findFreePort();
    fs.writeFileSync(path.join(state.root, "rebase.json"), "{}\n");
    fs.writeFileSync(path.join(state.root, "docker-compose.yml"), [
        `name: ${composeProject}`,
        "services:",
        "  db:",
        "    image: postgres:16-alpine",
        "    environment:",
        "      POSTGRES_USER: rebase_app",
        "      POSTGRES_PASSWORD: changeme",
        "      POSTGRES_DB: rebase",
        "    ports:",
        `      - "${port}:5432"`,
        ""
    ].join("\n"));
    // What `rebase dev --docker` leaves behind: the remembered choice.
    fs.mkdirSync(path.join(state.root, ".rebase"));
    fs.writeFileSync(path.join(state.root, ".rebase", "dev-database.json"), JSON.stringify({ kind: "docker" }));

    // Up once, then stopped: the state a reboot leaves it in.
    await compose("up", "-d", "--wait", "db");
    await compose("stop", "db");
}, 180_000);

afterAll(async () => {
    if (state.root) {
        await compose("down", "-v").catch(() => undefined);
        fs.rmSync(state.root, { recursive: true, force: true });
    }
}, 120_000);

/** What `run` printed on stdout and on stderr, each line as one entry. */
async function captured(run: () => Promise<void>): Promise<{ stdout: string[]; stderr: string[] }> {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => { stdout.push(parts.map(String).join(" ")); });
    const error = vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => { stderr.push(parts.map(String).join(" ")); });
    const warn = vi.spyOn(console, "warn").mockImplementation((...parts: unknown[]) => { stderr.push(parts.map(String).join(" ")); });
    const write = vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
        stdout.push(String(chunk));
        return true;
    });
    try {
        await run();
    } finally {
        log.mockRestore();
        error.mockRestore();
        warn.mockRestore();
        write.mockRestore();
    }
    return { stdout, stderr };
}

/** The container came back up, and the start was announced on stderr. */
async function expectStartedOnStderr(stderr: string[]): Promise<void> {
    expect(stderr.join("\n")).toContain("starting it");
    expect(stderr.join("\n")).toContain(`Database ready on port ${port}`);
    const { stdout: running } = await compose("ps", "--status", "running", "--services");
    expect(running.trim()).toBe("db");
}

describe("with the remembered container stopped", () => {
    beforeEach(async () => {
        await compose("stop", "db");
    }, 60_000);

    it("rebase db url starts it and prints the URL, and only the URL, on stdout", async () => {
        const { stdout, stderr } = await captured(() => dbCommand("url", ["node", "rebase", "db", "url"]));

        await expectStartedOnStderr(stderr);
        expect(stdout).toHaveLength(1);
        expect(stdout[0]).toMatch(new RegExp(`^postgresql://rebase_app:changeme@127\\.0\\.0\\.1:${port}/rebase\\?`));
    }, 120_000);

    it("rebase console -e starts it and leaves stdout to the result", async () => {
        const { stdout, stderr } = await captured(() =>
            consoleCommand(["node", "rebase", "console", "-e", "rebase.sql('select 1')"]));

        await expectStartedOnStderr(stderr);
        expect(stdout).toEqual([JSON.stringify({ count: 1 })]);
    }, 120_000);
});
