/**
 * The resolve cache answers on Node's behalf, so the property that matters is
 * that it answers what Node would. The unit tests pin each rule; the
 * equivalence test runs the cache next to Node's own resolver, in a real Node
 * process (jest's module sandbox has no native loader to hook), over every
 * relative import in drizzle-orm, zod and hono, and over a fixture of the
 * awkward cases.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { pathToFileURL } from "url";
import { preservesSymlinks, resolveRelativeModule, scopeTypeOf } from "./esm-resolve-cache";

const PACKAGE_ROOT = path.resolve(__dirname, "../..");
const REPO_ROOT = path.resolve(PACKAGE_ROOT, "../..");

let scratch: string;

beforeEach(() => {
    scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "esm-resolve-cache-")));
});

afterEach(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
});

function write(relative: string, contents: string): string {
    const file = path.join(scratch, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
    return file;
}

/**
 * A `"type": "module"` package with every case the resolver must either answer
 * exactly as Node does or leave to Node.
 */
function writeFixture(): string {
    write("pkg/package.json", JSON.stringify({ name: "fx", type: "module", exports: { ".": "./entry.js" } }));
    write("pkg/entry.js", [
        "import { b } from \"./b.js\";",
        "import { c } from \"./sub/c.js\";",
        "import { linked } from \"./link.js\";",
        "import { deep } from \"../pkg/deep/d.js\";",
        "import { t } from \"./typeless/t.js\";",
        "export const all = [b, c, linked, deep, t].join(\",\");"
    ].join("\n"));
    write("pkg/b.js", "export const b = \"b\";");
    write("pkg/sub/package.json", JSON.stringify({ type: "commonjs" }));
    write("pkg/sub/c.js", "exports.c = \"c\";");
    write("pkg/real.js", "export const linked = \"linked\";");
    fs.symlinkSync(path.join(scratch, "pkg/real.js"), path.join(scratch, "pkg/link.js"));
    write("pkg/deep/d.js", "export const deep = \"deep\";");
    write("pkg/typeless/package.json", JSON.stringify({ name: "typeless" }));
    write("pkg/typeless/t.js", "export const t = \"t\";");
    fs.mkdirSync(path.join(scratch, "pkg/folder.js"));
    return path.join(scratch, "pkg/entry.js");
}

const IMPORT = { conditions: ["node", "import"] };

describe("scopeTypeOf", () => {
    it("reads the nearest package.json", () => {
        write("a/package.json", JSON.stringify({ type: "module" }));
        write("a/b/package.json", JSON.stringify({ type: "commonjs" }));
        const cache = new Map();
        expect(scopeTypeOf(path.join(scratch, "a/x/y/file.js"), cache)).toBe("module");
        expect(scopeTypeOf(path.join(scratch, "a/b/file.js"), cache)).toBe("other");
    });

    it("treats a package.json without a type, or one that does not parse, as not a module scope", () => {
        write("typeless/package.json", JSON.stringify({ name: "x" }));
        write("broken/package.json", "{ \"type\": \"module\",");
        const cache = new Map();
        expect(scopeTypeOf(path.join(scratch, "typeless/f.js"), cache)).toBe("other");
        expect(scopeTypeOf(path.join(scratch, "broken/f.js"), cache)).toBe("other");
    });

    it("never reads a package.json directly inside node_modules, as Node does not", () => {
        write("package.json", JSON.stringify({ type: "module" }));
        write("node_modules/package.json", JSON.stringify({ type: "module" }));
        expect(scopeTypeOf(path.join(scratch, "node_modules/loose.js"), new Map())).toBe("other");
    });

    it("answers every directory it walked through from the cache afterwards", () => {
        write("p/package.json", JSON.stringify({ type: "module" }));
        const cache = new Map();
        scopeTypeOf(path.join(scratch, "p/a/b/f.js"), cache);
        expect(cache.get(path.join(scratch, "p/a/b"))).toBe("module");
        expect(cache.get(path.join(scratch, "p/a"))).toBe("module");
        expect(cache.get(path.join(scratch, "p"))).toBe("module");
        // The file changing is not seen: Node caches the file for the process too.
        write("p/package.json", JSON.stringify({ type: "commonjs" }));
        expect(scopeTypeOf(path.join(scratch, "p/a/f.js"), cache)).toBe("module");
    });
});

describe("resolveRelativeModule", () => {
    it("answers a relative .js import in a module package with Node's URL and format", () => {
        const entry = writeFixture();
        const parentURL = pathToFileURL(entry).href;
        expect(resolveRelativeModule("./b.js", { parentURL, ...IMPORT }, new Map())).toEqual({
            url: pathToFileURL(path.join(scratch, "pkg/b.js")).href,
            format: "module",
            shortCircuit: true
        });
    });

    it("answers a symlink with the real path, as Node does without --preserve-symlinks", () => {
        const entry = writeFixture();
        const result = resolveRelativeModule("./link.js", { parentURL: pathToFileURL(entry).href, ...IMPORT }, new Map());
        expect(result?.url).toBe(pathToFileURL(path.join(scratch, "pkg/real.js")).href);
    });

    it.each([
        ["a bare specifier", "fx"],
        ["an .mjs file", "./b.mjs"],
        ["a query", "./b.js?v=1"],
        ["a hash", "./b.js#x"],
        ["a percent-escape", "./b%2Ejs"],
        ["a CommonJS scope", "./sub/c.js"],
        ["a typeless package", "./typeless/t.js"],
        ["a missing file", "./missing.js"],
        ["a directory named like a file", "./folder.js"]
    ])("leaves %s to Node", (_case, specifier) => {
        const entry = writeFixture();
        expect(resolveRelativeModule(specifier, { parentURL: pathToFileURL(entry).href, ...IMPORT }, new Map())).toBeUndefined();
    });

    it("leaves require() and non-file parents to Node", () => {
        const entry = writeFixture();
        const parentURL = pathToFileURL(entry).href;
        expect(resolveRelativeModule("./b.js", { parentURL, conditions: ["node", "require"] }, new Map())).toBeUndefined();
        expect(resolveRelativeModule("./b.js", { parentURL: "data:text/javascript,", ...IMPORT }, new Map())).toBeUndefined();
        expect(resolveRelativeModule("./b.js", { parentURL: undefined, ...IMPORT }, new Map())).toBeUndefined();
    });
});

describe("preservesSymlinks", () => {
    it("sees the flag on the command line and in NODE_OPTIONS", () => {
        expect(preservesSymlinks(["--preserve-symlinks"], undefined)).toBe(true);
        expect(preservesSymlinks([], "--max-old-space-size=256 --preserve-symlinks")).toBe(true);
        expect(preservesSymlinks(["--preserve-symlinks-main"], "--enable-source-maps")).toBe(false);
        expect(preservesSymlinks([], undefined)).toBe(false);
    });
});

describe("against Node's own resolver", () => {
    /**
     * Every relative import Node resolves while loading these graphs is also
     * answered by the cache, and the two answers compared. Node's answer is the
     * one used, so a mismatch cannot hide behind a load that happens to work.
     */
    it("returns the same URL and format for every import it answers", () => {
        const entry = writeFixture();
        const hookModule = pathToFileURL(path.join(__dirname, "esm-resolve-cache.ts")).href;
        const script = `
            import { registerHooks } from "node:module";
            const { resolveRelativeModule } = await import(${JSON.stringify(hookModule)});
            const cache = new Map();
            let compared = 0;
            const mismatches = [];
            registerHooks({
                resolve(specifier, context, nextResolve) {
                    const fast = resolveRelativeModule(specifier, context, cache);
                    let real;
                    try {
                        real = nextResolve(specifier, context);
                    } catch (error) {
                        if (fast) mismatches.push({ specifier, parent: context.parentURL, fast, nodeError: error.code });
                        throw error;
                    }
                    if (fast) {
                        compared++;
                        if (fast.url !== real.url || fast.format !== real.format) {
                            mismatches.push({ specifier, parent: context.parentURL, fast, node: real });
                        }
                    }
                    return real;
                }
            });
            const loaded = await import(${JSON.stringify(pathToFileURL(entry).href)});
            for (const specifier of ["./missing.js", "./folder.js", "./b.js?v=1"]) {
                await import(new URL(specifier, ${JSON.stringify(pathToFileURL(entry).href)}).href).catch(() => {});
            }
            await import("drizzle-orm");
            await import("drizzle-orm/pg-core");
            await import("drizzle-orm/node-postgres");
            await import("zod");
            await import("hono");
            await import("hono/cors");
            process.stdout.write(JSON.stringify({ compared, mismatches, all: loaded.all }));
        `;
        const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
            cwd: PACKAGE_ROOT,
            encoding: "utf8",
            env: { ...process.env, NODE_OPTIONS: "" }
        });
        const result: { compared: number; mismatches: unknown[]; all: string } = JSON.parse(out);
        expect(result.mismatches).toEqual([]);
        expect(result.all).toBe("b,c,linked,deep,t");
        // drizzle-orm alone is a couple of hundred files; a handful would mean
        // the fast path silently stopped applying.
        expect(result.compared).toBeGreaterThan(200);
    });

    it("loads a graph with the hook installed exactly as without it", () => {
        const entry = writeFixture();
        const hookModule = pathToFileURL(path.join(__dirname, "esm-resolve-cache.ts")).href;
        const script = `
            const { installEsmResolveCache } = await import(${JSON.stringify(hookModule)});
            const first = installEsmResolveCache();
            const second = installEsmResolveCache();
            const loaded = await import(${JSON.stringify(pathToFileURL(entry).href)});
            const { pgTable, text } = await import("drizzle-orm/pg-core");
            const table = pgTable("t", { name: text("name") });
            process.stdout.write(JSON.stringify({ first, second, all: loaded.all, column: table.name.name }));
        `;
        const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
            cwd: PACKAGE_ROOT,
            encoding: "utf8",
            env: { ...process.env, NODE_OPTIONS: "" }
        });
        expect(JSON.parse(out)).toEqual({ first: true, second: false, all: "b,c,linked,deep,t", column: "name" });
    });
});

describe("the runtime's entrypoints", () => {
    /**
     * The cache only helps the modules resolved after it is installed, and a
     * static import is resolved before any line of the importing file runs. So
     * each entrypoint installs it and only then imports the server, dynamically.
     */
    it.each([
        ["the rebase-server bin", path.join(PACKAGE_ROOT, "bin/rebase-server.js"), "../dist/index.es.js"],
        ["the container entrypoint", path.join(REPO_ROOT, "infra/docker/entrypoint.mjs"), "\"@rebasepro/server\""]
    ])("%s installs the cache before importing the server", (_name, file, serverImport) => {
        const source = fs.readFileSync(file, "utf8");
        const install = source.indexOf("installEsmResolveCache();");
        const server = source.indexOf(`await import(${serverImport.startsWith("\"") ? serverImport : JSON.stringify(serverImport)})`);
        expect(install).toBeGreaterThan(-1);
        expect(server).toBeGreaterThan(install);
        expect(source).not.toMatch(/^import [^;]*from "(\.\.\/dist\/index\.es\.js|@rebasepro\/server)";/m);
    });
});
