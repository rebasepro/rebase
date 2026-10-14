/**
 * A `rebase db …` line the driver refuses is refused before a database is
 * started for it.
 *
 * The driver checks its flags, but it is spawned only once the CLI has a
 * database to hand it, and getting one means starting one. So with the
 * remembered compose container stopped, or the managed database not running:
 *
 *     $ rebase db push --dry-rn
 *       Database not running — starting it…
 *       ✓ Database ready on port 5461
 *     ✗ `rebase db push` has no option --dry-rn — did you mean --dry-run?
 *
 * The refusal was right and came after the work it said had not been done.
 * The CLI now runs the driver's own check (`assertDbCommandLine` from
 * `@rebasepro/server-postgres`, the real one here, not a stand-in) first. The
 * steps that start a database are stood in for and counted.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ root: "", ensured: 0, prepared: 0 }));

vi.mock("../utils/project", async importOriginal => ({
    ...await importOriginal<typeof import("../utils/project")>(),
    requireProjectRoot: () => state.root,
    // Installed, as far as the CLI can tell: nothing spawns it.
    resolvePluginCliScript: () => path.join(state.root, "backend", "node_modules", "driver", "dist", "cli.js")
}));

// What starts the remembered compose container.
vi.mock("../utils/dev-preflight", async importOriginal => ({
    ...await importOriginal<typeof import("../utils/dev-preflight")>(),
    ensureDevDatabase: async () => {
        state.ensured++;
        return { action: "started", host: "127.0.0.1", port: 1 };
    }
}));

// What boots the managed one. It stops the command there: a line that gets
// this far was accepted, which is all a passing case needs to show.
vi.mock("../dev-db/prepare", async importOriginal => ({
    ...await importOriginal<typeof import("../dev-db/prepare")>(),
    prepareDatabaseEnv: async () => {
        state.prepared++;
        throw new Error("prepared");
    }
}));

const { dbCommand } = await import("./db");
const { UsageError } = await import("../utils/args");

class Exit extends Error {
    constructor(readonly code: number | undefined) {
        super(`process.exit(${code})`);
    }
}

const argv = (...words: string[]) => ["node", "rebase", "db", ...words];

let printed: string[];

/** A scaffold on server-postgres; `remembered` is what the last `rebase dev` chose. */
function project(remembered: "docker" | "managed"): void {
    fs.writeFileSync(path.join(state.root, "rebase.json"), "{}\n");
    fs.mkdirSync(path.join(state.root, "backend"));
    fs.writeFileSync(path.join(state.root, "backend", "package.json"), JSON.stringify({
        name: "backend",
        dependencies: { "@rebasepro/server": "0.25.0", "@rebasepro/server-postgres": "0.25.0" }
    }));
    fs.mkdirSync(path.join(state.root, "config", "collections"), { recursive: true });
    if (remembered === "docker") {
        fs.writeFileSync(path.join(state.root, "docker-compose.yml"), [
            "services:",
            "  db:",
            "    image: postgres:16-alpine",
            "    environment:",
            "      POSTGRES_USER: rebase_app",
            "      POSTGRES_PASSWORD: changeme",
            "      POSTGRES_DB: rebase",
            "    ports:",
            "      - \"5461:5432\"",
            ""
        ].join("\n"));
        fs.mkdirSync(path.join(state.root, ".rebase"));
        fs.writeFileSync(path.join(state.root, ".rebase", "dev-database.json"), JSON.stringify({ kind: "docker" }));
    }
}

beforeEach(() => {
    state.root = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-db-driver-flags-"));
    state.ensured = 0;
    state.prepared = 0;
    printed = [];
    const capture = (...parts: unknown[]) => { printed.push(parts.map(String).join(" ")); };
    vi.spyOn(console, "log").mockImplementation(capture);
    vi.spyOn(console, "error").mockImplementation(capture);
    vi.spyOn(process, "exit").mockImplementation((code?: string | number | null) => {
        throw new Exit(typeof code === "number" ? code : undefined);
    });
});

afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(state.root, { recursive: true, force: true });
});

describe.each(["docker", "managed"] as const)("with the %s database not running", (remembered) => {
    beforeEach(() => project(remembered));

    it.each([
        [["push", "--dry-rn"], "`rebase db push` has no option --dry-rn — did you mean --dry-run? Nothing was run."],
        [["migrate", "--baselin", "1"], "`rebase db migrate` has no option --baselin — did you mean --baseline?"],
        [["branch", "create", "x", "--froce"], "`rebase db branch create` has no option --froce — did you mean --force?"],
        [["restore", "x.dump", "--targt-db", "y", "--yes"], "`rebase db restore` has no option --targt-db — did you mean --target-db?"],
        [["backup", "--exclude-schema", "rebase"], "--exclude-schema rebase leaves out the rebase schema"],
        [["backups", "list", "--ot", "x"], "`rebase db backups list` has no option --ot — did you mean --out?"]
    ])("refuses db %j and starts nothing", async (words, message) => {
        const refused = await dbCommand(words[0], argv(...words)).catch((error: unknown) => error);

        expect(refused).toBeInstanceOf(UsageError);
        expect((refused as Error).message).toContain(message);
        expect(state.ensured).toBe(0);
        expect(state.prepared).toBe(0);
    });

    it("refuses a flag after a global one, judged on the line the driver would get", async () => {
        const refused = await dbCommand("push", ["node", "rebase", "--debug", "db", "push", "--dry-rn"])
            .catch((error: unknown) => error);

        expect((refused as Error).message).toContain("has no option --dry-rn");
        expect(state.ensured + state.prepared).toBe(0);
    });

    it("refuses branch switch's own typo before starting anything", async () => {
        const refused = await dbCommand("branch", argv("branch", "switch", "--of")).catch((error: unknown) => error);

        expect((refused as Error).message).toContain("`rebase db branch switch` has no option --of — did you mean --off?");
        expect(state.ensured + state.prepared).toBe(0);
    });

    it("refuses a --collections path that is not there before starting anything", async () => {
        await expect(dbCommand("push", argv("push", "--collections", "./nope"))).rejects.toThrow(Exit);

        expect(printed.join("\n")).toContain("nope");
        expect(state.ensured + state.prepared).toBe(0);
    });

    it("lets a correct line through to the database", async () => {
        await expect(dbCommand("push", argv("push", "--dry-run"))).rejects.toThrow(Exit);

        expect(state.prepared).toBe(1);
        expect(state.ensured).toBe(remembered === "docker" ? 1 : 0);
    });
});

it("leaves a driver other than server-postgres to judge its own line", async () => {
    project("managed");
    fs.writeFileSync(path.join(state.root, "backend", "package.json"), JSON.stringify({
        name: "backend",
        dependencies: { "@rebasepro/server": "0.25.0", "@rebasepro/server-mongo": "0.25.0" }
    }));

    await expect(dbCommand("push", argv("push", "--dry-rn"))).rejects.toThrow(Exit);
    expect(state.prepared).toBe(1);
    expect(printed.join("\n")).not.toContain("has no option");
});
