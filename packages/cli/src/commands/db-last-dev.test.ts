/**
 * `rebase db url` after `rebase dev --docker`.
 *
 * The tester's repro: with `rebase dev --docker` running, `rebase db url`
 * printed `postgresql://postgres@127.0.0.1:64532/postgres` — a managed PGlite it
 * had just started — instead of the Docker database dev was serving, and left
 * that daemon running. Every `db` command resolved the same way.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ root: "" }));

vi.mock("../utils/project", async importOriginal => ({
    ...(await importOriginal<typeof import("../utils/project")>()),
    findProjectRoot: () => state.root,
    requireProjectRoot: () => state.root
}));

vi.mock("../utils/dev-preflight", async importOriginal => ({
    ...(await importOriginal<typeof import("../utils/dev-preflight")>()),
    ensureDevDatabase: vi.fn(async () => ({ action: "already-running" as const, host: "127.0.0.1", port: 5435 }))
}));

vi.mock("../dev-db/daemon", async importOriginal => ({
    ...(await importOriginal<typeof import("../dev-db/daemon")>()),
    ensureManagedDatabase: vi.fn(async () => {
        throw new Error("the managed database must not be started");
    })
}));

const { dbCommand } = await import("./db");
const { ensureDevDatabase } = await import("../utils/dev-preflight");
const { recordLastDevDatabase } = await import("../dev-db/last-dev-database");

const ensureSpy = vi.mocked(ensureDevDatabase);
const COMPOSE_URL = "postgresql://rebase_app:s3cret@127.0.0.1:5435/rebase?options=-c%20search_path%3Dpublic&sslmode=disable";

describe("rebase db url, after rebase dev --docker", () => {
    let stdout: string[];
    let stderr: string[];

    beforeEach(() => {
        state.root = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-db-last-dev-"));
        fs.writeFileSync(path.join(state.root, "docker-compose.yml"), [
            "services:",
            "  db:",
            "    image: pgvector/pgvector:pg18",
            "    environment:",
            "      POSTGRES_USER: rebase_app",
            "      POSTGRES_PASSWORD: ${DATABASE_PASSWORD:-changeme}",
            "      POSTGRES_DB: rebase",
            "    ports:",
            '      - "5435:5432"',
            ""
        ].join("\n"));
        fs.writeFileSync(path.join(state.root, ".env"), "DATABASE_PASSWORD=s3cret\n");
        stdout = [];
        stderr = [];
        vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => { stdout.push(parts.map(String).join(" ")); });
        vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => { stderr.push(parts.map(String).join(" ")); });
        ensureSpy.mockClear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        fs.rmSync(state.root, { recursive: true, force: true });
    });

    const url = () => dbCommand("url", ["node", "rebase", "db", "url"]);

    it("prints the Docker database, ensures it is up, and starts no PGlite", async () => {
        recordLastDevDatabase(state.root, "docker");

        await url();

        expect(stdout).toEqual([COMPOSE_URL]);
        expect(ensureSpy).toHaveBeenCalledOnce();
        expect(ensureSpy.mock.calls[0][0]).toMatchObject({ databaseUrl: COMPOSE_URL, hasCollections: false });
        // Said on stderr, so `$(rebase db url)` still captures only the URL.
        expect(stderr.join("\n")).toContain("rebase dev --docker");
    });

    it("goes back to the managed database once `rebase dev` runs without --docker", async () => {
        recordLastDevDatabase(state.root, "docker");
        recordLastDevDatabase(state.root, "managed");

        await expect(url()).rejects.toThrow("the managed database must not be started");
        expect(ensureSpy).not.toHaveBeenCalled();
    });
});
