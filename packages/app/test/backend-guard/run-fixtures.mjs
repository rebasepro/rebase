/**
 * Builds a small Rebase-shaped project once per import form, with Vite —
 * the repository's own — and reports what happened, as JSON on stdout.
 *
 * Run by `backend_guard_build.test.ts` in a child process: Vite 8 is ESM
 * only, and this package's Jest runs CommonJS. The guard is imported from
 * source (Node strips the types).
 *
 * Every form is built twice:
 *
 * - with `rebaseBackendGuard()`: the build must fail, naming the importer and
 *   the backend file;
 * - without it (the control): the build must succeed and its output must
 *   contain the marker the backend hook file sets at load — proof that the
 *   form really ships backend code, so the guarded build failing means
 *   something.
 *
 * Forms that do not put backend code in the bundle at all (a `require` the
 * bundler cannot see, a dynamic `import()` of a variable) are built the same
 * way; their control shows no marker and the result says so.
 *
 *     node --experimental-strip-types test/backend-guard/run-fixtures.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build, createServer } from "vite";

import { rebaseBackendGuard } from "../../src/backend_guard.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
/** What the backend hook file sets at module scope: in the bundle means the hook shipped. */
export const MARKER = "REBASE_BACKEND_HOOK_MARKER_7d41";

/** The reviewer's ten forms (security review S-2), then the ones the guard adds. */
const FORMS = {
    "relative": "import { posts } from \"../../backend/schema/posts\";\nconsole.log(posts);",
    "glob-eager": "const m = import.meta.glob(\"../../backend/schema/*.ts\", { eager: true });\nconsole.log(m);",
    "package-imports": "import { posts } from \"#backend/schema/posts\";\nconsole.log(posts);",
    "alias": "import { posts } from \"@backend/schema/posts\";\nconsole.log(posts);",
    "package-name": "import { posts } from \"rebase-app-backend/schema/posts\";\nconsole.log(posts);",
    "aliased-require": "const r = require;\nconst m = r(\"../../backend/schema/posts\");\nconsole.log(m);",
    "create-require": "import { createRequire } from \"module\";\nconsole.log(createRequire(import.meta.url)(\"../../backend/schema/posts\"));",
    "dynamic-variable": "const p = \"../../backend/schema/posts\";\nimport(p).then(console.log);",
    "absolute": "import { posts } from \"__ROOT__/backend/schema/posts\";\nconsole.log(posts);",
    "sibling-reexport": "import { posts } from \"../../shared/reexports-backend\";\nconsole.log(posts);",
    // Beyond the ten.
    "glob-lazy": "const m = import.meta.glob(\"../../backend/schema/*.ts\");\nfor (const load of Object.values(m)) load().then(console.log);",
    "raw-query": "import source from \"../../backend/schema/posts.ts?raw\";\nconsole.log(source);",
    "side-effect": "import \"../../backend/schema/posts\";",
    "export-from": "export { posts } from \"../../backend/schema/posts\";",
    "dynamic-literal": "import(\"../../backend/schema/posts\").then(console.log);",
    // A module outside the project (a linked workspace package) that imports the backend.
    "outside-project": "import { posts } from \"__ROOT__-outside/lib\";\nconsole.log(posts);",
    "package-name-preserve-symlinks": "import { posts } from \"rebase-app-backend/schema/posts\";\nconsole.log(posts);",
    // Ways a Vite build pulls a file in without an `import` statement (SEC-FIX-2 F-5).
    "new-url": "console.log(new URL(\"../../backend/schema/posts.ts\", import.meta.url).href);",
    "new-url-large": "console.log(new URL(\"../../backend/data/large.json\", import.meta.url).href);",
    "new-url-alias": "console.log(new URL(\"@backend/schema/posts.ts\", import.meta.url).href);",
    "new-url-template": "const name = \"posts\";\nconsole.log(new URL(`../../backend/schema/${name}.ts`, import.meta.url).href);",
    "url-query": "import url from \"../../backend/schema/posts.ts?url\";\nconsole.log(url);",
    "url-inline-query": "import url from \"../../backend/schema/posts.ts?url&inline\";\nconsole.log(url);",
    "glob-url": "const m = import.meta.glob(\"../../backend/schema/*.ts\", { query: \"?url\", import: \"default\", eager: true });\nconsole.log(m);",
    "css-inline-query": "import css from \"../../backend/theme.css?inline\";\nconsole.log(css);",
    "css-import": { main: "import \"./leaky.css\";", files: { "frontend/src/leaky.css": "@import \"../../backend/theme.css\";\nbody { color: red; }\n" } },
    "css-url": { main: "import \"./leaky.css\";", files: { "frontend/src/leaky.css": "body { background: url(\"../../backend/schema/posts.ts\"); }\n" } },
    "worker-query": { main: "import W from \"./work.ts?worker\";\nnew W();", files: { "frontend/src/work.ts": "import { posts } from \"../../backend/schema/posts\";\nconsole.log(posts);\n" } },
    "worker-new-url": { main: "new Worker(new URL(\"./work.ts\", import.meta.url), { type: \"module\" });", files: { "frontend/src/work.ts": "import { posts } from \"../../backend/schema/posts\";\nconsole.log(posts);\n" } },
    "worker-backend-file": "new Worker(new URL(\"../../backend/schema/posts.ts\", import.meta.url), { type: \"module\" });",
    "html-asset": { main: "console.log(1);", files: { "frontend/index.html": "<!doctype html><html><body><img src=\"../backend/data/large.json\"><script type=\"module\" src=\"/src/main.ts\"></script></body></html>" } }
};

/** A project that builds clean with the guard on: a type import, a `?raw` text file, CSS, a JSON file. */
const CLEAN = [
    "import type { posts } from \"../../backend/schema/posts\";",
    "import text from \"./notes.txt?raw\";",
    "import data from \"./data.json\";",
    "import \"./style.css\";",
    "const name: typeof posts[\"name\"] = \"posts\";",
    "console.log(name, text, data);"
].join("\n");

function write(root, files) {
    for (const [rel, text] of Object.entries(files)) {
        const file = path.join(root, rel);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, text);
    }
}

/** A project: rebase.json, backend/ (a package with a hook file), shared/, frontend/ (a package). */
function project(base, name, form) {
    const root = path.join(base, name);
    const main = typeof form === "string" ? form : form.main;
    write(root, {
        "rebase.json": JSON.stringify({ rebase: "^1", apps: { backend: { type: "backend" }, admin: { type: "static", root: "frontend" } } }),
        "backend/package.json": JSON.stringify({ name: "rebase-app-backend", type: "module" }),
        "backend/schema/posts.ts": [
            "// A table with a server hook: what must never reach a browser.",
            `(globalThis as Record<string, unknown>).hookMarker = "${MARKER}";`,
            "export const posts = { name: \"posts\" as const, hooks: { beforeSave: () => process.env.SECRET } };"
        ].join("\n"),
        "shared/reexports-backend.ts": "export { posts } from \"../backend/schema/posts\";\n",
        "frontend/package.json": JSON.stringify({
            name: "rebase-app-frontend",
            type: "module",
            private: true,
            imports: { "#backend/*": "rebase-app-backend/*" }
        }),
        "frontend/index.html": "<!doctype html><html><body><div id=\"root\"></div><script type=\"module\" src=\"/src/main.ts\"></script></body></html>",
        "frontend/src/main.ts": main.replaceAll("__ROOT__", root),
        "frontend/src/notes.txt": "plain text",
        "frontend/src/data.json": "{\"a\":1}",
        "frontend/src/style.css": "body { color: red; }",
        "frontend/src/App.tsx": "export function App() { return null; }\n",
        // Non-module backend files a build could pull in as assets: one under
        // the inline limit's reach, one over it, and a stylesheet.
        "backend/data/large.json": JSON.stringify({ marker: MARKER, padding: "x".repeat(8192) }),
        "backend/theme.css": `.secret::after { content: "${MARKER}"; }\n`
    });
    if (typeof form !== "string") write(root, Object.fromEntries(Object.entries(form.files).map(([rel, text]) => [rel, text.replaceAll("__ROOT__", root)])));
    write(`${root}-outside`, { "lib.ts": `export { posts } from ${JSON.stringify(path.join(root, "backend/schema/posts"))};\n` });
    // The workspace link pnpm makes for `"rebase-app-backend": "workspace:*"`.
    fs.mkdirSync(path.join(root, "frontend/node_modules"), { recursive: true });
    fs.symlinkSync(path.join(root, "backend"), path.join(root, "frontend/node_modules/rebase-app-backend"), "dir");
    return root;
}

/** Tiny stand-ins for what the MCP view's boot module imports: React, the CMS's view runtime, Tailwind's utilities. */
function mcpViewStubs(frontend) {
    write(path.join(frontend, "node_modules"), {
        "react/package.json": JSON.stringify({ name: "react", type: "module", exports: { ".": "./index.js", "./jsx-runtime": "./jsx-runtime.js", "./jsx-dev-runtime": "./jsx-runtime.js" } }),
        "react/index.js": "export default {};\n",
        "react/jsx-runtime.js": "export const jsx = (type, props) => ({ type, props }); export const jsxs = jsx; export const jsxDEV = jsx; export const Fragment = \"fragment\";\n",
        "react-dom/package.json": JSON.stringify({ name: "react-dom", type: "module", exports: { "./client": "./client.js" } }),
        "react-dom/client.js": "export function createRoot() { return { render() {} }; }\n",
        "@rebasepro/cms/package.json": JSON.stringify({ name: "@rebasepro/cms", type: "module", exports: { "./mcp-view": "./mcp-view.js" } }),
        "@rebasepro/cms/mcp-view.js": "export function startMcpView(options) { options.mountApp(); }\n",
        "tailwindcss/package.json": JSON.stringify({ name: "tailwindcss", exports: { "./utilities": { style: "./utilities.css", default: "./utilities.css" } } }),
        "tailwindcss/utilities.css": ".flex { display: flex; }\n"
    });
}

function configFor(root, { guard, preserveSymlinks = false, extraPlugins = [] }) {
    return {
        root: path.join(root, "frontend"),
        configFile: false,
        logLevel: "silent",
        resolve: { alias: { "@backend": path.join(root, "backend") }, preserveSymlinks },
        plugins: [...(guard ? [rebaseBackendGuard()] : []), ...extraPlugins],
        build: { outDir: path.join(root, "frontend/dist"), emptyOutDir: true, minify: false, write: true }
    };
}

function readOutput(dir) {
    if (!fs.existsSync(dir)) return "";
    let out = "";
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        out += entry.isDirectory() ? readOutput(full) : fs.readFileSync(full, "utf8");
    }
    // An asset under the inline limit ships as a base64 `data:` URL: decoded,
    // so a file inlined that way counts as shipped.
    for (const [, encoded] of out.matchAll(/data:[^;,"')\s]*;base64,([A-Za-z0-9+/=]+)/g)) {
        out += Buffer.from(encoded, "base64").toString("utf8");
    }
    return out;
}

async function tryBuild(root, options) {
    fs.rmSync(path.join(root, "frontend/dist"), { recursive: true, force: true });
    try {
        await build(configFor(root, options));
        return { ok: true, leaked: readOutput(path.join(root, "frontend/dist")).includes(MARKER) };
    } catch (error) {
        return { ok: false, error: String(error instanceof Error ? error.message : error) };
    }
}

/** Whether the file system under `dir` ignores case (APFS and NTFS by default). */
function caseInsensitive(dir) {
    const probe = path.join(dir, "CaseProbe");
    fs.writeFileSync(probe, "");
    try {
        return fs.existsSync(path.join(dir, "caseprobe"));
    } finally {
        fs.rmSync(probe);
    }
}

async function main() {
    // The real path: on macOS the temporary directory is behind a symlink
    // (/var → /private/var), and Vite works in real paths.
    const base = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), "rebase-backend-guard-"));
    const results = { forms: {}, clean: undefined, dev: {}, mcpView: {}, caseInsensitive: caseInsensitive(base) };
    try {
        const forms = { ...FORMS };
        if (results.caseInsensitive) {
            forms["other-case"] = "import { posts } from \"../../Backend/schema/posts\";\nconsole.log(posts);";
        }
        for (const [form, main] of Object.entries(forms)) {
            const root = project(base, form, main);
            const preserveSymlinks = form === "package-name-preserve-symlinks";
            results.forms[form] = {
                guarded: await tryBuild(root, { guard: true, preserveSymlinks }),
                control: await tryBuild(root, { guard: false, preserveSymlinks })
            };
        }

        const clean = project(base, "clean", CLEAN);
        results.clean = await tryBuild(clean, { guard: true });

        // The MCP view: a second build of the project's App from the same
        // config file. The guard is in that file, so it guards the view: an
        // App the page never imports (so the page's own build passes) but
        // the view mounts must fail the view's build. Stub packages stand in
        // for what the view's boot module imports.
        for (const [name, leaky] of [["mcp-view-clean", false], ["mcp-view-leak", true]]) {
            const viewRoot = project(base, name, CLEAN);
            mcpViewStubs(path.join(viewRoot, "frontend"));
            if (leaky) {
                fs.writeFileSync(path.join(viewRoot, "frontend/src/App.tsx"),
                    "import { posts } from \"../../backend/schema/posts\";\nexport function App() { return posts.name; }\n");
            }
            const viewConfig = path.join(viewRoot, "frontend/vite.config.mjs");
            fs.writeFileSync(viewConfig, [
                `import { rebaseBackendGuard } from ${JSON.stringify(path.join(here, "../../src/backend_guard.ts"))};`,
                `import { rebaseMcpViewPlugin } from ${JSON.stringify(path.join(here, "../../src/vitePlugin.ts"))};`,
                // No CSS minify: without Tailwind's plugin, the view's `@import … source(none)` is not CSS lightningcss reads.
                "export default { logLevel: \"silent\", build: { cssMinify: false }, plugins: [rebaseBackendGuard(), rebaseMcpViewPlugin()] };"
            ].join("\n"));
            try {
                await build({
                    root: path.join(viewRoot, "frontend"),
                    configFile: viewConfig,
                    logLevel: "silent",
                    build: { outDir: path.join(viewRoot, "frontend/dist"), emptyOutDir: true, minify: false }
                });
                results.mcpView[name] = { ok: true, view: fs.existsSync(path.join(viewRoot, "frontend/dist/rebase-view.html")) };
            } catch (error) {
                results.mcpView[name] = { ok: false, error: String(error instanceof Error ? error.message : error) };
            }
        }

        // The dev server: the importing module fails to load, and so does a
        // direct request for a backend file.
        const devRoot = project(base, "dev", FORMS.relative);
        const server = await createServer({
            ...configFor(devRoot, { guard: true }),
            server: { middlewareMode: true, hmr: false, ws: false },
            optimizeDeps: { noDiscovery: true, include: [] }
        });
        try {
            for (const [name, url] of [["importer", "/src/main.ts"], ["fs-request", `/@fs${path.join(devRoot, "backend/schema/posts.ts")}`]]) {
                try {
                    await server.transformRequest(url);
                    results.dev[name] = { ok: true };
                } catch (error) {
                    results.dev[name] = { ok: false, error: String(error instanceof Error ? error.message : error) };
                }
            }
        } finally {
            await server.close();
        }
    } finally {
        fs.rmSync(base, { recursive: true, force: true });
    }
    process.stdout.write(JSON.stringify(results));
}

await main();
