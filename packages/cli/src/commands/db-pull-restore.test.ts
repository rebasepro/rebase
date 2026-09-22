/**
 * `rebase db pull` when the restore half does not work.
 *
 * `--clean` empties the local database before `pg_restore` writes anything, so
 * a restore that fails part-way — a missing extension, a killed connection —
 * leaves a partial or empty database. The command swallowed that failure and
 * printed "✓ Local database now holds a copy", exit 0. And it checked only
 * that `pg_dump` was on PATH, so a machine without `pg_restore` dumped
 * production, "restored" nothing, and reported the same green tick.
 *
 * No database is touched: the tools are stood in for at `execa`.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
    root: "",
    installed: new Set<string>(),
    restore: { exitCode: 0 as number | undefined, stderr: "" },
    calls: [] as { file: string; args: readonly string[] }[]
}));

vi.mock("../utils/project", async importOriginal => ({
    ...await importOriginal<typeof import("../utils/project")>(),
    requireProjectRoot: () => state.root
}));

vi.mock("../dev-db/prepare", async importOriginal => ({
    ...await importOriginal<typeof import("../dev-db/prepare")>(),
    prepareDatabaseEnv: async () => ({
        database: { kind: "managed", source: "managed" },
        description: "the managed development database (PGlite)",
        env: { DATABASE_URL: "postgresql://postgres@127.0.0.1:1/postgres" }
    })
}));

vi.mock("execa", () => ({
    execa: async (file: string, args: readonly string[]) => {
        state.calls.push({ file, args });
        if (!state.installed.has(file)) {
            throw Object.assign(new Error(`spawn ${file} ENOENT`), { code: "ENOENT" });
        }
        if (args[0] === "--version") return { exitCode: 0, stdout: `${file} (PostgreSQL) 17.2`, stderr: "" };
        if (file === "pg_restore") {
            return { exitCode: state.restore.exitCode, stdout: "", stderr: state.restore.stderr, failed: state.restore.exitCode !== 0 };
        }
        return { exitCode: 0, stdout: "", stderr: "" };
    }
}));

const { dbCommand } = await import("./db");

class Exit extends Error {
    constructor(readonly code: number | undefined) {
        super(`process.exit(${code})`);
    }
}

describe("rebase db pull, when the restore fails", () => {
    let printed: string[];

    beforeEach(() => {
        state.root = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-db-pull-"));
        state.installed = new Set(["pg_dump", "pg_restore"]);
        state.restore = { exitCode: 0, stderr: "" };
        state.calls.length = 0;
        printed = [];
        const capture = (...parts: unknown[]) => { printed.push(parts.map(String).join(" ")); };
        vi.spyOn(console, "log").mockImplementation(capture);
        vi.spyOn(console, "error").mockImplementation(capture);
        vi.spyOn(process, "exit").mockImplementation((code?: string | number | null) => {
            throw new Exit(typeof code === "number" ? code : undefined);
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        fs.rmSync(state.root, { recursive: true, force: true });
    });

    const pull = () => dbCommand("pull", ["node", "rebase", "db", "pull", "--from", "postgresql://u:pw@prod.example.com/app", "--yes"]);

    it("does not claim a copy, and exits 1, when pg_restore reports errors", async () => {
        state.restore = { exitCode: 1, stderr: "pg_restore: warning: errors ignored on restore: 12\n" };

        await expect(pull()).rejects.toEqual(new Exit(1));

        const output = printed.join("\n");
        expect(output).not.toContain("✓ Local database now holds a copy");
        expect(output).toContain("12 object(s)");
    });

    it("refuses before dumping anything when pg_restore is not installed", async () => {
        state.installed.delete("pg_restore");

        await expect(pull()).rejects.toEqual(new Exit(1));

        expect(printed.join("\n")).toContain("`pg_restore` is not on PATH");
        // Nothing was read from the source: the refusal came first.
        expect(state.calls.some(call => call.file === "pg_dump" && call.args[0] !== "--version")).toBe(false);
    });
});
