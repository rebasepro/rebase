/**
 * Run the table examples in the docs through the real builders and the real
 * compiler.
 *
 * `typecheck-snippets.mjs` compiles every fence against the real types, which
 * catches a key or a modifier that does not exist. It does not catch what only
 * the schema compiler knows: a table with no primary key, an `rls` the
 * compiler refuses, a relation whose bound column has the wrong type, two
 * modifiers that contradict each other, a feature `rebase db generate` cannot
 * plan yet. Each of those typechecks, reads perfectly and stops `db generate`,
 * `db push` and boot with a `SchemaDefinitionError`. That is the failure this
 * module exists to make visible — the reader copies the example, the backend
 * will not start, and the docs were green the whole time.
 *
 * So the fences are *run* with the builders from `@rebasepro/types` (what
 * `@rebasepro/server/schema` re-exports), and the definitions they produce are
 * handed to `compileTables` and then `lowerTables` from `@rebasepro/common` —
 * the two steps every door that reads `backend/schema` takes. A
 * `customizeTable(…)` call is run through the real `customizeTable`, which
 * refuses an unknown option, a legacy `admin` name or a component that is not
 * a value.
 *
 * Running documentation is only possible because the examples are small and
 * their surroundings are fake by construction. The accommodations, each
 * matching something the docs really do:
 *
 *   1. **Imports.** The builders resolve to the real ones; `customizeTable` to
 *      the real one; every other name to a permissive stub that can be called,
 *      constructed, read from and iterated.
 *   2. **A page is a project.** A page shows `posts.ts` in one fence and
 *      `users.ts` in the next, and `posts` imports `users` from `"./users"`. A
 *      relative import, or a free name, resolves to a table another fence on
 *      the same page declares under that name — lazily, because relation
 *      targets are thunks the compiler calls after every fence has run. Each
 *      fence's tables are compiled together with the page's other tables, and
 *      only the fence's own problems are reported at it.
 *   3. **What a page does not show is not judged.** A relation to a table the
 *      page never declares points at a stub; its target problem is the
 *      reader's project's business, and is not reported. A table with
 *      `rls: "inherit"` on a page with no `defaultRls` gets an admin-only
 *      project default, as it would from the reader's `backend/schema/index.ts`.
 *   4. **The body runs inside an async function**, because fences use
 *      top-level `await` freely and CommonJS output cannot.
 *
 * A fence that is an excerpt — `title: col.text().notNull()` — is wrapped into
 * a table and compiled too (given an admin-only `rls`, and a primary key when
 * it shows none), so a column chain the compiler refuses is caught where the
 * docs teach it. One that is genuinely not runnable opts out with
 * `<!-- doc-examples: fragment -->` on the line above it. Sparingly: every mark
 * is an example nobody validates.
 *
 * The module imports TypeScript sources, so its caller runs under tsx with
 * `TSX_TSCONFIG_PATH=tsconfig.typecheck.json` (`pnpm check:doc-examples`).
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { createRequire } from "node:module";

import { extractSnippets } from "./extract.mjs";

const require = createRequire(import.meta.url);
/** The workspace's own TypeScript, the one every other gate here compiles with. */
const ts = require("typescript");

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");

const types = await import(path.join(ROOT, "packages/types/src/index.ts"));
const compiler = await import(path.join(ROOT, "packages/common/src/schema/index.ts"));
const cms = await import(path.join(ROOT, "packages/cms/src/tables/customize_table.ts"));

/** The builder names a schema file imports, and where they come from. */
const BUILDER_NAMES = ["defineTable", "defineAuthTable", "defineView", "col", "rel", "json", "pgEnum", "sql", "policy", "isTableDef", "isAuthTableDef", "isViewDef"];

/** The packages a schema fence imports the builders from. */
const SCHEMA_PACKAGES = new Set(["@rebasepro/server/schema", "@rebasepro/server", "@rebasepro/types", "@rebasepro/common"]);

/** The project default a page with no `defaultRls` is compiled with. */
export const ASSUMED_DEFAULT_RLS = Object.freeze([{ operation: "all", roles: ["admin"] }]);

/** The name an excerpt's wrapping table is given, prefixed so nobody mistakes it for one a page wrote. */
export const FRAGMENT_TABLE = "example_fragment";

/** A call that makes a fence a schema declaration or a customization. */
const DECLARES = /\b(?:defineTable|defineAuthTable|defineView)\s*\(|\bcustomizeTable\s*(?:<[^()]*?>)?\s*\(/;

/** See `typecheck-snippets.mjs`: docs fence React as ```typescript too. */
const LOOKS_LIKE_JSX = /<\/[A-Za-z][\w.]*>|<[A-Z][\w.]*[\s/>]|<>/;

/** `{ ... }` / a bare `…`: how the pages write "and the rest". */
const EMPTY_SPREAD = /\.\.\.(?=\s*[},\])])/g;

/** `<!-- doc-examples: fragment -->` on the line above the fence. */
const FRAGMENT_OPT_OUT = /<!--\s*doc-examples:\s*fragment\s*-->/;

/**
 * A changelog and an upgrade page record the shape an API had when they were
 * written; their fences are history, held to the API of their version by the
 * names stage, not to today's compiler.
 */
const EXCLUDED = [/(^|\/)CHANGELOG\.md$/, /\/upgrading\//];

/**
 * Docs whose fences this gate reads. English only — the locales are mirrors.
 *
 * The agent skills are in here for the same reason the docs are, only more so:
 * a person reads a doc and adapts it, an agent copies a fence verbatim into
 * somebody's `backend/schema/`.
 */
export const TABLE_DOC_GLOBS = [
    "website/src/content/docs/docs/**/*.md",
    "website/src/content/docs/docs/**/*.mdx",
    "tooling/rebase-agent-skills/skills/**/SKILL.md"
];

const STUB = Symbol("docs-stub");

/**
 * A stand-in for anything the prose owns: callable, constructible, readable,
 * iterable, and `undefined` where being present would break the host (`then`,
 * or an awaited stub never settles).
 */
function makeStub(label = "stub") {
    const target = function stub() { };
    return new Proxy(target, {
        get(_t, prop) {
            if (prop === STUB) return true;
            if (prop === "then") return undefined;
            if (prop === Symbol.toPrimitive) return () => label;
            if (prop === Symbol.iterator) return function* () { };
            if (prop === Symbol.asyncIterator) return async function* () { };
            if (prop === "toString") return () => label;
            if (prop === "constructor") return target;
            if (prop === "prototype") return target.prototype;
            return makeStub(label);
        },
        has() { return true; },
        apply() { return makeStub(label); },
        construct() { return makeStub(label); }
    });
}

const isStub = (value) => (typeof value === "function" || typeof value === "object") && value !== null && value[STUB] === true;
const isPlainObject = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v) && !isStub(v);
const isSchemaDef = (v) => types.isTableDef(v) || types.isViewDef(v);

/** The names of the top-level `const`/`let`/`var` bindings and function declarations. */
function topLevelNames(source) {
    const names = [];
    for (const statement of source.statements) {
        if (ts.isVariableStatement(statement)) {
            for (const declaration of statement.declarationList.declarations) {
                if (ts.isIdentifier(declaration.name)) names.push(declaration.name.text);
            }
        }
    }
    return names;
}

/**
 * Wrap an object-literal excerpt so it can be evaluated: a fence opening with
 * `{` is an object, one opening with `key:` is the inside of one.
 */
function fragmentSource(code) {
    const trimmed = code.trim();
    if (trimmed.startsWith("{")) return `const __fragment = (\n${code}\n);\n__recordFragment(__fragment);`;
    if (/^[A-Za-z_$][\w$]*\s*:/.test(trimmed)) return `const __fragment = {\n${code}\n};\n__recordFragment(__fragment);`;
    return null;
}

/**
 * A table definition for an excerpt, when it is one this gate can judge:
 * a table config (it has `columns`), or a set of columns. Relation and option
 * excerpts name tables and components the page owns, and are passed over.
 */
function tableFromFragment(fragment) {
    if (!isPlainObject(fragment)) return null;
    if (isPlainObject(fragment.columns) && Object.values(fragment.columns).every(types.isColumnBuilder)) {
        return types.defineTable(FRAGMENT_TABLE, { rls: "admin-only", ...fragment });
    }
    const values = Object.values(fragment);
    if (values.length > 0 && values.every(types.isColumnBuilder)) {
        const hasKey = values.some(column => column.def.primaryKey);
        const columns = hasKey ? fragment : { example_id: types.col.text().primaryKey(), ...fragment };
        return types.defineTable(FRAGMENT_TABLE, { columns, rls: "admin-only" });
    }
    return null;
}

/**
 * Evaluate one fence.
 *
 * @param {string} program the code to run, already wrapped if it is a fragment
 * @param {string} filename
 * @param {(name: string) => unknown} pageBinding a table another fence on the page declares under `name`
 */
async function runSnippet(program, filename, pageBinding) {
    const transpiled = ts.transpileModule(program, {
        fileName: filename,
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
            jsx: ts.JsxEmit.React,
            isolatedModules: true
        },
        reportDiagnostics: false
    }).outputText;

    /** Definitions in the order the fence made them. */
    const defs = [];
    /** Every customization the fence made, or the error `customizeTable` threw. */
    const customizations = [];
    /** Top-level bindings, by name, for the page. */
    const bindings = new Map();
    let fragment;

    const recording = (builder) => (...args) => {
        const def = builder(...args);
        defs.push(def);
        return def;
    };
    const real = {
        ...Object.fromEntries(BUILDER_NAMES.map(name => [name, types[name]])),
        defineTable: recording(types.defineTable),
        defineAuthTable: recording(types.defineAuthTable),
        defineView: recording(types.defineView),
        composeTableHooks: compiler.composeTableHooks,
        customizeTable: (...args) => {
            const result = cms.customizeTable(...args);
            customizations.push(result);
            return result;
        }
    };

    const packageModule = (specifier) => new Proxy({}, {
        get(_t, prop) {
            if (prop === "__esModule") return true;
            if (typeof prop === "string" && prop in real && (SCHEMA_PACKAGES.has(specifier) || (specifier === "@rebasepro/cms" && prop === "customizeTable"))) {
                return real[prop];
            }
            if (prop === "default") return makeStub("default");
            return makeStub(String(prop));
        },
        has() { return true; }
    });

    /** A sibling file: what another fence on the page declares, read when it is used. */
    const relativeModule = new Proxy({}, {
        get(_t, prop) {
            if (prop === "__esModule") return true;
            if (typeof prop !== "string") return undefined;
            return pageBinding(prop) ?? makeStub(prop);
        },
        has() { return true; }
    });

    const moduleExports = {};
    const globals = {
        require: (specifier) => specifier.startsWith(".") ? relativeModule : packageModule(specifier),
        module: { exports: moduleExports },
        exports: moduleExports,
        __recordBindings: (values) => { for (const [k, v] of Object.entries(values)) bindings.set(k, v); },
        __recordFragment: (value) => { fragment = value; },
        // Also globals, not only imports: plenty of fences call the builders
        // without repeating the import line above them.
        ...real,
        console: { log() { }, warn() { }, error() { }, info() { }, debug() { } },
        React: { createElement: () => ({}), Fragment: "Fragment" },
        Promise, Date, Math, JSON, Object, Array, String, Number, Boolean,
        RegExp, Error, Symbol, Map, Set, BigInt, URL, URLSearchParams,
        setTimeout, clearTimeout, structuredClone,
        process: { env: new Proxy({}, { get: () => "" }) }
    };

    const sandbox = new Proxy(globals, {
        has: () => true,
        get(target, prop) {
            if (prop in target) return target[prop];
            if (prop === Symbol.unscopables) return undefined;
            if (typeof prop === "string") return pageBinding(prop) ?? makeStub(prop);
            return undefined;
        }
    });

    let error = null;
    try {
        await vm.runInContext(`(async () => {\n${transpiled}\n})()`, vm.createContext(sandbox), { filename, timeout: 5000 });
    } catch (e) {
        error = e;
    }
    for (const [name, value] of Object.entries(moduleExports)) bindings.set(name, value);
    return { defs, customizations, bindings, fragment, error };
}

/** Appended, never inserted, so a diagnostic's line still maps to the fence. */
function withRecorder(code, source) {
    const names = topLevelNames(source);
    if (names.length === 0) return code;
    // Each read guarded: a binding in its temporal dead zone (the fence threw
    // before reaching it) must not hide the error that put it there.
    const reads = names.map(n => `try { __b.${n} = ${n}; } catch { }`).join(" ");
    return `${code}\n;{ const __b = {}; ${reads} __recordBindings(__b); }\n`;
}

/** Reads the line above the fence, which `extractSnippets` does not carry. */
const fileLines = new Map();
function isMarkedFragment(root, snippet) {
    let lines = fileLines.get(snippet.file);
    if (!lines) {
        lines = readFileSync(path.join(root, snippet.file), "utf8").split("\n");
        fileLines.set(snippet.file, lines);
    }
    const marker = lines[snippet.line - 3];
    return typeof marker === "string" && FRAGMENT_OPT_OUT.test(marker);
}

/** The relation keys of `def` whose target is a stub: a table the page does not show. */
function relationsToUnshownTables(def) {
    const keys = new Set();
    const relations = def.config?.relations ?? {};
    for (const [key, relation] of Object.entries(relations)) {
        let target;
        try {
            target = relation.target();
        } catch {
            continue; // the compiler reports a throwing thunk itself
        }
        if (isStub(target)) keys.add(key);
    }
    return keys;
}

/** Every problem `fn` reports through a SchemaDefinitionError; anything else is rethrown. */
function problemsOf(fn) {
    try {
        fn();
        return [];
    } catch (error) {
        if (compiler.isSchemaDefinitionError(error)) return [...error.problems];
        throw error;
    }
}

/**
 * Every schema or customization fence in the English docs, evaluated, with the
 * problems the compiler, the lowering and `customizeTable` find in it.
 *
 * @param {string} root
 * @param {{ globs?: string[] }} [opts]
 * @returns {Promise<{ results: Array<{ snippet: object, tables: number, customizations: number, problems: string[], error: Error | null, whole: boolean }>, fragments: number }>}
 */
export async function tableSnippets(root, opts = {}) {
    const { snippets } = extractSnippets(root, opts.globs ?? TABLE_DOC_GLOBS);
    let fragments = 0;

    /** Pass 1: run every fence, page by page, so a page's bindings are complete before anything is compiled. */
    const runs = [];
    /** @type {Map<string, Map<string, unknown>>} */
    const pageBindings = new Map();

    for (const snippet of snippets) {
        if (EXCLUDED.some((re) => re.test(snippet.file))) continue;

        const code = snippet.code.replace(EMPTY_SPREAD, "").replace(/…/g, "");
        const whole = DECLARES.test(code);
        const jsx = /^(tsx|jsx)$/.test(snippet.lang) || LOOKS_LIKE_JSX.test(code);
        const filename = `${snippet.id}.${jsx ? "tsx" : "ts"}`;
        let program;
        if (whole) {
            const source = ts.createSourceFile(filename, code, ts.ScriptTarget.ESNext, false, jsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
            program = withRecorder(code, source);
        } else {
            // An excerpt is judged only when it builds columns or a table config.
            if (!/\bcol\.\w+\s*\(/.test(code)) continue;
            program = fragmentSource(code);
            if (!program) continue;
        }
        if (isMarkedFragment(root, snippet)) { fragments++; continue; }

        if (!pageBindings.has(snippet.file)) pageBindings.set(snippet.file, new Map());
        const page = pageBindings.get(snippet.file);
        const run = await runSnippet(program, filename, (name) => page.get(name));
        for (const [name, value] of run.bindings) {
            if ((isSchemaDef(value) || name === "defaultRls") && !page.has(name)) page.set(name, value);
        }
        runs.push({ snippet, whole, ...run });
    }

    /** Pass 2: compile each fence's tables with the page's. */
    const results = [];
    for (const run of runs) {
        const { snippet, whole, error, customizations } = run;
        let own = run.defs;
        if (!whole) {
            if (error) { results.push({ snippet, tables: 0, customizations: 0, problems: [], error, whole }); continue; }
            let table;
            try {
                table = tableFromFragment(run.fragment);
            } catch (e) {
                results.push({ snippet, tables: 0, customizations: 0, problems: [], error: e, whole }); continue;
            }
            if (!table) continue;
            own = [table];
        }

        const page = pageBindings.get(snippet.file);
        const ownNames = new Set(own.map(def => def.name));
        const borrowed = [];
        for (const value of page.values()) {
            if (!isSchemaDef(value) || own.includes(value) || ownNames.has(value.name)) continue;
            if (borrowed.some(def => def.name === value.name)) continue;
            borrowed.push(value);
        }
        const defaultRls = run.bindings.get("defaultRls") ?? page.get("defaultRls") ?? ASSUMED_DEFAULT_RLS;

        const unshown = new Map(own.map(def => [def.name, relationsToUnshownTables(def)]));
        const problems = [];
        if (own.length > 0) {
            const defs = [...own, ...borrowed];
            const found = [
                ...problemsOf(() => compiler.compileTables(defs, { defaultRls })),
                ...problemsOf(() => compiler.lowerTables(defs, { defaultRls }))
            ];
            for (const problem of found) {
                if (!ownNames.has(problem.table)) continue;
                if (problem.key && unshown.get(problem.table)?.has(problem.key)) continue;
                const where = problem.key ? `${problem.table}.${problem.key}` : problem.table;
                const line = `${where}: ${problem.message}`;
                if (!problems.includes(line)) problems.push(line);
            }
        }
        results.push({ snippet, tables: own.length, customizations: customizations.length, problems, error, whole });
    }

    return { results, fragments };
}
