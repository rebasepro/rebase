/**
 * One answer to "where are this project's tables", for every command.
 *
 * `rebase.json` may move the tables directory (`apps.<backend>.tables`). Under
 * the old layout the runtime, `rebase build` and `rebase generate view`
 * honoured the moved config package while `verify`, `doctor`, `generate-sdk`,
 * `console` and dev's regeneration read the conventional directory regardless
 * — so `rebase verify` passed over no tables at all. Every one of them asks
 * `resolveSchemaDir` now.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveSchemaDir, resolveTablesDir, SCHEMA_DIR_FLAG, schemaDirArgs, schemaDirFlag } from "./schema-dir";
import { doctorDriverArgs } from "../commands/doctor";
import { runVerify, verifyCommand } from "../commands/verify";
import { col, defineTable } from "@rebasepro/types";
import { TYPES_SOURCE, writeTableModules } from "../../test/helpers/project";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(HERE, "..", "..");

let root: string;

function manifest(backend: Record<string, unknown>): void {
    fs.writeFileSync(path.join(root, "rebase.json"), JSON.stringify({ rebase: "^2", apps: { backend: { type: "backend", runtime: "managed", ...backend } } }));
}

beforeEach(() => {
    root = fs.mkdtempSync(path.join(PACKAGE_ROOT, ".tmp-schema-dir-"));
});

afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
});

describe("resolveSchemaDir", () => {
    it("follows the backend's tables directory in rebase.json", () => {
        manifest({ tables: "db/tables" });
        expect(resolveTablesDir(root)).toBe("db/tables");
        expect(resolveSchemaDir(root)).toBe(path.join(root, "db", "tables"));
    });

    it("is backend/schema for a conventional project, and without a manifest", () => {
        manifest({});
        expect(resolveSchemaDir(root)).toBe(path.join(root, "backend", "schema"));
        fs.rmSync(path.join(root, "rebase.json"));
        expect(resolveSchemaDir(root)).toBe(path.join(root, "backend", "schema"));
    });

    it("falls back to the default over a manifest the commands will refuse", () => {
        // `config` is refused; the command that owns the manifest reports it.
        manifest({ config: "config" });
        expect(resolveSchemaDir(root)).toBe(path.join(root, "backend", "schema"));
    });
});

describe("schemaDirArgs: the driver is told where they are", () => {
    it("is the one flag contract with the driver", () => {
        expect(SCHEMA_DIR_FLAG).toBe("--schema-dir");
        expect(schemaDirFlag("/abs/dir")).toEqual(["--schema-dir", "/abs/dir"]);
    });

    it("names the declared directory, absolute, to every driver command that reads the schema", () => {
        manifest({ tables: "db/tables" });
        const dir = path.join(root, "db", "tables");
        for (const line of [["db", "push"], ["db", "generate"], ["db", "migrate"], ["schema", "generate"], ["schema", "introspect"], ["schema", "stale", "--fix"], ["doctor"], ["console", "-e", "1"]]) {
            expect(schemaDirArgs(root, line), line.join(" ")).toEqual(["--schema-dir", dir]);
        }
    });

    it("adds nothing to a command that does not read it, or a line that names its own", () => {
        manifest({ tables: "db/tables" });
        expect(schemaDirArgs(root, ["db", "url"])).toEqual([]);
        expect(schemaDirArgs(root, ["db", "push", "--schema-dir", "/x"])).toEqual([]);
        expect(schemaDirArgs(root, ["schema", "generate", "--schema-dir=/x"])).toEqual([]);
    });

    it("leaves a conventional project's command lines exactly as they were", () => {
        manifest({});
        expect(schemaDirArgs(root, ["db", "push"])).toEqual([]);
        manifest({ tables: "backend/schema" });
        expect(schemaDirArgs(root, ["db", "push"])).toEqual([]);
    });

    it("reaches doctor's driver line", () => {
        manifest({ tables: "db/tables" });
        expect(doctorDriverArgs(["node", "rebase", "doctor"], root, root))
            .toEqual(["doctor", "--schema-dir", path.join(root, "db", "tables")]);
    });
});

describe("rebase verify in a project that moved its tables", () => {
    it("reads the declared directory by default instead of passing over none", async () => {
        manifest({ tables: "db/tables" });
        writeTableModules(path.join(root, "db", "tables"), [defineTable("notes", {
            columns: { id: col.uuid().primaryKey(), title: col.text() },
            rls: "admin-only"
        })], undefined, TYPES_SOURCE);
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
        expect(report.schemaDir).toBe(path.join("db", "tables"));
        expect(report.steps[0]).toMatchObject({ id: "schema", status: "passed" });
        expect(report.steps[0].detail).toContain("1 table");
    });
});
