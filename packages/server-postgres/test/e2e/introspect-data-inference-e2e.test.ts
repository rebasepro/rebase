/**
 * `rebase schema introspect --data-inference`, against a real Postgres.
 *
 * Three things a tester met on the one path that reads rows:
 *
 * - `--data-inference` and `--no-data-inference` were refused by the driver's
 *   flag check ("unknown or unexpected option"), though introspect reads both
 *   and says "pass --data-inference to enable" when it skips the prompt.
 * - Answering the prompt yes printed `DeprecationWarning: Calling
 *   client.query() when the client is already executing a query`: the rows of
 *   ten tables at a time were sampled at once over one connection.
 * - "Review the generated files in …" was printed when no file was generated.
 *
 * Requires Docker. Spins up a throwaway Postgres container and tears it down.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import pg from "pg";
import { fileURLToPath } from "url";
import { execa } from "execa";
import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, "../..");
const monorepoRoot = path.resolve(pkgRoot, "../..");
const cliScript = path.join(pkgRoot, "src", "cli.ts");
const tsxBin = path.join(monorepoRoot, "node_modules", ".bin", "tsx");

/** More tables than one batch of ten, each with rows to sample. */
const TABLES = Array.from({ length: 12 }, (_, index) => `t${String(index).padStart(2, "0")}`);

function cleanEnv(connectionString: string): Record<string, string> {
    const env = { ...process.env } as Record<string, string>;
    for (const key of Object.keys(env)) {
        if (/^(npm_|PNPM_|pnpm_|NPM_)/i.test(key)) delete env[key];
    }
    env.DATABASE_URL = connectionString;
    return env;
}

describe("schema introspect with data inference", () => {
    let container: PgContainer;
    let base: string;

    beforeAll(async () => {
        container = await startPgContainer();
        const client = new pg.Client({ connectionString: container.connectionString });
        await client.connect();
        try {
            for (const table of TABLES) {
                await client.query(`CREATE TABLE ${table} (id serial PRIMARY KEY, email text, created_at timestamptz DEFAULT now())`);
                await client.query(`INSERT INTO ${table} (email) SELECT 'user' || g || '@example.com' FROM generate_series(1, 5) AS g`);
            }
        } finally {
            await client.end();
        }
        base = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-introspect-inference-"));
        fs.mkdirSync(path.join(base, "backend"));
        fs.writeFileSync(path.join(base, "backend", "package.json"), JSON.stringify({ name: "backend", type: "module" }));
    }, 120_000);

    afterAll(async () => {
        if (base) fs.rmSync(base, { recursive: true, force: true });
        if (container) await stopPgContainer(container.containerName);
    }, 30_000);

    const introspect = (...args: string[]) => execa(tsxBin, [cliScript, "schema", "introspect", ...args], {
        cwd: path.join(base, "backend"),
        env: cleanEnv(container.connectionString),
        reject: false,
        stdin: "ignore",
        all: true
    });

    it("takes --data-inference, and samples every table over one connection without a warning", async () => {
        const output = path.join(base, "inferred");

        const run = await introspect("--data-inference", "--output", output);

        expect(run.all).not.toContain("unknown or unexpected option");
        expect(run.all).not.toContain("DeprecationWarning");
        expect(run.all).toContain("Sampling database rows for data inference");
        expect(run.exitCode, run.all).toBe(0);
        for (const table of TABLES) expect(fs.existsSync(path.join(output, `${table}.ts`))).toBe(true);
    }, 120_000);

    it("takes --no-data-inference", async () => {
        const run = await introspect("--no-data-inference", "--output", path.join(base, "structure"));

        expect(run.exitCode, run.all).toBe(0);
        expect(run.all).not.toContain("Sampling database rows");
    }, 120_000);

    it("says nothing about reviewing files when it generated none", async () => {
        const output = path.join(base, "inferred");

        // Every file is there already, and nothing forces an overwrite.
        const run = await introspect("--no-data-inference", "--output", output);

        expect(run.exitCode, run.all).toBe(0);
        expect(run.all).toContain("generated 0 collection(s)");
        expect(run.all).not.toContain("Review the generated files");
    }, 120_000);
});
