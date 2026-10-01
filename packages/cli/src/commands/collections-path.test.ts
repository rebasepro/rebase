/**
 * One rule for a `--collections` path: relative to where you run the command.
 *
 * It was three. `rebase schema generate`, `db push`/`generate` and `doctor`
 * handed the path to the driver unchanged, and the driver runs in `backend/`,
 * so from the project root `--collections ./config/collections` was "not
 * found … Pass an absolute path, or one relative to where you run the command"
 * — which is what it had been. `doctor` said "No collections found". The same
 * spelling worked for `generate-sdk`, which resolves against the cwd, while the
 * `../config/collections` the scaffold's root scripts used only worked because
 * the driver was secretly standing one directory down. The help said the
 * default was `../config/collections`, the docs `config/collections/`.
 *
 * Now every command resolves a relative path from the directory it is run in
 * before the driver is handed another one, refuses a path that is not there in
 * those same terms, and every help page states the rule in the same words.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { absolutizeLocalPathArgs } from "./db";
import { schemaDriverArgs, schemaCommand } from "./schema";
import { doctorDriverArgs, doctorCommand } from "./doctor";
import { dbCommand } from "./db";
import { COLLECTIONS_PATH_RULE, missingCollectionsPath } from "../utils/path-flags";

const ROOT = path.resolve("/projects/my-app");

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;

describe("a relative --collections reaches the driver resolved from the cwd", () => {
    it.each([
        ["--collections", "./config/collections"],
        ["-c", "config/collections"]
    ])("db push %s %s", (flag, value) => {
        expect(absolutizeLocalPathArgs(["db", "push", flag, value], ROOT))
            .toEqual(["db", "push", flag, path.join(ROOT, "config/collections")]);
    });

    it("db generate --collections=<value>", () => {
        expect(absolutizeLocalPathArgs(["db", "generate", "--collections=config/collections"], ROOT))
            .toEqual(["db", "generate", `--collections=${path.join(ROOT, "config/collections")}`]);
    });

    it("schema generate resolves --collections and --output, wherever the flags sit", () => {
        const args = schemaDriverArgs(
            ["node", "rebase", "--debug", "schema", "generate", "-c", "config/collections", "--output", "backend/src/schema.generated.ts"],
            ROOT
        );
        expect(args).toEqual([
            "schema", "generate",
            "-c", path.join(ROOT, "config/collections"),
            "--output", path.join(ROOT, "backend/src/schema.generated.ts"),
            "--debug"
        ]);
    });

    it("schema introspect leaves --schema alone: there it names a Postgres schema, not a file", () => {
        const args = schemaDriverArgs(["node", "rebase", "schema", "introspect", "--schema", "analytics", "-o", "config/collections"], ROOT);
        expect(args).toEqual(["schema", "introspect", "--schema", "analytics", "-o", path.join(ROOT, "config/collections")]);
    });

    it("doctor resolves every path it takes: --collections, --schema and --sdk", () => {
        const args = doctorDriverArgs(
            ["node", "rebase", "doctor", "--collections", "config/collections", "-s", "backend/src/schema.generated.ts", "--sdk=generated/sdk/database.types.ts", "--policies"],
            ROOT
        );
        expect(args).toEqual([
            "doctor",
            "--collections", path.join(ROOT, "config/collections"),
            "-s", path.join(ROOT, "backend/src/schema.generated.ts"),
            `--sdk=${path.join(ROOT, "generated/sdk/database.types.ts")}`,
            "--policies"
        ]);
    });

    it("leaves an absolute path alone", () => {
        const abs = path.resolve("/elsewhere/collections");
        expect(absolutizeLocalPathArgs(["db", "push", "--collections", abs], ROOT))
            .toEqual(["db", "push", "--collections", abs]);
    });
});

describe("a --collections path that is not there", () => {
    let scratch: string;
    beforeEach(() => {
        scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-collections-path-")));
        fs.mkdirSync(path.join(scratch, "app", "config", "collections"), { recursive: true });
        fs.mkdirSync(path.join(scratch, "app", "backend"), { recursive: true });
    });
    afterEach(() => fs.rmSync(scratch, { recursive: true, force: true }));

    it("is no problem when it exists, or when no path was passed", () => {
        const root = path.join(scratch, "app");
        expect(missingCollectionsPath(["db", "push", "--collections", "config/collections"], root, path.join(root, "backend"))).toBeNull();
        expect(missingCollectionsPath(["db", "push"], root, path.join(root, "backend"))).toBeNull();
    });

    it("names what was typed, where it resolved and the rule it resolved by", () => {
        const root = path.join(scratch, "app");
        const lines = missingCollectionsPath(["schema", "generate", "-c", "./colections"], root, path.join(root, "backend"));
        const text = lines!.join("\n").replace(ANSI, "");
        expect(text).toContain('"./colections"');
        expect(text).toContain(path.join(root, "colections"));
        expect(text).toContain(COLLECTIONS_PATH_RULE);
        expect(text).toContain(root);
    });

    it("tells a script written for the old rule exactly what to change", () => {
        // Every scaffold before this one wrote `--collections ../config/collections`
        // into its root package.json scripts, which ran from the root and only
        // worked because the driver stood in backend/. That line now fails,
        // and the failure has to say why and what to write instead.
        const root = path.join(scratch, "app");
        const lines = missingCollectionsPath(["db", "push", "--collections", "../config/collections"], root, path.join(root, "backend"));
        const text = lines!.join("\n").replace(ANSI, "");
        expect(text).toContain("backend/");
        expect(text).toMatch(/leave the flag out/i);
        expect(text).toContain("config/collections");
    });
});

describe("every help page states the rule in the same words", () => {
    let printed: string[];
    beforeEach(() => {
        printed = [];
        vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
            printed.push(args.map(String).join(" "));
        });
    });
    afterEach(() => vi.restoreAllMocks());

    const linesNaming = (flag: string) => printed.join("\n").replace(ANSI, "").split("\n").filter(line => line.includes(flag));

    it.each([
        ["schema", () => schemaCommand("--help", ["node", "rebase", "schema", "--help"])],
        ["doctor", () => doctorCommand(["node", "rebase", "doctor", "--help"])],
        ["db push", () => dbCommand("push", ["node", "rebase", "db", "push", "--help"])],
        ["db generate", () => dbCommand("generate", ["node", "rebase", "db", "generate", "--help"])],
        ["generate-sdk", async () => (await import("../cli")).entry(["node", "rebase", "generate-sdk", "--help"])]
    ])("rebase %s --help", async (_name, run) => {
        await run();
        const text = printed.join("\n").replace(ANSI, "");
        expect(linesNaming("--collections").length, "the page does not mention --collections").toBeGreaterThan(0);
        expect(text).toContain(COLLECTIONS_PATH_RULE);
        // The default is the project's config/collections, never a path
        // relative to a directory the reader is not standing in.
        expect(text).not.toContain("../config/collections");
    });
});

describe("the scaffold's scripts follow the rule", () => {
    const templateDir = path.join(__dirname, "..", "..", "templates");

    it.each([
        ["template/package.json", "the project root"],
        ["overlays/baas/package.json", "the project root"]
    ])("%s passes no collections path relative to backend/", (file, _where) => {
        const pkg = JSON.parse(fs.readFileSync(path.join(templateDir, file), "utf8")) as { scripts?: Record<string, string> };
        for (const [name, script] of Object.entries(pkg.scripts ?? {})) {
            expect(script, `script "${name}" runs from the root but names a path relative to backend/`).not.toMatch(/--collections\s+\.\.\//);
        }
    });
});
