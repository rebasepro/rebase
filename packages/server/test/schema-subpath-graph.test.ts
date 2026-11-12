import { afterAll, describe, expect, it } from "@jest/globals";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * `@rebasepro/server/schema` evaluates no server module.
 *
 * It is what every `backend/schema/*.ts` file imports, so it is loaded by
 * `rebase db generate` and type-imported by frontends: an import of it that
 * dragged in the server — its drivers, its Hono routes, its process state —
 * would make generating a schema boot half a backend, and put server code in
 * a browser bundle. The line is easy to cross by accident (one re-export from
 * the wrong module) and invisible when crossed, so it is asserted on the real
 * module graph: the entry is imported in a fresh Node process under a loader
 * hook that records every module that resolves.
 *
 * `@rebasepro/types` is pointed at its source, as the build inlines it.
 */

const SERVER_ROOT = path.resolve(__dirname, "..");
const PACKAGES = path.resolve(SERVER_ROOT, "..");
const ENTRY = path.join(SERVER_ROOT, "src", "schema", "index.ts");
const TYPES_SOURCE = path.join(PACKAGES, "types", "src", "index.ts");

/** tsx, resolved where it is installed: the hook files live in a temp directory. */
const TSX_API = pathToFileURL(require.resolve("tsx/esm/api", { paths: [path.resolve(PACKAGES, "..")] })).href;

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-schema-subpath-"));
afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }));

function loadedModules(): { status: number | null; stderr: string; urls: string[]; exported: string[] } {
    const log = path.join(scratch, "resolved.log");
    const out = path.join(scratch, "exports.json");
    const hook = path.join(scratch, "record-hook.mjs");
    fs.writeFileSync(hook, `
import { appendFileSync } from "node:fs";
export async function resolve(specifier, context, next) {
    const result = specifier === "@rebasepro/types"
        ? { url: ${JSON.stringify(pathToFileURL(TYPES_SOURCE).href)}, shortCircuit: true }
        : await next(specifier, context);
    appendFileSync(${JSON.stringify(log)}, result.url + "\\n");
    return result;
}
`);
    const register = path.join(scratch, "register.mjs");
    fs.writeFileSync(register, `
import { register } from "node:module";
import { register as registerTsx } from ${JSON.stringify(TSX_API)};
registerTsx();
register(${JSON.stringify(pathToFileURL(hook).href)});
`);
    const script = `
const mod = await import(${JSON.stringify(pathToFileURL(ENTRY).href)});
(await import("node:fs")).writeFileSync(${JSON.stringify(out)}, JSON.stringify(Object.keys(mod).sort()));
`;
    const result = spawnSync(process.execPath, ["--import", pathToFileURL(register).href, "--input-type=module", "-e", script], {
        // tsx is resolved from the repository root, where it is installed.
        cwd: path.resolve(PACKAGES, ".."),
        encoding: "utf8",
        env: { ...process.env, NODE_OPTIONS: "" }
    });
    const urls = fs.existsSync(log) ? fs.readFileSync(log, "utf8").split("\n").filter(Boolean) : [];
    const exported: string[] = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, "utf8")) : [];
    return { status: result.status, stderr: result.stderr, urls, exported };
}

describe("@rebasepro/server/schema", () => {
    const loaded = loadedModules();

    it("imports cleanly in a fresh process", () => {
        expect(loaded.stderr).toBe("");
        expect(loaded.status).toBe(0);
    });

    it("evaluates no module of the server but its own entry", () => {
        const serverSource = pathToFileURL(path.join(SERVER_ROOT, "src")).href + "/";
        const server = loaded.urls.filter(url => url.startsWith(serverSource) && url !== pathToFileURL(ENTRY).href);
        expect(server).toEqual([]);
    });

    it("reaches nothing but @rebasepro/types and Node built-ins", () => {
        const typesSource = pathToFileURL(path.join(PACKAGES, "types", "src")).href + "/";
        const elsewhere = loaded.urls.filter(url =>
            url !== pathToFileURL(ENTRY).href && !url.startsWith(typesSource) && !url.startsWith("node:"));
        expect(elsewhere).toEqual([]);
        expect(loaded.urls.some(url => url.startsWith(typesSource))).toBe(true);
    });

    it("exports the builders and `policy`", () => {
        expect(loaded.exported).toEqual([
            "col", "defineAuthTable", "defineTable", "defineView", "isAuthTableDef", "isTableDef", "isViewDef", "json", "policy", "rel"
        ]);
    });
});
