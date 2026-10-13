/**
 * The driver is told where `rebase` was run.
 *
 * It runs in `backend/`, so the paths it resolves itself were relative to the
 * wrong directory: `rebase db backup` with no `--out` wrote to
 * `<root>/backend/backups` and `rebase db backups list` looked there, while
 * `rebase db backup --out ./backups`, whose path this CLI resolves, wrote to
 * `<root>/backups`. `REBASE_INVOCATION_CWD` is what the driver resolves against
 * (`INVOCATION_CWD_ENV` in `@rebasepro/server-postgres`).
 */
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ROOT = path.resolve("/projects/shop");

vi.mock("../utils/project", async importOriginal => ({
    ...(await importOriginal<typeof import("../utils/project")>()),
    findProjectRoot: () => ROOT,
    requireProjectRoot: () => ROOT,
    requireBackendDir: () => path.join(ROOT, "backend"),
    findEnvFile: () => path.join(ROOT, ".env"),
    readEnvFile: () => ({ DATABASE_URL: "postgres://u:p@127.0.0.1:5432/shop" }),
    resolveTsx: () => "/bin/true",
    getActiveBackendPlugin: () => "@rebasepro/server-postgres",
    resolvePluginCliScript: () => "/tmp/rebase-test-plugin-cli.js"
}));

vi.mock("execa", () => ({ execa: vi.fn(async () => ({ exitCode: 0 })) }));

vi.mock("../dev-db/prepare", () => ({
    prepareDatabaseEnv: vi.fn(async () => ({
        env: {},
        database: { kind: "external" as const, url: "postgres://u:p@127.0.0.1:5432/shop", source: "env-file" as const },
        description: "the configured database"
    })),
    managedNotices: () => [],
    DEV_DATABASE_KIND_ENV: "REBASE_DEV_DATABASE_KIND",
    devDatabaseKind: () => "external" as const,
    resolveProjectDatabase: () => ({ kind: "external" as const, url: "postgres://u:p@127.0.0.1:5432/shop", source: "env-file" as const }),
    resolveActiveBranch: () => null,
    resolveComposeUrl: () => null
}));

import { dbCommand } from "./db";
import { execa } from "execa";

const execaSpy = execa as unknown as ReturnType<typeof vi.fn>;
const argv = (...line: string[]) => ["/usr/bin/node", "/usr/local/bin/rebase", ...line];

/** The driver spawn: its working directory and environment. */
function driverSpawn(): { cwd?: string; env?: Record<string, string> } {
    const call = execaSpy.mock.calls.at(-1);
    return call ? (call[2] as { cwd?: string; env?: Record<string, string> }) : {};
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => vi.restoreAllMocks());

describe("the directory `rebase` was run from", () => {
    it.each([
        ["backup", ["db", "backup"]],
        ["backups", ["db", "backups", "list"]],
        ["restore", ["db", "restore", "./backups/x.dump", "--yes"]]
    ])("reaches the driver for `db %s`, which runs in backend/", async (subcommand, line) => {
        await dbCommand(subcommand, argv(...line));

        expect(driverSpawn().cwd).toBe(path.join(ROOT, "backend"));
        expect(driverSpawn().env?.REBASE_INVOCATION_CWD).toBe(process.cwd());
    });
});
