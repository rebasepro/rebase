#!/usr/bin/env node
/**
 * Keep the request path portable, one module at a time.
 *
 * `@rebasepro/server/functions` is already portable and proven so by
 * `assert-portable-entry.mjs`, which evaluates the built artifact in a `vm`
 * holding web globals and nothing else. That covers the code a *customer*
 * writes. It says nothing about the code that runs before their handler does —
 * token verification, rate limiting, idempotency, storage URL signing — which
 * is the part that would have to move first if any of this were ever to serve
 * a request somewhere other than a Node process.
 *
 * That path cannot be made portable in one change, and pretending otherwise
 * would produce a branch nobody merges. So this is a **ratchet**, not a wall:
 * `contracts/portable-core.txt` records every module reachable from the roots
 * below that still needs Node, and the gate fails three ways —
 *
 *   1. a NEW dependency on Node appears on the path → the branch that added it
 *      is the cheapest possible place to reconsider;
 *   2. a listed dependency is GONE → the line must be deleted, so the file
 *      only ever shrinks;
 *   3. a listed module is no longer reachable at all → the line is stale.
 *
 * The direction is the whole point. Nothing here has to reach zero for the
 * file to be worth having: an inventory that cannot silently grow is what makes
 * a later port a scoping exercise rather than an excavation.
 *
 * ## Why these roots
 *
 * A request this server can serve without touching the database pool is a
 * request an isolate could serve. `drizzle-orm` and `pg` both need a TCP
 * socket, so any module that reaches them is Node-bound for reasons no
 * refactor here can address — those are a driver decision (Hyperdrive, a
 * serverless driver, a data proxy), not a code-hygiene one. The roots are
 * therefore everything on the way *in*, up to the first database call, plus the
 * portable functions entry as the anchor that must never regress.
 *
 * Run: pnpm run check:portable-core        (verify)
 *      pnpm run check:portable-core --write (re-record the baseline)
 */
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const baselinePath = path.join(repoRoot, "contracts", "portable-core.txt");

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const NC = "\x1b[0m";

/**
 * Where the request path starts.
 *
 * Repo-relative, and every one of them must exist — a root that quietly stops
 * existing would shrink the graph to nothing and turn this gate green for the
 * worst possible reason.
 */
const ROOTS = [
    // The anchor. Already portable, gated twice over; listed so that a change
    // reaching it from this side is caught by this gate too.
    "packages/server/src/functions/index.ts",
    // Authentication and authorization of an inbound request.
    "packages/server/src/auth/middleware.ts",
    "packages/server/src/auth/jwt.ts",
    "packages/server/src/auth/cookie-utils.ts",
    "packages/server/src/auth/rate-limiter.ts",
    "packages/server/src/auth/rate-limit-store.ts",
    // Request shaping and error rendering.
    "packages/server/src/api/errors.ts",
    "packages/server/src/api/rest/query-parser.ts",
    "packages/server/src/api/rest/idempotency.ts",
    "packages/server/src/utils/request-id.ts",
    // Storage: key derivation, policy evaluation and response headers all run
    // before any object is read, and signing a URL never touches the database.
    "packages/server/src/storage/keys.ts",
    "packages/server/src/storage/path-pattern.ts",
    "packages/server/src/storage/policies.ts",
    "packages/server/src/storage/cache-headers.ts",
    "packages/server/src/storage/range.ts"
];

/** Node built-ins, bare and `node:`-prefixed alike. */
const NODE_BUILTINS = new Set([
    "assert", "async_hooks", "buffer", "child_process", "cluster", "console",
    "constants", "crypto", "dgram", "diagnostics_channel", "dns", "domain",
    "events", "fs", "http", "http2", "https", "inspector", "module", "net",
    "os", "path", "perf_hooks", "process", "punycode", "querystring",
    "readline", "repl", "stream", "string_decoder", "sys", "timers", "tls",
    "trace_events", "tty", "url", "util", "v8", "wasi", "worker_threads",
    "zlib"
]);

/**
 * Packages that need Node, with the reason — deliberately the same list the
 * per-function scan carries in `packages/cli/src/function-portability.ts`.
 * Two copies of one judgement is worse than one, but the alternative is the
 * CLI depending on a tooling script or this script depending on the CLI's
 * build, and neither is available where these run.
 */
const NODE_ONLY_PACKAGES = new Map([
    ["@hono/node-server", "the Node HTTP adapter"],
    ["ws", "Node sockets"],
    ["jsonwebtoken", "node:crypto"],
    ["drizzle-orm", "a database TCP socket"],
    ["pg", "a database TCP socket"],
    ["postgres", "a database TCP socket"],
    ["mysql2", "a database TCP socket"],
    ["mongodb", "a database TCP socket"],
    ["nodemailer", "SMTP sockets"],
    ["sharp", "a native addon"],
    ["bcrypt", "a native addon"],
    ["fs-extra", "the filesystem"],
    ["chokidar", "the filesystem"],
    ["dotenv", "reading a file at import time"],
    ["archiver", "Node streams"],
    ["ioredis", "Node sockets"]
]);

/**
 * Why a given module is expected to stay on the list.
 *
 * Rendered into the baseline's header for the modules still on it, so the file
 * says which of its lines are decisions and which are merely undone. A line
 * with no note here is the second kind.
 */
const NOTES = new Map([
    ["packages/server/src/auth/jwt-crypto.ts", [
        "The JWT library, and deliberately the only module that names one. Its own",
        "functions are already async, so replacing `jsonwebtoken` with `jose` is a",
        "one-file change that touches no caller."
    ]],
    ["packages/server/src/auth/jwt-keys.ts", [
        "PEM parsing into `KeyObject`s. The portable form is `jose`'s `importSPKI`",
        "and `importPKCS8`; it moves when jwt-crypto.ts does, and not before."
    ]],
    ["packages/server/src/auth/rate-limiter.ts", [
        "The client's socket address — a per-adapter capability rather than",
        "something a portable module can reach: Hono has no runtime-agnostic",
        "`getConnInfo`, and an isolate host would read `CF-Connecting-IP` or",
        "whatever its own proxy sets. Binding it belongs to the host adapter."
    ]]
]);

/** Workspace packages the walk follows into, rather than treating as leaves. */
const WORKSPACE_PREFIX = "@rebasepro/";

/** Blank comments, preserving line structure so line numbers stay true. */
function stripComments(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, " "))
        .replace(/(^|[^:])\/\/[^\n]*/g, (match, lead) => lead + " ".repeat(match.length - lead.length));
}

/** Comments and string bodies, for scans that read identifiers not specifiers. */
function stripNonCode(source) {
    return stripComments(source)
        .replace(/`(?:[^`\\]|\\.)*`/g, match => match.replace(/[^\n]/g, " "))
        .replace(/"(?:[^"\\\n]|\\.)*"/g, match => `"${" ".repeat(Math.max(0, match.length - 2))}"`)
        .replace(/'(?:[^'\\\n]|\\.)*'/g, match => `'${" ".repeat(Math.max(0, match.length - 2))}'`);
}

/**
 * Import specifiers, with whether the import is type-only.
 *
 * `import type` is erased before anything runs, so it constrains nothing at
 * runtime. Counting it would put half the codebase in the baseline for
 * importing a `Stats` type, and train everyone to ignore the file.
 */
function imports(source) {
    const found = [];
    const code = stripComments(source);

    // Multi-line import statements are the norm here, so the scan works on the
    // whole file rather than line by line, and recovers the line from the
    // match offset.
    const pattern = /(?:^|[\s;}])(import|export)(\s+type)?\s+(?:[^;'"]*?\sfrom\s*)?["']([^"']+)["']/g;
    let match;
    while ((match = pattern.exec(code)) !== null) {
        const [full, , typeKeyword, specifier] = match;
        found.push({
            specifier,
            line: code.slice(0, match.index).split("\n").length,
            typeOnly: Boolean(typeKeyword) || /\{\s*type\s/.test(full)
        });
    }

    // A bare `import "./x"` side-effect import has no `from`, and the pattern
    // above catches it via the optional group.
    return found;
}

/** `process.env` read where the module is evaluated, not where it is called. */
function moduleScopeEnvReads(source) {
    const hits = [];
    stripNonCode(source).split("\n").forEach((line, index) => {
        if (/^\s/.test(line) || line.trim() === "") return;
        if (/\bprocess\.env\b/.test(line)) hits.push(index + 1);
    });
    return hits;
}

function packageOf(specifier) {
    return specifier.startsWith("@")
        ? specifier.split("/").slice(0, 2).join("/")
        : specifier.split("/")[0];
}

/** Resolve a relative specifier to a file on disk, or null. */
function resolveRelative(fromFile, specifier) {
    const base = path.resolve(path.dirname(fromFile), specifier);
    const withoutJs = base.replace(/\.js$/, "");
    const candidates = [
        base, `${base}.ts`, `${base}.tsx`,
        `${withoutJs}.ts`, `${withoutJs}.tsx`,
        path.join(base, "index.ts"), path.join(withoutJs, "index.ts")
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
    return null;
}

/** Resolve `@rebasepro/x` (and `@rebasepro/x/sub`) to a source file, or null. */
function resolveWorkspace(specifier) {
    const name = specifier.slice(WORKSPACE_PREFIX.length);
    const [pkg, ...rest] = name.split("/");
    const src = path.join(repoRoot, "packages", pkg, "src");
    if (!fs.existsSync(src)) return null;
    if (rest.length === 0) {
        const index = path.join(src, "index.ts");
        return fs.existsSync(index) ? index : null;
    }
    return resolveRelative(path.join(src, "index.ts"), `./${rest.join("/")}`);
}

/**
 * Walk the graph from the roots, recording why each module needs Node.
 *
 * @returns {Map<string, Set<string>>} repo-relative path → set of reasons
 */
function walk() {
    /** @type {Map<string, Set<string>>} */
    const findings = new Map();
    const seen = new Set();
    const queue = ROOTS.map(root => path.join(repoRoot, root));

    for (const root of queue) {
        if (!fs.existsSync(root)) {
            console.error(`${RED}✗${NC} declared root does not exist: ${path.relative(repoRoot, root)}`);
            console.error(`  A root that stops existing empties the graph and turns this gate green for the wrong reason.`);
            process.exit(1);
        }
    }

    const note = (file, reason) => {
        const rel = path.relative(repoRoot, file);
        if (!findings.has(rel)) findings.set(rel, new Set());
        findings.get(rel).add(reason);
    };

    while (queue.length > 0) {
        const file = queue.pop();
        if (seen.has(file)) continue;
        seen.add(file);

        const source = fs.readFileSync(file, "utf8");

        for (const line of moduleScopeEnvReads(source)) {
            note(file, `module-scope-env process.env read at line ${line}`);
        }

        for (const { specifier, typeOnly } of imports(source)) {
            if (typeOnly) continue;

            if (specifier.startsWith(".")) {
                const resolved = resolveRelative(file, specifier);
                // An unresolvable relative import is a real problem, but it is
                // the typechecker's problem, not this gate's — and a hard
                // failure here would make every in-flight rename look like a
                // portability regression.
                if (resolved) queue.push(resolved);
                continue;
            }

            const bare = specifier.replace(/^node:/, "");
            if (specifier.startsWith("node:") || NODE_BUILTINS.has(bare.split("/")[0])) {
                note(file, `node-builtin ${bare.split("/")[0]}`);
                continue;
            }

            const pkg = packageOf(specifier);
            if (pkg.startsWith(WORKSPACE_PREFIX)) {
                const resolved = resolveWorkspace(specifier);
                if (resolved) queue.push(resolved);
                continue;
            }

            const reason = NODE_ONLY_PACKAGES.get(pkg);
            if (reason) note(file, `node-only-package ${pkg} (${reason})`);
        }
    }

    return findings;
}

/** Render findings as the baseline file's body: one `path reason` per line. */
function render(findings) {
    const lines = [];
    for (const [file, reasons] of findings) {
        for (const reason of reasons) lines.push(`${file} ${reason}`);
    }
    return lines.sort();
}

const HEADER = `# Modules on the request path that still need Node — a RATCHET.
#
# Rendered by tooling/scripts/check-portable-core.mjs. Re-record with
# \`pnpm run check:portable-core --write\`, and read that file's header for
# what the roots are and why.
#
# Every line is one reason one module cannot run outside a Node process. The
# file may SHRINK freely and may never grow: a new line means a branch put a
# fresh dependency on Node in front of every request, which is the moment to
# reconsider it rather than a year from now.
#
# Removing the last reason for a module removes its line. Nothing here has to
# reach zero — \`drizzle-orm\` and \`pg\` need a TCP socket, and that is a driver
# decision, not a code-hygiene one.
`;

/** The `NOTES` entries for modules that are actually on the list. */
function notesFor(findings) {
    const blocks = [];
    for (const [file, note] of NOTES) {
        if (!findings.has(file)) continue;
        blocks.push([`# ${file}`, ...note.map(line => `#   ${line}`)].join("\n"));
    }
    if (blocks.length === 0) return "";
    return `#\n# Why each of these is still here:\n#\n${blocks.join("\n#\n")}\n`;
}

function main() {
    const write = process.argv.includes("--write");
    const findings = walk();
    const current = render(findings);

    if (write) {
        fs.writeFileSync(baselinePath, `${HEADER}${notesFor(findings)}\n${current.join("\n")}\n`);
        console.log(`${GREEN}✓${NC} recorded ${current.length} line(s) in contracts/portable-core.txt`);
        return;
    }

    if (!fs.existsSync(baselinePath)) {
        console.error(`${RED}✗${NC} contracts/portable-core.txt is missing — run: pnpm run check:portable-core --write`);
        process.exit(1);
    }

    const baseline = fs.readFileSync(baselinePath, "utf8")
        .split("\n")
        .map(line => line.trim())
        .filter(line => line !== "" && !line.startsWith("#"));

    const baselineSet = new Set(baseline);
    const currentSet = new Set(current);
    const added = current.filter(line => !baselineSet.has(line));
    const removed = baseline.filter(line => !currentSet.has(line));

    if (added.length === 0 && removed.length === 0) {
        console.log(`${GREEN}✓${NC} portable core unchanged — ${current.length} known dependency(ies) on Node`);
        return;
    }

    if (added.length > 0) {
        console.error(`\n${RED}✗ new dependency on Node on the request path${NC}\n`);
        for (const line of added) console.error(`    ${line}`);
        console.error(`\n  ${DIM}Every request goes through these modules. Node-only code here is what a`);
        console.error(`  future edge deployment would have to unpick, and the branch that added it`);
        console.error(`  is the cheapest place to reconsider.${NC}`);
        console.error(`\n  Portable alternatives that cover most of it:`);
        console.error(`    node:crypto randomUUID/getRandomValues → the \`crypto\` global`);
        console.error(`    node:crypto createHash                 → \`crypto.subtle.digest\` (async)`);
        console.error(`    node:perf_hooks performance            → the \`performance\` global`);
        console.error(`    node:path on storage keys              → string operations (keys are POSIX)`);
        console.error(`\n  If it genuinely has to be Node — record it:`);
        console.error(`    pnpm run check:portable-core --write\n`);
    }

    if (removed.length > 0) {
        console.error(`\n${YELLOW}✗ stale line(s) in contracts/portable-core.txt${NC}\n`);
        for (const line of removed) console.error(`    ${line}`);
        console.error(`\n  ${DIM}These no longer hold — the module was made portable, or it left the`);
        console.error(`  graph. The baseline only ratchets down if the wins are recorded:${NC}`);
        console.error(`    pnpm run check:portable-core --write\n`);
    }

    process.exit(1);
}

main();
