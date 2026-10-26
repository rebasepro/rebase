/**
 * One answer to "where are this project's collections", for every command.
 *
 * `rebase.json` may move the backend's config package (`apps.<backend>.config`).
 * The runtime, `rebase build` and `rebase generate view` honoured it while
 * `verify`, `doctor`, `generate-sdk`, `console` and dev's regeneration read
 * `config/collections` regardless — so in a project with `"config": "shared"`
 * `rebase verify` passed over no collections at all.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { collectionsDirArgs, resolveCollectionsDir } from "./collections-dir";
import { doctorDriverArgs } from "../commands/doctor";
import { runVerify, verifyCommand } from "../commands/verify";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(HERE, "..", "..");

let root: string;

function manifest(backend: Record<string, unknown>): void {
    fs.writeFileSync(path.join(root, "rebase.json"), JSON.stringify({ rebase: "^1", apps: { backend: { type: "backend", runtime: "managed", ...backend } } }));
}

beforeEach(() => {
    root = fs.mkdtempSync(path.join(PACKAGE_ROOT, ".tmp-collections-dir-"));
});

afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
});

describe("resolveCollectionsDir", () => {
    it("follows the backend's config directory in rebase.json", () => {
        manifest({ config: "shared" });
        expect(resolveCollectionsDir(root)).toBe(path.join(root, "shared", "collections"));
    });

    it("is config/collections for a conventional project, and without a manifest", () => {
        manifest({});
        expect(resolveCollectionsDir(root)).toBe(path.join(root, "config", "collections"));
        fs.rmSync(path.join(root, "rebase.json"));
        expect(resolveCollectionsDir(root)).toBe(path.join(root, "config", "collections"));
    });
});

describe("collectionsDirArgs: the driver is told where they are", () => {
    it("names the declared directory to every driver command that reads collections", () => {
        manifest({ config: "shared" });
        const dir = path.join(root, "shared", "collections");
        for (const line of [["db", "push"], ["db", "generate"], ["schema", "generate"], ["schema", "stale", "--fix"], ["doctor"], ["console", "-e", "1"]]) {
            expect(collectionsDirArgs(root, line), line.join(" ")).toEqual(["--collections", dir]);
        }
    });

    it("adds nothing to a command that does not read them, or a line that names its own", () => {
        manifest({ config: "shared" });
        expect(collectionsDirArgs(root, ["db", "url"])).toEqual([]);
        expect(collectionsDirArgs(root, ["db", "migrate"])).toEqual([]);
        expect(collectionsDirArgs(root, ["db", "push", "--collections", "/x"])).toEqual([]);
        expect(collectionsDirArgs(root, ["schema", "generate", "-c=/x"])).toEqual([]);
    });

    it("leaves a conventional project's command lines exactly as they were", () => {
        manifest({});
        expect(collectionsDirArgs(root, ["db", "push"])).toEqual([]);
    });

    it("reaches doctor's driver line", () => {
        manifest({ config: "shared" });
        expect(doctorDriverArgs(["node", "rebase", "doctor"], root, root))
            .toEqual(["doctor", "--collections", path.join(root, "shared", "collections")]);
    });
});

describe("rebase verify in a project that moved its config", () => {
    it("checks the declared collections by default instead of passing over none", async () => {
        manifest({ config: "shared" });
        fs.mkdirSync(path.join(root, "shared", "collections"), { recursive: true });
        fs.writeFileSync(path.join(root, "shared", "collections", "notes.ts"), `export default {
    slug: "notes", table: "notes", name: "Notes",
    properties: { title: { type: "string", name: "Title", widget: "markdown" } }
};
`);
        const stdout: string[] = [];
        vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => { stdout.push(args.map(String).join(" ")); });
        const cwd = process.cwd();
        process.chdir(root);
        try {
            await verifyCommand(["node", "rebase", "verify", "--json"]);
        } finally {
            process.chdir(cwd);
            process.exitCode = undefined;
        }
        const report = JSON.parse(stdout.join("\n")) as Awaited<ReturnType<typeof runVerify>>;
        expect(report.collectionsDir).toBe(path.join("shared", "collections"));
        expect(report.findings.map(f => f.check)).toContain("config-key");
        expect(report.ok).toBe(false);
    });
});
