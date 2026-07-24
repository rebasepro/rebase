import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    collectDeclaredDependencies,
    detectNativeDependencies,
    normalizeEsmSpecifiers
} from "./bundle";

let scratch: string;

beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-bundle-build-"));
});

afterEach(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
});

function write(relative: string, content: string): string {
    const full = path.join(scratch, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
    return full;
}

/**
 * TypeScript emits import specifiers untouched, so a project written with
 * `moduleResolution: "bundler"` produces JavaScript that Node cannot load:
 * extensionless paths and directory imports are both rejected by the ESM
 * loader. Nothing bundles a Rebase bundle, so the build has to finish the job.
 */
describe("normalizeEsmSpecifiers", () => {
    it("adds the extension to a relative import", () => {
        write("posts.js", "export default {};");
        const file = write("authors.js", 'import posts from "./posts";\n');

        const result = normalizeEsmSpecifiers(scratch);

        expect(result.rewritten).toBe(1);
        expect(fs.readFileSync(file, "utf8")).toContain('"./posts.js"');
    });

    it("resolves a directory import to its index", () => {
        write("collections/index.js", "export const collections = [];");
        const file = write("index.js", 'export { collections } from "./collections";\n');

        normalizeEsmSpecifiers(scratch);

        expect(fs.readFileSync(file, "utf8")).toContain('"./collections/index.js"');
    });

    it("handles every import form the compiler emits", () => {
        write("dep.js", "export default {};");
        write("side.js", "");
        const file = write("all.js", [
            'import a from "./dep";',
            'import { b } from "./dep";',
            'export { c } from "./dep";',
            'export * from "./dep";',
            'import "./side";',
            'const d = await import("./dep");'
        ].join("\n"));

        normalizeEsmSpecifiers(scratch);
        const content = fs.readFileSync(file, "utf8");

        expect(content.match(/"\.\/dep\.js"/g)).toHaveLength(5);
        expect(content).toContain('"./side.js"');
    });

    it("leaves an already-complete specifier alone", () => {
        write("posts.js", "export default {};");
        const file = write("authors.js", 'import posts from "./posts.js";\n');

        const result = normalizeEsmSpecifiers(scratch);

        expect(result.rewritten).toBe(0);
        expect(fs.readFileSync(file, "utf8")).toContain('"./posts.js"');
    });

    it("never touches bare package specifiers", () => {
        const file = write("a.js", 'import { z } from "zod";\nimport x from "@scope/pkg";\n');

        normalizeEsmSpecifiers(scratch);

        expect(fs.readFileSync(file, "utf8")).toContain('"zod"');
        expect(fs.readFileSync(file, "utf8")).toContain('"@scope/pkg"');
    });

    it("reports a specifier it could not resolve rather than guessing", () => {
        write("a.js", 'import missing from "./nope";\n');

        const result = normalizeEsmSpecifiers(scratch);

        expect(result.rewritten).toBe(0);
        expect(result.unresolved).toHaveLength(1);
        expect(result.unresolved[0]).toContain("./nope");
    });

    it("rewrites an explicit .ts specifier to the emitted .js", () => {
        write("dep.js", "export default {};");
        const file = write("a.js", 'import dep from "./dep.ts";\n');

        normalizeEsmSpecifiers(scratch);

        expect(fs.readFileSync(file, "utf8")).toContain('"./dep.js"');
    });

    it("skips node_modules", () => {
        const vendored = write("node_modules/pkg/index.js", 'import x from "./other";\n');

        normalizeEsmSpecifiers(scratch);

        expect(fs.readFileSync(vendored, "utf8")).toContain('"./other"');
    });
});

describe("collectDeclaredDependencies", () => {
    it("gathers dependencies from the project's packages", () => {
        write("backend/package.json", JSON.stringify({ dependencies: { pg: "^8.0.0" } }));
        write("config/package.json", JSON.stringify({ dependencies: { zod: "^4.0.0" } }));

        expect(collectDeclaredDependencies(scratch)).toEqual({ pg: "^8.0.0", zod: "^4.0.0" });
    });

    it("omits packages the runtime image already provides", () => {
        // Installing a second copy of the server beside the one running the
        // process is wasted space at best and a version conflict at worst.
        write("backend/package.json", JSON.stringify({
            dependencies: { "@rebasepro/server": "^0.11.0", hono: "^4.0.0", pg: "^8.0.0" }
        }));

        expect(collectDeclaredDependencies(scratch)).toEqual({ pg: "^8.0.0" });
    });

    it("omits workspace protocol versions, which mean nothing outside the repo", () => {
        write("backend/package.json", JSON.stringify({
            dependencies: { "my-config": "workspace:*", pg: "^8.0.0" }
        }));

        expect(collectDeclaredDependencies(scratch)).toEqual({ pg: "^8.0.0" });
    });

    it("ignores an unparseable package.json rather than failing the build", () => {
        write("backend/package.json", "{ broken");
        write("config/package.json", JSON.stringify({ dependencies: { zod: "^4.0.0" } }));

        expect(collectDeclaredDependencies(scratch)).toEqual({ zod: "^4.0.0" });
    });
});

describe("detectNativeDependencies", () => {
    it("flags a known native package by name", () => {
        const found = detectNativeDependencies(scratch, { sharp: "^0.33.0" });

        expect(found).toHaveLength(1);
        expect(found[0].name).toBe("sharp");
    });

    it("flags a package that builds a native addon", () => {
        write("node_modules/thing/package.json", JSON.stringify({ name: "thing" }));
        write("node_modules/thing/binding.gyp", "{}");

        const found = detectNativeDependencies(scratch, { thing: "^1.0.0" });

        expect(found[0]).toMatchObject({ name: "thing" });
        expect(found[0].reason).toMatch(/binding\.gyp/);
    });

    it("flags an install script that compiles native code", () => {
        write("node_modules/thing/package.json", JSON.stringify({
            name: "thing",
            scripts: { install: "node-gyp rebuild" }
        }));

        expect(detectNativeDependencies(scratch, { thing: "^1.0.0" })[0].reason)
            .toMatch(/install script/);
    });

    it("flags a prebuilt binary", () => {
        write("node_modules/thing/package.json", JSON.stringify({ name: "thing" }));
        write("node_modules/thing/build/Release/thing.node", "");

        expect(detectNativeDependencies(scratch, { thing: "^1.0.0" })[0].reason)
            .toMatch(/prebuilt/);
    });

    it("follows transitive dependencies", () => {
        write("node_modules/top/package.json", JSON.stringify({
            name: "top",
            dependencies: { inner: "^1.0.0" }
        }));
        write("node_modules/inner/package.json", JSON.stringify({ name: "inner" }));
        write("node_modules/inner/binding.gyp", "{}");

        expect(detectNativeDependencies(scratch, { top: "^1.0.0" }).map(f => f.name))
            .toEqual(["inner"]);
    });

    it("passes a plain JavaScript dependency graph", () => {
        write("node_modules/pure/package.json", JSON.stringify({ name: "pure" }));
        write("node_modules/pure/index.js", "export default 1;");

        expect(detectNativeDependencies(scratch, { pure: "^1.0.0" })).toEqual([]);
    });

    it("terminates on a dependency cycle", () => {
        write("node_modules/a/package.json", JSON.stringify({ name: "a", dependencies: { b: "1" } }));
        write("node_modules/b/package.json", JSON.stringify({ name: "b", dependencies: { a: "1" } }));

        expect(detectNativeDependencies(scratch, { a: "^1.0.0" })).toEqual([]);
    });
});
