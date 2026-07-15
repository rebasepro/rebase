/**
 * End-to-end for the BaaS flavor: `rebase init --flavor baas`.
 *
 * Scaffolds a headless project the way a user would, installs it from real
 * tarballs, points it at a database whose tables it has never been told about,
 * and checks the API serves them. This is the only place the scaffolded
 * template is actually installed and booted — `workspace:*` deps don't resolve
 * anywhere else — so it's what proves the template, not just the library.
 *
 * Run: npx tsx e2e/tests/cli-init-baas-e2e.ts
 */
import * as fs from "fs";
import * as path from "path";

import {
    execa,
    getCleanEnv,
    packLocalPackages,
    rewritePackagesToTarballs,
    configureServiceKey,
    startPgContainer,
    stopPgContainer,
    rootDir,
    cliBin,
    type PgContainer
} from "./cli-init-e2e";

const projectPath = path.join(rootDir, "test-cli-init-baas-project");
const cleanEnv = getCleanEnv();
const serviceKey = "mysupersecretkey12345678901234567890";

/** Authenticated fetch — without this every /api/data path 401s alike, and a
 *  missing collection is indistinguishable from a guarded one. */
const api = (base: string, p: string, init: RequestInit = {}) =>
    fetch(`${base}${p}`, { ...init, headers: { ...init.headers, Authorization: `Bearer ${serviceKey}` } });

let failures = 0;

function check(label: string, ok: boolean, detail = "") {
    console.log(`${ok ? "  ✓" : "  ✗"} ${label}${detail ? ` — ${detail}` : ""}`);
    if (!ok) failures++;
}

/** The schema the server must discover entirely on its own. */
const SEED_SQL = `
CREATE TYPE post_status AS ENUM ('draft', 'published');
CREATE TABLE authors (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name varchar(120) NOT NULL
);
CREATE TABLE posts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title text NOT NULL,
    status post_status NOT NULL DEFAULT 'draft',
    views integer,
    tags text[],
    author_id uuid REFERENCES authors(id)
);
CREATE TABLE tags (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), label text NOT NULL);
CREATE TABLE posts_tags (
    post_id uuid NOT NULL REFERENCES posts(id),
    tag_id uuid NOT NULL REFERENCES tags(id),
    PRIMARY KEY (post_id, tag_id)
);

-- baas serves only what the database protects: requests run as rebase_user,
-- so a table without RLS would have no authorization model at all.
ALTER TABLE authors ENABLE ROW LEVEL SECURITY;
ALTER TABLE posts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE tags    ENABLE ROW LEVEL SECURITY;
CREATE POLICY authors_all ON authors FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY posts_all   ON posts   FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY tags_all    ON tags    FOR ALL TO public USING (true) WITH CHECK (true);

-- Deliberately left unprotected: must NOT reach the API.
CREATE TABLE secrets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), api_key text NOT NULL);
INSERT INTO secrets (api_key) VALUES ('SHOULD-NEVER-BE-SERVED');

INSERT INTO authors (name) VALUES ('Ada Lovelace');
INSERT INTO posts (title, status, views, tags, author_id)
SELECT 'Hello BaaS', 'published', 42, ARRAY['a','b'], id FROM authors;
`;

async function seedDatabase(container: PgContainer) {
    await execa("docker", ["exec", "-i", container.containerName, "psql", "-U", "rebase", "-d", "rebase", "-c", SEED_SQL], {
        stdio: "inherit"
    });
}

async function waitForApi(url: string, timeoutMs = 90_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const res = await fetch(url);
            if (res.ok) return true;
        } catch {
            // not up yet
        }
        await new Promise((r) => setTimeout(r, 1000));
    }
    return false;
}

async function run() {
    let container: PgContainer | undefined;
    let devProcess: { kill(signal?: string): void } | undefined;

    if (fs.existsSync(projectPath)) {
        fs.rmSync(projectPath, { recursive: true, force: true });
    }

    console.log("Starting temporary Postgres container...");
    container = await startPgContainer();

    try {
        // ── 1. Scaffold ──────────────────────────────────────────────────
        console.log("\n📦 Step 1: Scaffolding a BaaS project via CLI init --flavor baas...");
        await execa("node", [
            cliBin,
            "init",
            path.basename(projectPath),
            "--yes",
            "--flavor",
            "baas",
            "--database-url",
            container.connectionString
        ], { cwd: rootDir, env: cleanEnv, stdio: "inherit" });

        // ── 2. Structure ─────────────────────────────────────────────────
        console.log("\n🔍 Step 2: Checking the scaffolded structure...");
        check("no frontend/ directory", !fs.existsSync(path.join(projectPath, "frontend")));
        check("no config/ directory", !fs.existsSync(path.join(projectPath, "config")));
        check("no generated drizzle schema", !fs.existsSync(path.join(projectPath, "backend", "src", "schema.generated.ts")));

        const backendEntry = fs.readFileSync(path.join(projectPath, "backend", "src", "index.ts"), "utf8");
        check("backend runs in baas mode", backendEntry.includes('mode: "baas"'));
        check("backend does not serve an SPA", !backendEntry.includes("serveSPA("));

        // ── 3. Install from real tarballs ────────────────────────────────
        console.log("\n📥 Step 3: Installing dependencies from local tarballs...");
        const packageTarballs = packLocalPackages(projectPath);
        rewritePackagesToTarballs(projectPath, packageTarballs);
        configureServiceKey(projectPath, serviceKey);

        const lockPath = path.join(projectPath, "pnpm-lock.yaml");
        if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);

        await execa("pnpm", ["install", "--force", "--store-dir", "./pnpm-store"], {
            cwd: projectPath,
            stdio: "inherit",
            env: cleanEnv
        });

        // The guard in scripts/headless-guard covers the monorepo; only here can
        // we see what a user's install tree actually contains.
        const reactInstalled = fs.existsSync(path.join(projectPath, "node_modules", "react"))
            || fs.existsSync(path.join(projectPath, "backend", "node_modules", "react"));
        check("no react in the install tree", !reactInstalled);

        // ── 4. Seed a schema the project has never seen ──────────────────
        console.log("\n🌱 Step 4: Creating tables the project was never told about...");
        await seedDatabase(container);

        // ── 5. Boot ──────────────────────────────────────────────────────
        console.log("\n🚀 Step 5: Booting the API...");
        // `rebase dev` otherwise derives a per-project port, so pin one.
        devProcess = execa("node", [cliBin, "dev", "--port", "3098"], {
            cwd: projectPath,
            env: cleanEnv,
            stdio: "inherit"
        }) as unknown as { kill(signal?: string): void };

        const base = "http://localhost:3098";
        const up = await waitForApi(`${base}/health`);
        check("API boots and is healthy", up);
        if (!up) throw new Error("API never became healthy");

        // ── 6. Serve the database it discovered ──────────────────────────
        console.log("\n🔎 Step 6: Checking the derived API...");

        const postsRes = await api(base, "/api/data/posts");
        const postsBody = await postsRes.json().catch(() => ({})) as { data?: Record<string, unknown>[] };
        const post = postsBody.data?.[0] ?? {};
        check("posts are served from the discovered table", postsRes.status === 200, `status ${postsRes.status}`);
        check("row data comes back", post.title === "Hello BaaS", JSON.stringify(post.title));
        check("enum column", post.status === "published", JSON.stringify(post.status));
        check("integer column", post.views === 42, JSON.stringify(post.views));
        check("text[] column", Array.isArray(post.tags) && (post.tags as string[])[0] === "a", JSON.stringify(post.tags));

        const authorsRes = await api(base, "/api/data/authors");
        const authorsBody = await authorsRes.json().catch(() => ({})) as { data?: Record<string, unknown>[] };
        check("authors are served", authorsRes.status === 200, `status ${authorsRes.status}`);
        check("author row data", authorsBody.data?.[0]?.name === "Ada Lovelace");

        // Join tables are an edge between collections, not a collection.
        const join = await api(base, "/api/data/posts_tags");
        check("join table is not served", join.status === 404, `status ${join.status}`);

        // A table with RLS disabled has no authorization model — serving it
        // would hand every row to every authenticated caller.
        const secrets = await api(base, "/api/data/secrets");
        check("table without RLS is not served", secrets.status === 404, `status ${secrets.status}`);

        const editor = await api(base, "/api/schema-editor/collection/save", { method: "POST" });
        check("schema editor is off", editor.status === 404, `status ${editor.status}`);

        const swagger = await fetch(`${base}/api/swagger`);
        check("swagger is served", swagger.ok, `status ${swagger.status}`);

        // ── 7. The SDK, with no collections defined anywhere ──────────────
        // The whole baas promise: a user never learns what a collection is.
        // Run it as a real script inside the scaffolded project, so it proves
        // @rebasepro/client resolves from a baas install — not just that the
        // API answers curl.
        console.log("\n📦 Step 7: Using the SDK against the derived API...");
        const sdkScript = path.join(projectPath, "sdk-check.ts");
        fs.writeFileSync(sdkScript, `
import { createRebaseClient } from "@rebasepro/client";

const rebase = createRebaseClient({ baseUrl: "${base}", token: "${serviceKey}" });

// No collections option, no config, no generated types — just a table name.
const posts = await rebase.data.collection("posts").find({ limit: 5 });
const rows = (posts as { data?: unknown[] }).data ?? posts;
const first = (Array.isArray(rows) ? rows[0] : undefined) as Record<string, unknown> | undefined;
if (first?.title !== "Hello BaaS") {
    console.error("SDK_FAIL " + JSON.stringify(rows).slice(0, 200));
    process.exit(1);
}

// A write, so this isn't read-only proof.
const created = await rebase.data.collection("authors").create({ name: "Grace Hopper" });
if (!created) { console.error("SDK_FAIL create returned nothing"); process.exit(1); }

// The typed proxy accessor, still with no collections map configured.
const viaProxy = await rebase.data.posts.find({ limit: 1 });
if (!((viaProxy as { data?: unknown[] }).data ?? []).length) { console.error("SDK_FAIL proxy accessor"); process.exit(1); }

console.log("SDK_OK");
process.exit(0);
`);
        let sdkOk = false;
        try {
            const res = await execa("npx", ["tsx", "sdk-check.ts"], { cwd: projectPath, env: cleanEnv });
            sdkOk = String((res as unknown as { stdout?: string }).stdout ?? "").includes("SDK_OK");
        } catch (err) {
            console.log("  SDK script failed:", (err as Error).message.slice(0, 1200));
        }
        check("SDK reads and writes with zero collections configured", sdkOk);
        fs.rmSync(sdkScript, { force: true });

        console.log(failures === 0 ? "\n✅ BaaS e2e passed" : `\n❌ ${failures} check(s) failed`);
        if (failures > 0) process.exit(1);
    } finally {
        if (devProcess) {
            try { devProcess.kill("SIGTERM"); } catch { /* already gone */ }
        }
        if (container) await stopPgContainer(container.containerName);
    }
}

run().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
