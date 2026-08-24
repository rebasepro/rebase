/**
 * Tests for the published-types resolution gate.
 *
 * The gate had already stopped gating once, within hours of being written. Its
 * discriminator was *value* exports — functions, consts, classes — which is the
 * right signal for a package whose surface is mostly values and blind for one
 * whose surface is mostly types. Breaking a type-only re-export in
 * `@rebasepro/admin` by hand changed no value count, and the gate passed it.
 * `@rebasepro/types`, the package most consumers feel first, was blind along
 * its entire surface for the same reason.
 *
 * That is not a bug a gate can be trusted to avoid twice by inspection, so each
 * shape it must distinguish is a fixture package here:
 *
 *   - healthy — passes every mode
 *   - values broken — extensionless specifier, values disappear under nodenext
 *   - types broken — extensionless specifier carrying only types (the miss)
 *   - subpath, no redirect — node10 is not expected, the others are
 *   - subpath, broken — the subpath's own declarations do not check
 *   - non-module export — a `.css` entry is not a module and is not probed
 *
 * The assertions are on the gate's **exit code**, because that is the only
 * thing CI reads.
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
const SCRIPT = path.join(ROOT, "tooling", "scripts", "assert-dts-resolution.mjs");

/**
 * A throwaway published package.
 *
 * `files` are written under `dist`; `manifest` is merged over a minimal
 * ESM package.json. Dependency-free on purpose — a fixture that needed
 * `@types/node` would be testing the ambient environment, not the gate.
 */
function stagePackage(name, files, manifest = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dts-gate-"));
    for (const [relative, contents] of Object.entries(files)) {
        const file = path.join(dir, "dist", relative);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, contents, "utf8");
    }
    fs.writeFileSync(
        path.join(dir, "package.json"),
        JSON.stringify({
            name,
            version: "0.0.0",
            type: "module",
            main: "./dist/index.js",
            types: "./dist/index.d.ts",
            exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
            ...manifest
        }, null, 2),
        "utf8"
    );
    return dir;
}

function run(dir) {
    const result = spawnSync(process.execPath, [SCRIPT, dir], { encoding: "utf8" });
    return { code: result.status, out: `${result.stdout}${result.stderr}` };
}

/** A root barrel re-exporting one value module and one type module. */
const barrel = (valueSpecifier, typeSpecifier) =>
    `export { compute } from "${valueSpecifier}";\nexport type { Model } from "${typeSpecifier}";\n`;

const VALUES = "export declare function compute(input: string): number;\n";
const TYPES = "export interface Model { id: string }\n";

describe("a healthy package", () => {
    test("passes in every resolution mode", () => {
        const dir = stagePackage("@fixture/healthy", {
            "index.d.ts": barrel("./values.js", "./types/index.js"),
            "values.d.ts": VALUES,
            "types/index.d.ts": TYPES
        });
        const result = run(dir);
        assert.equal(result.code, 0, result.out);
        assert.match(result.out, /types resolve in all modes/);
    });
});

describe("the defect", () => {
    test("an extensionless specifier carrying values fails", () => {
        const dir = stagePackage("@fixture/values-broken", {
            "index.d.ts": barrel("./values", "./types/index.js"),
            "values.d.ts": VALUES,
            "types/index.d.ts": TYPES
        });
        const result = run(dir);
        assert.equal(result.code, 1, result.out);
        assert.match(result.out, /nodenext/);
    });

    test("an extensionless specifier carrying ONLY types fails", () => {
        // The regression this suite exists for. No value export changes, so
        // every count-based check reports the package as healthy.
        const dir = stagePackage("@fixture/types-broken", {
            "index.d.ts": barrel("./values.js", "./types/index"),
            "values.d.ts": VALUES,
            "types/index.d.ts": TYPES
        });
        const result = run(dir);
        assert.equal(result.code, 1, `a type-only re-export degrading must fail:\n${result.out}`);
        assert.match(result.out, /nodenext/);
        assert.match(result.out, /TS2834|do not type-check/);
    });

    test("a package with no values at all is still checked", () => {
        // `@rebasepro/types` in miniature: nothing but types, so there is no
        // value surface to compare and the direct diagnostic is the only signal.
        const dir = stagePackage("@fixture/pure-types", {
            "index.d.ts": 'export type { Model } from "./types/index";\n',
            "types/index.d.ts": TYPES
        });
        const result = run(dir);
        assert.equal(result.code, 1, `a pure-type package must not be exempt:\n${result.out}`);
    });
});

describe("subpaths", () => {
    const withSubpath = (subpathSpecifier) => ({
        files: {
            "index.d.ts": barrel("./values.js", "./types/index.js"),
            "values.d.ts": VALUES,
            "types/index.d.ts": TYPES,
            "sub/index.d.ts": `export { helper } from "${subpathSpecifier}";\n`,
            "sub/helper.d.ts": "export declare function helper(): void;\n"
        },
        manifest: {
            exports: {
                ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
                "./sub": { types: "./dist/sub/index.d.ts", import: "./dist/sub/index.js" }
            }
        }
    });

    test("a healthy subpath passes, and node10 is not demanded without a redirect", () => {
        const { files, manifest } = withSubpath("./helper.js");
        const dir = stagePackage("@fixture/subpath-ok", files, manifest);
        const result = run(dir);
        assert.equal(result.code, 0, result.out);
        // Root in three modes, subpath in two: node10 cannot see `exports`, and
        // a subpath works there only if the package ships a redirect directory.
        assert.match(result.out, /\(5 checks\)/);
    });

    test("a broken subpath fails even though the root is fine", () => {
        const { files, manifest } = withSubpath("./helper");
        const dir = stagePackage("@fixture/subpath-broken", files, manifest);
        const result = run(dir);
        assert.equal(result.code, 1, result.out);
        assert.match(result.out, /\/sub/);
    });

    test("a redirect directory brings node10 into scope", () => {
        const { files, manifest } = withSubpath("./helper.js");
        const dir = stagePackage("@fixture/subpath-redirect", files, manifest);
        fs.mkdirSync(path.join(dir, "sub"));
        fs.writeFileSync(
            path.join(dir, "sub", "package.json"),
            JSON.stringify({ type: "module", main: "../dist/sub/index.js", types: "../dist/sub/index.d.ts" }),
            "utf8"
        );
        const result = run(dir);
        assert.equal(result.code, 0, result.out);
        assert.match(result.out, /\(6 checks\)/, "the redirect is the package claiming node10 support");
    });
});

describe("what is not a module", () => {
    test("a .css export is skipped rather than probed", () => {
        const dir = stagePackage("@fixture/with-css", {
            "index.d.ts": barrel("./values.js", "./types/index.js"),
            "values.d.ts": VALUES,
            "types/index.d.ts": TYPES,
            "styles.css": ".a{}\n"
        }, {
            exports: {
                ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
                "./styles.css": "./dist/styles.css"
            }
        });
        const result = run(dir);
        assert.equal(result.code, 0, result.out);
        assert.match(result.out, /\(3 checks\)/, "the stylesheet is not an entry a type checker can read");
    });
});

describe("honesty about coverage", () => {
    test("an unbuilt package is reported as skipped, not as passing", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dts-gate-unbuilt-"));
        fs.writeFileSync(
            path.join(dir, "package.json"),
            JSON.stringify({ name: "@fixture/unbuilt", version: "0.0.0", type: "module", types: "./dist/index.d.ts" }),
            "utf8"
        );
        const result = run(dir);
        assert.match(result.out, /skipped/, "a green check on a package with no declarations means nothing");
    });
});
