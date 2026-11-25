/**
 * `rebase db …` binds every declared database on the managed path, as
 * `rebase dev` does.
 *
 * It handed `prepareDatabaseEnv` no keys, so on the managed database
 * `rebase db push --database analytics` found no DATABASE_URL__ANALYTICS —
 * while `rebase dev`, one command earlier, had served that database fine.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-db-declared-"));

const { prepareDatabaseEnv, declaredAdditionalDatabases } = vi.hoisted(() => ({
    prepareDatabaseEnv: vi.fn(async (_root: string, _options: { additionalKeys?: unknown }) => ({
        env: { DATABASE_URL: "postgres://rebase@127.0.0.1:55001/rebase" },
        database: { kind: "managed" as const, source: "managed" as const },
        description: "the managed development database (PGlite)"
    })),
    declaredAdditionalDatabases: vi.fn(async (_root: string) => ["analytics"])
}));

vi.mock("../utils/project", async importOriginal => ({
    ...(await importOriginal<typeof import("../utils/project")>()),
    findProjectRoot: () => ROOT,
    requireProjectRoot: () => ROOT,
    requireBackendDir: () => path.join(ROOT, "backend"),
    findEnvFile: () => null,
    readEnvFile: () => ({}),
    resolveTsx: () => "/bin/true",
    getActiveBackendPlugin: () => "@rebasepro/server-postgres",
    resolvePluginCliScript: () => "/tmp/rebase-test-plugin-cli.js"
}));

vi.mock("execa", () => ({ execa: vi.fn(async () => ({ exitCode: 0 })) }));

vi.mock("../dev-db/prepare", () => ({
    prepareDatabaseEnv,
    managedNotices: () => [],
    DEV_DATABASE_KIND_ENV: "REBASE_DEV_DATABASE_KIND",
    devDatabaseKind: () => "managed" as const,
    resolveProjectDatabase: () => ({ kind: "managed" as const, source: "managed" as const }),
    resolveActiveBranch: () => null,
    resolveComposeUrl: () => null
}));

vi.mock("../dev-db/declared-databases", () => ({
    declaredAdditionalDatabases,
    declaredAdditionalKeys: (root: string) => () => declaredAdditionalDatabases(root)
}));

vi.mock("../dev-db/atlas-dev-database", () => ({ startAtlasDevDatabase: vi.fn(async () => null) }));

import { runDriverDbCommand } from "./db";

const argv = (...line: string[]) => ["/usr/bin/node", "/usr/local/bin/rebase", ...line];

beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterAll(() => fs.rmSync(ROOT, { recursive: true, force: true }));

describe("rebase db push on the managed database", () => {
    it("asks for every declared database, read from this project", async () => {
        await runDriverDbCommand(argv("db", "push", "--database", "analytics"), { quiet: true });

        const options = prepareDatabaseEnv.mock.calls[0][1];
        expect(typeof options.additionalKeys).toBe("function");
        const keys = options.additionalKeys as () => Promise<string[]>;
        expect(await keys()).toEqual(["analytics"]);
        expect(declaredAdditionalDatabases).toHaveBeenCalledWith(ROOT);
    });
});
