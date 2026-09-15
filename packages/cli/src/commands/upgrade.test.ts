/**
 * `rebase upgrade`, end to end, with the registry and the installer stood in.
 *
 * The control plane runs this command when it rebuilds a project on a newer
 * release and reads its `--json`, so the document's shape is a contract, and
 * stdout must hold that document and nothing else — the installer's own output
 * included.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { upgradeCommand, type UpgradeIo } from "./upgrade";

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

beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-upgrade-cmd-")));
    cwd = process.cwd();
    argv = process.argv;
    stdout = [];
    stderr = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
        stdout.push(args.map(String).join(" "));
    });
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
        stderr.push(args.map(String).join(" "));
    });
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
        throw new Exited(code ?? 0);
    }) as never);
});

afterEach(() => {
    process.chdir(cwd);
    process.argv = argv;
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
});

function write(relative: string, content: string): void {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
}

function read(relative: string): string {
    return fs.readFileSync(path.join(root, relative), "utf8");
}

/** A small managed project, pinned to 0.19.1, with a pnpm lockfile. */
function project(): void {
    write(".git/HEAD", "ref: refs/heads/main\n");
    write("rebase.json", JSON.stringify({ rebase: "^1", apps: { backend: { type: "backend", runtime: "managed" } } }, null, 4));
    write("pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
    write("package.json", JSON.stringify({ devDependencies: { "@rebasepro/cli": "0.19.1" } }, null, 2) + "\n");
    write("backend/package.json", JSON.stringify({
        dependencies: { "@rebasepro/server": "^0.19.1", "@rebasepro/types": "workspace:*" }
    }, null, 2) + "\n");
    write("pnpm-workspace.yaml", "packages:\n  - backend\noverrides:\n  \"@rebasepro/client\": \"link:../client\"\n");
    process.chdir(root);
}

function io(overrides: Partial<UpgradeIo> = {}): UpgradeIo & { npmView: ReturnType<typeof vi.fn>; install: ReturnType<typeof vi.fn> } {
    return {
        npmView: vi.fn(async () => "0.21.0"),
        install: vi.fn(async () => undefined),
        ...overrides
    } as UpgradeIo & { npmView: ReturnType<typeof vi.fn>; install: ReturnType<typeof vi.fn> };
}

/** Run the command with `line` as the whole of `process.argv`, the way `cli.ts` does. */
async function run(line: string[], fake: UpgradeIo): Promise<number> {
    const full = ["node", "rebase", "upgrade", ...line];
    process.argv = full;
    try {
        await upgradeCommand(full, fake);
        return 0;
    } catch (err) {
        if (err instanceof Exited) return err.code;
        throw err;
    }
}

describe("rebase upgrade --json", () => {
    it("prints one document with every change, relative to the project root", async () => {
        project();
        const fake = io();

        expect(await run(["--to", "0.21.0", "--no-install", "--json"], fake)).toBe(0);

        const doc = JSON.parse(stdout.join("\n"));
        expect(Object.keys(doc)).toEqual(["target", "changed", "skipped", "overrides", "unreadable", "installed", "dryRun"]);
        expect(doc).toMatchObject({ target: "0.21.0", installed: false, dryRun: false });
        expect(doc.changed).toEqual([
            { file: "backend/package.json", name: "@rebasepro/server", field: "dependencies", from: "^0.19.1", to: "^0.21.0" },
            { file: "package.json", name: "@rebasepro/cli", field: "devDependencies", from: "0.19.1", to: "0.21.0" }
        ]);
        expect(doc.skipped).toEqual([{
            file: "backend/package.json",
            name: "@rebasepro/types",
            field: "dependencies",
            spec: "workspace:*",
            reason: expect.any(String)
        }]);
        expect(doc.overrides).toEqual([
            { file: "pnpm-workspace.yaml", name: "@rebasepro/client", spec: "link:../client", action: "kept-local" }
        ]);

        // Written, and not installed, and nobody asked the registry about an
        // exact version.
        expect(read("backend/package.json")).toContain("\"@rebasepro/server\": \"^0.21.0\"");
        expect(fake.install).not.toHaveBeenCalled();
        expect(fake.npmView).not.toHaveBeenCalled();
    });

    it("writes nothing on a dry run, and says so", async () => {
        project();
        const before = read("package.json");
        const fake = io();

        expect(await run(["--to", "0.21.0", "--dry-run", "--json", "--drop-local-overrides"], fake)).toBe(0);

        const doc = JSON.parse(stdout.join("\n"));
        expect(doc.dryRun).toBe(true);
        expect(doc.changed).toHaveLength(2);
        expect(doc.overrides[0].action).toBe("removed-local");
        expect(read("package.json")).toBe(before);
        expect(read("pnpm-workspace.yaml")).toContain("link:../client");
        expect(fake.install).not.toHaveBeenCalled();
    });

    it("installs with the lockfile's package manager, keeping stdout for the document", async () => {
        project();
        const fake = io();

        expect(await run(["--to", "0.21.0", "--json"], fake)).toBe(0);

        expect(fake.install).toHaveBeenCalledWith(["pnpm", ["install"]], root, true);
        expect(JSON.parse(stdout.join("\n")).installed).toBe(true);
    });

    it("resolves a tag through the registry, from the project", async () => {
        project();
        const fake = io({ npmView: vi.fn(async () => "0.21.1-canary.g8c5a265\n") });

        expect(await run(["--to", "canary", "--no-install", "--json"], fake)).toBe(0);

        expect(fake.npmView).toHaveBeenCalledWith("@rebasepro/cli@canary", root);
        expect(JSON.parse(stdout.join("\n")).target).toBe("0.21.1-canary.g8c5a265");
        expect(read("package.json")).toContain("0.21.1-canary.g8c5a265");
    });

    it("defaults to latest", async () => {
        project();
        const fake = io();
        await run(["--no-install", "--json"], fake);
        expect(fake.npmView).toHaveBeenCalledWith("@rebasepro/cli@latest", root);
    });

    it("refuses with the envelope when the tag does not resolve, and writes nothing", async () => {
        project();
        const before = read("package.json");
        const fake = io({ npmView: vi.fn(async () => { throw new Error("npm error 404 Not Found"); }) });

        expect(await run(["--to", "nosuchtag", "--json"], fake)).toBe(1);

        const doc = JSON.parse(stdout.join("\n"));
        expect(doc.error.code).toBe("target_unresolved");
        expect(read("package.json")).toBe(before);
    });

    it("keeps the edits and exits non-zero when the install fails", async () => {
        project();
        const fake = io({ install: vi.fn(async () => { throw new Error("ERR_PNPM_NO_MATCHING_VERSION"); }) });

        expect(await run(["--to", "0.21.0", "--json"], fake)).toBe(1);

        const doc = JSON.parse(stdout.join("\n"));
        expect(doc.error.code).toBe("install_failed");
        expect(doc.error.hint).toContain("edits were kept");
        expect(read("package.json")).toContain("0.21.0");
    });

    it("does not install when nothing changed", async () => {
        project();
        const fake = io();
        await run(["--to", "0.21.0", "--no-install", "--json"], fake);
        stdout = [];

        expect(await run(["--to", "0.21.0", "--json"], fake)).toBe(0);

        expect(JSON.parse(stdout.join("\n"))).toMatchObject({ changed: [], installed: false });
        expect(fake.install).not.toHaveBeenCalled();
    });
});

describe("rebase upgrade, for a person", () => {
    it("groups the changes by file and names the next step", async () => {
        project();
        const fake = io();

        expect(await run(["--to", "0.21.0"], fake)).toBe(0);

        // eslint-disable-next-line no-control-regex
        const text = stdout.join("\n").replace(/\x1b\[[0-9;]*m/g, "");
        expect(text).toContain("backend/package.json");
        expect(text).toMatch(/@rebasepro\/server\s+\^0\.19\.1 → \^0\.21\.0/);
        expect(text).toContain("local override — wins over every pin, the upgrade will not reach these packages");
        expect(text).toContain("--drop-local-overrides");
        expect(text).toContain("rebase build");
        expect(fake.install).toHaveBeenCalledWith(["pnpm", ["install"]], root, false);
    });

    it("says the project is already there when it is", async () => {
        project();
        await run(["--to", "0.21.0", "--no-install"], io());
        stdout = [];

        await run(["--to", "0.21.0", "--no-install"], io());

        expect(stdout.join("\n")).toContain("already on 0.21.0");
    });

    it("rejects an unknown flag before touching anything", async () => {
        project();
        const before = read("package.json");
        await expect(upgradeCommand(["node", "rebase", "upgrade", "--frobnicate"], io())).rejects.toThrow(/unknown or unexpected option/i);
        expect(read("package.json")).toBe(before);
    });

    it("answers --help without needing a project", async () => {
        process.chdir(root);
        const fake = io();
        await upgradeCommand(["node", "rebase", "upgrade", "--help"], fake);
        const text = stdout.join("\n");
        for (const flag of ["--to", "--drop-local-overrides", "--no-install", "--dry-run", "--json"]) {
            expect(text).toContain(flag);
        }
        expect(fake.npmView).not.toHaveBeenCalled();
    });
});
