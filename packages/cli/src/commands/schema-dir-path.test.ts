/**
 * One rule for a `--schema-dir` path: relative to where you run the command.
 *
 * It was three, under the flag's old name. `rebase schema generate`, `db
 * push`/`generate` and `doctor` handed the path to the driver unchanged, and
 * the driver runs in `backend/`, so from the project root a path typed from
 * the root was "not found", while the same spelling worked for
 * `generate-sdk`, which resolves against the cwd.
 *
 * Now every command resolves a relative path from the directory it is run in
 * before the driver is handed another one, refuses a path that is not there in
 * those same terms, and every help page states the rule in the same words. The
 * old flag, `--collections`, is refused with the new one named.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { absolutizeLocalPathArgs } from "./db";
import { schemaDriverArgs, schemaCommand } from "./schema";
import { doctorDriverArgs, doctorCommand } from "./doctor";
import { dbCommand } from "./db";
import { PATH_RESOLUTION_RULE, missingSchemaDir, removedCollectionsFlag } from "../utils/path-flags";
import { consoleCommand } from "./console";

const ROOT = path.resolve("/projects/my-app");

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;

describe("a relative --schema-dir reaches the driver resolved from the cwd", () => {
    it("db push --schema-dir ./backend/schema", () => {
        expect(absolutizeLocalPathArgs(["db", "push", "--schema-dir", "./backend/schema"], ROOT))
            .toEqual(["db", "push", "--schema-dir", path.join(ROOT, "backend/schema")]);
    });

    it("db generate --schema-dir=<value>", () => {
        expect(absolutizeLocalPathArgs(["db", "generate", "--schema-dir=backend/schema"], ROOT))
            .toEqual(["db", "generate", `--schema-dir=${path.join(ROOT, "backend/schema")}`]);
    });

    it("schema generate resolves --schema-dir and --output, wherever the flags sit", () => {
        const args = schemaDriverArgs(
            ["node", "rebase", "--debug", "schema", "generate", "--schema-dir", "backend/schema", "--output", "backend/src/schema.generated.ts"],
            ROOT
        );
        expect(args).toEqual([
            "schema", "generate",
            "--schema-dir", path.join(ROOT, "backend/schema"),
            "--output", path.join(ROOT, "backend/src/schema.generated.ts"),
            "--debug"
        ]);
    });

    it("schema introspect leaves --schema alone: there it names a Postgres schema, not a file", () => {
        const args = schemaDriverArgs(["node", "rebase", "schema", "introspect", "--schema", "analytics", "-o", "config/collections"], ROOT);
        expect(args).toEqual(["schema", "introspect", "--schema", "analytics", "-o", path.join(ROOT, "config/collections")]);
    });

    it("doctor resolves every path it takes: --schema-dir, --schema and --sdk", () => {
        const args = doctorDriverArgs(
            ["node", "rebase", "doctor", "--schema-dir", "backend/schema", "-s", "backend/src/schema.generated.ts", "--sdk=generated/sdk/database.types.ts", "--policies"],
            ROOT
        );
        expect(args).toEqual([
            "doctor",
            "--schema-dir", path.join(ROOT, "backend/schema"),
            "-s", path.join(ROOT, "backend/src/schema.generated.ts"),
            `--sdk=${path.join(ROOT, "generated/sdk/database.types.ts")}`,
            "--policies"
        ]);
    });

    it("leaves an absolute path alone", () => {
        const abs = path.resolve("/elsewhere/schema");
        expect(absolutizeLocalPathArgs(["db", "push", "--schema-dir", abs], ROOT))
            .toEqual(["db", "push", "--schema-dir", abs]);
    });
});

describe("a typed --collections", () => {
    it.each([
        ["verify", ["--collections", "config/collections"], "--collections"],
        ["doctor", ["-c", "x"], "-c"],
        ["console", ["--collections=x"], "--collections"],
        ["generate-sdk", ["-c", "x"], "-c"],
        ["schema generate", ["--collections", "x"], "--collections"]
    ])("is refused on %s with the new flag named and the codemod for an old project", (command, words, flag) => {
        const sentence = removedCollectionsFlag(words, command);
        expect(sentence).toContain(`${flag} was removed`);
        expect(sentence).toContain("--schema-dir <dir>");
        expect(sentence).toContain("rebase migrate collections-to-tables");
        expect(sentence).toContain("Nothing was run");
    });

    it("is not -c on a command that never had it, nor anything after a --", () => {
        expect(removedCollectionsFlag(["-c"], "status")).toBeNull();
        expect(removedCollectionsFlag(["--", "--collections", "x"], "verify")).toBeNull();
        expect(removedCollectionsFlag(["--schema-dir", "x"], "verify")).toBeNull();
    });

    it.each([
        ["schema generate", () => schemaCommand("generate", ["node", "rebase", "schema", "generate", "--collections", "x"])],
        ["doctor", () => doctorCommand(["node", "rebase", "doctor", "-c", "x"])],
        ["console", () => consoleCommand(["node", "rebase", "console", "--collections", "x"])]
    ])("stops rebase %s before anything starts", async (_name, run) => {
        const cwd = process.cwd();
        const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-collections-flag-"));
        fs.mkdirSync(path.join(scratch, "backend"), { recursive: true });
        fs.writeFileSync(path.join(scratch, "rebase.json"), JSON.stringify({ rebase: "^1", apps: {} }));
        process.chdir(scratch);
        try {
            await expect(run()).rejects.toThrow(/was removed.*--schema-dir/s);
        } finally {
            process.chdir(cwd);
            fs.rmSync(scratch, { recursive: true, force: true });
        }
    });
});

describe("a --schema-dir path that is not there", () => {
    let scratch: string;
    beforeEach(() => {
        scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-schema-dir-path-")));
        fs.mkdirSync(path.join(scratch, "app", "backend", "schema"), { recursive: true });
    });
    afterEach(() => fs.rmSync(scratch, { recursive: true, force: true }));

    it("is no problem when it exists, or when no path was passed", () => {
        const root = path.join(scratch, "app");
        expect(missingSchemaDir(["db", "push", "--schema-dir", "backend/schema"], root, path.join(root, "backend"))).toBeNull();
        expect(missingSchemaDir(["db", "push", "--schema-dir=backend/schema"], root, path.join(root, "backend"))).toBeNull();
        expect(missingSchemaDir(["db", "push"], root, path.join(root, "backend"))).toBeNull();
    });

    it("names what was typed, where it resolved and the rule it resolved by", () => {
        const root = path.join(scratch, "app");
        const lines = missingSchemaDir(["schema", "generate", "--schema-dir", "./shema"], root, path.join(root, "backend"));
        const text = lines!.join("\n").replace(ANSI, "");
        expect(text).toContain('"./shema"');
        expect(text).toContain(path.join(root, "shema"));
        expect(text).toContain(PATH_RESOLUTION_RULE);
        expect(text).toContain(root);
    });

    it("tells a path written from backend/ exactly what to change", () => {
        // The driver runs in backend/, so `--schema-dir schema` reads naturally
        // to anyone who has looked at it — and resolves from the root to a
        // directory that is not there. The failure has to say why and what to
        // write instead.
        const root = path.join(scratch, "app");
        const lines = missingSchemaDir(["db", "push", "--schema-dir", "schema"], root, path.join(root, "backend"));
        const text = lines!.join("\n").replace(ANSI, "");
        expect(text).toContain("backend/");
        expect(text).toMatch(/leave the flag out/i);
        expect(text).toContain("backend/schema");
    });

    it("says what was spared in the terms of the command that refused", () => {
        // The schema writers' warning — an empty schema drops every table — was
        // printed by `rebase console` and `rebase doctor` too, which drop nothing.
        const root = path.join(scratch, "app");
        const said = (use?: "schema" | "console" | "doctor") =>
            missingSchemaDir(["x", "--schema-dir", "nope"], root, path.join(root, "backend"), use)!.join("\n").replace(ANSI, "");
        expect(said()).toContain("applying it would drop");
        expect(said("schema")).toContain("applying it would drop");
        expect(said("console")).toContain("Nothing was started");
        expect(said("doctor")).toContain("Nothing was checked");
        expect(said("console")).not.toContain("drop");
        expect(said("doctor")).not.toContain("drop");
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
        expect(linesNaming("--schema-dir").length, "the page does not mention --schema-dir").toBeGreaterThan(0);
        expect(text).toContain(PATH_RESOLUTION_RULE);
        // The default is the project's backend/schema, never a path relative
        // to a directory the reader is not standing in.
        expect(text).toContain("backend/schema");
        expect(linesNaming("--collections").filter(line => !line.includes("introspect"))).toEqual([]);
    });
});

describe("the scaffold's scripts follow the rule", () => {
    const templateDir = path.join(__dirname, "..", "..", "templates");

    it.each([
        ["template/package.json", "the project root"],
        ["overlays/baas/package.json", "the project root"]
    ])("%s passes no schema path relative to backend/", (file, _where) => {
        const pkg = JSON.parse(fs.readFileSync(path.join(templateDir, file), "utf8")) as { scripts?: Record<string, string> };
        for (const [name, script] of Object.entries(pkg.scripts ?? {})) {
            expect(script, `script "${name}" runs from the root but names a path relative to backend/`).not.toMatch(/--(schema-dir|collections)\s+\.\.\//);
        }
    });
});
