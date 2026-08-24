/**
 * Tests for the declaration-extension rewrite.
 *
 * This script edits every `.d.ts` of all twenty-one published packages — over a
 * thousand specifiers — and its output is what consumers type-check against. It
 * had been verified by running it and reading the result, which checks that it
 * works on today's input and nothing about the cases it was written to handle:
 *
 *   - a specifier naming a **directory** must become `<dir>/index.js`, not
 *     `<dir>.js`, or the re-export dangles and the module degrades to `any` —
 *     the exact defect the rewrite exists to remove, reintroduced by the fix;
 *   - a string literal that merely *looks* like a specifier — a literal type, an
 *     ambient `declare module` name — must not be touched. That claim lived in
 *     a code comment and nowhere else;
 *   - a second run must change nothing, because the build runs it every time;
 *   - a `dist` that is a symlink out of the package must be refused, because in
 *     a git worktree it points at the primary checkout's published output.
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
const SCRIPT = path.join(ROOT, "tooling", "scripts", "add-dts-extensions.mjs");

/** A throwaway package directory whose `dist` holds the given files. */
function stage(files) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dts-rewrite-"));
    const dist = path.join(dir, "dist");
    for (const [relative, contents] of Object.entries(files)) {
        const file = path.join(dist, relative);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, contents, "utf8");
    }
    return { dir, dist };
}

function run(dist) {
    const result = spawnSync(process.execPath, [SCRIPT, dist], { encoding: "utf8" });
    return { code: result.status, out: `${result.stdout}${result.stderr}` };
}

const read = (dist, file) => fs.readFileSync(path.join(dist, file), "utf8");

describe("rewriting specifiers", () => {
    test("a specifier naming a file gains .js", () => {
        const { dist } = stage({
            "index.d.ts": 'export { a } from "./values";\n',
            "values.d.ts": "export declare const a: number;\n"
        });
        assert.equal(run(dist).code, 0);
        assert.match(read(dist, "index.d.ts"), /from "\.\/values\.js"/);
    });

    test("a specifier naming a directory gains /index.js, not .js", () => {
        // The case that would silently reintroduce the bug: `./types.js` does
        // not exist, so the re-export would dangle and the module would be
        // `any` again — passing a naive "has an extension now" check.
        const { dist } = stage({
            "index.d.ts": 'export * from "./types";\n',
            "types/index.d.ts": "export type Thing = string;\n"
        });
        assert.equal(run(dist).code, 0);
        const rewritten = read(dist, "index.d.ts");
        assert.match(rewritten, /from "\.\/types\/index\.js"/);
        assert.doesNotMatch(rewritten, /from "\.\/types\.js"/);
    });

    test("an import() type is a specifier too", () => {
        // `tsc` emits these whenever a declaration references a type it did not
        // import by name; there are more of them in generated output than real
        // import statements.
        const { dist } = stage({
            "index.d.ts": 'export declare const x: import("./model").Model;\n',
            "model.d.ts": "export interface Model { id: string }\n"
        });
        assert.equal(run(dist).code, 0);
        assert.match(read(dist, "index.d.ts"), /import\("\.\/model\.js"\)/);
    });

    test("bare package specifiers are left alone", () => {
        const { dist } = stage({ "index.d.ts": 'export { Hono } from "hono";\n' });
        assert.equal(run(dist).code, 0);
        assert.match(read(dist, "index.d.ts"), /from "hono"/);
    });
});

describe("what must not be rewritten", () => {
    test("a string literal type that looks like a specifier", () => {
        const { dist } = stage({
            "index.d.ts": 'export type Mode = "./legacy" | "./modern";\nexport declare const m: Mode;\n'
        });
        assert.equal(run(dist).code, 0);
        assert.match(read(dist, "index.d.ts"), /"\.\/legacy" \| "\.\/modern"/);
    });

    test("an ambient module declaration's name", () => {
        // `declare module "./x"` names a module; rewriting it would declare a
        // different module than the one that exists.
        const { dist } = stage({
            "index.d.ts": 'declare module "./virtual" {\n    export const v: number;\n}\nexport {};\n'
        });
        assert.equal(run(dist).code, 0);
        assert.match(read(dist, "index.d.ts"), /declare module "\.\/virtual"/);
    });

    test("a specifier that already carries an extension", () => {
        const { dist } = stage({
            "index.d.ts": 'export { a } from "./values.js";\nexport data from "./data.json";\n',
            "values.d.ts": "export declare const a: number;\n"
        });
        assert.equal(run(dist).code, 0);
        assert.match(read(dist, "index.d.ts"), /from "\.\/values\.js"/);
        assert.match(read(dist, "index.d.ts"), /from "\.\/data\.json"/);
    });
});

describe("safety", () => {
    test("running twice changes nothing", () => {
        const { dist } = stage({
            "index.d.ts": 'export * from "./types";\nexport { a } from "./values";\n',
            "types/index.d.ts": "export type Thing = string;\n",
            "values.d.ts": "export declare const a: number;\n"
        });
        assert.equal(run(dist).code, 0);
        const first = read(dist, "index.d.ts");

        const second = run(dist);
        assert.equal(second.code, 0);
        assert.match(second.out, /already extension-complete/);
        assert.equal(read(dist, "index.d.ts"), first, "the build runs this every time");
    });

    test("a specifier resolving to nothing fails, and is left visible", () => {
        const { dist } = stage({ "index.d.ts": 'export { gone } from "./missing";\n' });
        const result = run(dist);
        assert.equal(result.code, 1, "a dangling specifier is a broken emit, not a formatting problem");
        assert.match(result.out, /resolve to nothing/);
        assert.match(result.out, /\.\/missing/);
        assert.match(read(dist, "index.d.ts"), /from "\.\/missing"/, "left unrewritten so the cause stays visible");
    });

    test("a dist symlinked outside its package is refused", () => {
        // What a git worktree looks like: `dist` points at the primary
        // checkout. Rewriting through it edits another checkout's published
        // output, and the damage is invisible from here.
        const real = stage({ "index.d.ts": 'export { a } from "./values";\n', "values.d.ts": "export declare const a: number;\n" });
        const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "dts-worktree-"));
        const link = path.join(elsewhere, "dist");
        fs.symlinkSync(real.dist, link, "dir");

        const result = run(link);
        assert.equal(result.code, 1);
        assert.match(result.out, /outside this checkout/);
        assert.match(read(real.dist, "index.d.ts"), /from "\.\/values"/, "the target is untouched");
    });

    test("a missing dist fails rather than reporting success", () => {
        const result = run(path.join(os.tmpdir(), "definitely-not-here-dist"));
        assert.equal(result.code, 1);
        assert.match(result.out, /does not exist/);
    });
});
