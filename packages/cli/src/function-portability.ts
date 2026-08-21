/**
 * What each of a project's custom functions depends on the *host* for.
 *
 * A custom function is a Hono app, and Hono runs on every JavaScript server
 * runtime there is. So the question of whether a given function could run
 * somewhere other than a Node process is not about the framework — it is
 * entirely about what the function's own file imports and touches. This answers
 * that, per file, from source.
 *
 * It is a **report, not a rule.** Nothing here fails a build. A function that
 * opens a file, shells out, or runs raw SQL is a perfectly good function, and
 * on a Node deployment — which is every deployment today — it costs nothing.
 * The value is in knowing which ones those are *before* it matters, and in the
 * one finding that is genuinely a latent bug on any host:
 * `process.env` read at module scope.
 *
 * Why bother now: the alternative is discovering it per-file, later, across a
 * codebase already written against the assumption. The scan is cheap, the
 * output is short, and the habits it nudges — importing from
 * `@rebasepro/server/functions`, reading configuration inside the handler — are
 * better on Node too.
 *
 * @module
 */
import * as fs from "fs";
import * as path from "path";

/** Node built-ins, bare and `node:`-prefixed alike. */
const NODE_BUILTINS = new Set([
    "assert", "async_hooks", "buffer", "child_process", "cluster", "console",
    "constants", "crypto", "dgram", "diagnostics_channel", "dns", "domain",
    "events", "fs", "http", "http2", "https", "inspector", "module", "net",
    "os", "path", "perf_hooks", "process", "punycode", "querystring",
    "readline", "repl", "stream", "string_decoder", "sys", "timers", "tls",
    "trace_events", "tty", "url", "util", "v8", "vm", "wasi", "worker_threads",
    "zlib"
]);

/**
 * Packages that need Node, with the reason. Not exhaustive and cannot be —
 * an unknown package is reported as unknown rather than guessed at, because
 * claiming a dependency is portable when it is not is worse than saying nothing.
 */
const NODE_ONLY_PACKAGES = new Map<string, string>([
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
    ["puppeteer", "a browser subprocess"],
    ["fs-extra", "the filesystem"],
    ["chokidar", "the filesystem"],
    ["dotenv", "reading a file at import time"],
    ["archiver", "Node streams"],
    ["ioredis", "Node sockets"]
]);

/** What a single finding is about. */
export type PortabilityIssueKind =
    | "node-builtin"
    | "node-only-package"
    | "module-scope-env"
    | "root-barrel-import"
    | "unknown-package";

export interface PortabilityIssue {
    kind: PortabilityIssueKind;
    /** 1-based line in the function file. */
    line: number;
    /** One sentence, already phrased for a terminal. */
    message: string;
    /**
     * Whether this is a problem *today*, on Node, rather than only a constraint
     * on where the function could run. Exactly one kind is:
     * `module-scope-env`, which is a latent crash on any host where a variable
     * happens to be unset at import time, and takes every other function in the
     * same directory down with it — the loader reports a file that throws on
     * import as simply "skipped".
     */
    actionable: boolean;
}

export interface FunctionPortability {
    /** Function name — the filename without extension, as it mounts. */
    name: string;
    /** Path relative to the project root. */
    file: string;
    /** Empty when the function depends on nothing host-specific. */
    issues: PortabilityIssue[];
    /** True when `issues` contains nothing that pins it to Node. */
    portable: boolean;
}

/** Files the functions loader would serve. Mirrors `function-loader.ts`. */
function functionFiles(directory: string): string[] {
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory, { withFileTypes: true })
        .filter(entry => entry.isFile())
        .map(entry => entry.name)
        .filter(name =>
            (name.endsWith(".ts") || name.endsWith(".js"))
            && !name.startsWith(".")
            && !name.includes(".test.")
            && !name.endsWith(".d.ts")
            && name !== "index.ts"
            && name !== "index.js")
        .sort();
}

/**
 * Blank out comments, preserving line structure so reported line numbers stay
 * true. Strings are left alone: an import specifier *is* a string, and blanking
 * them before reading imports is how a scan reports that a file imports `""`.
 */
function stripComments(source: string): string {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, " "))
        .replace(/(^|[^:])\/\/[^\n]*/g, (match, lead) => lead + " ".repeat(match.length - lead.length));
}

/**
 * Comments *and* string bodies, for scans that look for identifiers rather than
 * specifiers — where `"process.env.FOO"` inside a message is not a read.
 */
function stripNonCode(source: string): string {
    return stripComments(source)
        .replace(/`(?:[^`\\]|\\.)*`/g, match => match.replace(/[^\n]/g, " "))
        .replace(/"(?:[^"\\\n]|\\.)*"/g, match => `"${" ".repeat(Math.max(0, match.length - 2))}"`)
        .replace(/'(?:[^'\\\n]|\\.)*'/g, match => `'${" ".repeat(Math.max(0, match.length - 2))}'`);
}

/** Import specifiers, keeping the raw line so the report can point at it. */
function imports(source: string): Array<{ specifier: string; line: number; typeOnly: boolean }> {
    const found: Array<{ specifier: string; line: number; typeOnly: boolean }> = [];
    const lines = source.split("\n");

    lines.forEach((line, index) => {
        const match = /(?:^|[\s;}])(?:import|export)(\s+type)?\s[^;]*?from\s*["']([^"']+)["']/.exec(line)
            ?? /(?:^|[\s;}])import\s*["']([^"']+)["']/.exec(line);
        if (!match) return;
        const specifier = match[2] ?? match[1];
        if (!specifier) return;
        found.push({
            specifier,
            line: index + 1,
            // `import type` is erased before anything runs, so it constrains
            // nothing at runtime — flagging it would be noise that trains people
            // to ignore the report.
            typeOnly: Boolean(match[1]) || /\bimport\s+type\b/.test(line)
        });
    });

    return found;
}

/**
 * `process.env` (and friends) read where the module is *evaluated*.
 *
 * Indentation is the heuristic for "inside something that runs later", which is
 * exact for every formatter anyone uses on a function file and wrong only for
 * code nobody writes. The cost of being wrong is one line of advisory output.
 */
function moduleScopeEnvReads(source: string): number[] {
    const lines = stripNonCode(source).split("\n");
    const hits: number[] = [];
    lines.forEach((line, index) => {
        if (/^\s/.test(line) || line.trim() === "") return;
        if (/\bprocess\.env\b/.test(line)) hits.push(index + 1);
    });
    return hits;
}

function packageOf(specifier: string): string {
    return specifier.startsWith("@")
        ? specifier.split("/").slice(0, 2).join("/")
        : specifier.split("/")[0];
}

/** Analyse one function file's source. Exported for testing. */
export function analyseFunctionSource(source: string, name: string, file: string): FunctionPortability {
    const issues: PortabilityIssue[] = [];
    // Two views of the same file: imports need their string literals intact,
    // identifier scans need them gone. Both keep line numbers.
    const withStrings = stripComments(source);
    const code = stripNonCode(source);

    for (const { specifier, line, typeOnly } of imports(withStrings)) {
        if (typeOnly) continue;
        if (specifier.startsWith(".") || specifier.startsWith("/")) continue;

        const bare = specifier.replace(/^node:/, "");
        if (specifier.startsWith("node:") || NODE_BUILTINS.has(bare.split("/")[0])) {
            issues.push({
                kind: "node-builtin",
                line,
                message: `imports the Node built-in "${specifier}"`,
                actionable: false
            });
            continue;
        }

        const pkg = packageOf(specifier);

        // The exact specifier, not the package: `@rebasepro/server/functions`
        // is the portable subpath and is the thing being recommended.
        if (specifier === "@rebasepro/server") {
            // Not a portability problem in itself — the root barrel works
            // perfectly on Node — but it is the single edit that would let this
            // file move, and it is one line.
            issues.push({
                kind: "root-barrel-import",
                line,
                message: "imports from \"@rebasepro/server\" — the whole framework, Node-only. "
                    + "Use \"@rebasepro/server/functions\" for the authoring surface.",
                actionable: false
            });
            continue;
        }

        const why = NODE_ONLY_PACKAGES.get(pkg);
        if (why) {
            issues.push({
                kind: "node-only-package",
                line,
                message: `imports "${specifier}", which needs ${why}`,
                actionable: false
            });
        }
    }

    for (const line of moduleScopeEnvReads(code)) {
        issues.push({
            kind: "module-scope-env",
            line,
            message: "reads process.env at module scope. If the variable is unset the whole file "
                + "fails to import, and the loader reports that as a skipped function — read it "
                + "inside the handler instead (`requireEnv(c, \"NAME\")`, or `lazyResource`).",
            actionable: true
        });
    }

    return {
        name,
        file,
        issues,
        // The advisory import-path finding does not make a function unportable —
        // it is the same code either way, reachable through a heavier door.
        portable: issues.every(issue => issue.kind === "root-barrel-import")
    };
}

/**
 * Analyse every function in a directory.
 *
 * @param functionsDir Absolute path to the functions directory.
 * @param projectRoot  For rendering paths people recognise.
 */
export function analyseFunctionsDirectory(functionsDir: string, projectRoot: string): FunctionPortability[] {
    return functionFiles(functionsDir).map(fileName => {
        const absolute = path.join(functionsDir, fileName);
        const source = fs.readFileSync(absolute, "utf8");
        return analyseFunctionSource(
            source,
            path.basename(fileName, path.extname(fileName)),
            path.relative(projectRoot, absolute)
        );
    });
}

/**
 * The lines to print after a build, or nothing at all.
 *
 * Silent when every function is portable and nothing is actionable, because a
 * report that always prints is a report nobody reads. Actionable findings are
 * always shown; the rest collapse to a single count with a pointer.
 */
export function summarisePortability(results: FunctionPortability[]): string[] {
    if (results.length === 0) return [];

    const actionable = results.flatMap(result =>
        result.issues.filter(issue => issue.actionable).map(issue => ({ result, issue })));
    const nodeOnly = results.filter(result => !result.portable);

    const lines: string[] = [];

    for (const { result, issue } of actionable) {
        lines.push(`  ⚠ ${result.file}:${issue.line} — ${issue.message}`);
    }

    if (nodeOnly.length > 0) {
        const names = nodeOnly.map(result => result.name).join(", ");
        lines.push(
            `  ℹ ${nodeOnly.length} of ${results.length} function(s) depend on Node: ${names}`
        );
        lines.push("      Fine for any Node deployment — recorded in the manifest so a host knows.");
    }

    return lines;
}
