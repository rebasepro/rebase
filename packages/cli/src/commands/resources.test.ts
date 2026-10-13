/**
 * `rebase resources --check` is a CI gate, so it has to fail on drift in every
 * output mode.
 *
 * With `--json` it did not: the JSON branch printed the graph and returned
 * before `--check` and `--write` were looked at, so `--check --json` exited 0
 * on a missing or stale `rebase.resources.json` and `--write --json` wrote
 * nothing. A gate written with `--json` — the form a CI step reaches for —
 * always passed.
 *
 * Fixtures live under the package root for the reason `resources/derive.test.ts`
 * gives: `@rebasepro/types` has to resolve from them.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { serializeResourceGraph } from "../resources/derive";
import { resourcesCommand } from "./resources";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(HERE, "..", "..");

class Exited extends Error {
    constructor(readonly code: number) {
        super(`process.exit(${code})`);
    }
}

let root: string;
let cwd: string;
let argv: string[];
let stdout: string[];
let stderr: string[];
let declared = 0;

beforeEach(() => {
    root = fs.mkdtempSync(path.join(PACKAGE_ROOT, ".tmp-resources-cmd-"));
    fs.mkdirSync(path.join(root, "config"), { recursive: true });
    fs.mkdirSync(path.join(root, "backend"), { recursive: true });
    fs.writeFileSync(path.join(root, "rebase.json"), JSON.stringify({
        rebase: "^1",
        apps: { backend: { type: "backend", runtime: "managed" } }
    }));
    cwd = process.cwd();
    argv = process.argv;
    process.chdir(root);
    stdout = [];
    stderr = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => { stdout.push(args.map(String).join(" ")); });
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { stderr.push(args.map(String).join(" ")); });
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

/**
 * Declare a bucket, and return the graph file that records it.
 *
 * A fresh key each time, and one derive per declaration: `config/resources.ts`
 * is loaded with `import()`, so a second derive in the same process reads the
 * cached module and declares nothing. The CLI derives once per process; the
 * file that matches is therefore written here rather than by a second run.
 */
function declareBucket(): string {
    declared++;
    const key = `media_${process.pid}_${declared}`;
    fs.writeFileSync(path.join(root, "config", "resources.ts"), `
        import { bucket } from "@rebasepro/types";
        export const media = bucket("${key}");
    `);
    return serializeResourceGraph({
        version: 1,
        resources: [{ kind: "bucket", key, engine: "local", transport: "server", options: {} }]
    });
}

const graphFile = () => path.join(root, "rebase.resources.json");

/** Run the command and return its exit code, however it exited. */
async function run(...flags: string[]): Promise<number> {
    const line = ["node", "rebase", "resources", ...flags];
    process.argv = line;
    process.exitCode = 0;
    try {
        await resourcesCommand(line);
    } catch (err) {
        if (!(err instanceof Exited)) throw err;
        return err.code;
    }
    return typeof process.exitCode === "number" ? process.exitCode : 0;
}

const json = (): Record<string, any> => JSON.parse(stdout.join("\n"));

describe("rebase resources --check", () => {
    it.each([[[]], [["--json"]]])("fails when the graph file is missing (%j)", async (extra) => {
        declareBucket();

        expect(await run("--check", ...extra)).toBe(1);

        if (extra.includes("--json")) {
            expect(json().error.code).toBe("resource_graph_missing");
            expect(json().error.hint).toContain("rebase resources --write");
        } else {
            expect(stderr.join("\n")).toContain("is missing");
        }
    });

    it.each([[[]], [["--json"]]])("fails when the graph file is stale (%j)", async (extra) => {
        declareBucket();
        fs.writeFileSync(graphFile(), "{\"bogus\":1}\n");

        expect(await run("--check", ...extra)).toBe(1);

        if (extra.includes("--json")) {
            expect(json().error.code).toBe("resource_graph_stale");
        } else {
            expect(stderr.join("\n")).toContain("is stale");
        }
        // A check never writes.
        expect(fs.readFileSync(graphFile(), "utf8")).toBe("{\"bogus\":1}\n");
    });

    it("passes, as JSON, once the file matches", async () => {
        fs.writeFileSync(graphFile(), declareBucket());

        expect(await run("--check", "--json")).toBe(0);

        const parsed = json();
        expect(parsed.check).toEqual({ file: "rebase.resources.json", status: "current" });
        expect(parsed.resources.some((r: { kind: string }) => r.kind === "bucket")).toBe(true);
    });

    it("passes, as JSON, when nothing is declared and there is no file", async () => {
        expect(await run("--check", "--json")).toBe(0);
        expect(json().check).toEqual({ file: "rebase.resources.json", status: "nothing-declared" });
    });
});

describe("rebase resources --write --json", () => {
    it("writes the file and says so", async () => {
        const expected = declareBucket();

        expect(await run("--write", "--json")).toBe(0);

        expect(fs.readFileSync(graphFile(), "utf8")).toBe(expected);
        expect(json().written).toEqual({ file: "rebase.resources.json", changed: true });
        expect(json().resources.some((r: { kind: string }) => r.kind === "bucket")).toBe(true);
    });

    it("says when the file already matched", async () => {
        fs.writeFileSync(graphFile(), declareBucket());

        expect(await run("--write", "--json")).toBe(0);

        expect(json().written).toEqual({ file: "rebase.resources.json", changed: false });
    });
});
