/**
 * A frontend may import the backend's tables as types, never as values — the
 * fast pre-check.
 *
 * `frontend/src/cms/posts.tsx` writes `import type { posts } from
 * "../../../backend/schema/posts"` so `customizeTable<typeof posts>` can check
 * every field name against the table. A *value* import of the same file puts
 * the table into the browser bundle — and with it whatever the table pulls in:
 * its hooks, the helpers they call, the server modules those import.
 *
 * **What enforces the rule is the build**, not this file: `rebaseBackendGuard()`
 * from `@rebasepro/app/vitePlugin` refuses, in every project's own Vite build
 * and dev server, any module that RESOLVES under `backend/` — whatever the
 * spelling. This is the pre-check that runs without a build: in this repo's CI
 * (`check:frontend-backend-imports`, `check:templates`) and wherever an editor
 * or agent wants an answer in milliseconds. It resolves specifiers the way the
 * build does, as far as that can be done without running Vite:
 *
 * - relative and absolute paths;
 * - tsconfig `paths` (with `baseUrl` and relative `extends`), from the
 *   nearest `tsconfig.json`;
 * - package.json subpath `imports` (`#backend/*`), from the nearest
 *   `package.json`;
 * - the backend's package name (`rebase-app-backend/...`), and any bare
 *   specifier whose `node_modules` entry is a link into the backend;
 * - `import.meta.glob` patterns (eager or lazy, a string or an array) whose
 *   matches may lie under the backend;
 * - re-exports: a value import of a module outside the scanned files (a
 *   sibling `shared/` directory, a workspace package) is followed, and an
 *   import of the backend there is reported at the frontend line that
 *   reached it;
 * - `require` bound to another name (`const r = require; r("…")`), which the
 *   bundler follows, and `createRequire(…)("…")` / `import(x)` /
 *   `require(x)` with `x` a same-file `const` string, which it does not.
 *
 * What it cannot see — a Vite `resolve.alias` that no tsconfig `paths`
 * mirrors, a specifier computed at runtime, a plugin's own resolution — is
 * the build guard's alone.
 *
 * It reads `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs` with
 * the compiler's parser, so a commented-out import or an import inside a
 * string is not reported, and the `<script>` blocks of `.vue` and `.svelte`
 * files the same way.
 *
 * A clause counts as type-only when it is written `import type …` /
 * `export type …`. `import { type posts }` does not count: with
 * `verbatimModuleSyntax` (or a bundler that preserves imports) it still loads
 * the module for its side effects, which is exactly what this rule exists to
 * stop. Say `import type`.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

/** Extensions a module specifier may leave off, in the order a bundler tries them. */
const EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte", ".json"];

/** The source files this pre-check reads. */
const SOURCE_FILE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|vue|svelte)$/;

/** A file-system view, replaceable in tests. */
function defaultHost() {
    return {
        read: file => fs.readFileSync(file, "utf8"),
        exists: file => fs.existsSync(file),
        isFile: file => {
            try {
                return fs.statSync(file).isFile();
            } catch {
                return false;
            }
        },
        realpath: file => {
            try {
                return fs.realpathSync.native(file);
            } catch {
                return file;
            }
        }
    };
}

/**
 * The file-system view for one run: the real one, or — in tests — `read`
 * (a file it returns a string for exists) and `exists` (directories too).
 */
function hostFor(read, exists) {
    const real = defaultHost();
    if (!read && !exists) return real;
    const readable = file => {
        if (!read) return false;
        try {
            return typeof read(file) === "string";
        } catch {
            return false;
        }
    };
    return {
        read: read ?? real.read,
        exists: exists ?? (file => readable(file) || real.exists(file)),
        isFile: file => readable(file) || (!read && real.isFile(file)),
        realpath: file => (real.exists(file) ? real.realpath(file) : file)
    };
}

/** `tsconfig.json` is JSONC: comments and trailing commas. */
function parseJsonc(text) {
    const parsed = ts.parseConfigFileTextToJson("tsconfig.json", text);
    return parsed.error ? undefined : parsed.config;
}

function parseJson(text) {
    try {
        return JSON.parse(text);
    } catch {
        return undefined;
    }
}

/** Whether `child` is `dir` or inside it. */
function isInside(child, dir) {
    return child === dir || child.startsWith(dir + path.sep);
}

/** Match `specifier` against a `*` pattern (tsconfig paths, package imports); the captured part, or undefined. */
function matchStar(pattern, specifier) {
    const star = pattern.indexOf("*");
    if (star < 0) return pattern === specifier ? "" : undefined;
    const prefix = pattern.slice(0, star);
    const suffix = pattern.slice(star + 1);
    if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix) || specifier.length < prefix.length + suffix.length) return undefined;
    return specifier.slice(prefix.length, specifier.length - suffix.length);
}

/** The first string target of a package.json `imports`/`exports` value (conditions in browser-build order). */
function conditionalTarget(value) {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) {
        for (const item of value) {
            const target = conditionalTarget(item);
            if (target) return target;
        }
        return undefined;
    }
    if (value && typeof value === "object") {
        for (const condition of ["browser", "import", "module", "development", "production", "default"]) {
            if (condition in value) {
                const target = conditionalTarget(value[condition]);
                if (target) return target;
            }
        }
    }
    return undefined;
}

/**
 * Resolves specifiers the way the frontend's build does, as far as a static
 * read can: returns candidate absolute paths (unresolved extensions are fine:
 * a candidate under the backend is the answer whether or not a file exists).
 */
class Resolver {
    constructor(host, backend) {
        this.host = host;
        this.backend = backend;
        this.tsconfigCache = new Map();
        this.packageCache = new Map();
        const manifest = host.exists(path.join(backend, "package.json"))
            ? parseJson(host.read(path.join(backend, "package.json")))
            : undefined;
        this.backendPackage = typeof manifest?.name === "string" ? manifest.name : undefined;
    }

    /** The nearest file named `name` above `dir`. */
    nearest(dir, name, cache) {
        const seen = [];
        let current = dir;
        for (;;) {
            if (cache.has(current)) {
                const found = cache.get(current);
                for (const d of seen) cache.set(d, found);
                return found;
            }
            seen.push(current);
            const candidate = path.join(current, name);
            if (this.host.exists(candidate)) {
                for (const d of seen) cache.set(d, candidate);
                return candidate;
            }
            const parent = path.dirname(current);
            if (parent === current) {
                for (const d of seen) cache.set(d, undefined);
                return undefined;
            }
            current = parent;
        }
    }

    /** `{ baseUrl, paths }` of a tsconfig, following relative `extends`. */
    compilerPaths(file, depth = 0) {
        if (depth > 8 || !this.host.exists(file)) return undefined;
        const config = parseJsonc(this.host.read(file));
        if (!config) return undefined;
        const dir = path.dirname(file);
        let inherited;
        const extendsList = Array.isArray(config.extends) ? config.extends : config.extends ? [config.extends] : [];
        for (const base of extendsList) {
            if (typeof base !== "string" || !base.startsWith(".")) continue;
            const target = path.resolve(dir, base.endsWith(".json") ? base : `${base}.json`);
            inherited = this.compilerPaths(target, depth + 1) ?? inherited;
        }
        const options = config.compilerOptions ?? {};
        const baseUrl = typeof options.baseUrl === "string" ? path.resolve(dir, options.baseUrl) : inherited?.baseUrl;
        if (options.paths && typeof options.paths === "object") {
            return { baseUrl, paths: options.paths, pathsDir: baseUrl ?? dir };
        }
        return inherited ? { ...inherited, baseUrl } : baseUrl ? { baseUrl, paths: {}, pathsDir: baseUrl } : undefined;
    }

    fromTsconfig(fromDir, specifier) {
        const tsconfig = this.nearest(fromDir, "tsconfig.json", this.tsconfigCache);
        if (!tsconfig) return [];
        const compiled = this.compilerPaths(tsconfig);
        if (!compiled) return [];
        const out = [];
        for (const [pattern, targets] of Object.entries(compiled.paths)) {
            const captured = matchStar(pattern, specifier);
            if (captured === undefined || !Array.isArray(targets)) continue;
            for (const target of targets) {
                if (typeof target === "string") out.push(path.resolve(compiled.pathsDir, target.replace("*", captured)));
            }
        }
        if (out.length === 0 && compiled.baseUrl && !specifier.startsWith("#")) out.push(path.resolve(compiled.baseUrl, specifier));
        return out;
    }

    fromPackageImports(fromDir, specifier) {
        const manifestFile = this.nearest(fromDir, "package.json", this.packageCache);
        if (!manifestFile) return [];
        const manifest = parseJson(this.host.read(manifestFile));
        const imports = manifest?.imports;
        if (!imports || typeof imports !== "object") return [];
        const out = [];
        for (const [pattern, value] of Object.entries(imports)) {
            const captured = matchStar(pattern, specifier);
            const target = captured === undefined ? undefined : conditionalTarget(value);
            if (target === undefined) continue;
            const filled = target.replaceAll("*", captured);
            if (filled.startsWith(".")) out.push(path.resolve(path.dirname(manifestFile), filled));
            else out.push(...this.fromBareSpecifier(path.dirname(manifestFile), filled));
        }
        return out;
    }

    /** A package name: the backend's own, or one whose `node_modules` link points into the backend. */
    fromBareSpecifier(fromDir, specifier) {
        const parts = specifier.split("/");
        const name = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
        const rest = parts.slice(specifier.startsWith("@") ? 2 : 1).join("/");
        if (this.backendPackage && name === this.backendPackage) return [path.join(this.backend, rest)];
        let current = fromDir;
        for (;;) {
            const link = path.join(current, "node_modules", name);
            if (this.host.exists(link)) return [path.join(this.host.realpath(link), rest)];
            const parent = path.dirname(current);
            if (parent === current) return [];
            current = parent;
        }
    }

    /** Every place `specifier`, imported from `fromFile`, may land. */
    candidates(fromFile, specifier) {
        const dir = path.dirname(fromFile);
        // `?raw`, `?url`: the same file. A `#subpath` keeps its `#`.
        const bare = specifier.startsWith("#") ? specifier : specifier.replace(/[?#].*$/, "");
        if (bare.startsWith("./") || bare.startsWith("../") || bare === "." || bare === "..") return [path.resolve(dir, bare)];
        if (path.isAbsolute(bare)) return [bare];
        if (bare.startsWith("#")) return this.fromPackageImports(dir, bare);
        if (/^[a-z][a-z0-9+.-]*:/i.test(bare)) return [];
        return [...this.fromTsconfig(dir, bare), ...this.fromBareSpecifier(dir, bare)];
    }

    /**
     * Where a glob pattern searches from. Vite reads a pattern that starts
     * with `/` from the project's root, not the file system's: the directory
     * of the importer's nearest package.json stands in for it.
     */
    globCandidates(fromFile, pattern) {
        if (pattern.startsWith("/")) {
            const manifest = this.nearest(path.dirname(fromFile), "package.json", this.packageCache);
            return [path.join(manifest ? path.dirname(manifest) : path.dirname(fromFile), pattern)];
        }
        return this.candidates(fromFile, pattern);
    }

    inBackend(candidate) {
        return isInside(this.realOf(candidate), this.backend);
    }

    /** The real path of a candidate whose tail may not exist. */
    realOf(candidate) {
        let current = candidate;
        const missing = [];
        for (;;) {
            if (this.host.exists(current)) return path.join(this.host.realpath(current), ...missing.reverse());
            const parent = path.dirname(current);
            if (parent === current) return candidate;
            missing.push(path.basename(current));
            current = parent;
        }
    }

    /** The file a candidate names, trying extensions and `index` files. */
    file(candidate) {
        if (this.host.isFile(candidate)) return candidate;
        for (const extension of EXTENSIONS) {
            if (this.host.isFile(candidate + extension)) return candidate + extension;
        }
        for (const extension of EXTENSIONS) {
            const index = path.join(candidate, `index${extension}`);
            if (this.host.isFile(index)) return index;
        }
        return undefined;
    }
}

/** The directory a glob pattern can match under: its path up to the first segment with a glob character. */
function globBase(pattern) {
    const segments = pattern.split("/");
    const fixed = [];
    for (const segment of segments) {
        if (/[*?{}[\]!]/.test(segment)) break;
        fixed.push(segment);
    }
    const complete = fixed.length === segments.length;
    return { base: fixed.join("/") || ".", complete };
}

/**
 * The script blocks of a `.vue` / `.svelte` file, each with the line its
 * content starts on (0-based), or the whole file for any other source.
 */
function scriptsOf(file, text) {
    if (!/\.(vue|svelte)$/.test(file)) return [{ code: text, lineOffset: 0, tsx: /\.(tsx|jsx)$/.test(file) }];
    const out = [];
    const block = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;
    for (const match of text.matchAll(block)) {
        const start = match.index + match[0].indexOf(">") + 1;
        out.push({
            code: match[2],
            lineOffset: text.slice(0, start).split("\n").length - 1,
            tsx: /\blang=["']tsx["']/.test(match[1])
        });
    }
    return out;
}

/** Every module a file loads at runtime, as written: `{ line, specifier, form, glob? }`. */
function runtimeImports(file, text) {
    const found = [];
    for (const { code, lineOffset, tsx } of scriptsOf(file, text)) {
        const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, tsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
        const lineOf = node => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 + lineOffset;
        // Same-file `const x = "…"`, and names `require` is bound to.
        const constants = new Map();
        const requires = new Set(["require"]);
        const collect = node => {
            if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
                const list = node.parent;
                const isConst = ts.isVariableDeclarationList(list) && (list.flags & ts.NodeFlags.Const) !== 0;
                if (isConst && ts.isStringLiteralLike(node.initializer)) constants.set(node.name.text, node.initializer.text);
                if (ts.isIdentifier(node.initializer) && node.initializer.text === "require") requires.add(node.name.text);
            }
            ts.forEachChild(node, collect);
        };
        collect(source);
        const stringOf = node => {
            if (!node) return undefined;
            if (ts.isStringLiteralLike(node)) return node.text;
            if (ts.isIdentifier(node)) return constants.get(node.text);
            return undefined;
        };
        const push = (node, specifier, form, glob = false) => found.push({ line: lineOf(node), specifier, form, glob });

        const visit = node => {
            if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
                const clause = node.importClause;
                if (!(clause !== undefined && clause.isTypeOnly)) push(node, node.moduleSpecifier.text, clause ? "import" : "side-effect import");
            } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
                if (!node.isTypeOnly) push(node, node.moduleSpecifier.text, "export … from");
            } else if (ts.isImportEqualsDeclaration(node)
                && ts.isExternalModuleReference(node.moduleReference)
                && ts.isStringLiteral(node.moduleReference.expression)) {
                if (!node.isTypeOnly) push(node, node.moduleReference.expression.text, "import = require");
            } else if (ts.isCallExpression(node) && node.arguments.length > 0) {
                const callee = node.expression;
                const first = node.arguments[0];
                if (callee.kind === ts.SyntaxKind.ImportKeyword) {
                    const specifier = stringOf(first);
                    if (specifier !== undefined) push(node, specifier, "import()");
                } else if (ts.isIdentifier(callee) && requires.has(callee.text)) {
                    const specifier = stringOf(first);
                    if (specifier !== undefined) push(node, specifier, "require()");
                } else if (ts.isCallExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === "createRequire") {
                    const specifier = stringOf(first);
                    if (specifier !== undefined) push(node, specifier, "createRequire()");
                } else if (ts.isPropertyAccessExpression(callee) && callee.name.text === "glob"
                    && ts.isMetaProperty(callee.expression) && callee.expression.keywordToken === ts.SyntaxKind.ImportKeyword) {
                    const patterns = ts.isArrayLiteralExpression(first) ? first.elements : [first];
                    for (const element of patterns) {
                        const pattern = stringOf(element);
                        if (pattern !== undefined && !pattern.startsWith("!")) push(node, pattern, "import.meta.glob", true);
                    }
                }
            }
            ts.forEachChild(node, visit);
        };
        visit(source);
    }
    return found;
}

/**
 * Every value import, in `files`, of a module under `backendDir`.
 *
 * @param {object} options
 * @param {string[]} options.files absolute paths of the frontend files to read
 * @param {string} options.backendDir absolute path of the backend directory nothing may import a value from
 * @param {(file: string) => string} [options.read] how to read a file (for tests)
 * @param {(file: string) => boolean} [options.exists] whether a path exists (for tests; default: the file system, or `read` succeeding when only `read` is given)
 * @returns {{ file: string, line: number, specifier: string, form: string, via?: string[] }[]}
 *   one entry per offending import, 1-based lines; `via` lists the modules outside `files` an import went through to reach the backend
 */
export function findValueImportsOfBackend({ files, backendDir, read, exists }) {
    const host = hostFor(read, exists);
    const backend = host.exists(backendDir) ? host.realpath(path.resolve(backendDir)) : path.resolve(backendDir);
    const resolver = new Resolver(host, backend);
    const scanned = new Set(files.map(file => path.resolve(file)));
    /** For a module outside `files`: the chain of modules through which it reaches the backend, or null. */
    const reachCache = new Map();

    const reachesBackend = (file, stack) => {
        if (reachCache.has(file)) return reachCache.get(file);
        if (stack.has(file)) return null;
        stack.add(file);
        let result = null;
        let text;
        try {
            text = host.read(file);
        } catch {
            text = undefined;
        }
        if (text !== undefined) {
            for (const imported of runtimeImports(file, text)) {
                const hit = judge(file, imported, stack);
                if (hit) {
                    result = [file, ...hit.via];
                    break;
                }
            }
        }
        stack.delete(file);
        reachCache.set(file, result);
        return result;
    };

    /** `{ via }` when this import reaches the backend (directly: `via` is empty), else null. */
    const judge = (fromFile, imported, stack) => {
        if (imported.glob) {
            for (const candidate of resolver.globCandidates(fromFile, imported.specifier)) {
                const { base } = globBase(candidate);
                const real = resolver.realOf(base);
                // The pattern's fixed part is in the backend, or the backend is under where it searches.
                if (isInside(real, backend) || isInside(backend, real)) return { via: [] };
            }
            return null;
        }
        for (const candidate of resolver.candidates(fromFile, imported.specifier)) {
            if (resolver.inBackend(candidate)) return { via: [] };
            const target = resolver.file(candidate);
            if (!target) continue;
            const real = host.realpath(target);
            if (scanned.has(target) || scanned.has(real) || /[\\/]node_modules[\\/]/.test(real)) continue;
            if (!SOURCE_FILE.test(real)) continue;
            const via = reachesBackend(real, stack);
            if (via) return { via };
        }
        return null;
    };

    const findings = [];
    for (const file of files) {
        const text = host.read(file);
        for (const imported of runtimeImports(file, text)) {
            const hit = judge(file, imported, new Set([path.resolve(file)]));
            if (!hit) continue;
            findings.push({
                file,
                line: imported.line,
                specifier: imported.specifier,
                form: imported.form,
                ...(hit.via.length > 0 ? { via: hit.via } : {})
            });
        }
    }
    return findings;
}

/**
 * Forms this pre-check cannot judge, and why: the build guard
 * (`rebaseBackendGuard`) is what refuses them. Printed by the gates beside a
 * clean result, so nobody reads a green pre-check as the whole answer.
 */
export const BUILD_GUARD_ONLY = [
    "a Vite `resolve.alias` that no tsconfig `paths` entry mirrors — the alias lives in code (vite.config), not data",
    "a specifier computed at runtime or held in anything but a same-file `const` string",
    "resolution a Vite plugin performs itself"
];

/** Every source file under `dir` this pre-check reads, skipping `node_modules`, build output and declaration files. */
export function sourceFilesUnder(dir) {
    const out = [];
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...sourceFilesUnder(full));
        else if (SOURCE_FILE.test(entry.name) && !/\.d\.[cm]?ts$/.test(entry.name)) out.push(full);
    }
    return out;
}
