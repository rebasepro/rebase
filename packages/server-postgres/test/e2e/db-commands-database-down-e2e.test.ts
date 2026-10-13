/**
 * `db backup`, `db restore`, `db branch list`, `db branch info` and
 * `schema introspect` against a database that is not running say so the way
 * `db push` does: the boxed "Cannot connect to PostgreSQL at host:port" and
 * its fixes.
 *
 * `db backup` printed `✗ connect ECONNREFUSED 127.0.0.1:5433` and nothing
 * else. `db branch list` printed `✗ Failed query: CREATE SCHEMA IF NOT EXISTS
 * rebase params: connect ECONNREFUSED…` — a Drizzle wrapper, and the sign that
 * a read-only `list` ran DDL first.
 *
 * No Docker: a port nothing listens on refuses the connection at once. In the
 * e2e lane because it runs the driver CLI in-process, which needs ESM.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { runPluginCommand } from "../../src/cli.js";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tsxBin = path.join(pkgRoot, "..", "..", "node_modules", ".bin", "tsx");

/** A port that refuses: bound, then closed, so nothing is on it. */
async function closedPort(): Promise<number> {
    const server = net.createServer();
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (typeof address !== "object" || address === null) throw new Error("no port");
    await new Promise<void>(resolve => server.close(() => resolve()));
    return address.port;
}

class Exited extends Error {
    constructor(readonly code: number | undefined) {
        super(`process.exit(${code})`);
    }
}

describe("db commands with the database down", () => {
    const originalEnv = { DATABASE_URL: process.env.DATABASE_URL, cwd: process.cwd() };
    let stderr: string[];
    let port: number;
    let workDir: string;

    beforeEach(async () => {
        port = await closedPort();
        process.env.DATABASE_URL = `postgresql://app:app@127.0.0.1:${port}/app?sslmode=disable`;
        // A directory with no .env, so the URL above is the one read.
        workDir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-db-down-"));
        process.chdir(workDir);
        stderr = [];
        const capture = (...parts: unknown[]) => { stderr.push(parts.map(String).join(" ")); };
        vi.spyOn(console, "error").mockImplementation(capture);
        vi.spyOn(console, "warn").mockImplementation(capture);
        vi.spyOn(console, "log").mockImplementation(() => undefined);
        vi.spyOn(process, "exit").mockImplementation((code?: string | number | null) => {
            throw new Exited(typeof code === "number" ? code : undefined);
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        process.chdir(originalEnv.cwd);
        if (originalEnv.DATABASE_URL === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = originalEnv.DATABASE_URL;
        fs.rmSync(workDir, { recursive: true, force: true });
    });

    async function run(args: string[]): Promise<{ code: number | undefined; stderr: string }> {
        let code: number | undefined;
        try {
            await runPluginCommand(args);
        } catch (error) {
            if (!(error instanceof Exited)) throw error;
            code = error.code;
        }
        return { code, stderr: stderr.join("\n") };
    }

    for (const args of [["db", "backup"], ["db", "branch", "list"], ["db", "branch", "info", "feature_x"]]) {
        it(`rebase ${args.join(" ")} names the database it cannot reach, and runs nothing`, async () => {
            const { code, stderr: written } = await run(args);
            expect(code).toBe(1);
            expect(written).toContain(`Cannot connect to PostgreSQL at 127.0.0.1:${port}`);
            expect(written).not.toMatch(/Failed query/);
            expect(written).not.toMatch(/CREATE SCHEMA/);
        });
    }

    it("rebase schema introspect names it, says it once, and leaves no empty directory", async () => {
        // Spawned: the introspector is a child process of the driver CLI.
        const output = path.join(workDir, "config", "collections");
        const env = { ...process.env, DATABASE_URL: process.env.DATABASE_URL ?? "" };
        const run = await execa(tsxBin, [path.join(pkgRoot, "src", "cli.ts"), "schema", "introspect", "--output", output],
            { cwd: workDir, env, reject: false, stdin: "ignore", all: true });
        expect(run.exitCode).toBe(1);
        expect(run.all).toContain(`Cannot connect to PostgreSQL at 127.0.0.1:${port}`);
        expect(run.all).not.toMatch(/Failed to run schema introspector/);
        expect(fs.existsSync(output)).toBe(false);
    }, 60_000);

    it("rebase db restore names it too", async () => {
        const dump = path.join(workDir, "x.dump");
        fs.writeFileSync(dump, "not a real dump");
        const { code, stderr: written } = await run(["db", "restore", dump, "--yes"]);
        expect(code).toBe(1);
        expect(written).toContain(`Cannot connect to PostgreSQL at 127.0.0.1:${port}`);
    });
});
