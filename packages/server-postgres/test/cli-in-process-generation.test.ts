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
