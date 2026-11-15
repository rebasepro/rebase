/**
 * The commands that act on a running app — `rebase api`, `data`, `users`,
 * `cron`, `logs`, `functions`, `schema show --remote`, `auth login|whoami|
 * emails`, `rls simulate`, `storage ls|cp|rm|url|stat`, `api-keys update` —
 * against a real one: the documented first run (`rebase init`, then
 * `rebase dev` on the managed database), driven only through the CLI.
 *
 * Every other test of these commands answers their requests with a fake
 * `fetch`. That pins what they send; it cannot say a route takes it. This
 * one can: the server is the one a reader runs, and the credential is the
 * one `init` wrote into `.env`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { execa } from "execa";
import {
    cliBin,
    getCleanEnv,
    assertPackagesBuilt,
    linkLocalPackages,
    startBackend,
    stopBackend,
    claimFirstAdmin,
    FIRST_ADMIN,
    type RunningBackend
} from "./helpers.js";

let tempDir: string;
let projectDir: string;
let backend: RunningBackend | undefined;
let env: Record<string, string>;

/** Run the CLI in the project, JSON out, and parse what it printed. */
async function rebase(...args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string; json: unknown }> {
    const run = await execa("node", [cliBin, ...args], { cwd: projectDir, env: { ...env, REBASE_JSON: "1" }, reject: false });
    let json: unknown;
    try {
        json = JSON.parse(run.stdout);
    } catch {
        json = undefined;
    }
    return { exitCode: run.exitCode ?? 1, stdout: run.stdout, stderr: run.stderr, json };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

beforeAll(async () => {
    assertPackagesBuilt(["server", "server-postgres", "types", "client", "cli"]);
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-project-commands-e2e-"));
    env = {
        ...getCleanEnv(),
        // Sessions `rebase auth login` stores, kept out of the home directory.
        REBASE_SESSIONS_FILE: path.join(tempDir, "sessions.json")
    };
    await execa("node", [cliBin, "init", "myapp", "--yes", "--template", "blog"], { cwd: tempDir, env });
    projectDir = path.join(tempDir, "myapp");
    linkLocalPackages(projectDir);
    await execa("pnpm", ["install"], { cwd: projectDir, env });
    backend = await startBackend(projectDir, env);
    await claimFirstAdmin(backend.baseUrl);
}, 900_000);

afterAll(async () => {
    await stopBackend(backend);
    if (projectDir) await execa("node", [cliBin, "db", "stop"], { cwd: projectDir, env, reject: false });
    if (tempDir && fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
}, 120_000);

describe("rebase data, through the running server", () => {
    let id: string;

    it("inserts a row and answers it", async () => {
        const run = await rebase("data", "insert", "posts", "--data", JSON.stringify({ title: "From the CLI", content: "e2e", status: "published" }));
        expect(run.exitCode, run.stderr).toBe(0);
        expect(isRecord(run.json) && run.json.title).toBe("From the CLI");
        id = String(isRecord(run.json) ? run.json.id : "");
        expect(id).not.toBe("");
    });

    it("queries with the API's own filters, gets one, and counts", async () => {
        const query = await rebase("data", "query", "posts", "--where", "status=eq.published");
        expect(query.exitCode, query.stderr).toBe(0);
        const rows = isRecord(query.json) && Array.isArray(query.json.data) ? query.json.data : [];
        expect(rows.map(row => (isRecord(row) ? row.title : undefined))).toContain("From the CLI");

        const one = await rebase("data", "get", "posts", id);
        expect(isRecord(one.json) && String(one.json.id)).toBe(id);

        const count = await rebase("data", "count", "posts", "--where", "status=eq.published");
        expect(isRecord(count.json) && typeof count.json.count === "number" && count.json.count >= 1).toBe(true);
    });

    it("updates and deletes it", async () => {
        const update = await rebase("data", "update", "posts", id, "--data", JSON.stringify({ title: "Renamed" }));
        expect(update.exitCode, update.stderr).toBe(0);
        expect(isRecord(update.json) && update.json.title).toBe("Renamed");

        const refused = await rebase("data", "delete", "posts", id);
        expect(refused.exitCode).toBe(1);
        expect(isRecord(refused.json) && isRecord(refused.json.error) && refused.json.error.code).toBe("confirmation_required");

        const deleted = await rebase("data", "delete", "posts", id, "--yes");
        expect(deleted.exitCode, deleted.stderr).toBe(0);
        const gone = await rebase("data", "get", "posts", id);
        expect(gone.exitCode).toBe(1);
    });

    it("imports NDJSON in a bulk write and exports CSV", async () => {
        const file = path.join(tempDir, "seed.ndjson");
        fs.writeFileSync(file, [
            JSON.stringify({ title: "Seed one", content: "x", status: "draft" }),
            JSON.stringify({ title: "Seed two", content: "y", status: "draft" })
        ].join("\n"));
        const imported = await rebase("data", "import", "posts", "--file", file);
        expect(imported.exitCode, imported.stderr).toBe(0);
        expect(isRecord(imported.json) && imported.json.written).toBe(2);

        const csv = await execa("node", [cliBin, "data", "query", "posts", "--all", "--format", "csv"], { cwd: projectDir, env, reject: false });
        expect(csv.exitCode, csv.stderr).toBe(0);
        expect(csv.stdout.split("\n")[0]).toContain("title");
        expect(csv.stdout).toContain("Seed two");
    });
});

describe("rebase schema show --remote", () => {
    it("lists the tables the server describes, and one table's columns", async () => {
        const all = await rebase("schema", "show", "--remote");
        expect(all.exitCode, all.stderr).toBe(0);
        const slugs = Array.isArray(all.json) ? all.json.map(table => (isRecord(table) ? table.slug : undefined)) : [];
        expect(slugs).toContain("posts");

        const posts = await rebase("schema", "show", "posts");
        expect(posts.exitCode, posts.stderr).toBe(0);
        expect(JSON.stringify(posts.json)).toContain("title");
    });
});

describe("rebase users", () => {
    it("creates, finds, updates and deletes an account", async () => {
        const created = await rebase("users", "create", "reader@example.test", "--name", "Reader");
        expect(created.exitCode, created.stderr).toBe(0);

        const listed = await rebase("users", "list", "--search", "reader@example.test");
        const users = isRecord(listed.json) && Array.isArray(listed.json.users) ? listed.json.users : [];
        expect(users.map(user => (isRecord(user) ? user.email : undefined))).toContain("reader@example.test");

        const updated = await rebase("users", "update", "reader@example.test", "--name", "Reader Two");
        expect(updated.exitCode, updated.stderr).toBe(0);

        const roles = await rebase("users", "roles");
        expect(roles.exitCode, roles.stderr).toBe(0);
        expect(isRecord(roles.json) && Array.isArray(roles.json.roles)).toBe(true);

        const deleted = await rebase("users", "delete", "reader@example.test", "--yes");
        expect(deleted.exitCode, deleted.stderr).toBe(0);
    });

    it("captured the invitation in the development mailbox", async () => {
        const mail = await rebase("auth", "emails");
        expect(mail.exitCode, mail.stderr).toBe(0);
        const messages = isRecord(mail.json) && Array.isArray(mail.json.messages) ? mail.json.messages : [];
        expect(messages.map(message => (isRecord(message) ? message.to : undefined))).toContain("reader@example.test");
    });
});

describe("rebase api, functions, cron and logs", () => {
    it("sends any request with the project's credential", async () => {
        const run = await rebase("api", "data/posts", "-f", "limit=1");
        expect(run.exitCode, run.stderr).toBe(0);
        expect(isRecord(run.json) && Array.isArray(run.json.data)).toBe(true);

        const missing = await rebase("api", "data/no_such_table");
        expect(missing.exitCode).toBe(1);
    });

    it("lists the functions and calls one as a visitor", async () => {
        const listed = await rebase("functions", "list");
        expect(listed.exitCode, listed.stderr).toBe(0);
        expect(JSON.stringify(listed.json)).toContain("hello");

        const called = await rebase("functions", "invoke", "hello", "--anon");
        expect(called.exitCode, called.stderr).toBe(0);
    });

    it("lists cron jobs and reads the log", async () => {
        const cron = await rebase("cron", "list");
        expect(cron.exitCode, cron.stderr).toBe(0);
        expect(isRecord(cron.json) && Array.isArray(cron.json.jobs)).toBe(true);

        const logs = await rebase("logs", "-n", "5");
        expect(logs.exitCode, logs.stderr).toBe(0);
        expect(isRecord(logs.json) && Array.isArray(logs.json.entries)).toBe(true);
    });
});

describe("a person's session: auth login, whoami, rls simulate", () => {
    it("signs in, says who it is, and simulates a visitor", async () => {
        const login = await rebase("auth", "login", "--email", FIRST_ADMIN.email, "--password", FIRST_ADMIN.password);
        expect(login.exitCode, login.stderr).toBe(0);

        const whoami = await rebase("auth", "whoami", "--session");
        expect(whoami.exitCode, whoami.stderr).toBe(0);
        expect(JSON.stringify(whoami.json)).toContain("admin");

        const simulated = await rebase("rls", "simulate", "--role", "anon");
        expect(simulated.exitCode, simulated.stderr).toBe(0);
        expect(isRecord(simulated.json) && Array.isArray(simulated.json.collections)).toBe(true);

        const logout = await rebase("auth", "logout");
        expect(logout.exitCode, logout.stderr).toBe(0);
    });

    it("refuses the simulator for the service key, which is a machine", async () => {
        const run = await rebase("rls", "simulate", "--role", "anon");
        expect(run.exitCode).toBe(1);
    });
});

describe("rebase storage ls, cp, stat, url and rm", () => {
    it("uploads a file, lists it, signs a link to it, downloads it and deletes it", async () => {
        const local = path.join(tempDir, "hello.txt");
        fs.writeFileSync(local, "hello from the CLI\n");

        const up = await rebase("storage", "cp", local, ":e2e/hello.txt");
        expect(up.exitCode, up.stderr).toBe(0);

        const listed = await rebase("storage", "ls", ":e2e");
        expect(listed.exitCode, listed.stderr).toBe(0);
        expect(JSON.stringify(listed.json)).toContain("hello.txt");

        const stat = await rebase("storage", "stat", ":e2e/hello.txt");
        expect(stat.exitCode, stat.stderr).toBe(0);

        const url = await rebase("storage", "url", ":e2e/hello.txt");
        expect(url.exitCode, url.stderr).toBe(0);
        expect(isRecord(url.json) && typeof url.json.url === "string" && url.json.url.startsWith("http")).toBe(true);

        const back = path.join(tempDir, "back.txt");
        const down = await rebase("storage", "cp", ":e2e/hello.txt", back);
        expect(down.exitCode, down.stderr).toBe(0);
        expect(fs.readFileSync(back, "utf8")).toBe("hello from the CLI\n");

        const removed = await rebase("storage", "rm", ":e2e/hello.txt", "--yes");
        expect(removed.exitCode, removed.stderr).toBe(0);
        const gone = await rebase("storage", "stat", ":e2e/hello.txt");
        expect(gone.exitCode).toBe(1);
    });
});

describe("rebase api-keys update", () => {
    it("mints, changes and revokes a key through the shared target", async () => {
        const created = await execa("node", [cliBin, "api-keys", "create", "--name", "e2e", "--scopes", "data:read:posts"], { cwd: projectDir, env, reject: false });
        expect(created.exitCode, created.stderr).toBe(0);
        // eslint-disable-next-line no-control-regex
        const id = /ID:\s+(\S+)/.exec(created.stdout.replace(/\u001b\[[0-9;]*m/g, ""))?.[1];
        expect(id).toBeTruthy();

        const updated = await execa("node", [cliBin, "api-keys", "update", String(id), "--scopes", "data:read:posts,data:write:posts"], { cwd: projectDir, env, reject: false });
        expect(updated.exitCode, updated.stderr).toBe(0);
        expect(updated.stdout).toContain("data:write:posts");

        const revoked = await execa("node", [cliBin, "api-keys", "revoke", String(id), "--yes"], { cwd: projectDir, env, reject: false });
        expect(revoked.exitCode, revoked.stderr).toBe(0);
    });
});
