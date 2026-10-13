/**
 * `rebase db branch list` and `info` read, and write nothing.
 *
 * Both ran `CREATE SCHEMA IF NOT EXISTS rebase` and created the branch
 * registry before reading it, so a read-only command needed DDL rights, and
 * against a stopped database its first words were that DDL's Drizzle wrapper.
 * A database no branch was ever made on has no registry, and no branches.
 *
 * Requires Docker.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { runPluginCommand } from "../../src/cli.js";

class Exited extends Error {
    constructor(readonly code: number | undefined) {
        super(`process.exit(${code})`);
    }
}

describe("db branch list and info on a database with no branches", () => {
    let container: PgContainer;
    let admin: pg.Client;
    let workDir: string;
    let stdout: string[];
    let stderr: string[];
    const original = { DATABASE_URL: process.env.DATABASE_URL, cwd: process.cwd() };

    beforeAll(async () => {
        container = await startPgContainer();
        for (let attempt = 1; ; attempt++) {
            try {
                admin = new pg.Client({ connectionString: container.connectionString });
                await admin.connect();
                break;
            } catch (error) {
                if (attempt >= 10) throw error;
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    }, 120_000);

    afterAll(async () => {
        if (admin) await admin.end().catch(() => {});
        if (container) await stopPgContainer(container.containerName);
    }, 30_000);

    beforeEach(() => {
        process.env.DATABASE_URL = container.connectionString;
        workDir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-branch-read-"));
        process.chdir(workDir);
        stdout = [];
        stderr = [];
        vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => { stdout.push(parts.map(String).join(" ")); });
        vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => { stderr.push(parts.map(String).join(" ")); });
        vi.spyOn(console, "warn").mockImplementation((...parts: unknown[]) => { stderr.push(parts.map(String).join(" ")); });
        vi.spyOn(process, "exit").mockImplementation((code?: string | number | null) => {
            throw new Exited(typeof code === "number" ? code : undefined);
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        process.chdir(original.cwd);
        if (original.DATABASE_URL === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = original.DATABASE_URL;
        fs.rmSync(workDir, { recursive: true, force: true });
    });

    async function run(args: string[]): Promise<number | undefined> {
        try {
            await runPluginCommand(args);
            return 0;
        } catch (error) {
            if (error instanceof Exited) return error.code;
            throw error;
        }
    }

    const rebaseSchemaExists = async () =>
        (await admin.query("SELECT 1 FROM pg_namespace WHERE nspname = 'rebase'")).rows.length > 0;

    it("lists no branches, and creates neither the schema nor the registry", async () => {
        expect(await run(["db", "branch", "list"])).toBe(0);
        expect(stdout.join("\n")).toContain("No branches found");
        expect(await rebaseSchemaExists()).toBe(false);
    });

    it("says a branch is not found, exits 1, and creates nothing", async () => {
        expect(await run(["db", "branch", "info", "feature_x"])).toBe(1);
        expect(stderr.join("\n")).toContain('Branch "feature_x" not found');
        expect(await rebaseSchemaExists()).toBe(false);
    });
});
