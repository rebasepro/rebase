/**
 * `rebase start` on the scaffold's own `.env`.
 *
 * The scaffold leaves DATABASE_URL commented out — `rebase dev` runs the
 * project on the managed database without it — so the first `pnpm run build &&
 * pnpm start` stopped on the runtime's `DATABASE_URL: is required` and a link
 * to the self-hosting docs. Nothing mentioned `rebase db url`, or that the
 * database `rebase dev` had been using was one command away.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
    root: "",
    booted: 0,
    poolMaxAtBoot: undefined as string | undefined,
    daemonPort: null as number | null
}));

vi.mock("../utils/project", async importOriginal => ({
    ...(await importOriginal<typeof import("../utils/project")>()),
    requireProjectRoot: () => state.root,
    findProjectRoot: () => state.root
}));

vi.mock("@rebasepro/server", () => ({
    runFromBundle: async () => {
        state.booted++;
        state.poolMaxAtBoot = process.env.REBASE_DB_POOL_MAX;
    }
}));

vi.mock("../dev-db/daemon", async importOriginal => ({
    ...(await importOriginal<typeof import("../dev-db/daemon")>()),
    findRunningDaemon: async () => state.daemonPort === null ? null : {
        port: state.daemonPort, pid: process.pid, dataDir: "", startedAt: "", token: "t", identityPort: 1
    }
}));

const { managedDatabaseRuntimeEnv, missingDatabaseUrl, startCommand } = await import("./start");
const { getPMCommands } = await import("../utils/package-manager");

class Exit extends Error {
    constructor(readonly code: number | undefined) {
        super(`process.exit(${code})`);
    }
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

describe("rebase start without a DATABASE_URL", () => {
    let printed: string[];
    const saved = {
        DATABASE_URL: process.env.DATABASE_URL,
        REBASE_BUNDLE: process.env.REBASE_BUNDLE,
        NODE_ENV: process.env.NODE_ENV,
        REBASE_DB_POOL_MAX: process.env.REBASE_DB_POOL_MAX
    };

    beforeEach(() => {
        state.root = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-start-db-"));
        state.booted = 0;
        state.poolMaxAtBoot = undefined;
        state.daemonPort = null;
        delete process.env.REBASE_DB_POOL_MAX;
        fs.mkdirSync(path.join(state.root, "dist-bundle"), { recursive: true });
        fs.writeFileSync(path.join(state.root, "dist-bundle", "manifest.json"), JSON.stringify({ entry: {} }));
        // The scaffold's .env, as `rebase init` writes it: the URL commented out.
        fs.writeFileSync(path.join(state.root, ".env"), [
            "NODE_ENV=development",
            "PORT=3001",
            "# DATABASE_URL=postgresql://rebase:changeme@127.0.0.1:5436/rebase",
            ""
        ].join("\n"));
        delete process.env.DATABASE_URL;
        printed = [];
        const capture = (...parts: unknown[]) => { printed.push(parts.map(String).join(" ").replace(ANSI, "")); };
        vi.spyOn(console, "log").mockImplementation(capture);
        vi.spyOn(console, "error").mockImplementation(capture);
        vi.spyOn(process, "exit").mockImplementation((code?: string | number | null) => {
            throw new Exit(typeof code === "number" ? code : undefined);
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
        fs.rmSync(state.root, { recursive: true, force: true });
    });

    it("says how to run it against the development database, and does not boot", async () => {
        fs.writeFileSync(path.join(state.root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
        await expect(startCommand(["node", "rebase", "start"])).rejects.toEqual(new Exit(1));

        const output = printed.join("\n");
        expect(output).toContain("DATABASE_URL is not set");
        expect(output).toContain("managed development database");
        expect(state.booted).toBe(0);
    });

    /**
     * A scaffold has `rebase` in `node_modules/.bin`, not on PATH: the README
     * runs it through scripts (`pnpm dev`), and the CLI's other hints spell a
     * bare command the package manager's way. The bare `rebase db url` printed
     * here answered `command not found`.
     */
    it("spells the command the way this project's package manager runs a local bin", async () => {
        fs.writeFileSync(path.join(state.root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
        await expect(startCommand(["node", "rebase", "start"])).rejects.toEqual(new Exit(1));
        expect(printed.join("\n")).toContain('DATABASE_URL="$(pnpm exec rebase db url)" pnpm exec rebase start');
    });

    it("spells it with npx in an npm project", async () => {
        fs.writeFileSync(path.join(state.root, "package-lock.json"), "{}\n");
        await expect(startCommand(["node", "rebase", "start"])).rejects.toEqual(new Exit(1));
        expect(printed.join("\n")).toContain('DATABASE_URL="$(npx rebase db url)" npx rebase start');
    });

    it("boots when .env names one", async () => {
        fs.appendFileSync(path.join(state.root, ".env"), "DATABASE_URL=postgresql://u:p@127.0.0.1:5432/app\n");

        await startCommand(["node", "rebase", "start"]);

        expect(state.booted).toBe(1);
        expect(printed.join("\n")).not.toContain("DATABASE_URL is not set");
        expect(state.poolMaxAtBoot).toBeUndefined();
    });

    it("boots on the managed database with the pool `rebase dev` gives it", async () => {
        state.daemonPort = 54001;
        process.env.DATABASE_URL = "postgresql://postgres@127.0.0.1:54001/postgres?sslmode=disable";

        await startCommand(["node", "rebase", "start"]);

        expect(state.booted).toBe(1);
        expect(state.poolMaxAtBoot).toBe("1");
    });
});

describe("missingDatabaseUrl", () => {
    const pnpm = getPMCommands("pnpm");

    it("is nothing when DATABASE_URL is set", () => {
        expect(missingDatabaseUrl({ DATABASE_URL: "postgresql://x" }, "managed", pnpm)).toBeNull();
    });

    it("treats a blank value as unset, as the runtime does", () => {
        expect(missingDatabaseUrl({ DATABASE_URL: "  " }, "managed", pnpm)).not.toBeNull();
    });

    it("names the Docker database when that is what `rebase dev` runs on", () => {
        const text = (missingDatabaseUrl({}, "docker", pnpm) ?? []).join("\n");
        expect(text).toContain("Docker");
        expect(text).toContain("rebase db url");
    });
});

/**
 * `rebase start` beside `rebase dev`, on the managed database.
 *
 * Its boot logged `❌ rebase.cron_claims is unavailable`, a warning about
 * `cron_job_state` and one about the history sweep, while all of those tables
 * existed. The runtime's pool was the ordinary size, so the boot's concurrent
 * probes opened several connections at once; the managed database accepts four
 * and dev holds two, so the ones over were refused, and a probe that cannot
 * connect reads as a table that is not there. Measured: three concurrent
 * `SELECT 1 FROM … WHERE false` beside two held connections, one refused with
 * a pool of ten, none with a pool of one. `rebase dev` caps its pool at one
 * (`MANAGED_POOL_MAX`) for this database; `rebase start` now does too.
 */
describe("managedDatabaseRuntimeEnv", () => {
    const daemon = {
        port: 54001, pid: 1, dataDir: "/tmp/x", startedAt: "", token: "t", identityPort: 54002,
        databases: { analytics: { port: 54003, dataDir: "/tmp/y" } }
    };
    const managed = "postgresql://postgres@127.0.0.1:54001/postgres?sslmode=disable";

    it("caps the pool at one connection when DATABASE_URL is this project's managed database", () => {
        expect(managedDatabaseRuntimeEnv(managed, daemon, {})).toEqual({ REBASE_DB_POOL_MAX: "1" });
        expect(managedDatabaseRuntimeEnv("postgresql://postgres@localhost:54003/postgres", daemon, {}))
            .toEqual({ REBASE_DB_POOL_MAX: "1" });
    });

    it("leaves any other database alone", () => {
        expect(managedDatabaseRuntimeEnv("postgresql://u:p@127.0.0.1:5432/app", daemon, {})).toEqual({});
        expect(managedDatabaseRuntimeEnv("postgresql://u:p@db.example.com:54001/app", daemon, {})).toEqual({});
        expect(managedDatabaseRuntimeEnv(managed, null, {})).toEqual({});
        expect(managedDatabaseRuntimeEnv("not a url", daemon, {})).toEqual({});
        expect(managedDatabaseRuntimeEnv(undefined, daemon, {})).toEqual({});
    });

    it("keeps a ceiling set by hand", () => {
        expect(managedDatabaseRuntimeEnv(managed, daemon, { REBASE_DB_POOL_MAX: "2" })).toEqual({});
    });
});
