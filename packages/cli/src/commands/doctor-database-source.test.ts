/**
 * `rebase doctor` tells the driver what named the database.
 *
 * The driver's "Cannot connect" banner chooses its fixes by
 * `REBASE_DATABASE_SOURCE`, which the `db` commands pass and doctor did not.
 * So with the remembered Docker database stopped, doctor's banner listed
 * "Verify DATABASE_URL in your .env file" — a file that played no part, since
 * the URL came from the earlier `rebase dev --docker` — beside the
 * `docker compose up -d db` that was the whole answer.
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

vi.mock("execa", () => ({ execa: vi.fn(async () => ({ exitCode: 0 })) }));

vi.mock("../dev-db/prepare", async importOriginal => ({
    ...await importOriginal<typeof import("../dev-db/prepare")>(),
    prepareDatabaseEnv: async () => ({
        database: { kind: "docker", source: "last-dev", url: "postgresql://rebase:rebase@127.0.0.1:5433/rebase" },
        description: "Postgres in Docker (remembered from your last `rebase dev --docker`)",
        env: { DATABASE_URL: "postgresql://rebase:rebase@127.0.0.1:5433/rebase" }
    })
}));

const { doctorCommand } = await import("./doctor");
const { execa } = await import("execa");

class Exit extends Error {
    constructor(readonly code: number | undefined) {
        super(`process.exit(${code})`);
    }
}

describe("what rebase doctor tells the driver about its database", () => {
    beforeEach(() => {
        state.root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-doctor-source-")));
        fs.mkdirSync(path.join(state.root, "backend"));
        fs.mkdirSync(path.join(state.root, "config", "collections"), { recursive: true });
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

    it("passes REBASE_DATABASE_SOURCE, so the banner names the remembered Docker database", async () => {
        // An environment finding may still end the run with exit 1; the
        // driver has been spawned by then.
        await doctorCommand(["node", "rebase", "doctor"]).catch((err: unknown) => {
            if (!(err instanceof Exit)) throw err;
        });

        const call: unknown[] | undefined = vi.mocked(execa).mock.calls.at(-1);
        expect(call, "the driver was never spawned").toBeDefined();
        const options: unknown = call?.[2];
        const env = typeof options === "object" && options !== null && "env" in options ? options.env : undefined;
        expect(env).toMatchObject({
            REBASE_DATABASE_SOURCE: "last-dev",
            DATABASE_URL: "postgresql://rebase:rebase@127.0.0.1:5433/rebase"
        });
    });
});
