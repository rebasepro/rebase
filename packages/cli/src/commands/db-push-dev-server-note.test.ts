/**
 * `rebase db push` beside a running `rebase dev` on the same database says
 * that the dev server applies schema edits as files are saved.
 *
 * From a migration report: a `db push --dry-run` run beside `rebase dev` said
 * "No changes" for columns that were not there a minute earlier. Correct —
 * dev had applied them on save — but it read as a planner bug until the dev
 * server was found.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-push-dev-note-"));
const DATABASE_URL = "postgres://u:p@127.0.0.1:5432/shop";

vi.mock("../utils/project", async importOriginal => ({
    ...(await importOriginal<typeof import("../utils/project")>()),
    findProjectRoot: () => ROOT,
    requireProjectRoot: () => ROOT,
    requireBackendDir: () => path.join(ROOT, "backend"),
    findEnvFile: () => path.join(ROOT, ".env"),
    readEnvFile: () => ({ DATABASE_URL }),
    resolveTsx: () => "/bin/true",
    getActiveBackendPlugin: () => "@rebasepro/server-postgres",
    resolvePluginCliScript: () => "/tmp/rebase-test-plugin-cli.js"
}));

vi.mock("execa", () => ({ execa: vi.fn(async () => ({ exitCode: 0 })) }));

vi.mock("../dev-db/prepare", () => ({
    prepareDatabaseEnv: vi.fn(async () => ({
        env: {},
        database: { kind: "external" as const, url: DATABASE_URL, source: "env-file" as const },
        description: "the configured database"
    })),
    managedNotices: () => [],
    DEV_DATABASE_KIND_ENV: "REBASE_DEV_DATABASE_KIND",
    devDatabaseKind: () => "external" as const,
    resolveProjectDatabase: () => ({ kind: "external" as const, url: DATABASE_URL, source: "env-file" as const }),
    resolveActiveBranch: () => null,
    resolveComposeUrl: () => null
}));

import { dbCommand, runDriverDbCommand } from "./db";

const argv = (...line: string[]) => ["/usr/bin/node", "/usr/local/bin/rebase", ...line];

let printed: string[];

function writeDevRun(database: string): void {
    fs.mkdirSync(path.join(ROOT, ".rebase"), { recursive: true });
    fs.writeFileSync(path.join(ROOT, ".rebase", "dev.json"), JSON.stringify({
        pid: process.pid,
        database,
        backendUrl: "http://localhost:3082",
        startedAt: new Date().toISOString()
    }));
}

beforeEach(() => {
    vi.clearAllMocks();
    printed = [];
    vi.spyOn(console, "log").mockImplementation((line: unknown = "") => { printed.push(String(line)); });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(path.join(ROOT, ".rebase"), { recursive: true, force: true });
});

afterAll(() => fs.rmSync(ROOT, { recursive: true, force: true }));

const note = () => printed.find(line => line.includes("`rebase dev` is running on this database"));

describe("db push beside a running `rebase dev`", () => {
    it("says the dev server on this database applies schema edits as you save", async () => {
        writeDevRun("localhost:5432/shop");

        await dbCommand("push", argv("db", "push", "--dry-run"));

        expect(note()).toContain("at http://localhost:3082");
        expect(note()).toContain("applies new tables and columns as you save, so a change it has already applied is not listed here");
    });

    it("says nothing about a `rebase dev` on another database", async () => {
        writeDevRun("localhost:5432/staging");

        await dbCommand("push", argv("db", "push", "--dry-run"));

        expect(note()).toBeUndefined();
    });

    it("says nothing on `rebase dev`'s own start-up push, which is quiet", async () => {
        writeDevRun("localhost:5432/shop");

        await runDriverDbCommand(argv("db", "push"), { quiet: true });

        expect(note()).toBeUndefined();
    });
});
