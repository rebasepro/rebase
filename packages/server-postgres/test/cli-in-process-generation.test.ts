/**
 * One-shot schema generation runs in the driver's own process.
 *
 * Every generation used to be three Node processes: the `rebase` CLI, the
 * driver (under tsx), and a tsx child per generator — `schema generate` one,
 * `db push` and `db generate` two. Each child paid a Node start, tsx's loader
 * and an import of the whole server package before reading a collection:
 * about 0.5 s apiece. The driver is one-shot, so nothing in it can go stale.
 *
 * These run the real driver CLI under tsx, with a preload that records every
 * process it spawns, and assert the generator scripts are not among them — and
 * that what is written, and what is printed on failure, is what the child
 * wrote and printed. `--watch` keeps its child (it must re-import on every
 * save); that path is not exercised here.
 */
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const fixtures = path.join(packageRoot, "test", "fixtures");

/** The workspace's tsx, found the way `resolveLocalBin` finds it. */
function tsxBin(): string {
    let dir = packageRoot;
    for (;;) {
        const candidate = path.join(dir, "node_modules", ".bin", "tsx");
        if (fs.existsSync(candidate)) return candidate;
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    throw new Error("tsx not found");
}

/** A CommonJS preload that appends every spawned command line to `$SPAWN_LOG`. */
const RECORD_SPAWNS = `
const childProcess = require("child_process");
const fs = require("fs");
const { syncBuiltinESMExports } = require("module");
for (const name of ["spawn", "spawnSync", "execFile", "execFileSync", "fork"]) {
    const original = childProcess[name];
    childProcess[name] = function (command, args, ...rest) {
        const argv = Array.isArray(args) ? args : [];
        fs.appendFileSync(process.env.SPAWN_LOG, JSON.stringify([String(command), ...argv.map(String)]) + "\\n");
        return original.call(this, command, args, ...rest);
    };
}
syncBuiltinESMExports();
`;

let work: string;
let spawnLog: string;
let preload: string;

beforeEach(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-inproc-gen-"));
    spawnLog = path.join(work, "spawns.log");
    preload = path.join(work, "record-spawns.cjs");
    fs.writeFileSync(preload, RECORD_SPAWNS);
    fs.writeFileSync(spawnLog, "");
});

afterEach(() => {
    fs.rmSync(work, { recursive: true, force: true });
});

function runDriver(args: string[]) {
    return spawnSync(tsxBin(), [path.join(packageRoot, "src", "cli.ts"), ...args], {
        cwd: work,
        encoding: "utf8",
        env: {
            ...process.env,
            DOTENV_CONFIG_QUIET: "true",
            // Workspace packages from source: a worktree has no `dist`.
            TSX_TSCONFIG_PATH: path.join(repoRoot, "tsconfig.typecheck.json"),
            NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require ${preload}`.trim(),
            SPAWN_LOG: spawnLog
        }
    });
}

/** The command lines the driver spawned that ran one of the generator scripts. */
function generatorSpawns(): string[][] {
    return fs.readFileSync(spawnLog, "utf8").split("\n").filter(Boolean)
        .map(line => JSON.parse(line) as string[])
        .filter(argv => argv.some(arg => /schema[\\/](?:bin[\\/])?generate-(?:drizzle-schema|postgres-ddl)\.[jt]s$/.test(arg)));
}

describe("schema generate", () => {
    it("writes the schema without starting a generator process", () => {
        const output = path.join(work, "schema.generated.ts");
        const result = runDriver([
            "schema", "generate",
            `--collections=${path.join(fixtures, "broken-resources", "collections")}`,
            `--output=${output}`
        ]);

        expect(result.status).toBe(0);
        expect(result.stdout).toContain(`Drizzle schema generated successfully at ${output}`);
        expect(fs.readFileSync(output, "utf8")).toContain("export const tags");
        // The preload ran: tsx's own relaunch of node is in the log.
        expect(fs.readFileSync(spawnLog, "utf8")).not.toBe("");
        expect(generatorSpawns()).toEqual([]);
    }, 60_000);

    it("fails as the child did: its error, the verdict, exit 1, nothing written", () => {
        const output = path.join(work, "schema.generated.ts");
        const result = runDriver([
            "schema", "generate",
            `--collections=${path.join(fixtures, "broken-collection", "collections")}`,
            `--output=${output}`
        ]);

        expect(result.status).toBe(1);
        expect(result.stderr).toContain("Error generating schema");
        expect(result.stderr).toContain("did not evaluate");
        expect(result.stderr).toContain("Drizzle schema generation failed — nothing was applied.");
        expect(fs.existsSync(output)).toBe(false);
        expect(generatorSpawns()).toEqual([]);
    }, 60_000);
});

describe("what the generator prints", () => {
    const collections = () => `--collections=${path.join(fixtures, "broken-resources", "collections")}`;

    it("ends `schema generate` on the next step, as plain text when stdout is not a terminal", () => {
        const output = path.join(work, "schema.generated.ts");
        const result = runDriver(["schema", "generate", collections(), `--output=${output}`]);

        expect(result.status).toBe(0);
        expect(result.stdout).toContain("You can now run rebase db generate");
        // The escapes were written by hand, so a log file got `[1m[44m…`.
        expect(result.stdout).not.toContain("\x1b[");
    }, 60_000);

    it("does not tell `db push` to run `db generate`, nor `db push --dry-run` to write the project", () => {
        // A project upgraded from a release that committed the generated SQL
        // into `drizzle/`, with a schema file that is out of date.
        const schemaFile = path.join(work, "src", "schema.generated.ts");
        fs.mkdirSync(path.dirname(schemaFile), { recursive: true });
        fs.writeFileSync(schemaFile, "// hand-checked, out of date\n");
        const legacy = path.join(work, "drizzle", "schema.sql");
        fs.mkdirSync(path.dirname(legacy), { recursive: true });
        fs.writeFileSync(legacy, "-- This file is auto-generated by the Rebase DDL generator.\n");

        // The fixture's collection without its throwing resources module.
        const collectionsDir = path.join(work, "config", "collections");
        fs.mkdirSync(collectionsDir, { recursive: true });
        fs.copyFileSync(path.join(fixtures, "broken-resources", "collections", "tags.ts"), path.join(collectionsDir, "tags.ts"));

        // No database: the run stops at Atlas. Everything asserted happens before.
        const result = runDriver(["db", "push", "--dry-run", `--collections=${collectionsDir}`]);

        expect(result.stdout).toContain("PostgreSQL DDL generated successfully");

        expect(result.stdout).not.toContain("You can now run");
        expect(fs.readFileSync(schemaFile, "utf8")).toBe("// hand-checked, out of date\n");
        expect(fs.existsSync(legacy)).toBe(true);
        // The plan's input is still written, to the scratch directory.
        expect(fs.existsSync(path.join(work, ".rebase", "sql", "schema.sql"))).toBe(true);
    }, 60_000);

    it("does not tell `db generate` to run itself", () => {
        const collectionsDir = path.join(work, "config", "collections");
        fs.mkdirSync(collectionsDir, { recursive: true });
        fs.copyFileSync(path.join(fixtures, "broken-resources", "collections", "tags.ts"), path.join(collectionsDir, "tags.ts"));

        // No database: the run stops at Atlas, after step 1.
        const result = runDriver(["db", "generate", `--collections=${collectionsDir}`]);

        expect(result.stdout).toContain("Drizzle schema generated successfully");
        expect(result.stdout).not.toContain("You can now run rebase db generate");
    }, 60_000);

    it("prints a broken collection's message without a stack, unless --debug", () => {
        const args = [
            "schema", "generate",
            `--collections=${path.join(fixtures, "broken-collection", "collections")}`,
            `--output=${path.join(work, "out.ts")}`
        ];
        const plain = runDriver(args);
        expect(plain.status).toBe(1);
        expect(plain.stderr).toContain("did not evaluate");
        expect(plain.stderr).not.toMatch(/\n\s+at .+:\d+:\d+/);
        expect(plain.stderr).toContain("Re-run with --debug for the stack trace.");

        process.env.REBASE_DEBUG = "1";
        try {
            const debug = runDriver(args);
            expect(debug.stderr).toMatch(/\n\s+at .+:\d+:\d+/);
        } finally {
            delete process.env.REBASE_DEBUG;
        }
    }, 60_000);
});
