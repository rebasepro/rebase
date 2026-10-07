/**
 * The driver runs in one Node process, under tsx's loader.
 *
 * `spawnDriverCli` used to start the driver through the `tsx` binary — pnpm's
 * `.bin/tsx` shell shim, then tsx's CLI in one Node, which spawns a second Node
 * with tsx's loader to run the script. A shell and a Node start (~50–100 ms)
 * on every driver run, and `rebase dev` makes one on every start and every
 * collection save. Spawning `node --import <tsx's loader>` runs the same
 * loader in one process.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let scratch: string;
let tsxBin: string | null = "/nonexistent/.bin/tsx";

vi.mock("../utils/project", async importOriginal => {
    const actual = await importOriginal<typeof import("../utils/project")>();
    return {
        ...actual,
        requireProjectRoot: () => scratch,
        requireBackendDir: () => path.join(scratch, "backend"),
        findEnvFile: () => null,
        resolveTsx: () => tsxBin,
        getActiveBackendPlugin: () => "@rebasepro/server-postgres",
        resolvePluginCliScript: () => "/tmp/rebase-test-plugin-cli.ts"
    };
});

vi.mock("execa", () => ({ execa: vi.fn(async () => ({ exitCode: 0 })) }));

import { execa } from "execa";
import { runDriverSchemaCommand } from "./db";
import { resolveTsxLoader } from "../utils/project";

const execaSpy = vi.mocked(execa);

beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-driver-spawn-"));
    fs.mkdirSync(path.join(scratch, "backend"), { recursive: true });
    tsxBin = "/nonexistent/.bin/tsx";
    execaSpy.mockClear();
});

afterEach(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
});

describe("spawnDriverCli", () => {
    it("runs the driver as one Node with tsx's loader, not through the tsx binary", async () => {
        await runDriverSchemaCommand(["node", "rebase", "schema", "generate"], { quiet: true });

        expect(execaSpy).toHaveBeenCalledTimes(1);
        const [command, args] = execaSpy.mock.calls[0] as unknown as [string, string[]];
        expect(command).toBe(process.execPath);
        expect(args.slice(0, 2)).toEqual(["--import", resolveTsxLoader(scratch)]);
        expect(args[1]).toMatch(/^file:\/\/.*\/tsx\/dist\/loader\.mjs$/);
        expect(args.slice(2)).toEqual(["/tmp/rebase-test-plugin-cli.ts", "schema", "generate"]);
    });

    it("resolves tsx from the project before this package", () => {
        // A project with its own tsx in backend/node_modules: that one, the one
        // `resolveTsx` would have found.
        const own = path.join(scratch, "backend", "node_modules", "tsx");
        fs.mkdirSync(path.join(own, "dist"), { recursive: true });
        fs.writeFileSync(path.join(own, "package.json"), JSON.stringify({ name: "tsx", exports: { ".": "./dist/loader.mjs" } }));
        fs.writeFileSync(path.join(own, "dist", "loader.mjs"), "");

        expect(resolveTsxLoader(scratch)).toBe(`file://${fs.realpathSync(path.join(own, "dist", "loader.mjs"))}`);
    });
});
