import fs from "fs";
import os from "os";
import path from "path";

import { backendImportMessage, bundleOutputSources, fileOfModuleId, findProjectBackendDir, assertInlineLimitKept, htmlReferencedPaths, isModuleInDir, neverInlineUnder, rebaseBackendGuard, realPath, referencedPaths } from "../src/backend_guard";

/** The pieces of `rebaseBackendGuard` a build does not show one by one. */

function tree(files: Record<string, string>): string {
    const root = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), "backend-guard-"));
    for (const [rel, text] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
        fs.writeFileSync(path.join(root, rel), text);
    }
    return root;
}

describe("findProjectBackendDir", () => {
    it("walks up from the Vite root to the directory with rebase.json", () => {
        const root = tree({ "rebase.json": "{}", "backend/index.ts": "", "frontend/package.json": "{}" });
        expect(findProjectBackendDir(path.join(root, "frontend"))).toBe(path.join(root, "backend"));
    });

    it("takes a package.json beside a backend/ as the project, as the CLI does", () => {
        const root = tree({ "package.json": "{}", "backend/index.ts": "", "apps/admin/package.json": "{}" });
        expect(findProjectBackendDir(path.join(root, "apps/admin"))).toBe(path.join(root, "backend"));
    });

    it("finds nothing for a project without backend/", () => {
        const root = tree({ "rebase.json": "{}", "frontend/package.json": "{}" });
        expect(findProjectBackendDir(path.join(root, "frontend"))).toBeUndefined();
    });
});

describe("fileOfModuleId", () => {
    it("drops the query and the dev server's /@fs prefix", () => {
        expect(fileOfModuleId("/p/backend/x.ts?raw")).toBe("/p/backend/x.ts");
        expect(fileOfModuleId("/@fs/p/backend/x.ts?import")).toBe("/p/backend/x.ts");
    });

    it("names no file for a virtual module or a bare specifier", () => {
        expect(fileOfModuleId("\0commonjsHelpers.js")).toBeUndefined();
        expect(fileOfModuleId("virtual:rebase")).toBeUndefined();
        expect(fileOfModuleId("react")).toBeUndefined();
    });
});

describe("isModuleInDir", () => {
    it("follows a symlink into the backend, and keeps a sibling with a longer name out", () => {
        const root = tree({ "backend/schema/posts.ts": "", "backend-tools/x.ts": "", "frontend/src/main.ts": "" });
        fs.mkdirSync(path.join(root, "frontend/node_modules"));
        fs.symlinkSync(path.join(root, "backend"), path.join(root, "frontend/node_modules/app-backend"), "dir");
        const backend = realPath(path.join(root, "backend"));
        expect(isModuleInDir(path.join(root, "frontend/node_modules/app-backend/schema/posts.ts"), backend)).toBe(true);
        expect(isModuleInDir(path.join(root, "backend-tools/x.ts"), backend)).toBe(false);
        expect(isModuleInDir(path.join(root, "frontend/src/main.ts"), backend)).toBe(false);
    });

    it("judges a path that does not exist by its nearest existing ancestor", () => {
        const root = tree({ "backend/index.ts": "" });
        expect(isModuleInDir(path.join(root, "backend/not/yet.ts"), realPath(path.join(root, "backend")))).toBe(true);
    });
});

describe("backendImportMessage", () => {
    it("names the importer, the import as written, the backend file, and what to write instead", () => {
        const message = backendImportMessage({
            projectRoot: "/p",
            importer: "/p/frontend/src/cms/posts.tsx",
            specifier: "../../../backend/schema/posts",
            resolved: "/p/backend/schema/posts.ts"
        });
        expect(message).toContain("frontend/src/cms/posts.tsx imports \"../../../backend/schema/posts\", which resolves to backend/schema/posts.ts");
        expect(message).toContain("import type { … } from \"../../../backend/schema/posts\"");
        expect(message).toContain("outside backend/");
    });
});

describe("referencedPaths: what a module names outside its imports", () => {
    it("reads every `new URL(literal, import.meta.url)` of a script, but not a template with a placeholder (a glob)", () => {
        const code = [
            "const a = new URL(\"../../backend/a.ts\", import.meta.url);",
            "const b = new URL( '../img/logo.png' , import.meta.url );",
            "const c = new URL(`../../backend/c.json`, import.meta.url);",
            "const d = new URL(`../../backend/${name}.ts`, import.meta.url);",
            "const e = new URL(\"https://example.com/x\", import.meta.url);",
            "new Worker(new URL(\"./worker.ts\", import.meta.url));"
        ].join("\n");
        expect(referencedPaths(code, "/p/frontend/src/main.ts")).toEqual(["../../backend/a.ts", "../img/logo.png", "../../backend/c.json", "./worker.ts"]);
        expect(referencedPaths("new URL(\"./x\", base)", "/p/frontend/src/main.ts")).toEqual([]);
    });

    it("reads a stylesheet's @import / @use and url(), skipping data:, remote and fragment URLs", () => {
        const css = [
            "@import \"../../backend/theme.css\";",
            "@import url('./local.css');",
            "@use \"../../backend/tokens\";",
            ".a { background: url(../../backend/bg.png) }",
            ".b { background: url(\"data:image/png;base64,AAAA\") }",
            ".c { background: url(https://cdn.example/x.png) }",
            ".d { filter: url(#blur) }"
        ].join("\n");
        expect(referencedPaths(css, "/p/frontend/src/app.scss")).toEqual(["../../backend/theme.css", "./local.css", "../../backend/tokens", "../../backend/bg.png"]);
    });

    it("reads every src, href and srcset candidate of an HTML page", () => {
        const html = "<link href=\"../backend/a.css\"><img src='../backend/b.png' srcset=\"../backend/c.png 1x, ./d.png 2x\"><a href=\"https://x\">";
        expect(htmlReferencedPaths(html)).toEqual(["../backend/a.css", "../backend/b.png", "../backend/c.png", "./d.png"]);
    });

    it("words a reference apart from an import: nothing to write as a type import", () => {
        const message = backendImportMessage({
            projectRoot: "/p", importer: "/p/frontend/src/main.ts", specifier: "../../backend/a.ts", resolved: "/p/backend/a.ts", reference: true
        });
        expect(message).toContain("frontend/src/main.ts references \"../../backend/a.ts\", which resolves to backend/a.ts");
        expect(message).not.toContain("import type");
        expect(message).toContain("Move the file");
    });
});

describe("bundleOutputSources (the generateBundle net, SEC-FIX-4 R-3)", () => {
    it("reads an asset's sources against the Vite root, as Vite names them, so a backend asset is matched", () => {
        const root = tree({ "rebase.json": "{}", "backend/data/x.json": "{}", "frontend/package.json": "{}" });
        const sources = bundleOutputSources({ type: "asset", originalFileNames: ["../backend/data/x.json"] }, path.join(root, "frontend"));
        expect(sources).toEqual([path.join(root, "backend/data/x.json")]);
        expect(isModuleInDir(sources[0], path.join(root, "backend"))).toBe(true);
    });

    it("takes a chunk's module ids and an absolute source as they are", () => {
        expect(bundleOutputSources({ type: "chunk", moduleIds: ["/p/a.ts"] }, "/r")).toEqual(["/p/a.ts"]);
        expect(bundleOutputSources({ type: "asset", originalFileNames: ["/p/b.json"] }, "/r")).toEqual(["/p/b.json"]);
    });
});

describe("neverInlineUnder (FINAL-FIX-PRODUCT L-2)", () => {
    const backend = (file: string) => file.startsWith("/p/backend/");
    const bytes = (n: number) => Buffer.alloc(n);

    it("never inlines a backend file, whatever the project's own setting", () => {
        for (const own of [undefined, 1_000_000, () => true]) {
            const limit = neverInlineUnder(own, backend);
            expect(typeof limit === "function" ? limit("/p/backend/data/small.png", bytes(4)) : limit).toBe(false);
        }
    });

    it("decides every other file as the project's setting does", () => {
        const byNumber = neverInlineUnder(10, backend);
        const byFunction = neverInlineUnder(file => file.endsWith(".svg") ? false : undefined, backend);
        const byDefault = neverInlineUnder(undefined, backend);
        if (typeof byNumber !== "function" || typeof byFunction !== "function" || typeof byDefault !== "function") throw new Error("a function");
        expect(byNumber("/p/frontend/a.png", bytes(9))).toBe(true);
        expect(byNumber("/p/frontend/a.png", bytes(10))).toBe(false);
        expect(byFunction("/p/frontend/a.svg", bytes(1))).toBe(false);
        expect(byFunction("/p/frontend/a.png", bytes(1))).toBeUndefined();
        // Absent: Vite's own default limit decides.
        expect(byDefault("/p/frontend/a.png", bytes(1))).toBeUndefined();
    });
});

describe("a plugin that replaces the guard's inline limit (security look 5, I-1)", () => {
    /** The guard's own `config` result, as Vite would merge it. */
    function guardLimit(): unknown {
        const plugin = rebaseBackendGuard();
        const hook = plugin.config;
        const run = typeof hook === "function" ? hook : hook?.handler;
        if (!run) throw new Error("the guard has a config hook");
        const result: unknown = Reflect.apply(run, {}, [{}, { command: "build", mode: "production" }]);
        if (typeof result !== "object" || result === null || !("build" in result)) throw new Error("the guard sets build");
        const build: unknown = result.build;
        if (typeof build !== "object" || build === null || !("assetsInlineLimit" in build)) throw new Error("the guard sets the limit");
        return build.assetsInlineLimit;
    }

    it("fails the build, naming the guard, when another plugin overwrote it", () => {
        const own = neverInlineUnder(undefined, () => false);
        const overwritten = () => true;
        expect(() => assertInlineLimitKept({ build: { assetsInlineLimit: overwritten } }, own)).toThrow(/rebase-backend-guard.*assetsInlineLimit/s);
        expect(() => assertInlineLimitKept({ build: { assetsInlineLimit: 100_000_000 } }, own)).toThrow(/rebase-backend-guard/);
    });

    it("passes when the limit is still the guard's own", () => {
        const own = neverInlineUnder(4096, () => false);
        expect(() => assertInlineLimitKept({ build: { assetsInlineLimit: own } }, own)).not.toThrow();
        expect(typeof guardLimit()).toBe("function");
    });
});
