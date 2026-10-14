/**
 * `rebase schema introspect` reads the project's database, the one every other
 * database command resolves.
 *
 * It passed the driver `.env` and nothing else, so on the managed database or
 * after `rebase dev --docker` — the scaffold leaves `DATABASE_URL` commented out
 * on purpose — it answered `✗ DATABASE_URL is not set. Make sure your .env file
 * is configured.`, contradicting the scaffold. And `--docker` and
 * `--database-url` passed the unknown-flag guard and were ignored, so they read
 * as working.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawned = vi.hoisted(() => ({ env: null as Record<string, string> | null, args: null as string[] | null }));
const project = vi.hoisted(() => ({ root: "" }));
const ensureDocker = vi.hoisted(() => ({ calls: 0 }));

vi.mock("./db", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./db")>()),
    spawnDriverCli: async (resolved: { env: Record<string, string> }, args: string[]) => {
        spawned.env = resolved.env;
        spawned.args = args;
    },
    // The container itself is not what this asserts; starting one is `db.ts`'s.
    ensureDockerDatabase: async () => {
        ensureDocker.calls += 1;
    }
}));

vi.mock("../utils/project", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../utils/project")>();
    return {
        ...actual,
        requireProjectRoot: () => project.root,
        requireBackendDir: () => path.join(project.root, "backend"),
        getActiveBackendPlugin: () => "@rebasepro/server-postgres",
        resolvePluginCliScript: () => path.join(project.root, "backend", "driver-cli.ts")
    };
});

import { recordLastDevDatabase } from "../dev-db/last-dev-database";
import { schemaCommand } from "./schema";

const originalEnv = { ...process.env };

beforeEach(() => {
    project.root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-introspect-db-")));
    fs.mkdirSync(path.join(project.root, "backend"));
    fs.writeFileSync(path.join(project.root, "rebase.json"), "{}");
    fs.writeFileSync(path.join(project.root, "docker-compose.yml"), [
        "services:",
        "  db:",
        "    image: pgvector/pgvector:pg18",
        "    environment:",
        "      POSTGRES_USER: rebase_app",
        "      POSTGRES_PASSWORD: ${DATABASE_PASSWORD:-changeme}",
        "      POSTGRES_DB: rebase",
        "    ports:",
        "      - \"5433:5432\"",
        ""
    ].join("\n"));
    // The scaffold's `.env`, DATABASE_URL commented out.
    fs.writeFileSync(path.join(project.root, ".env"), "DATABASE_PASSWORD=s3cret\n# DATABASE_URL=postgresql://…\n");
    delete process.env.DATABASE_URL;
    spawned.env = null;
    spawned.args = null;
    ensureDocker.calls = 0;
    vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
    process.env = { ...originalEnv };
    fs.rmSync(project.root, { recursive: true, force: true });
    vi.restoreAllMocks();
});

const argv = (...line: string[]) => ["/usr/bin/node", "/usr/local/bin/rebase", ...line];

describe("schema introspect", () => {
    it("reads the Postgres in Docker the last `rebase dev --docker` ran on", async () => {
        recordLastDevDatabase(project.root, "docker");

        await schemaCommand("introspect", argv("schema", "introspect", "-o", "config/introspected"));

        expect(spawned.env?.DATABASE_URL).toContain("@127.0.0.1:5433/rebase");
        expect(spawned.env?.REBASE_DEV_DATABASE_KIND).toBe("docker");
        expect(ensureDocker.calls).toBe(1);
    });

    it("follows --docker typed on the line", async () => {
        await schemaCommand("introspect", argv("schema", "introspect", "--docker"));

        expect(spawned.env?.DATABASE_URL).toContain("@127.0.0.1:5433/rebase");
    });

    it("reads the database --database-url names", async () => {
        recordLastDevDatabase(project.root, "docker");

        await schemaCommand("introspect", argv("schema", "introspect", "--database-url", "postgresql://u:pw@db.local:5432/legacy"));

        expect(spawned.env?.DATABASE_URL).toBe("postgresql://u:pw@db.local:5432/legacy");
        expect(spawned.env?.REBASE_DEV_DATABASE_KIND).toBe("external");
    });

    it("leaves the commands that never connect alone", async () => {
        // `schema generate` reads collection files and writes one; resolving —
        // let alone starting — a database for it is a side effect nobody asked for.
        recordLastDevDatabase(project.root, "docker");

        await schemaCommand("generate", argv("schema", "generate"));

        expect(spawned.args?.[1]).toBe("generate");
        expect(spawned.env?.DATABASE_URL).toBeUndefined();
        expect(ensureDocker.calls).toBe(0);
    });
});

/**
 * Every flag the driver's `introspect` reads, on both help pages.
 *
 * `--data-inference` and `--no-data-inference` decide whether rows are read at
 * all — the one choice a script has to make, since without a terminal the
 * prompt is skipped — and neither `rebase schema --help` nor `rebase schema
 * introspect --help` named them. The flags come from the driver's own spec, so
 * the next one added there fails here until a help page says it.
 */
describe("schema introspect --help", () => {
    const driverFlags = (): string[] => {
        const source = fs.readFileSync(
            path.join(__dirname, "..", "..", "..", "server-postgres", "src", "schema", "introspect-db.ts"),
            "utf8"
        );
        const spec = /const args = arg\(\s*\{([\s\S]*?)\}/.exec(source);
        expect(spec, "introspect-db.ts's arg spec moved; this guard needs its new shape").not.toBeNull();
        // Long flags only: a short alias is named beside the flag it stands for.
        return [...spec![1].matchAll(/"(--[a-z-]+)":\s*(?!")/g)].map(match => match[1]);
    };
    const helpOf = async (...line: string[]): Promise<string> => {
        const printed: string[] = [];
        vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => { printed.push(parts.map(String).join(" ")); });
        await schemaCommand(line[1], argv(...line));
        // eslint-disable-next-line no-control-regex
        return printed.join("\n").replace(/\x1b\[[0-9;]*m/g, "");
    };

    it("names every flag the driver's introspect reads", async () => {
        const flags = driverFlags();
        expect(flags).toContain("--data-inference");

        const page = await helpOf("schema", "introspect", "--help");
        const index = await helpOf("schema", "--help");
        for (const flag of flags) {
            expect(page, `rebase schema introspect --help does not mention ${flag}`).toContain(flag);
            expect(index, `rebase schema --help does not mention ${flag}`).toContain(flag);
        }
    });
});

