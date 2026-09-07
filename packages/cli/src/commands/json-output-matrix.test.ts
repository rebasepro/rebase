/**
 * `--json` is a promise about stdout, and it has to hold on every exit.
 *
 * It held on exactly one: the failure `requireProjectRoot` owns. `rebase status
 * --json` outside a project printed `{"error":{…,"code":"no_project_root"}}` on
 * stdout — and the same command, in a project whose `config/resources.ts`
 * throws, printed `✗ 2 problem(s) in the declared resources` to **stderr** and
 * left stdout empty. A caller that pipes stdout to a parser therefore got a
 * parseable refusal for the case it was never in and an empty parse for the one
 * it actually has to handle.
 *
 * So this is a matrix rather than a case: every `--json`-bearing command, across
 * every way it can fail, with `JSON.parse(stdout)` as the assertion. A new
 * `process.exit(1)` on one of these paths that forgets the envelope fails here.
 *
 * Fixtures live under the package root for the reason `resources/derive.test.ts`
 * gives: a project under `os.tmpdir()` has no `node_modules` above it, so
 * `@rebasepro/types` would not resolve and the failure would be about the
 * fixture rather than the command.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appsCommand } from "./apps";
import { resourcesCommand } from "./resources";
import { statusCommand } from "./status";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(HERE, "..", "..");

/** Thrown in place of `process.exit`, so the command stops where it would have. */
class Exited extends Error {
    constructor(readonly code: number) {
        super(`process.exit(${code})`);
    }
}

let root: string;
let cwd: string;
let argv: string[];
let stdout: string[];

beforeEach(() => {
    root = fs.mkdtempSync(path.join(PACKAGE_ROOT, ".tmp-json-matrix-"));
    cwd = process.cwd();
    argv = process.argv;
    stdout = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
        stdout.push(args.map(String).join(" "));
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
        throw new Exited(code ?? 0);
    }) as never);
});

afterEach(() => {
    process.chdir(cwd);
    process.argv = argv;
    vi.restoreAllMocks();
    process.exitCode = 0;
    fs.rmSync(root, { recursive: true, force: true });
});

/** A project directory with a manifest and, optionally, a config/ that throws. */
function project(name: string, options: {
    manifest?: unknown;
    resources?: string;
} = {}): string {
    const dir = path.join(root, name);
    fs.mkdirSync(path.join(dir, "config"), { recursive: true });
    fs.mkdirSync(path.join(dir, "backend"), { recursive: true });
    if (options.manifest !== undefined) {
        fs.writeFileSync(path.join(dir, "rebase.json"), JSON.stringify(options.manifest, null, 2));
    }
    if (options.resources !== undefined) {
        fs.writeFileSync(path.join(dir, "config", "resources.ts"), options.resources);
    }
    return dir;
}

const HEALTHY_MANIFEST = {
    rebase: "^1",
    apps: { backend: { type: "backend", runtime: "managed" } }
};

/**
 * Run a command that is expected to refuse, and return the one JSON object it
 * was supposed to put on stdout.
 *
 * `process.argv` is set to the line under test because that is where the CLI
 * reads `--json` from on the paths that fail before parsing — `requireProjectRoot`
 * is called by helpers that have no parsed flags to consult. Leaving vitest's
 * own argv in place would mean the suite exercised the human branch while
 * claiming to test the JSON one.
 */
async function refusal(command: Command): Promise<Record<string, any>> {
    process.argv = command.argv;

    let exited = false;
    try {
        await command.run();
    } catch (err) {
        if (!(err instanceof Exited)) throw err;
        exited = true;
        expect(err.code, "a refusal exits non-zero").not.toBe(0);
    }
    if (!exited) {
        // A command may set `process.exitCode` and return instead of exiting.
        expect(process.exitCode, "a refusal exits non-zero").not.toBe(0);
    }

    const text = stdout.join("\n");
    expect(text, "--json left stdout empty on a failure").not.toBe("");
    return JSON.parse(text);
}

interface Command {
    argv: string[];
    run: () => Promise<void>;
}

/** Every command that takes `--json`, run against a project directory. */
const COMMANDS: Array<[name: string, command: Command]> = [
    ["status", {
        argv: ["node", "rebase", "status", "--json"],
        run: () => statusCommand(["node", "rebase", "status", "--json"])
    }],
    ["resources", {
        argv: ["node", "rebase", "resources", "--json"],
        run: () => resourcesCommand(["node", "rebase", "resources", "--json"])
    }],
    ["apps list", {
        argv: ["node", "rebase", "apps", "list", "--json"],
        run: () => appsCommand("list", ["node", "rebase", "apps", "list", "--json"])
    }]
];

describe("--json on a failing command", () => {
    it.each(COMMANDS)("%s answers with an envelope outside a project", async (_name, command) => {
        // The one case that already worked, kept so the fix cannot regress it
        // while the others are added.
        process.chdir(fs.mkdtempSync(path.join(root, "not-a-project-")));

        const parsed = await refusal(command);
        expect(parsed.error.code).toBe("no_project_root");
        expect(parsed.error.message).toBeTruthy();
    });

    it.each(COMMANDS)("%s answers with an envelope for an invalid manifest", async (_name, command) => {
        process.chdir(project("broken-manifest", {
            // No `rebase` range and an app with no type: two issues, so the
            // envelope has to carry more than one.
            manifest: { apps: { backend: {} } }
        }));

        const parsed = await refusal(command);
        expect(parsed.error.code).toBe("manifest_invalid");
        expect(Array.isArray(parsed.error.issues)).toBe(true);
        expect(parsed.error.issues.length).toBeGreaterThan(0);
    });

    it.each(COMMANDS.filter(([name]) => name !== "apps list"))(
        "%s answers with an envelope for a manifest with no backend",
        async (_name, command) => {
            process.chdir(project("no-backend", {
                manifest: { rebase: "^1", apps: { web: { type: "static", root: "web", output: "dist" } } }
            }));

            const parsed = await refusal(command);
            expect(parsed.error.code).toBe("no_backend_app");
        }
    );

    it.each(COMMANDS.filter(([name]) => name !== "apps list"))(
        "%s answers with an envelope when the declarations do not load",
        async (_name, command) => {
            // The sweep's repro: a config file that throws. This is the failure
            // that was human-only, and the one a CI step is most likely to hit.
            process.chdir(project("bad-declarations", {
                manifest: HEALTHY_MANIFEST,
                resources: "throw new Error(\"resources.ts blew up\");\n"
            }));

            const parsed = await refusal(command);
            expect(parsed.error.code).toBe("resource_declaration_invalid");
            expect(parsed.error.issues.length).toBeGreaterThan(0);
            expect(parsed.error.issues[0].message).toContain("resources.ts blew up");
        }
    );
});

describe("the refusal envelope", () => {
    it("is the shape the cloud family uses", async () => {
        process.chdir(fs.mkdtempSync(path.join(root, "not-a-project-")));

        const parsed = await refusal(COMMANDS[0][1]);

        // One key at the top; `code` is what a caller branches on and is never
        // absent. Same contract as `cloud/context.ts`'s `fail()`.
        expect(Object.keys(parsed)).toEqual(["error"]);
        expect(typeof parsed.error.code).toBe("string");
        expect(typeof parsed.error.message).toBe("string");
    });

    it("is not printed when --json was not asked for", async () => {
        process.chdir(project("bad-declarations-human", {
            manifest: HEALTHY_MANIFEST,
            resources: "throw new Error(\"resources.ts blew up\");\n"
        }));

        try {
            await statusCommand(["node", "rebase", "status"]);
        } catch (err) {
            if (!(err instanceof Exited)) throw err;
        }

        expect(stdout.join("\n")).not.toContain("\"code\"");
    });
});
