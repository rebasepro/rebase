/**
 * A script the driver still runs as a child gets one Node, under tsx's loader.
 *
 * The generators, the introspector and the doctor ran through the `tsx` binary:
 * pnpm's `.bin/tsx` shell shim, then tsx's CLI in one Node, which spawns a
 * second Node with tsx's loader to run the script — a shell and a Node start
 * (~50–100 ms) per child. `resolveChildScript` now hands back
 * `node --import <tsx's loader> <script>`, the same loader in one process.
 *
 * `schema generate --watch` is the child that is still started on every
 * invocation (a one-shot generation runs in the driver's own process), so it is
 * the one recorded here: the driver runs under tsx with a preload that logs
 * every process it spawns, and is stopped as soon as the generator appears.
 */
import { spawn } from "child_process";
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

beforeEach(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-child-interp-"));
    spawnLog = path.join(work, "spawns.log");
    fs.writeFileSync(path.join(work, "record-spawns.cjs"), RECORD_SPAWNS);
    fs.writeFileSync(spawnLog, "");
});

afterEach(() => {
    fs.rmSync(work, { recursive: true, force: true });
});

/** The command lines that ran the Drizzle schema generator script. */
function generatorSpawns(): string[][] {
    return fs.readFileSync(spawnLog, "utf8").split("\n").filter(Boolean)
        .map(line => JSON.parse(line) as string[])
        .filter(argv => argv.some(arg => /schema[\\/](?:bin[\\/])?generate-drizzle-schema\.[jt]s$/.test(arg)));
}

it("starts the watching generator as one Node with tsx's loader, not through the tsx binary", async () => {
    const driver = spawn(tsxBin(), [
        path.join(packageRoot, "src", "cli.ts"),
        "schema", "generate", "--watch",
        `--collections=${path.join(fixtures, "broken-resources", "collections")}`,
        `--output=${path.join(work, "schema.generated.ts")}`
    ], {
        cwd: work,
        detached: true,
        stdio: "ignore",
        env: {
            ...process.env,
            DOTENV_CONFIG_QUIET: "true",
            TSX_TSCONFIG_PATH: path.join(repoRoot, "tsconfig.typecheck.json"),
            NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require ${path.join(work, "record-spawns.cjs")}`.trim(),
            SPAWN_LOG: spawnLog
        }
    });
    try {
        const deadline = Date.now() + 45_000;
        while (generatorSpawns().length === 0 && Date.now() < deadline && driver.exitCode === null) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    } finally {
        // The driver and its watching child share the group `detached` gave it.
        try {
            process.kill(-(driver.pid ?? 0), "SIGKILL");
        } catch {
            // Already gone.
        }
    }

    const spawns = generatorSpawns();
    expect(spawns).toHaveLength(1);
    const [command, ...args] = spawns[0];
    expect(path.basename(command)).toMatch(/^node(\.exe)?$/);
    expect(args[0]).toBe("--import");
    expect(args[1]).toMatch(/^file:\/\/.*\/tsx\/dist\/loader\.mjs$/);
    expect(args[2]).toMatch(/generate-drizzle-schema\.[jt]s$/);
    expect(args).toContain("--watch");
}, 60_000);
