import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    collectDeclaredDependencies,
    detectNativeDependencies,
    detectStorageAuthorize,
    findUnusedServerEntry,
    foldStaticIntoBundle,
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

    it("omits a plain-range dep that resolves to an in-repo workspace package", () => {
        // The standard case: the backend depends on the `config` package by name
        // with a plain `"*"` (not `workspace:`), symlinked to `../config`. It
        // travels *inside* the bundle, so declaring it would make the runtime
        // try — and fail — to `npm install` it from the registry.
        write("config/package.json", JSON.stringify({ name: "dadaki-config" }));
        write("backend/package.json", JSON.stringify({
            dependencies: { "dadaki-config": "*", pg: "^8.0.0" }
        }));
        fs.mkdirSync(path.join(scratch, "backend/node_modules"), { recursive: true });
        fs.symlinkSync(
            path.join("..", "..", "config"),
            path.join(scratch, "backend/node_modules/dadaki-config")
        );

        expect(collectDeclaredDependencies(scratch)).toEqual({ pg: "^8.0.0" });
    });

    it("keeps a plain-range dep that resolves to a real registry install", () => {
        // A registry package's node_modules entry is a real directory, not a link
        // back into the repo — it must stay in the declared set.
        write("backend/package.json", JSON.stringify({ dependencies: { leftpad: "^1.0.0" } }));
        write("backend/node_modules/leftpad/package.json", JSON.stringify({ name: "leftpad" }));

        expect(collectDeclaredDependencies(scratch)).toEqual({ leftpad: "^1.0.0" });
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

/**
 * `rebase dev` runs `backend/src/index.ts` when a project has one; a bundle
 * never does. A project with routes in that file therefore worked locally,
 * built clean and 404'd in production, with nothing said anywhere.
 */
describe("detecting a server entrypoint the bundle ignores", () => {
    it("finds the conventional entrypoint", () => {
        write("backend/src/index.ts", "export default {};");
        expect(findUnusedServerEntry(scratch, "backend/functions")).toBe("backend/src/index.ts");
    });

    it("finds one beside relocated functions", () => {
        write("api/src/index.ts", "export default {};");
        expect(findUnusedServerEntry(scratch, "api/functions")).toBe("api/src/index.ts");
    });

    it("says nothing when the project has no entrypoint of its own", () => {
        write("backend/functions/hello.ts", "export default {};");
        expect(findUnusedServerEntry(scratch, "backend/functions")).toBeUndefined();
    });
});

describe("storage access-control detection", () => {
    const write = (contents: string): string => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-storage-detect-"));
        fs.writeFileSync(path.join(dir, "index.js"), contents);
        return dir;
    };

    it("finds a directly exported hook", () => {
        expect(detectStorageAuthorize(write("export const storageAuthorize = () => true;"))).toBe(true);
        expect(detectStorageAuthorize(write("export function storageAuthorize() {}"))).toBe(true);
        expect(detectStorageAuthorize(write("export async function storageAuthorize() {}"))).toBe(true);
    });

    it("finds it in an export clause, renamed or re-exported", () => {
        expect(detectStorageAuthorize(write("export { storageAuthorize };"))).toBe(true);
        expect(detectStorageAuthorize(write('export { authz as storageAuthorize } from "./storage.js";'))).toBe(true);
        expect(detectStorageAuthorize(write("export { collections, storageAuthorize, callbacks };"))).toBe(true);
    });

    it("does not claim a hook that is only mentioned", () => {
        // The failure that matters: reporting `true` for a bundle without a hook
        // hands back the crash loop this field exists to prevent.
        expect(detectStorageAuthorize(write("// TODO: add storageAuthorize\nexport const collections = [];"))).toBe(false);
        expect(detectStorageAuthorize(write("const storageAuthorize = () => true;"))).toBe(false);
        expect(detectStorageAuthorize(write('export { storageAuthorizeHelper } from "./x.js";'))).toBe(false);
    });

    it("reports false when there is no config index at all", () => {
        expect(detectStorageAuthorize(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-empty-")))).toBe(false);
    });
});

describe("folding a frontend into the backend bundle", () => {
    function bundleWith(manifest: Record<string, unknown>): string {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-fold-bundle-"));
        fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest));
        return dir;
    }

    function assets(files: Record<string, string>): string {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-fold-assets-"));
        for (const [name, contents] of Object.entries(files)) {
            const full = path.join(dir, name);
            fs.mkdirSync(path.dirname(full), { recursive: true });
            fs.writeFileSync(full, contents);
        }
        return dir;
    }

    it("copies the assets in and records them in the manifest", () => {
        // The runtime finds the site through `entry.static`, not by guessing a
        // directory name — so copying without recording serves nothing.
        const bundleDir = bundleWith({ bundleFormat: 1, app: "backend", entry: { config: "config" } });
        const assetsDir = assets({ "index.html": "<html>", "assets/app.js": "//", "assets/logo.svg": "<svg>" });

        const { fileCount } = foldStaticIntoBundle({ bundleDir, assetsDir });

        expect(fileCount).toBe(3);
        expect(fs.existsSync(path.join(bundleDir, "static", "index.html"))).toBe(true);
        expect(fs.existsSync(path.join(bundleDir, "static", "assets", "app.js"))).toBe(true);
        const manifest = JSON.parse(fs.readFileSync(path.join(bundleDir, "manifest.json"), "utf8"));
        expect(manifest.entry.static).toBe("static");
        // And it does not lose what was already there.
        expect(manifest.entry.config).toBe("config");
    });

    it("replaces a previous fold rather than merging into it", () => {
        // A stale asset from the last build served alongside the new ones is a
        // cache bug that survives a deploy, which is the worst kind.
        const bundleDir = bundleWith({ bundleFormat: 1, app: "backend", entry: {} });
        foldStaticIntoBundle({ bundleDir, assetsDir: assets({ "old.html": "old" }) });
        foldStaticIntoBundle({ bundleDir, assetsDir: assets({ "new.html": "new" }) });

        expect(fs.existsSync(path.join(bundleDir, "static", "new.html"))).toBe(true);
        expect(fs.existsSync(path.join(bundleDir, "static", "old.html"))).toBe(false);
    });

    it("refuses a bundle that has not been built", () => {
        const empty = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-fold-empty-"));
        expect(() => foldStaticIntoBundle({ bundleDir: empty, assetsDir: assets({ "a.html": "a" }) }))
            .toThrow(/build the backend bundle first/i);
    });

    it("refuses assets that do not exist, rather than shipping an empty site", () => {
        const bundleDir = bundleWith({ bundleFormat: 1, app: "backend", entry: {} });
        expect(() => foldStaticIntoBundle({ bundleDir, assetsDir: path.join(bundleDir, "nope") }))
            .toThrow(/No built assets/i);
    });
});
