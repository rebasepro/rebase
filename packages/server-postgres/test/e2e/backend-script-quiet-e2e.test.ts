/**
 * E2E: a script that builds a backend with `createRebaseBackend` and never
 * mounts it prints only its own output on stdout, and warns about no route it
 * did not mount — the way the scripts page tells a script to use it.
 *
 * Its stdout used to open with the boot: the collection schema skipped,
 * change capture, the RLS posture, the per-boot key, the request log of
 * `backend.fetch` and three shutdown lines, ahead of the script's JSON. Its
 * stderr carried "… routes are mounted but DISABLED" for eight admin surfaces
 * and the contract endpoint, none of them mounted.
 *
 * Run as a user runs it: its own Node process, `tsx script.mts`, the packages
 * imported from their entry points (this checkout's source), LOG_LEVEL=info.
 *
 * Requires Docker.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";

const packageRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const serverEntry = path.resolve(packageRoot, "../server/src/index.ts");
const driverEntry = path.join(packageRoot, "src/index.ts");

const posts = {
    name: "Posts",
    slug: "posts",
    table: "posts",
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        title: { name: "Title", type: "string" }
    }
};

/** The documented script: build, read, `fetch`, print one JSON line, shut down. */
function scriptSource(provision: boolean): string {
    return [
        `import { createRebaseBackend } from ${JSON.stringify(serverEntry)};`,
        `import { createPostgresAdapter, createPostgresDatabaseConnection, postgresDriverConfigFromEnv } from ${JSON.stringify(driverEntry)};`,
        "const { db, pool, connectionString } = createPostgresDatabaseConnection(process.env.DATABASE_URL ?? \"\");",
        "const backend = await createRebaseBackend({",
        "    database: createPostgresAdapter(postgresDriverConfigFromEnv({ connection: db, connectionString })),",
        `    collections: [${JSON.stringify(posts)}],`,
        `    provision: ${provision}`,
        "});",
        "const { data } = await backend.rebase.dataAsAdmin.posts.find({ limit: 5 });",
        "const res = await backend.fetch(new Request(\"http://local/api/meta/schema-version\"));",
        "console.log(JSON.stringify({ rows: data.length, status: res.status }));",
        "await backend.shutdown();",
        "await pool.end();",
        ""
    ].join("\n");
}

describe("a script that builds a backend and never mounts it (E2E)", () => {
    let container: PgContainer;
    let workDir: string;

    beforeAll(async () => {
        container = await startPgContainer();
        workDir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-backend-script-"));
    }, 180_000);

    afterAll(async () => {
        if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
        if (container) await stopPgContainer(container.containerName);
    }, 60_000);

    function runScript(source: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
        const script = path.join(workDir, `script-${crypto.randomUUID().slice(0, 8)}.mts`);
        fs.writeFileSync(script, source);
        const env: Record<string, string> = {};
        for (const [key, value] of Object.entries(process.env)) {
            if (value !== undefined && !["LOG_LEVEL", "NODE_ENV", "DATABASE_URL", "VITEST", "VITEST_WORKER_ID"].includes(key)) env[key] = value;
        }
        Object.assign(env, {
            DATABASE_URL: container.connectionString,
            LOG_LEVEL: "info",
            // `@rebasepro/*` from this checkout's source, as the vitest aliases do.
            TSX_TSCONFIG_PATH: path.resolve(packageRoot, "../../tsconfig.typecheck.json")
        });
        return new Promise((resolve, reject) => {
            const child = spawn(process.execPath, [createRequire(import.meta.url).resolve("tsx/cli"), script], {
                cwd: workDir, env, stdio: ["ignore", "pipe", "pipe"]
            });
            let stdout = "";
            let stderr = "";
            child.stdout.on("data", (chunk: Buffer) => { stdout += String(chunk); });
            child.stderr.on("data", (chunk: Buffer) => { stderr += String(chunk); });
            child.on("error", reject);
            child.on("close", (code) => resolve({ code, stdout, stderr }));
        });
    }

    it("provisioning its own tables, prints only its JSON on stdout", async () => {
        const result = await runScript(scriptSource(true));
        expect(result.stderr).not.toMatch(/\[ERROR\]/);
        expect(result.code).toBe(0);
        expect(result.stdout).toBe("{\"rows\":0,\"status\":200}\n");
    }, 120_000);

    it("with provision: false, prints only its JSON, and no warning about a route it never mounted", async () => {
        const result = await runScript(scriptSource(false));
        expect(result.code).toBe(0);
        expect(result.stdout).toBe("{\"rows\":0,\"status\":200}\n");
        expect(result.stderr).not.toMatch(/mounted but DISABLED/);
        expect(result.stderr).not.toMatch(/Contract endpoint disabled/);
    }, 120_000);
});
