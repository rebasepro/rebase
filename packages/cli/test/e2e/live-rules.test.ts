/**
 * A rule changed from the Studio is the rule the database enforces — and the
 * schema a reader is served names only the tables they can reach.
 *
 * ## The live rule edit (security review S-4)
 *
 * The planner's DDL carries no policies. So a live apply that removed a public
 * read rule swapped the SERVED rules at once — the panel, the Studio RLS editor
 * and MCP all showed the tightened posture — while Postgres kept serving the
 * rows under the old policies until the next boot. A tightening looked enforced
 * when it was not. The fix writes the changed tables' policies in the same
 * apply (`applyPolicies` on the live schema routes) and reports the outcome as
 * `policies`; this file drives it through a real project: `rebase init`, a git
 * repository (a live apply commits), `rebase dev`, then
 * `POST /api/admin/schema/apply` with a `removeRule`, and three readers of the
 * same fact must agree afterwards — `GET /api/schema/tables`, `pg_policies`,
 * and what a signed-in reader is actually served.
 *
 * ## `GET /api/schema/tables` for a person without `schema:read`
 *
 * A signed-in person is described the tables some rule could grant their roles
 * something on (`schemaTables.persons: "granted"`), not the whole schema. The
 * blog scaffold's `users` table is admin-only, so a reader with no roles must
 * not see it, and — once the live edit removes the only rule that granted them
 * `posts` — must stop seeing `posts` too.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { execa } from "execa";
import pg from "pg";
import {
    cliBin,
    getCleanEnv,
    assertPackagesBuilt,
    linkLocalPackages,
    startBackend,
    stopBackend,
    claimFirstAdmin,
    registerAndLogin,
    writeRow,
    readRows,
    waitFor,
    type AuthedUser,
    type RunningBackend
} from "./helpers.js";

const env = getCleanEnv();
const gitEnv = {
    ...env,
    GIT_AUTHOR_NAME: "e2e", GIT_AUTHOR_EMAIL: "e2e@example.test",
    GIT_COMMITTER_NAME: "e2e", GIT_COMMITTER_EMAIL: "e2e@example.test"
};

/** The posts rule the scaffold opens published posts to every reader with — rule 0. */
const PUBLISHED_RULE = "{status} = 'published'";

let tempDir: string;
let projectDir: string;
let backend: RunningBackend | undefined;
let admin: AuthedUser;
let reader: AuthedUser;

interface ServedTable { slug: string; rls?: unknown }

async function servedTables(token: string): Promise<ServedTable[]> {
    const res = await fetch(`${backend!.baseUrl}/api/schema/tables`, { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status, await res.clone().text()).toBe(200);
    const body = await res.json() as { tables?: ServedTable[] } | ServedTable[];
    return Array.isArray(body) ? body : body.tables ?? [];
}

/** `pg_policies.qual` of every policy on `posts`, read from the database itself. */
async function postsPolicyQuals(): Promise<string[]> {
    const { stdout: url } = await execa("node", [cliBin, "db", "url"], { cwd: projectDir, env });
    const client = new pg.Client({ connectionString: url.trim() });
    await client.connect();
    try {
        const { rows } = await client.query<{ qual: string | null; with_check: string | null }>(
            "SELECT qual, with_check FROM pg_policies WHERE schemaname = 'public' AND tablename = 'posts'"
        );
        return rows.map(row => `${row.qual ?? ""} ${row.with_check ?? ""}`);
    } finally {
        await client.end();
    }
}

beforeAll(async () => {
    assertPackagesBuilt();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-live-rules-e2e-"));
    await execa("node", [cliBin, "init", "myapp", "--yes", "--template", "blog"], { cwd: tempDir, env });
    projectDir = path.join(tempDir, "myapp");
    linkLocalPackages(projectDir);
    await execa("pnpm", ["install"], { cwd: projectDir, env });

    backend = await startBackend(projectDir, env);
    admin = await claimFirstAdmin(backend.baseUrl);
    reader = await registerAndLogin(backend.baseUrl, "reader@example.test", "StrongPass3!reader");

    // A live apply commits, and refuses a dirty tree: the project is a
    // repository with everything the first boot wrote already committed.
    await execa("git", ["init", "-q"], { cwd: projectDir, env: gitEnv });
    await execa("git", ["add", "-A"], { cwd: projectDir, env: gitEnv });
    await execa("git", ["commit", "-q", "-m", "scaffold"], { cwd: projectDir, env: gitEnv });
}, 900_000);

afterAll(async () => {
    await stopBackend(backend);
    if (projectDir) await execa("node", [cliBin, "db", "stop"], { cwd: projectDir, env, reject: false });
    if (tempDir && fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
}, 120_000);

describe("GET /api/schema/tables for a person without schema:read", () => {
    it("names only the tables a rule grants the caller something on", async () => {
        expect(reader.roles).not.toContain("admin");
        const forReader = (await servedTables(reader.accessToken)).map(table => table.slug);
        const forAdmin = (await servedTables(admin.accessToken)).map(table => table.slug);

        // The admin is described everything; `users` is admin-only.
        expect(forAdmin).toEqual(expect.arrayContaining(["posts", "authors", "tags", "users"]));
        expect(forReader).toEqual(expect.arrayContaining(["posts", "authors", "tags"]));
        expect(forReader).not.toContain("users");
    });
});

describe("a live rule edit (S-4)", () => {
    it("enforces the removed rule in the same apply, and every reader agrees", async () => {
        // Before: rule 0 opens published posts to the reader, in all three places.
        const write = await writeRow(backend!.baseUrl, admin.accessToken, "posts", { title: "Visible until the edit", status: "published" });
        expect(write.status).toBe(201);
        const before = await readRows(backend!.baseUrl, reader.accessToken, "posts");
        expect(before.status).toBe(200);
        expect(before.rows.map(row => row.title)).toContain("Visible until the edit");
        const servedPostsBefore = (await servedTables(admin.accessToken)).find(table => table.slug === "posts");
        expect(JSON.stringify(servedPostsBefore?.rls)).toContain("published");
        expect((await postsPolicyQuals()).some(qual => qual.includes("published"))).toBe(true);

        const apply = await fetch(`${backend!.baseUrl}/api/admin/schema/apply`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${admin.accessToken}` },
            body: JSON.stringify({ patches: [{ op: "removeRule", table: "posts", index: 0 }] })
        });
        const applied = await apply.json() as { policies?: { status?: string; tables?: string[] } };
        expect(apply.status, JSON.stringify(applied)).toBe(200);
        // The discriminating half: the apply itself wrote the policies. Without
        // the fix this field is absent and the next boot is what enforces it.
        expect(applied.policies?.status, JSON.stringify(applied)).toBe("applied");
        expect(applied.policies?.tables).toContain("posts");

        // The source changed, and was committed.
        const source = fs.readFileSync(path.join(projectDir, "backend", "schema", "posts.ts"), "utf8");
        expect(source).not.toContain(PUBLISHED_RULE);
        const { stdout: status } = await execa("git", ["status", "--porcelain", "backend/schema"], { cwd: projectDir, env: gitEnv });
        expect(status.trim()).toBe("");

        // After: the served rules, the database's policies and the rows the
        // reader gets say the same thing. Polled, because `rebase dev` may
        // restart the backend for the changed file meanwhile.
        await waitFor(async () => {
            try {
                const served = (await servedTables(admin.accessToken)).find(table => table.slug === "posts");
                return served !== undefined && !JSON.stringify(served.rls).includes("published");
            } catch {
                return false;
            }
        }, 60_000);
        expect((await postsPolicyQuals()).some(qual => qual.includes("published"))).toBe(false);
        const after = await readRows(backend!.baseUrl, reader.accessToken, "posts");
        expect(after.rows.map(row => row.title)).not.toContain("Visible until the edit");

        // And the reader is no longer described a table no rule grants them.
        expect((await servedTables(reader.accessToken)).map(table => table.slug)).not.toContain("posts");
    }, 180_000);
});
