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
import { createRequire } from "module";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
    root: "",
    spawned: [] as { command: string; args: readonly string[]; env: NodeJS.ProcessEnv; script: string }[],
    /** What opening the database does: nothing, or throw this. */
    connectError: null as Error | null,
    database: { kind: "managed", source: "managed" } as { kind: string; source: string },
    ensured: [] as string[]
}));

vi.mock("../dev-db/prepare", () => ({
    prepareDatabaseEnv: vi.fn(async () => ({
        database: state.database,
        description: "the managed development database (PGlite)",
        env: { DATABASE_URL: "postgresql://postgres@127.0.0.1:54329/managed", REBASE_DB_POOL_MAX: "1" }
    }))
}));

// The remembered compose database is started the way every `db` command starts it.
vi.mock("./db", async importOriginal => ({
    ...await importOriginal<typeof import("./db")>(),
    ensureDockerDatabase: async (root: string) => {
        state.ensured.push(root);
    }
}));

vi.mock("pg", () => {
    class Client {
        on(): this { return this; }
        async connect(): Promise<void> {
            if (state.connectError) throw state.connectError;
        }
        async query(): Promise<{ rows: unknown[] }> { return { rows: [{ "?column?": 1 }] }; }
        async end(): Promise<void> { /* nothing to close */ }
    }
    return { Client, default: { Client } };
});

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

/** tsx is the repository root's, not the CLI's: resolve it rather than name a shim path. */
const TSX_CLI = createRequire(import.meta.url).resolve("tsx/cli");

describe("the direct-database reset", () => {
    let savedBaseUrl: string | undefined;
    let savedServiceKey: string | undefined;

    beforeEach(() => {
        state.root = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-auth-direct-"));
        fs.mkdirSync(path.join(state.root, "backend"));
        state.spawned.length = 0;
        state.connectError = null;
        state.database = { kind: "managed", source: "managed" };
        state.ensured.length = 0;
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

    it("starts the remembered Docker database first, as every db command does", async () => {
        await authCommand("reset-password", ["node", "rebase", "auth", "reset-password", "admin@example.com", "N3w-Passw0rd!"]);

        expect(state.ensured).toEqual([state.root]);
    });

    /**
     * Every other command that opens the database answers a stopped one with
     * the boxed "Cannot connect" banner. This one printed the script's raw
     * `Error: connect ECONNREFUSED 127.0.0.1:5508` and the stack under it.
     */
    it("says Cannot connect in the banner, and writes no script, when the database does not answer", async () => {
        state.database = { kind: "docker", source: "last-dev" };
        state.connectError = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:54329"), { code: "ECONNREFUSED" });
        const errors: string[] = [];
        vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => { errors.push(parts.map(String).join(" ")); });
        vi.spyOn(process, "exit").mockImplementation((code?: string | number | null) => {
            throw new Error(`process.exit(${String(code)})`);
        });

        await expect(authCommand("reset-password", ["node", "rebase", "auth", "reset-password", "admin@example.com", "N3w-Passw0rd!"]))
            .rejects.toThrow("process.exit(1)");

        const said = errors.join("\n");
        expect(said).toContain("Cannot connect to PostgreSQL at 127.0.0.1:54329");
        expect(said).toContain("The driver said: connect ECONNREFUSED 127.0.0.1:54329");
        expect(said).toContain("The password was not reset.");
        expect(said).toContain("docker compose up -d db");
        expect(said).not.toMatch(/\n\s+at /);
        expect(state.spawned).toHaveLength(0);
        expect(fs.existsSync(path.join(state.root, "backend", ".tmp-reset-password.ts"))).toBe(false);
    });

    it("does not go round a backend that refused the reset — a weak password stays refused", async () => {
        process.env.REBASE_BASE_URL = "http://127.0.0.1:1";
        process.env.REBASE_SERVICE_KEY = "service-key-that-is-long-enough-0123456789";
        const errors: string[] = [];
        vi.spyOn(console, "error").mockImplementation((line: unknown) => { errors.push(String(line)); });
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const fetchMock = vi.fn(async (url: string) => String(url).includes("/reset-password")
            ? new Response("{\"error\":{\"message\":\"Password too weak\"}}", { status: 400 })
            : new Response(JSON.stringify({ users: [{ uid: "u1", email: "admin@example.com" }] }), { status: 200 }));
        vi.stubGlobal("fetch", fetchMock);
        try {
            await authCommand("reset-password", ["node", "rebase", "auth", "reset-password", "admin@example.com", "short"]);
        } finally {
            vi.unstubAllGlobals();
            process.exitCode = undefined;
        }

        expect(state.spawned).toHaveLength(0);
        expect(errors.join("\n")).toContain("Password too weak");
    });

    it("says what the backend refused in its own words, not as the raw JSON body", async () => {
        process.env.REBASE_BASE_URL = "http://127.0.0.1:1";
        process.env.REBASE_SERVICE_KEY = "service-key-that-is-long-enough-0123456789";
        const errors: string[] = [];
        vi.spyOn(console, "error").mockImplementation((line: unknown) => { errors.push(String(line)); });
        const body = { error: { message: "Password must be at least 8 characters.", code: "WEAK_PASSWORD" } };
        vi.stubGlobal("fetch", vi.fn(async (url: string) => String(url).includes("/reset-password")
            ? new Response(JSON.stringify(body), { status: 400, statusText: "Bad Request" })
            : new Response(JSON.stringify({ users: [{ uid: "u1", email: "admin@example.com" }] }), { status: 200 })));
        try {
            await authCommand("reset-password", ["node", "rebase", "auth", "reset-password", "admin@example.com", "short"]);
            expect(process.exitCode).toBe(1);
        } finally {
            vi.unstubAllGlobals();
            process.exitCode = undefined;
        }

        const said = errors.join("\n");
        expect(said).toContain("Password must be at least 8 characters. (WEAK_PASSWORD)");
        expect(said).not.toContain("{");
    });

    /**
     * The API path sends the project's service key — the `admin` role, every
     * scope — to the address it finds. It took `.rebase/state.json`'s `baseUrl`
     * without asking whether the backend that wrote it was still running, and
     * then `.rebase-dev-url`, which a killed `rebase dev` leaves behind: the key
     * went to whatever had taken that port since. It asks
     * `resolveBackendAddress` now, as `api-keys` and `storage` do.
     */
    it("sends the service key nowhere when the backend that recorded its address has stopped", async () => {
        const exited = spawnSync(process.execPath, ["-e", ""]);
        fs.mkdirSync(path.join(state.root, ".rebase"));
        fs.writeFileSync(path.join(state.root, ".rebase", "state.json"),
            JSON.stringify({ baseUrl: "http://127.0.0.1:1", port: 1, pid: exited.pid }));
        fs.writeFileSync(path.join(state.root, ".rebase-dev-url"), "http://127.0.0.1:2");
        process.env.REBASE_SERVICE_KEY = "service-key-that-is-long-enough-0123456789";
        const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
        vi.stubGlobal("fetch", fetchMock);
        try {
            await authCommand("reset-password", ["node", "rebase", "auth", "reset-password", "admin@example.com", "N3w-Passw0rd!"]);
        } finally {
            vi.unstubAllGlobals();
        }

        expect(fetchMock).not.toHaveBeenCalled();
        expect(state.spawned).toHaveLength(1);
    });

    it("sends it to the backend that recorded its address while that backend runs", async () => {
        fs.mkdirSync(path.join(state.root, ".rebase"));
        fs.writeFileSync(path.join(state.root, ".rebase", "state.json"),
            JSON.stringify({ baseUrl: "http://127.0.0.1:1", port: 1, pid: process.pid }));
        process.env.REBASE_SERVICE_KEY = "service-key-that-is-long-enough-0123456789";
        const fetchMock = vi.fn(async (url: string) => String(url).includes("/reset-password")
            ? new Response("{}", { status: 200 })
            : new Response(JSON.stringify({ users: [{ uid: "u1", email: "admin@example.com" }] }), { status: 200 }));
        vi.stubGlobal("fetch", fetchMock);
        try {
            await authCommand("reset-password", ["node", "rebase", "auth", "reset-password", "admin@example.com", "N3w-Passw0rd!"]);
        } finally {
            vi.unstubAllGlobals();
        }

        expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(/^http:\/\/127\.0\.0\.1:1\/api\/admin\/users/);
        expect(state.spawned).toHaveLength(0);
    });

    it("labels a generated password the way the API path does", () => {
        expect(resetPasswordScript(true)).toContain('console.log("   Password: " + newPassword);');
    });

    /**
     * Run the generated script for real, against stand-ins for its imports.
     * The `pg` client the stand-in hands out records every statement in
     * `statements.json`, and answers each query with `answer(text)`.
     */
    function runResetScript(clientSource: string): { status: number | null; stderr: string; statements: { text: string; values?: unknown[] }[] } {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-auth-script-"));
        try {
            const stub = (name: string, files: Record<string, string>, exports?: Record<string, string>) => {
                const pkg = path.join(dir, "node_modules", name);
                fs.mkdirSync(pkg, { recursive: true });
                fs.writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ name, type: "module", main: "index.js", ...(exports ? { exports } : {}) }));
                for (const [file, source] of Object.entries(files)) fs.writeFileSync(path.join(pkg, file), source);
            };
            const log = path.join(dir, "statements.json");
            stub("@rebasepro/server-postgres", {
                "index.js": `
                    import fs from "fs";
                    const recorded = [];
                    const record = (text, values) => {
                        recorded.push({ text, values });
                        fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify(recorded));
                    };
                    ${clientSource}
                    const column = (name) => ({ name });
                    const config = Symbol.for("stub:table");
                    export const users = { id: column("id"), email: column("email"), passwordHash: column("password_hash"), [config]: { name: "users", schema: "rebase" } };
                    export function createPostgresDatabaseConnection() {
                        return { pool: { connect: async () => client(record), end: async () => undefined } };
                    }
                `
            });
            stub("@rebasepro/server", { "index.js": "export async function hashPassword() { return \"hash\"; }" });
            stub("drizzle-orm", {
                "index.js": "export function eq() { return undefined; }",
                "pg-core.js": "export function getTableConfig(table) { return table[Symbol.for(\"stub:table\")]; }"
            }, { ".": "./index.js", "./pg-core": "./pg-core.js" });
            stub("dotenv", { "index.js": "export function config() { return {}; }" });

            const script = path.join(dir, "reset.ts");
            fs.writeFileSync(script, resetPasswordScript(false));
            const run = spawnSync(process.execPath, [TSX_CLI, script], {
                cwd: dir,
                encoding: "utf8",
                env: { ...process.env, REBASE_RESET_EMAIL: "Admin@Example.com", REBASE_RESET_PASSWORD: "x" }
            });
            const statements = fs.existsSync(log) ? JSON.parse(fs.readFileSync(log, "utf8")) : [];
            return { status: run.status, stderr: run.stderr, statements };
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }

    it("exits non-zero when the update fails, rather than printing a stack and exiting 0", () => {
        // The connection is refused, the way a stopped database refuses it.
        const run = runResetScript(`
            const refused = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED" });
            const client = async () => { throw refused; };
        `);

        expect(run.stderr).toContain("ECONNREFUSED");
        expect(run.stderr).toContain("The password was not reset");
        // A sentence, not `console.error(error)`'s stack.
        expect(run.stderr).not.toMatch(/\n\s+at /);
        expect(run.status).toBe(1);
    });

    /**
     * A database with no users table — a managed one `db reset` emptied, or one
     * nothing has booted against — answered with pg's raw
     * `error: relation "rebase.users" does not exist` and a stack.
     */
    it("says there is no account to reset when the users table is not there", () => {
        const run = runResetScript(`
            const client = (record) => ({
                async query(text, values) {
                    record(text, values);
                    if (/to_regclass/.test(text)) return { rowCount: 1, rows: [{ present: false }] };
                    throw Object.assign(new Error('relation "rebase.users" does not exist'), { code: "42P01" });
                },
                release() {}
            });
        `);

        expect(run.status).toBe(1);
        expect(run.stderr).toContain("\"rebase\".\"users\" does not exist in this database");
        expect(run.stderr).toContain("Nothing was changed");
        expect(run.stderr).toContain("rebase dev");
        expect(run.stderr).not.toMatch(/\n\s+at /);
        expect(run.statements.some(s => /^UPDATE/.test(s.text))).toBe(false);
    });

    it("ends the account's sessions in the same transaction that sets the password", () => {
        // Every other door that sets a password ends the sessions the account
        // holds (`replaceUserPassword`): an operator resetting a phished account
        // is the reason to reset it. This one wrote the hash and left the
        // attacker's refresh token minting access tokens.
        const run = runResetScript(`
            const client = (record) => ({
                async query(text, values) {
                    record(text, values);
                    if (/^UPDATE/.test(text) && /RETURNING/.test(text)) return { rowCount: 1, rows: [{ id: "u-1", email: "admin@example.com" }] };
                    if (/information_schema/.test(text)) return { rowCount: 1, rows: [{ present: true }] };
                    if (/to_regclass/.test(text)) return { rowCount: 1, rows: [{ present: true }] };
                    return { rowCount: 0, rows: [] };
                },
                release() {}
            });
        `);

        expect(run.stderr).toBe("");
        expect(run.status).toBe(0);
        const texts = run.statements.map(s => s.text.replace(/\s+/g, " ").trim());
        const inTransaction = texts.slice(texts.indexOf("BEGIN") + 1, texts.indexOf("COMMIT"));
        expect(texts.indexOf("BEGIN")).toBeGreaterThanOrEqual(0);
        expect(texts.indexOf("COMMIT")).toBeGreaterThan(texts.indexOf("BEGIN"));

        const password = run.statements.find(s => /SET "password_hash" = \$1/.test(s.text));
        expect(password?.values).toEqual(["hash", "admin@example.com"]);
        expect(inTransaction.some(t => /SET "password_hash"/.test(t))).toBe(true);

        const statementFor = (pattern: RegExp) => run.statements.find(s => pattern.test(s.text));
        expect(statementFor(/SET tokens_valid_after = NOW\(\)/)?.values).toEqual(["u-1"]);
        expect(statementFor(/DELETE FROM "rebase"\."refresh_tokens" WHERE uid = \$1/)?.values).toEqual(["u-1"]);
        expect(statementFor(/DELETE FROM "rebase"\."password_reset_tokens" WHERE uid = \$1/)?.values).toEqual(["u-1"]);
        for (const pattern of [/tokens_valid_after = NOW/, /"refresh_tokens"/, /"password_reset_tokens"/]) {
            expect(inTransaction.some(t => pattern.test(t) && /^(UPDATE|DELETE)/.test(t))).toBe(true);
        }
    });
});
