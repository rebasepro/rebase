/**
 * The direct-database fallback of `rebase auth reset-password`.
 *
 * Reached whenever no backend is running to take the reset through its API —
 * which on a fresh scaffold is the ordinary case. Two things were wrong with it,
 * and both ended in a command that looked like it had worked:
 *
 *   - It never asked which database the project is on. A stock scaffold leaves
 *     `DATABASE_URL` commented out and runs on the managed database that
 *     `rebase dev` and the `db` family start and hand to their children, so the
 *     script connected with libpq's defaults — localhost:5432 as the OS user —
 *     which is somebody else's Postgres or nothing at all.
 *   - The script ended in `resetPassword().catch(console.error)`, so any
 *     failure, the refused connection above included, printed a stack and
 *     exited 0. A script calling the command concluded the password was reset.
 */
import { EventEmitter } from "events";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
    root: "",
    spawned: [] as { command: string; args: readonly string[]; env: NodeJS.ProcessEnv; script: string }[]
}));

vi.mock("../dev-db/prepare", () => ({
    prepareDatabaseEnv: vi.fn(async () => ({
        database: { kind: "managed" },
        description: "the managed development database (PGlite)",
        env: { DATABASE_URL: "postgresql://postgres@127.0.0.1:54329/managed", REBASE_DB_POOL_MAX: "1" }
    }))
}));

vi.mock("../utils/project", async importOriginal => ({
    ...await importOriginal<typeof import("../utils/project")>(),
    requireProjectRoot: () => state.root,
    requireBackendDir: () => path.join(state.root, "backend"),
    resolveTsx: () => "tsx"
}));

vi.mock("child_process", async importOriginal => ({
    ...await importOriginal<typeof import("child_process")>(),
    spawn: (command: string, args: readonly string[], options: { env: NodeJS.ProcessEnv }) => {
        state.spawned.push({ command, args, env: options.env, script: fs.readFileSync(args[0], "utf8") });
        const child = new EventEmitter();
        setImmediate(() => child.emit("close", 0));
        return child;
    }
}));

const { authCommand, resetPasswordScript } = await import("./auth");
const { prepareDatabaseEnv } = await import("../dev-db/prepare");
const { spawnSync } = await vi.importActual<typeof import("child_process")>("child_process");

const TSX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../node_modules/.bin/tsx");

describe("the direct-database reset", () => {
    let savedBaseUrl: string | undefined;
    let savedServiceKey: string | undefined;

    beforeEach(() => {
        state.root = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-auth-direct-"));
        fs.mkdirSync(path.join(state.root, "backend"));
        state.spawned.length = 0;
        savedBaseUrl = process.env.REBASE_BASE_URL;
        savedServiceKey = process.env.REBASE_SERVICE_KEY;
        delete process.env.REBASE_BASE_URL;
        delete process.env.REBASE_SERVICE_KEY;
        vi.spyOn(console, "log").mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        fs.rmSync(state.root, { recursive: true, force: true });
        if (savedBaseUrl !== undefined) process.env.REBASE_BASE_URL = savedBaseUrl;
        if (savedServiceKey !== undefined) process.env.REBASE_SERVICE_KEY = savedServiceKey;
    });

    it("connects to the database the project is on, not to libpq's defaults", async () => {
        await authCommand("reset-password", ["node", "rebase", "auth", "reset-password", "admin@example.com", "N3w-Passw0rd!"]);

        expect(prepareDatabaseEnv).toHaveBeenCalledWith(state.root, expect.anything());
        expect(state.spawned).toHaveLength(1);
        expect(state.spawned[0].env.DATABASE_URL).toBe("postgresql://postgres@127.0.0.1:54329/managed");
    });

    it("exits non-zero when the update fails, rather than printing a stack and exiting 0", () => {
        // The generated script, run for real against stand-ins for its four
        // imports whose update rejects the way a refused connection does.
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-auth-script-"));
        try {
            const stub = (name: string, source: string) => {
                const pkg = path.join(dir, "node_modules", name);
                fs.mkdirSync(pkg, { recursive: true });
                fs.writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ name, type: "module", main: "index.js" }));
                fs.writeFileSync(path.join(pkg, "index.js"), source);
            };
            stub("@rebasepro/server-postgres", `
                const refused = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED" });
                const chain = { set: () => chain, where: () => chain, returning: () => Promise.reject(refused) };
                export const users = { id: "id", email: "email", passwordHash: "password_hash" };
                export function createPostgresDatabaseConnection() { return { db: { update: () => chain } }; }
            `);
            stub("@rebasepro/server", "export async function hashPassword() { return \"hash\"; }");
            stub("drizzle-orm", "export function eq() { return undefined; }");
            stub("dotenv", "export function config() { return {}; }");

            const script = path.join(dir, "reset.ts");
            fs.writeFileSync(script, resetPasswordScript(false));
            const run = spawnSync(TSX, [script], {
                cwd: dir,
                encoding: "utf8",
                env: { ...process.env, REBASE_RESET_EMAIL: "admin@example.com", REBASE_RESET_PASSWORD: "x" }
            });

            expect(run.stderr).toContain("ECONNREFUSED");
            expect(run.status).toBe(1);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
