#!/usr/bin/env node
/**
 * Fail a build whose portable entry point is not portable.
 *
 * `@rebasepro/server/functions` exists so a custom function can be written once
 * and run on any JavaScript runtime — Node today, an isolate-based host later,
 * with no change to the function's own code. That promise is only as good as
 * the emitted file, and the ways it can quietly stop being true are all
 * invisible in review:
 *
 *   - a build banner that injects `import { createRequire } from "module"`
 *     (the main bundle's banner does exactly this, and applying it here was one
 *     misplaced config key away);
 *   - a new import somewhere deep in the graph that reaches `node:crypto`;
 *   - a dependency resolved through its `node` export condition;
 *   - a bare `process.env` read that moved from inside a function to module
 *     scope during a refactor.
 *
 * Each produces a file that imports and type-checks perfectly well on Node and
 * throws on the first request everywhere else. `functions/portability.test.ts`
 * catches these in *source*; this catches them in the *artifact*, which is what
 * actually ships, and is the reason both exist.
 *
 * After the static checks it does the thing that actually settles the question:
 * it **evaluates the file** in a `vm` context containing web globals and
 * nothing else — no `process`, no `Buffer`, no `require`, no `__dirname` — with
 * `hono` linked in from outside. A module that survives that has demonstrated,
 * not asserted, that it loads where Node's globals do not exist.
 *
 * Usage: node --experimental-vm-modules scripts/assert-portable-entry.mjs <file> [...]
 */
import { readFileSync, existsSync } from "node:fs";
import { relative, resolve, dirname } from "node:path";
import { createRequire } from "node:module";
import vm from "node:vm";

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const NC = "\x1b[0m";

/**
 * Node built-ins, as they appear in an ES module's import statements.
 *
 * Both spellings: `node:fs` is the modern one, but a bundler that inlined a
 * dependency written years ago emits the bare form, and a check for only the
 * prefixed spelling would pass the file that matters.
 */
const NODE_BUILTINS = [
    "assert", "async_hooks", "buffer", "child_process", "cluster", "console",
    "constants", "crypto", "dgram", "diagnostics_channel", "dns", "domain",
    "events", "fs", "http", "http2", "https", "inspector", "module", "net",
    "os", "path", "perf_hooks", "process", "punycode", "querystring",
    "readline", "repl", "stream", "string_decoder", "sys", "timers", "tls",
    "trace_events", "tty", "url", "util", "v8", "vm", "wasi", "worker_threads",
    "zlib"
];

/** Packages that cannot run without Node, whatever their own docs claim. */
const NODE_ONLY_PACKAGES = [
    "@hono/node-server",
    "ws",
    "jsonwebtoken",
    "drizzle-orm",
    "pg",
    "nodemailer",
    "sharp",
    "ts-morph",
    "chokidar",
    "dotenv"
];

/** Every module specifier the file imports or re-exports, statically. */
function importedSpecifiers(source) {
    const found = new Set();
    const patterns = [
        // import … from "x" / export … from "x"
        /(?:^|[\s;}])(?:import|export)\s[^;]*?from\s*["']([^"']+)["']/g,
        // bare side-effect import "x"
        /(?:^|[\s;}])import\s*["']([^"']+)["']/g,
        // dynamic import("x") — only the literal form is statically knowable,
        // and a non-literal one is flagged separately below.
        /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
        // require("x") — should never appear, but if it does it is the single
        // most important thing in the file to report.
        /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g
    ];
    for (const pattern of patterns) {
        for (const match of source.matchAll(pattern)) found.add(match[1]);
    }
    return [...found];
}

/**
 * Host globals used where they cannot be guarded — i.e. at module scope.
 *
 * Line-based rather than AST-based on purpose: this runs against emitted,
 * bundled output, where the module scope is simply "lines with no leading
 * indentation" for every formatter esbuild and rollup produce. A false positive
 * here is a build failure with the offending line printed, which is cheap to
 * resolve; a false negative is a runtime crash on a host nobody tested.
 */
function moduleScopeHostGlobals(source) {
    const hits = [];
    const lines = source.split("\n");
    lines.forEach((line, index) => {
        if (/^\s/.test(line) || line.trim() === "") return;
        const trimmed = line.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
        // `typeof process` is the guarded form and is always safe: it is the
        // one expression that does not throw on an undefined identifier.
        const guarded = /typeof\s+(process|Buffer|__dirname|__filename)/;
        const bare = /\b(process\.|Buffer\.|Buffer\(|__dirname|__filename)/;
        if (bare.test(line) && !guarded.test(line)) {
            hits.push({ line: index + 1, text: trimmed });
        }
    });
    return hits;
}

function checkFile(file) {
    const problems = [];
    const source = readFileSync(file, "utf8");

    for (const specifier of importedSpecifiers(source)) {
        const bare = specifier.replace(/^node:/, "").split("/")[0];
        if (specifier.startsWith("node:") || NODE_BUILTINS.includes(bare)) {
            problems.push(`imports the Node built-in "${specifier}"`);
            continue;
        }
        const pkg = specifier.startsWith("@")
            ? specifier.split("/").slice(0, 2).join("/")
            : specifier.split("/")[0];
        if (NODE_ONLY_PACKAGES.includes(pkg)) {
            problems.push(`imports "${specifier}", which needs Node`);
        }
    }

    // A bundled portable entry has no reason to defer a module: everything it
    // needs is inlined. A dynamic import with a computed specifier is also the
    // one shape the static scan above cannot see through.
    if (/\bimport\s*\(\s*[^"')]/.test(source)) {
        problems.push("contains a dynamic import with a computed specifier, which no static check can follow");
    }

    for (const hit of moduleScopeHostGlobals(source)) {
        problems.push(`line ${hit.line} touches a host global at module scope: ${hit.text.slice(0, 100)}`);
    }

    return problems;
}

/**
 * The globals a worker-like runtime actually provides.
 *
 * Everything on this list is in the WinterCG Minimum Common API — the set every
 * non-Node JavaScript server runtime agrees to have. What is *not* on it is the
 * point: `process`, `Buffer`, `require`, `__dirname`, `global`. A module that
 * evaluates against only this has proved it does not need them.
 */
function workerLikeGlobals() {
    return {
        console,
        URL,
        URLSearchParams,
        TextEncoder,
        TextDecoder,
        AbortController,
        AbortSignal,
        Event,
        EventTarget,
        fetch,
        Request,
        Response,
        Headers,
        FormData,
        Blob,
        ReadableStream,
        WritableStream,
        TransformStream,
        crypto: globalThis.crypto,
        structuredClone,
        queueMicrotask,
        atob,
        btoa,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        performance
    };
}

/**
 * Evaluate `file` in a context with worker-like globals only.
 *
 * External specifiers are linked from the real module graph — the point is to
 * test *this* bundle, not to re-litigate whether Hono runs on workers, which it
 * demonstrably does. Returns the module's export names.
 */
async function evaluateInBareContext(file) {
    if (typeof vm.SourceTextModule !== "function") {
        throw new Error(
            "vm.SourceTextModule is unavailable — re-run with --experimental-vm-modules. " +
            "Without it the static checks still ran, but the file was never evaluated."
        );
    }

    const context = vm.createContext(workerLikeGlobals());
    const requireFrom = createRequire(resolve(dirname(file), "package.json"));

    const module = new vm.SourceTextModule(readFileSync(file, "utf8"), {
        context,
        identifier: file,
        // Nothing in a portable bundle should reach for `import.meta`, and a
        // host that has none would break on it, so it is left empty rather than
        // populated with a `url` this file has no business knowing.
        initializeImportMeta: () => undefined
    });

    const linker = async (specifier) => {
        // Resolve against the built package so the version linked here is the
        // one the package itself would load.
        const resolved = requireFrom.resolve(specifier);
        const real = await import(`file://${resolved}`);
        const names = Object.keys(real);
        const synthetic = new vm.SyntheticModule(names, function () {
            for (const name of names) this.setExport(name, real[name]);
        }, { context, identifier: specifier });
        return synthetic;
    };

    await module.link(linker);
    await module.evaluate();
    return Object.keys(module.namespace);
}

const files = process.argv.slice(2);
if (files.length === 0) {
    console.error("usage: assert-portable-entry.mjs <file> [...more files]");
    process.exit(2);
}

let failed = false;
for (const arg of files) {
    const file = resolve(process.cwd(), arg);
    const label = relative(process.cwd(), file);

    if (!existsSync(file)) {
        console.error(`\n${RED}✖ portable entry missing${NC} — ${label} was not emitted.\n`);
        failed = true;
        continue;
    }

    const problems = checkFile(file);

    // Only worth evaluating a file the static pass believes in — running an
    // already-doomed module would report the same fact twice, in a worse way.
    if (problems.length === 0) {
        try {
            const exported = await evaluateInBareContext(file);
            console.log(
                `${GREEN}✓${NC} ${label}: portable — evaluates with worker-like globals only ` +
                `${DIM}(no process/Buffer/require; ${exported.length} exports)${NC}`
            );
            continue;
        } catch (error) {
            problems.push(
                `fails to evaluate in a context without Node globals: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    failed = true;
    console.error(`\n${RED}✖ ${label} is not portable${NC} — ${problems.length} problem${problems.length === 1 ? "" : "s"}:\n`);
    for (const problem of problems) console.error(`    ${problem}`);
    console.error(`
${DIM}This file is what a custom function imports as "@rebasepro/server/functions".
It has to load on a runtime with no Node built-ins, so anything above makes it
throw on the first import there — while continuing to work perfectly on Node,
which is why nothing else would have caught it.

Most likely causes, in order:
  1. A new import in the graph rooted at packages/server/src/functions/index.ts.
     Run the source-level check for a named import chain:
         pnpm --filter @rebasepro/server test -- portability
  2. An output banner or a resolve condition changed in vite.config.functions.ts.
  3. A host global that moved from inside a function to module scope. Read it
     through utils/host.ts instead.${NC}
`);
}

process.exit(failed ? 1 : 0);
