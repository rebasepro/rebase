/**
 * The portability gate for `@rebasepro/server/functions`.
 *
 * `functions/index.ts` is the entry point a custom function imports, and the
 * promise attached to it is that a function written against it runs unchanged
 * on any JavaScript runtime — Node now, an isolate-based host later. That
 * promise is not enforceable by review: everything that breaks it works
 * perfectly on Node, so it breaks in a commit that passes every other test, and
 * surfaces only on a host nobody has yet.
 *
 * So it is enforced here, by walking the actual import graph.
 *
 * Three rules, and the third is the one that would otherwise be missed:
 *
 *   1. No Node built-in anywhere in the graph.
 *   2. No package that needs one. The allowlist is deliberately tiny and
 *      closed — an unrecognised dependency fails rather than passes, because
 *      "is this package portable" is a question that has to be answered by a
 *      person, once, at the moment it is added.
 *   3. No host global (`process`, `Buffer`, `__dirname`) at **module scope**.
 *      A guarded read inside a function is fine on every runtime; the same read
 *      at module scope means the module cannot even be *evaluated* where the
 *      global is absent. That distinction is why this is an AST walk and not a
 *      grep.
 *
 * Type-only imports are ignored throughout, because they are erased before
 * anything runs. That is not a loophole — it is what lets `HonoEnv` name types
 * from the Node-only auth modules without dragging them along.
 *
 * `scripts/assert-portable-entry.mjs` is the same gate applied to the emitted
 * bundle. Both exist because they fail differently: this one names the import
 * chain that broke the rule, and that one catches a build setting — a banner, a
 * resolve condition — that this one cannot see.
 */
import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";

/** The root of the portable graph. */
const ENTRY = path.join(__dirname, "index.ts");

/**
 * Bare specifiers the portable graph may import.
 *
 * `hono` is the framework a function is written in and runs on every target
 * runtime; it is the entire reason this entry point is possible at all.
 *
 * Adding to this list is a decision about a runtime contract, not a dependency
 * bump. The question to answer first is not "does it install" — it is "does it
 * run on workerd with no nodejs_compat flag".
 */
const ALLOWED_PACKAGES = new Set(["hono"]);

/**
 * Named so the failure message can say *why*, rather than only that a package
 * is not on the allowlist. Everything else unknown fails too — this list buys a
 * better error, not a stricter rule.
 */
const KNOWN_NODE_ONLY = new Map<string, string>([
    ["@hono/node-server", "the Node HTTP adapter — by definition Node-only"],
    ["ws", "a Node socket implementation"],
    ["jsonwebtoken", "built on node:crypto; use a WebCrypto JWT library on a portable path"],
    ["drizzle-orm", "reaches a database over a TCP socket"],
    ["pg", "a Node TCP client"],
    ["nodemailer", "opens SMTP sockets"],
    ["sharp", "a native addon"],
    ["ts-morph", "reads the filesystem"],
    ["chokidar", "watches the filesystem"],
    ["dotenv", "reads a file at import time"]
]);

const NODE_BUILTINS = new Set([
    "assert", "async_hooks", "buffer", "child_process", "cluster", "console",
    "constants", "crypto", "dgram", "diagnostics_channel", "dns", "domain",
    "events", "fs", "http", "http2", "https", "inspector", "module", "net",
    "os", "path", "perf_hooks", "process", "punycode", "querystring",
    "readline", "repl", "stream", "string_decoder", "sys", "timers", "tls",
    "trace_events", "tty", "url", "util", "v8", "vm", "wasi", "worker_threads",
    "zlib"
]);

/** Globals whose mere presence at module scope makes a module unloadable. */
const HOST_GLOBALS = new Set(["process", "Buffer", "__dirname", "__filename", "require"]);

interface ValueImport {
    specifier: string;
    line: number;
}

function parse(file: string): ts.SourceFile {
    return ts.createSourceFile(
        file,
        fs.readFileSync(file, "utf8"),
        ts.ScriptTarget.Latest,
        /* setParentNodes */ true,
        ts.ScriptKind.TS
    );
}

function lineOf(source: ts.SourceFile, node: ts.Node): number {
    return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

/**
 * Every specifier this module imports **at runtime**.
 *
 * Skips `import type` declarations and named clauses whose specifiers are all
 * type-only, because those are erased. A mixed clause
 * (`import { a, type B } from "x"`) still counts: `a` is a real import.
 */
function valueImports(source: ts.SourceFile): ValueImport[] {
    const found: ValueImport[] = [];

    const record = (node: ts.Node, specifier: ts.Expression | undefined) => {
        if (!specifier || !ts.isStringLiteral(specifier)) return;
        found.push({ specifier: specifier.text,
            line: lineOf(source, node) });
    };

    const visit = (node: ts.Node): void => {
        if (ts.isImportDeclaration(node)) {
            if (!node.importClause?.isTypeOnly) {
                const bindings = node.importClause?.namedBindings;
                const allTypeOnly = bindings
                    && ts.isNamedImports(bindings)
                    && bindings.elements.length > 0
                    && bindings.elements.every(element => element.isTypeOnly);
                if (!allTypeOnly) record(node, node.moduleSpecifier);
            }
        } else if (ts.isExportDeclaration(node)) {
            if (!node.isTypeOnly && node.moduleSpecifier) {
                const clause = node.exportClause;
                const allTypeOnly = clause
                    && ts.isNamedExports(clause)
                    && clause.elements.length > 0
                    && clause.elements.every(element => element.isTypeOnly);
                if (!allTypeOnly) record(node, node.moduleSpecifier);
            }
        } else if (
            ts.isCallExpression(node)
            && node.expression.kind === ts.SyntaxKind.ImportKeyword
        ) {
            // A dynamic import is still an import; it defers loading, not
            // resolution, and a bundler follows it.
            record(node, node.arguments[0]);
        }
        ts.forEachChild(node, visit);
    };

    visit(source);
    return found;
}

/**
 * Host globals referenced where the module cannot defer them.
 *
 * Descends the top level but stops at anything whose body runs later — a
 * function, a method, an accessor. `const f = () => process.env.X` is fine;
 * `const x = process.env.X` is not, and the difference is exactly whether the
 * reference executes when the module is evaluated.
 */
function moduleScopeGlobals(source: ts.SourceFile): Array<{ name: string; line: number }> {
    const hits: Array<{ name: string; line: number }> = [];

    const defersExecution = (node: ts.Node): boolean =>
        ts.isFunctionDeclaration(node)
        || ts.isFunctionExpression(node)
        || ts.isArrowFunction(node)
        || ts.isMethodDeclaration(node)
        || ts.isGetAccessorDeclaration(node)
        || ts.isSetAccessorDeclaration(node)
        || ts.isConstructorDeclaration(node)
        || ts.isClassDeclaration(node)
        || ts.isClassExpression(node);

    const visit = (node: ts.Node): void => {
        if (defersExecution(node)) return;

        // `typeof process` is the one form that is safe on a runtime where the
        // identifier is undefined — it is how you *check* for it.
        if (ts.isTypeOfExpression(node)) return;
        // Type positions never execute.
        if (ts.isTypeNode(node)) return;

        if (ts.isIdentifier(node) && HOST_GLOBALS.has(node.text)) {
            // Not a reference to the global if it is the name being declared,
            // or a property being read off something else (`foo.process`).
            const parent = node.parent;
            const isPropertyName = parent
                && ts.isPropertyAccessExpression(parent)
                && parent.name === node;
            const isDeclarationName = parent
                && (ts.isVariableDeclaration(parent) || ts.isParameter(parent) || ts.isBindingElement(parent))
                && (parent as { name?: ts.Node }).name === node;
            const isPropertyAssignmentKey = parent
                && ts.isPropertyAssignment(parent)
                && parent.name === node;

            if (!isPropertyName && !isDeclarationName && !isPropertyAssignmentKey) {
                hits.push({ name: node.text,
                    line: lineOf(source, node) });
            }
        }

        ts.forEachChild(node, visit);
    };

    source.statements.forEach(visit);
    return hits;
}

/** Resolve a relative specifier the way the TypeScript/bundler pair would. */
function resolveRelative(fromFile: string, specifier: string): string | undefined {
    const base = path.resolve(path.dirname(fromFile), specifier.replace(/\.js$/, ""));
    const candidates = [
        `${base}.ts`,
        `${base}.tsx`,
        path.join(base, "index.ts"),
        path.join(base, "index.tsx")
    ];
    return candidates.find(candidate => fs.existsSync(candidate));
}

function packageOf(specifier: string): string {
    return specifier.startsWith("@")
        ? specifier.split("/").slice(0, 2).join("/")
        : specifier.split("/")[0];
}

interface Problem {
    kind: "builtin" | "package" | "global" | "unresolved";
    detail: string;
    chain: string[];
}

/**
 * Walk the graph from {@link ENTRY}, collecting every violation with the import
 * chain that reached it. The chain is the part that makes a failure actionable:
 * "somewhere in this graph" is the report that gets ignored.
 */
function auditGraph(): { problems: Problem[]; visited: string[] } {
    const problems: Problem[] = [];
    const visited = new Set<string>();
    const rootDir = path.join(__dirname, "..", "..");
    const label = (file: string) => path.relative(rootDir, file);

    const walk = (file: string, chain: string[]): void => {
        if (visited.has(file)) return;
        visited.add(file);

        const source = parse(file);
        const here = [...chain, label(file)];

        for (const hit of moduleScopeGlobals(source)) {
            problems.push({
                kind: "global",
                detail: `${label(file)}:${hit.line} reads \`${hit.name}\` at module scope`,
                chain: here
            });
        }

        for (const { specifier, line } of valueImports(source)) {
            if (specifier.startsWith(".")) {
                const resolved = resolveRelative(file, specifier);
                if (!resolved) {
                    problems.push({
                        kind: "unresolved",
                        detail: `${label(file)}:${line} imports "${specifier}", which does not resolve to a source file`,
                        chain: here
                    });
                    continue;
                }
                walk(resolved, here);
                continue;
            }

            const bare = specifier.replace(/^node:/, "");
            if (specifier.startsWith("node:") || NODE_BUILTINS.has(bare.split("/")[0])) {
                problems.push({
                    kind: "builtin",
                    detail: `${label(file)}:${line} imports the Node built-in "${specifier}"`,
                    chain: here
                });
                continue;
            }

            const pkg = packageOf(specifier);
            if (ALLOWED_PACKAGES.has(pkg)) continue;

            const why = KNOWN_NODE_ONLY.get(pkg);
            problems.push({
                kind: "package",
                detail: why
                    ? `${label(file)}:${line} imports "${specifier}" — ${why}`
                    : `${label(file)}:${line} imports "${specifier}", which is not on the portable allowlist`,
                chain: here
            });
        }
    };

    walk(ENTRY, []);
    return { problems,
        visited: [...visited].map(label) };
}

function report(problems: Problem[]): string {
    return problems
        .map(problem => `  ✖ ${problem.detail}\n      reached via: ${problem.chain.join(" → ")}`)
        .join("\n\n");
}

describe("@rebasepro/server/functions is portable", () => {
    const { problems, visited } = auditGraph();

    it("reaches no Node built-in, and no package that needs one", () => {
        const relevant = problems.filter(p => p.kind === "builtin" || p.kind === "package");
        expect(relevant.length === 0 ? "" : `\n${report(relevant)}\n\n` +
            "A custom function imports this entry point. Anything above makes it fail to\n" +
            "load on a runtime without Node built-ins — while still working on Node, which\n" +
            "is why no other test would have caught it.\n\n" +
            "Fix by moving the import into `functions/internal.ts` (host machinery, not part\n" +
            "of the authoring surface), by making it `import type` if it is only a type, or\n" +
            "by replacing it with something that runs everywhere.\n"
        ).toBe("");
    });

    it("touches no host global at module scope", () => {
        const relevant = problems.filter(p => p.kind === "global");
        expect(relevant.length === 0 ? "" : `\n${report(relevant)}\n\n` +
            "A module-scope read of `process` or `Buffer` runs when the module is\n" +
            "*evaluated*, so it throws before the first request on a runtime that has\n" +
            "neither. Inside a function body the same read is fine.\n\n" +
            "Use `hostEnv()` from `utils/host.ts` for contextless reads, or `getEnv(c)`\n" +
            "from this entry point for request-scoped ones.\n"
        ).toBe("");
    });

    it("resolves every relative import in the graph", () => {
        const relevant = problems.filter(p => p.kind === "unresolved");
        expect(relevant.length === 0 ? "" : `\n${report(relevant)}\n`).toBe("");
    });

    it("actually walked a graph, rather than passing on an empty one", () => {
        // A refactor that empties the entry point would make every check above
        // pass for the worst possible reason.
        expect(visited.length).toBeGreaterThanOrEqual(6);
        expect(visited).toContain("src/functions/index.ts");
        expect(visited).toContain("src/functions/guards.ts");
        expect(visited).toContain("src/singleton.ts");
    });

    it("does not reach the host machinery", () => {
        // These are the modules the split exists to keep out. Naming them makes
        // the intent survive a refactor that renames the directory.
        for (const forbidden of [
            "src/functions/function-loader.ts",
            "src/functions/proxy.ts",
            "src/functions/internal.ts",
            "src/init.ts"
        ]) {
            expect(visited).not.toContain(forbidden);
        }
    });
});

describe("the portable surface keeps its shape", () => {
    /**
     * The published names. A rename or a removal here is a breaking change for
     * every function file that has been written, so it should require editing
     * this list — which is a conversation — rather than passing silently.
     */
    const PUBLISHED = [
        "defineFunction",
        "rebase",
        "getUser",
        "getUserId",
        "getRoles",
        "hasRole",
        "isAdmin",
        "isAuthenticated",
        "getDriver",
        "requireDriver",
        "getApiKey",
        "getRequestId",
        "identityResolved",
        "requireAuth",
        "requireAdmin",
        "requireRole",
        "getEnv",
        "env",
        "requireEnv",
        "runtimeKey",
        "isNodeRuntime",
        "lazyResource",
        "waitUntil",
        "ApiError"
    ];

    it("exports every documented name", async () => {
        const surface = await import("./index");
        const missing = PUBLISHED.filter(name => !(name in surface));
        expect(missing).toEqual([]);
    });

    it("exports nothing undocumented", async () => {
        const surface = await import("./index");
        const extra = Object.keys(surface).filter(name => !PUBLISHED.includes(name));
        expect(extra).toEqual([]);
    });
});
