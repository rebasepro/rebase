import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    collectDeclaredDependencies,
    detectFrameworkDepDrift,
    detectNativeDependencies,
    detectStorageAuthorize,
    findUnusedServerEntry,
    foldStaticIntoBundle,
    normalizeEsmSpecifiers,
    vendorDependencies,
    VENDOR_SIZE_MAX_BYTES
} from "./bundle";

let scratch: string;

beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-bundle-build-"));
});

afterEach(() => {
    fs.rmSync(scratch, { recursive: true,
force: true });
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
        // Not zod: the image supplies that one, and a bundle carrying a second
        // copy makes `loadEnv({ extend })` reject every defaulted field. See
        // RUNTIME_PROVIDED, and the test below.
        write("backend/package.json", JSON.stringify({ dependencies: { pg: "^8.0.0" } }));
        write("config/package.json", JSON.stringify({ dependencies: { dayjs: "^1.11.0" } }));

        expect(collectDeclaredDependencies(scratch)).toEqual({ pg: "^8.0.0",
dayjs: "^1.11.0" });
    });

    it("omits packages the runtime image already provides", () => {
        // Installing a second copy of the server beside the one running the
        // process is wasted space at best and a version conflict at worst.
        write("backend/package.json", JSON.stringify({
            dependencies: { "@rebasepro/server": "^0.11.0",
hono: "^4.0.0",
pg: "^8.0.0" }
        }));

        expect(collectDeclaredDependencies(scratch)).toEqual({ pg: "^8.0.0" });
    });

    it("omits workspace protocol versions, which mean nothing outside the repo", () => {
        write("backend/package.json", JSON.stringify({
            dependencies: { "my-config": "workspace:*",
pg: "^8.0.0" }
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
            dependencies: { "dadaki-config": "*",
pg: "^8.0.0" }
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
        write("config/package.json", JSON.stringify({ dependencies: { dayjs: "^1.11.0" } }));

        expect(collectDeclaredDependencies(scratch)).toEqual({ dayjs: "^1.11.0" });
    });

    it("strips zod, which the image supplies", () => {
        // A project declaring zod is completely ordinary — it is how you extend
        // `loadEnv`. Carrying it into the bundle is what breaks: the schema is
        // then built by a different zod than the one parsing it, every
        // `.default()` is rejected, and the deploy reports success while running
        // no crons.
        write("backend/package.json", JSON.stringify({ dependencies: { zod: "^4.0.0", pg: "^8.0.0" } }));

        expect(collectDeclaredDependencies(scratch)).toEqual({ pg: "^8.0.0" });
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
        write("node_modules/a/package.json", JSON.stringify({ name: "a",
dependencies: { b: "1" } }));
        write("node_modules/b/package.json", JSON.stringify({ name: "b",
dependencies: { a: "1" } }));

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

    const fold = (bundleDir: string, assetsDir: string, over: Partial<{
        appName: string;
        path: string;
        spa: boolean;
    }> = {}) => foldStaticIntoBundle({
        bundleDir,
        assetsDir,
        appName: over.appName ?? "web",
        path: over.path ?? "/",
        spa: over.spa ?? true
    });

    it("copies the assets in and records them in the manifest", () => {
        // The runtime finds the site through `entry.static`, not by guessing a
        // directory name — so copying without recording serves nothing.
        const bundleDir = bundleWith({ bundleFormat: 1,
app: "backend",
entry: { config: "config" } });
        const assetsDir = assets({ "index.html": "<html>",
"assets/app.js": "//",
"assets/logo.svg": "<svg>" });

        const { fileCount } = fold(bundleDir, assetsDir);

        expect(fileCount).toBe(3);
        expect(fs.existsSync(path.join(bundleDir, "static", "web", "index.html"))).toBe(true);
        expect(fs.existsSync(path.join(bundleDir, "static", "web", "assets", "app.js"))).toBe(true);
        const manifest = JSON.parse(fs.readFileSync(path.join(bundleDir, "manifest.json"), "utf8"));
        expect(manifest.entry.static).toEqual([{ path: "/",
dir: "static/web",
spa: true }]);
        // And it does not lose what was already there.
        expect(manifest.entry.config).toBe("config");
    });

    it("appends a second app instead of replacing the first", () => {
        // `entry.static` used to be one string and folding overwrote it, so the
        // second app silently replaced the first — in the tree AND the manifest
        // — and the bundle deployed looking complete.
        const bundleDir = bundleWith({ bundleFormat: 1,
app: "backend",
entry: {} });
        fold(bundleDir, assets({ "index.html": "site" }), { appName: "site",
path: "/" });
        fold(bundleDir, assets({ "index.html": "admin" }), { appName: "admin",
path: "/admin" });

        expect(fs.readFileSync(path.join(bundleDir, "static", "site", "index.html"), "utf8")).toBe("site");
        expect(fs.readFileSync(path.join(bundleDir, "static", "admin", "index.html"), "utf8")).toBe("admin");

        const manifest = JSON.parse(fs.readFileSync(path.join(bundleDir, "manifest.json"), "utf8"));
        expect(manifest.entry.static).toEqual([
            { path: "/",
dir: "static/site",
spa: true },
            { path: "/admin",
dir: "static/admin",
spa: true }
        ]);
    });

    it("replaces a previous fold of the SAME app rather than merging into it", () => {
        // A stale asset from the last build served alongside the new ones is a
        // cache bug that survives a deploy, which is the worst kind.
        const bundleDir = bundleWith({ bundleFormat: 1,
app: "backend",
entry: {} });
        fold(bundleDir, assets({ "old.html": "old" }));
        fold(bundleDir, assets({ "new.html": "new" }));

        expect(fs.existsSync(path.join(bundleDir, "static", "web", "new.html"))).toBe(true);
        expect(fs.existsSync(path.join(bundleDir, "static", "web", "old.html"))).toBe(false);

        const manifest = JSON.parse(fs.readFileSync(path.join(bundleDir, "manifest.json"), "utf8"));
        expect(manifest.entry.static).toHaveLength(1);
    });

    it("does not disturb a sibling app when one is rebuilt", () => {
        const bundleDir = bundleWith({ bundleFormat: 1,
app: "backend",
entry: {} });
        fold(bundleDir, assets({ "index.html": "admin" }), { appName: "admin",
path: "/admin" });
        fold(bundleDir, assets({ "index.html": "site v2" }), { appName: "site",
path: "/" });

        expect(fs.readFileSync(path.join(bundleDir, "static", "admin", "index.html"), "utf8")).toBe("admin");
    });

    it("records spa: false so a static site keeps its 404s", () => {
        const bundleDir = bundleWith({ bundleFormat: 1,
app: "backend",
entry: {} });
        fold(bundleDir, assets({ "index.html": "site" }), { appName: "docs",
path: "/docs",
spa: false });

        const manifest = JSON.parse(fs.readFileSync(path.join(bundleDir, "manifest.json"), "utf8"));
        expect(manifest.entry.static[0].spa).toBe(false);
    });

    it("refuses a bundle that has not been built", () => {
        const empty = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-fold-empty-"));
        expect(() => fold(empty, assets({ "a.html": "a" })))
            .toThrow(/build the backend bundle first/i);
    });

    it("refuses assets that do not exist, rather than shipping an empty site", () => {
        const bundleDir = bundleWith({ bundleFormat: 1,
app: "backend",
entry: {} });
        expect(() => fold(bundleDir, path.join(bundleDir, "nope")))
            .toThrow(/No built assets/i);
    });
});

/*
 * "What `rebase build` does with each runtime" used to live here, asserted by
 * reading `commands/build.ts` as text and matching regexes against it —
 * including an `indexOf` ordering check that a variable rename would break and
 * a genuine behavioural regression would not. It now runs the command:
 * see `commands/build.test.ts`.
 */

/**
 * The declared `@rebasepro/*` versions are the one thing a project can get badly
 * wrong and never find out locally.
 *
 * In development every one of them resolves through pnpm's workspace and `link:`
 * overrides to the checkout on disk, so the version STRINGS are never exercised.
 * They are first honoured when the runtime npm-installs them from a bundle in
 * the cloud — where the image supplies only `@rebasepro/server` and the database
 * driver comes from these declarations. A build warning is the only moment a
 * developer can be told.
 */
describe("detectFrameworkDepDrift", () => {
    it("flags a pin that can never reach the CLI's own version", () => {
        write("package.json", JSON.stringify({
            dependencies: { "@rebasepro/server-postgres": "^0.10.0" }
        }));

        const drift = detectFrameworkDepDrift(scratch, "0.12.0");
        expect(drift.behind.map(d => d.name)).toEqual(["@rebasepro/server-postgres"]);
        expect(drift.behind[0].file).toBe("package.json");
    });

    it("accepts a range that spans the CLI's version", () => {
        write("package.json", JSON.stringify({
            dependencies: { "@rebasepro/server-postgres": "^0.12.0" }
        }));
        expect(detectFrameworkDepDrift(scratch, "0.12.0").behind).toEqual([]);
    });

    it("reads every package.json, because the forgotten one is the problem", () => {
        // They have to be bumped together; the one nobody looks at is the one
        // that strands the deployment.
        write("package.json", JSON.stringify({
            dependencies: { "@rebasepro/server": "^0.12.0" }
        }));
        write("backend/package.json", JSON.stringify({
            dependencies: { "@rebasepro/server-postgres": "^0.10.0" }
        }));
        write("config/package.json", JSON.stringify({
            dependencies: { "@rebasepro/types": "^0.12.0" }
        }));

        const drift = detectFrameworkDepDrift(scratch, "0.12.0");
        expect(drift.behind.map(d => d.file)).toEqual(["backend/package.json"]);
    });

    it("looks in devDependencies too", () => {
        write("package.json", JSON.stringify({
            devDependencies: { "@rebasepro/cli": "0.10.0" }
        }));
        expect(detectFrameworkDepDrift(scratch, "0.12.0").behind).toHaveLength(1);
    });

    it("ignores packages that are not @rebasepro", () => {
        write("package.json", JSON.stringify({
            dependencies: { zod: "^3.0.0",
hono: "1.0.0" }
        }));
        expect(detectFrameworkDepDrift(scratch, "0.12.0").behind).toEqual([]);
    });

    it("says nothing about workspace and link specifiers", () => {
        // Normal inside the monorepo, and not a version range. Guessing at one
        // would produce a warning on every in-repo build, which is how a warning
        // stops being read.
        write("package.json", JSON.stringify({
            dependencies: {
                "@rebasepro/server": "workspace:*",
                "@rebasepro/server-postgres": "link:../server-postgres"
            }
        }));
        const drift = detectFrameworkDepDrift(scratch, "0.12.0");
        expect(drift.behind).toEqual([]);
        expect(drift.disagreeing).toEqual([]);
    });

    it("reports mixed-era pins even when none is behind", () => {
        write("package.json", JSON.stringify({
            dependencies: {
                "@rebasepro/server": "^0.12.0",
                "@rebasepro/cms": "^0.13.0"
            }
        }));
        const drift = detectFrameworkDepDrift(scratch, "0.12.0");
        expect(drift.behind).toEqual([]);
        expect(drift.disagreeing).toEqual(["0.12.0", "0.13.0"]);
    });

    it("does not call a caret and an exact pin of the same version a disagreement", () => {
        write("package.json", JSON.stringify({
            dependencies: {
                "@rebasepro/server": "^0.12.0",
                "@rebasepro/cms": "0.12.0"
            }
        }));
        expect(detectFrameworkDepDrift(scratch, "0.12.0").disagreeing).toEqual([]);
    });

    it("survives an unparseable package.json rather than failing the build", () => {
        write("package.json", "{ not json");
        expect(() => detectFrameworkDepDrift(scratch, "0.12.0")).not.toThrow();
    });
});

/**
 * Vendoring exists to take ~50 seconds off every managed pod start, and every
 * assertion here guards a way it could silently fail to — or silently produce a
 * tree that cannot run where it is going.
 */
describe("vendorDependencies", () => {
    function calls() {
        const ran: { cmd: string; args: string[]; cwd: string }[] = [];
        return {
            ran,
            run: (cmd: string, args: string[], cwd: string) => {
                ran.push({ cmd, args, cwd });
                fs.mkdirSync(path.join(cwd, "node_modules"), { recursive: true });
            }
        };
    }

    it("installs the declared tree into the bundle", () => {
        const { ran, run } = calls();
        const result = vendorDependencies({
            outDir: scratch,
            declared: { zod: "^3.0.0" },
            nativeModules: [],
            run
        });
        expect(result.vendored).toBe(true);
        expect(ran).toHaveLength(1);
        expect(ran[0].cwd).toBe(scratch);
        expect(ran[0].args).toContain("--omit=dev");
        expect(ran[0].args).toContain("--ignore-scripts");
    });

    it("resolves optional dependencies for the runtime image, not the build machine", () => {
        // The failure this prevents is invisible in a dependency list: esbuild is
        // pure JavaScript whose binary lives in a platform-specific optional
        // dependency, so a Mac build produces a tree that dies at import inside a
        // linux/amd64 pod.
        const { ran, run } = calls();
        vendorDependencies({ outDir: scratch, declared: { esbuild: "^0.28.0" }, nativeModules: [], run });
        expect(ran[0].args).toContain("--os=linux");
        expect(ran[0].args).toContain("--cpu=x64");
    });

    it("records the target it resolved for", () => {
        const { run } = calls();
        const result = vendorDependencies({ outDir: scratch, declared: { zod: "^3" }, nativeModules: [], run });
        expect(result.target).toMatchObject({ os: "linux", cpu: "x64" });
        expect(result.target?.node).toMatch(/^\d+$/);
    });

    it("refuses to vendor native code, and says which module", () => {
        const { ran, run } = calls();
        const result = vendorDependencies({
            outDir: scratch,
            declared: { sharp: "^0.33.0" },
            nativeModules: [{ name: "sharp", reason: "known native module" }],
            run
        });
        expect(result.vendored).toBe(false);
        expect(result.skipped).toContain("sharp");
        expect(ran).toHaveLength(0);
    });

    it("does nothing when the bundle declares no dependencies", () => {
        const { ran, run } = calls();
        const result = vendorDependencies({ outDir: scratch, declared: {}, nativeModules: [], run });
        expect(result.vendored).toBe(false);
        expect(ran).toHaveLength(0);
    });

    it("honours --no-vendor", () => {
        const { ran, run } = calls();
        const result = vendorDependencies({
            outDir: scratch, declared: { zod: "^3" }, nativeModules: [], requested: false, run
        });
        expect(result.vendored).toBe(false);
        expect(result.skipped).toContain("--no-vendor");
        expect(ran).toHaveLength(0);
    });

    it("never fails the build when npm fails", () => {
        // A bundle that could not be vendored is exactly what every project
        // shipped before this existed: slower to start, entirely functional.
        // Failing here would trade a working deploy for a faster one that does
        // not happen.
        const result = vendorDependencies({
            outDir: scratch,
            declared: { zod: "^3" },
            nativeModules: [],
            run: () => { throw new Error("ENOENT: npm not found"); }
        });
        expect(result.vendored).toBe(false);
        expect(result.skipped).toContain("npm install failed");
    });

    it("refuses a tree that installed without the driver, and removes it", () => {
        // The init container skips installing when node_modules is present, so
        // an incomplete vendored tree does not start slowly — it does not start.
        // The bundle must be left exactly as an unvendored one.
        const result = vendorDependencies({
            outDir: scratch,
            declared: { zod: "^3" },
            required: ["@rebasepro/server-postgres"],
            nativeModules: [],
            run: (_cmd, _args, cwd) => {
                fs.mkdirSync(path.join(cwd, "node_modules", "zod"), { recursive: true });
                fs.writeFileSync(path.join(cwd, "node_modules", "zod", "package.json"), "{}");
                fs.writeFileSync(path.join(cwd, "package-lock.json"), "{}");
            }
        });

        expect(result.vendored).toBe(false);
        expect(result.skipped).toContain("@rebasepro/server-postgres");
        expect(fs.existsSync(path.join(scratch, "node_modules"))).toBe(false);
        expect(fs.existsSync(path.join(scratch, "package-lock.json"))).toBe(false);
    });

    it("vendors when the driver is in the installed tree", () => {
        const result = vendorDependencies({
            outDir: scratch,
            declared: { "@rebasepro/server-postgres": "^0.16.0" },
            required: ["@rebasepro/server-postgres"],
            nativeModules: [],
            run: (_cmd, _args, cwd) => {
                const dir = path.join(cwd, "node_modules", "@rebasepro", "server-postgres");
                fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(path.join(dir, "package.json"), "{}");
            }
        });

        expect(result.vendored).toBe(true);
        expect(fs.existsSync(path.join(scratch, "node_modules"))).toBe(true);
    });

    it("refuses a tree too large to upload, rather than shipping a 413", () => {
        // The control plane's limit is on the compressed upload and this
        // measures the tree on disk, so the ceiling assumes a pessimistic 2x
        // compression floor. Past it, an unvendored bundle deploys and a
        // vendored one does not.
        const result = vendorDependencies({
            outDir: scratch,
            declared: { huge: "^1" },
            nativeModules: [],
            run: (_cmd, _args, cwd) => {
                const dir = path.join(cwd, "node_modules", "huge");
                fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(path.join(dir, "package.json"), "{}");
                fs.writeFileSync(path.join(dir, "blob.bin"), Buffer.alloc(VENDOR_SIZE_MAX_BYTES + 1024));
            }
        });

        expect(result.vendored).toBe(false);
        expect(result.skipped).toContain("100 MB");
        expect(fs.existsSync(path.join(scratch, "node_modules"))).toBe(false);
    });

    it("keeps an oversized tree when vendoring was asked for explicitly", () => {
        // `--vendor` is the deploy that builds from source: the tree is copied
        // into an image and the upload the ceiling protects never happens.
        const result = vendorDependencies({
            outDir: scratch,
            declared: { huge: "^1" },
            nativeModules: [],
            requested: true,
            run: (_cmd, _args, cwd) => {
                const dir = path.join(cwd, "node_modules", "huge");
                fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(path.join(dir, "package.json"), "{}");
                fs.writeFileSync(path.join(dir, "blob.bin"), Buffer.alloc(VENDOR_SIZE_MAX_BYTES + 1024));
            }
        });

        expect(result.vendored).toBe(true);
        expect(fs.existsSync(path.join(scratch, "node_modules"))).toBe(true);
    });

    it("does not claim success when npm exits 0 but installs nothing", () => {
        const result = vendorDependencies({
            outDir: scratch,
            declared: { zod: "^3" },
            nativeModules: [],
            run: () => { /* exits cleanly, writes no node_modules */ }
        });
        expect(result.vendored).toBe(false);
        expect(result.skipped).toContain("no node_modules");
    });
});
