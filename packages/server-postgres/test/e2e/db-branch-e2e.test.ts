/**
 * `rebase db branch` from a checkout switched to a branch.
 *
 * - `prune --older-than 0d --yes` dropped the branch the checkout was switched
 *   to, which `delete` refuses. The CLI names that database to the driver
 *   (`REBASE_ACTIVE_BRANCH_DATABASE`), which keeps it and says so — and `list`
 *   marks it, where every branch had the same bullet.
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

describe("db branch from a switched checkout", () => {
    let container: PgContainer;
    let admin: pg.Client;
    let workDir: string;
    let stdout: string[];
    let stderr: string[];
    const original = { DATABASE_URL: process.env.DATABASE_URL, cwd: process.cwd() };
    const urlFor = (db: string) => container.connectionString.replace(/\/rebase\?/, `/${db}?`);

    beforeAll(async () => {
        container = await startPgContainer();
        admin = new pg.Client({ connectionString: urlFor("postgres") });
        await admin.connect();
    }, 120_000);

    afterAll(async () => {
        if (admin) await admin.end().catch(() => {});
        if (container) await stopPgContainer(container.containerName);
    }, 30_000);

    beforeEach(() => {
        process.env.DATABASE_URL = container.connectionString;
        delete process.env.REBASE_ACTIVE_BRANCH_DATABASE;
        workDir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-branch-force-"));
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
        delete process.env.REBASE_ACTIVE_BRANCH_DATABASE;
        if (original.DATABASE_URL === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = original.DATABASE_URL;
        fs.rmSync(workDir, { recursive: true, force: true });
    });

    async function run(args: string[]): Promise<{ code: number | undefined; said: string }> {
        let code: number | undefined = 0;
        try {
            await runPluginCommand(args);
        } catch (error) {
            if (!(error instanceof Exited)) {
                stderr.push(error instanceof Error ? error.message : String(error));
                code = 1;
            } else {
                code = error.code;
            }
        }
        // eslint-disable-next-line no-control-regex
        return { code, said: [...stdout, ...stderr].join("\n").replace(/\x1b\[[0-9;]*m/g, "") };
    }

    const databases = async (): Promise<string[]> =>
        (await admin.query<{ datname: string }>("SELECT datname FROM pg_database ORDER BY 1")).rows.map(r => r.datname);

    it("prune keeps the branch this checkout is switched to, says so, and list marks it", async () => {
        expect((await run(["db", "branch", "create", "mine"])).code).toBe(0);
        expect((await run(["db", "branch", "create", "other"])).code).toBe(0);
        process.env.REBASE_ACTIVE_BRANCH_DATABASE = "rb_mine";

        const listed = await run(["db", "branch", "list"]);
        expect(listed.said).toMatch(/● mine \(current — this checkout is on it\)/);
        expect(listed.said).not.toMatch(/● other \(current/);

        stdout.length = 0;
        const pruned = await run(["db", "branch", "prune", "--older-than", "0d", "--yes"]);
        expect(pruned.code, pruned.said).toBe(0);
        expect(pruned.said).toContain("mine — this checkout is switched to it, so it is kept");
        expect(pruned.said).toContain("rebase db branch switch --off");
        expect(pruned.said).toMatch(/● other — 0 days old; branch and database will be dropped/);
        const left = await databases();
        expect(left).toContain("rb_mine");
        expect(left).not.toContain("rb_other");
    }, 60_000);
});
