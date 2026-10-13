/**
 * Tests for the last step of every package build, `assert-build-output.mjs`.
 *
 * Only its newest check is covered here: a built file that carries Vite's
 * `__vite-browser-external` stub fails the build. A Node built-in the externals
 * list does not name is not inlined; Vite swaps it for an empty object and the
 * build succeeds. The Postgres driver shipped that way for `readline`, and every
 * confirmation prompt in its CLI died on `createInterface is not a function`.
 *
 * Run: `pnpm test:gates`
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SCRIPT = path.join(ROOT, "tooling", "scripts", "assert-build-output.mjs");

/** A throwaway built package: a manifest pointing at `dist/index.js`, plus `dist` files. */
function stage(files) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "build-output-"));
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({
        name: "@rebasepro/fixture",
        type: "module",
        main: "./dist/index.js"
    }));
    for (const [relative, contents] of Object.entries(files)) {
        const file = path.join(dir, "dist", relative);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, contents, "utf8");
    }
    return dir;
}

function run(dir) {
    const result = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: "utf8" });
    return { code: result.status, out: `${result.stdout}${result.stderr}` };
}

describe("assert-build-output: Vite's browser stub for a Node built-in", () => {
    test("passes a build whose built-ins stayed imports", () => {
        const dir = stage({
            "index.js": 'import readline from "readline";\nexport const ask = () => readline.createInterface({ input: process.stdin });\n'
        });
        const { code, out } = run(dir);
        assert.equal(code, 0, out);
    });

    test("fails a build that inlined the stub, naming the file", () => {
        // What rolldown emitted for `import readline from "readline"` when
        // `readline` was missing from the externals list.
        const dir = stage({
            "index.js": 'export { ask } from "./chunks/backup-cli.js";\n',
            "chunks/backup-cli.js":
                'import { a as __toESM, t as require___vite_browser_external } from "./__vite-browser-external-BnuHet1e.js";\n' +
                "var import___vite_browser_external = __toESM(require___vite_browser_external());\n" +
                "export const ask = () => import___vite_browser_external.default.createInterface({});\n"
        });
        const { code, out } = run(dir);
        assert.equal(code, 1, out);
        assert.match(out, /browser stub/);
        assert.match(out, /dist\/chunks\/backup-cli\.js/);
        assert.match(out, /isBuiltin/);
    });

    test("reads .mjs and .cjs files too", () => {
        const dir = stage({
            "index.js": "export {};\n",
            "bin/cli.cjs": "const __viteBrowserExternal = {};\nmodule.exports = __viteBrowserExternal;\n"
        });
        const { code, out } = run(dir);
        assert.equal(code, 1, out);
        assert.match(out, /dist\/bin\/cli\.cjs/);
    });

    test("does not read source maps, which name modules without shipping them", () => {
        const dir = stage({
            "index.js": "export {};\n",
            "index.js.map": '{"sources":["__vite-browser-external"]}'
        });
        const { code, out } = run(dir);
        assert.equal(code, 0, out);
    });
});
