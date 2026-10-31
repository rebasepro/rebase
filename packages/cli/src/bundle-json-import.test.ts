/**
 * A JSON file a function imports reaches the bundle, loads under plain Node, and
 * travels through every step between the build and the pod.
 *
 * A `rebase cloud deploy` of a project builds on the developer's machine with
 * the same `buildBundle` that `rebase build` runs; the platform compiles only to
 * rebuild the uploaded source on a newer framework release. So there is one
 * build to pin, and three copies of its input and output to keep in step: the
 * bundle, the archive uploaded from it, and the source a rebuild starts from.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { createRequire } from "module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildBundle } from "./bundle";
import { packBundle } from "./commands/cloud/bundle-deploy";
import { listSourceFiles } from "./commands/cloud/rebuild-source";

const require = createRequire(import.meta.url);

let scratch: string;

function write(relative: string, content: string): void {
    const file = path.join(scratch, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
}

const build = () => buildBundle({
    projectRoot: scratch,
    appName: "backend",
    app: { type: "backend", runtime: "managed" },
    runtimeRange: "^1",
    vendor: false
});

beforeEach(() => {
    scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-bundle-json-")));
    write("backend/functions/greet.ts",
        "import lines from \"./lines.json\";\n" +
        "export const hello: string = lines.hello;\n" +
        "export default { fetch: () => undefined, routes: [] };\n");
    write("backend/functions/lines.json", "{ \"hello\": \"hola\" }\n");
    // This repository's TypeScript, not whatever `tsc` is on the PATH.
    fs.mkdirSync(path.join(scratch, "node_modules/.bin"), { recursive: true });
    fs.symlinkSync(require.resolve("typescript/bin/tsc"), path.join(scratch, "node_modules/.bin/tsc"));
    vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
    vi.restoreAllMocks();
});

describe("a JSON file a function imports", () => {
    it("is written next to the function, and the function loads under plain Node", async () => {
        const { outDir } = await build();

        const bundled = path.join(outDir, "backend/functions");
        expect(fs.readdirSync(bundled)).toContain("lines.json");

        // The runtime's loader, not tsx: Node's own ESM `import()` of the
        // emitted file, in a process of its own.
        const url = new URL(`file://${path.join(bundled, "greet.js")}`).href;
        const printed = execFileSync(process.execPath, [
            "--input-type=module",
            "-e",
            `const m = await import(${JSON.stringify(url)}); console.log(m.hello);`
        ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
        expect(printed.trim()).toBe("hola");
    });

    it("is in the archive a deploy uploads", async () => {
        const { outDir } = await build();
        const archive = path.join(scratch, "bundle.tar.gz");

        await packBundle(outDir, archive);

        const entries = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" }).split("\n");
        expect(entries).toContain("./backend/functions/lines.json");
        expect(entries).toContain("./backend/functions/greet.js");
    });

    it("is in the source a platform rebuild compiles", () => {
        expect(listSourceFiles(scratch).files).toEqual(expect.arrayContaining([
            "backend/functions/greet.ts",
            "backend/functions/lines.json"
        ]));
    });
});
