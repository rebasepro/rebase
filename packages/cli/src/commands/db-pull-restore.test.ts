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
    dump: { exitCode: 0, stderr: "" },
    restores: 0,
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

// Emptying the local schemas first is `restoreCopy`'s, tested on a real
// Postgres in `dev-db/pull-restore.integration.test.ts`. Here it stands for a
// restore that ends the way `state.restore` says pg_restore did.
vi.mock("../dev-db/pull", async importOriginal => {
    const actual = await importOriginal<typeof import("../dev-db/pull")>();
    return {
        ...actual,
        // The real dump step, through the `execa` below, for a target that
        // runs Postgres: asking a real one is `pull-managed.integration.test.ts`'s.
        dumpSource: (plan: Parameters<typeof actual.dumpSource>[0], dumpFile: string) =>
            actual.dumpSource({ ...plan, targetEngine: "postgres" }, dumpFile),
        restoreCopy: async () => {
            state.restores++;
            return { cleared: true, ...actual.restoreOutcome(state.restore) };
        }
    };
});

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
        if (file === "pg_dump") return { exitCode: state.dump.exitCode, stdout: "", stderr: state.dump.stderr, failed: state.dump.exitCode !== 0 };
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
        state.dump = { exitCode: 0, stderr: "" };
        state.restores = 0;
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

    it("says what a second pull would repeat, rather than sending you round again", async () => {
        // Restoring into an emptied database, what pg_restore could not create
        // it will not create next time either.
        state.restore = { exitCode: 1, stderr: "pg_restore: warning: errors ignored on restore: 2\n" };

        await expect(pull()).rejects.toEqual(new Exit(1));

        const output = printed.join("\n");
        expect(output).toContain("Pulling again repeats these errors");
        expect(output).not.toContain("and pull again.");
    });

    it("re-grants the app role on what did arrive, and still reaches its verdict", async () => {
        // The re-grant was skipped on any restore error, and its connection was
        // opened outside its own `try` — so a refused connection threw past the
        // "incomplete copy" verdict instead of being the warning it is.
        state.restore = { exitCode: 1, stderr: "pg_restore: warning: errors ignored on restore: 3\n" };

        await expect(pull()).rejects.toEqual(new Exit(1));

        const output = printed.join("\n");
        expect(output).toContain("could not re-grant");
        expect(output).toContain("incomplete copy");
    });

    it("says a source it cannot reach in the banner, not as a failed command, and touches nothing local", async () => {
        // pg_dump's own error, then `✗ Command failed with exit code 1:
        // pg_dump …` from the top-level handler — where every other database
        // command prints the "Cannot connect" banner.
        state.dump = {
            exitCode: 1,
            stderr: "pg_dump: error: connection to server at \"prod.example.com\" (203.0.113.5), port 5432 failed: Connection refused\n"
                + "\tIs the server running on that host and accepting TCP/IP connections?\n"
        };

        await expect(pull()).rejects.toEqual(new Exit(1));

        const output = printed.join("\n");
        expect(output).toContain("Cannot connect to PostgreSQL at prod.example.com:5432");
        expect(output).toContain("Nothing was changed");
        expect(output).not.toContain("Command failed");
        expect(output).not.toContain("Restoring…");
        expect(state.restores).toBe(0);
    });

    it("refuses before dumping anything when pg_restore is not installed", async () => {
        state.installed.delete("pg_restore");

        await expect(pull()).rejects.toEqual(new Exit(1));

        expect(printed.join("\n")).toContain("`pg_restore` is not on PATH");
        // Nothing was read from the source: the refusal came first.
        expect(state.calls.some(call => call.file === "pg_dump" && call.args[0] !== "--version")).toBe(false);
    });
});
