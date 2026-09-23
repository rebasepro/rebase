/**
 * `rebase doctor`'s exit code, for the one finding that did not reach it.
 *
 * "✗ Connection string that PostgreSQL's own tools cannot parse" is an error —
 * every `rebase db backup`, every scheduled backup and every `psql
 * "$DATABASE_URL"` fails on it — and doctor printed it and exited 0. A CI gate
 * running `rebase doctor` passed while the project had no working backups.
 *
 * Driven on a headless project, where doctor stops before the driver: the
 * finding is the only thing wrong, so the exit code is its alone.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ root: "" }));

vi.mock("../utils/project", async importOriginal => ({
    ...await importOriginal<typeof import("../utils/project")>(),
    requireProjectRoot: () => state.root,
    requireBackendDir: () => path.join(state.root, "backend"),
    getActiveBackendPlugin: () => "@rebasepro/server-postgres",
    resolvePluginCliScript: () => path.join(state.root, "backend", "cli.js")
}));

vi.mock("../dev-db/prepare", async importOriginal => ({
    ...await importOriginal<typeof import("../dev-db/prepare")>(),
    prepareDatabaseEnv: async () => ({
        database: { kind: "external", source: "env-file", url: "" },
        description: "your database (DATABASE_URL in .env)",
        env: {}
    })
}));

const { doctorCommand } = await import("./doctor");

class Exit extends Error {
    constructor(readonly code: number | undefined) {
        super(`process.exit(${code})`);
    }
}

describe("rebase doctor's exit code", () => {
    beforeEach(() => {
        state.root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-doctor-exit-")));
        fs.mkdirSync(path.join(state.root, "backend"));
        fs.mkdirSync(path.join(state.root, "config"));
        fs.writeFileSync(path.join(state.root, "package.json"), JSON.stringify({ name: "app", private: true }));
        fs.writeFileSync(path.join(state.root, "backend", "package.json"),
            JSON.stringify({ name: "backend", dependencies: { "@rebasepro/server-postgres": "0.22.0" } }));
        fs.writeFileSync(path.join(state.root, "rebase.json"),
            JSON.stringify({ rebase: "^1", apps: { backend: { type: "backend", runtime: "managed" } } }));
        vi.spyOn(console, "log").mockImplementation(() => undefined);
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        vi.spyOn(process, "exit").mockImplementation((code?: string | number | null) => {
            throw new Exit(typeof code === "number" ? code : undefined);
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        fs.rmSync(state.root, { recursive: true, force: true });
    });

    const env = (databaseUrl: string) => fs.writeFileSync(path.join(state.root, ".env"),
        `DATABASE_URL=${databaseUrl}\nJWT_SECRET=${"a1".repeat(32)}\n`);

    it("exits 1 over a connection string libpq cannot parse", async () => {
        env("postgresql://u:p@127.0.0.1:1/db?options=-c%20search_path=app");

        await expect(doctorCommand(["node", "rebase", "doctor"])).rejects.toEqual(new Exit(1));
    });

    it("still exits 0 when the same project's connection string is well-formed", async () => {
        env("postgresql://u:p@127.0.0.1:1/db?options=-c%20search_path%3Dapp");

        await expect(doctorCommand(["node", "rebase", "doctor"])).resolves.toBeUndefined();
    });
});
