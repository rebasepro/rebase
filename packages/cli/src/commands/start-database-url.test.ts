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

const state = vi.hoisted(() => ({ root: "", booted: 0 }));

vi.mock("../utils/project", async importOriginal => ({
    ...(await importOriginal<typeof import("../utils/project")>()),
    requireProjectRoot: () => state.root,
    findProjectRoot: () => state.root
}));

vi.mock("@rebasepro/server", () => ({
    runFromBundle: async () => {
        state.booted++;
    }
}));

const { missingDatabaseUrl, startCommand } = await import("./start");

class Exit extends Error {
    constructor(readonly code: number | undefined) {
        super(`process.exit(${code})`);
    }
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

describe("rebase start without a DATABASE_URL", () => {
    let printed: string[];
    const saved = { DATABASE_URL: process.env.DATABASE_URL, REBASE_BUNDLE: process.env.REBASE_BUNDLE, NODE_ENV: process.env.NODE_ENV };

    beforeEach(() => {
        state.root = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-start-db-"));
        state.booted = 0;
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
        await expect(startCommand(["node", "rebase", "start"])).rejects.toEqual(new Exit(1));

        const output = printed.join("\n");
        expect(output).toContain("DATABASE_URL is not set");
        expect(output).toContain('DATABASE_URL="$(rebase db url)" rebase start');
        expect(output).toContain("managed development database");
        expect(state.booted).toBe(0);
    });

    it("boots when .env names one", async () => {
        fs.appendFileSync(path.join(state.root, ".env"), "DATABASE_URL=postgresql://u:p@127.0.0.1:5432/app\n");

        await startCommand(["node", "rebase", "start"]);

        expect(state.booted).toBe(1);
        expect(printed.join("\n")).not.toContain("DATABASE_URL is not set");
    });
});

describe("missingDatabaseUrl", () => {
    it("is nothing when DATABASE_URL is set", () => {
        expect(missingDatabaseUrl({ DATABASE_URL: "postgresql://x" }, "managed")).toBeNull();
    });

    it("treats a blank value as unset, as the runtime does", () => {
        expect(missingDatabaseUrl({ DATABASE_URL: "  " }, "managed")).not.toBeNull();
    });

    it("names the Docker database when that is what `rebase dev` runs on", () => {
        const text = (missingDatabaseUrl({}, "docker") ?? []).join("\n");
        expect(text).toContain("Docker");
        expect(text).toContain("rebase db url");
    });
});
