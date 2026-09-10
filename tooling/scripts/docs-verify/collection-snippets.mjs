/**
 * Turn the collection examples in the docs back into objects.
 *
 * `typecheck-snippets.mjs` compiles every fence against the real types, which
 * catches a key that is not on the type at all. It does not catch a key that is
 * on the type *somewhere else*: `admin` is an index-signature-free interface, but
 * `widget`, `defaultFilter` and `entityActions` are all real names that live one
 * level down, and a fence writing them at the top of a collection compiles
 * clean while `assertCollectionConfigs` refuses to boot on it. That is the
 * failure this module exists to make visible — the reader copies the example,
 * the server will not start, and the docs were green the whole time.
 *
 * So the fences are *run*, not just compiled, and the resulting objects are
 * handed to the same validator the server runs at boot.
 *
 * Running documentation is only possible because the examples are small and
 * their surroundings are fake by construction. Three accommodations, each
 * matching something the docs really do:
 *
 *   1. **Every import is a stub.** `defineCollection` is the identity function
 *      that also records its argument; everything else resolves to a permissive
 *      object that can be called, constructed, read from and iterated. A doc
 *      importing `usersCollection` from `"./users"` is naming a file that does
 *      not exist here, and nothing about the collection under test depends on
 *      what it holds.
 *   2. **Every free name resolves.** The sandbox's global is a proxy that
 *      reports every name as present, so `currentTenantId` in a `fixedFilter`
 *      is a value rather than a `ReferenceError`. The compiler already decides
 *      whether such a name is legitimate; this module only needs the object.
 *   3. **The body runs inside an async function**, because fences use top-level
 *      `await` freely and CommonJS output cannot.
 *
 * A fence that is genuinely a fragment — an object literal cut out of a larger
 * one — opts out with `<!-- doc-examples: fragment -->` on the line above it.
 * Sparingly: every mark is an example nobody validates.
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { createRequire } from "node:module";

import { extractSnippets } from "./extract.mjs";

const require = createRequire(import.meta.url);
/** The workspace's own TypeScript, the one every other gate here compiles with. */
const ts = require("typescript");

/** Type annotations that make a declaration a collection (or a list of them). */
const COLLECTION_TYPE_NAMES = new Set([
    "CollectionConfig",
    "PostgresCollectionConfig",
    "FirebaseCollectionConfig",
    "MongoDBCollectionConfig",
    "AnyCollectionConfig"
]);

/**
 * Docs routinely fence a React example as ```typescript rather than ```tsx.
 * Parsing that as `.ts` turns every element into a cascade of comparison
 * operators, so the body decides as well as the fence — the same heuristic
 * `typecheck-snippets.mjs` uses, for the same reason.
 */
const LOOKS_LIKE_JSX = /<\/[A-Za-z][\w.]*>|<[A-Z][\w.]*[\s/>]|<>/;

/**
 * A spread with nothing to spread: `properties: { ... }`, or a bare `…`.
 *
 * This is how every page in this repository writes "and the rest", and it is a
 * parse error by construction — `...` must be followed by an operand. Removing
 * it leaves `{ }`, which is what the sentence meant, and cannot hide a real
 * spread: `{ ...values, name }` has an operand and is left alone.
 */
const EMPTY_SPREAD = /\.\.\.(?=\s*[},\])])/g;

/** `<!-- doc-examples: fragment -->` on the line above the fence. */
const FRAGMENT_OPT_OUT = /<!--\s*doc-examples:\s*fragment\s*-->/;

/**
 * A changelog records the shape a config had when it was written. Validating
 * those against today's key lists would report every migration note this
 * repository has ever published.
 */
const EXCLUDED = [/(^|\/)CHANGELOG\.md$/];

/**
 * Docs whose fences this gate reads. English only — the locales are mirrors.
 *
 * The agent skills are in here for the same reason the docs are, only more so:
 * a person reads a doc and adapts it, an agent copies a fence verbatim into
 * somebody's `config/collections/`. They were outside every gate until
 * 2026-09-10, and two of their examples wrote a property key at the top level —
 * one of them directly beside a correct `admin: { readOnly: true }` in the same
 * literal.
 */
export const COLLECTION_DOC_GLOBS = [
    "website/src/content/docs/docs/**/*.md",
    "website/src/content/docs/docs/**/*.mdx",
    "tooling/rebase-agent-skills/skills/**/SKILL.md"
];

/**
 * A stand-in for anything the prose owns: callable, constructible, readable,
 * iterable, and `undefined` where being present would break the host.
 *
 * `then` is the one that matters. A thenable returned from an `await` is
 * awaited again, and a proxy that answers every property with a function turns
 * `await somethingStubbed()` into a promise that never settles — the fence
 * would hang the gate rather than fail it.
 */
function makeStub(label = "stub") {
    const target = function stub() { };
    return new Proxy(target, {
        get(_t, prop) {
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

/**
 * Rewrite a snippet so every top-level declaration announces its value.
 *
 * `defineCollection` records what it is handed, which covers the form the docs
 * teach. The annotated form has nothing to hook: the annotation is erased
 * before the code ever runs. Rather than reimplement scope analysis, the names
 * are read off the AST and re-declared to the recorder at the end of the body,
 * where the values already exist.
 *
 * Appended, never inserted, so a diagnostic's line still maps to the fence.
 */
function withRecorder(code, source) {
    const names = [];
    for (const statement of source.statements) {
        const declarations = ts.isVariableStatement(statement)
            ? statement.declarationList.declarations
            : [];
        for (const declaration of declarations) {
            if (!ts.isIdentifier(declaration.name)) continue;
            names.push(declaration.name.text);
        }
    }
    if (names.length === 0) return code;
    return `${code}\n;__recordDeclared({ ${names.join(", ")} });\n`;
}

/** The type name a declaration is annotated with, unwrapping `T[]`. */
function annotationName(type) {
    if (!type) return undefined;
    if (ts.isArrayTypeNode(type)) return annotationName(type.elementType);
    if (ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName)) return type.typeName.text;
    return undefined;
}

/**
 * Is this fence a collection *declaration*, rather than a page that merely says
 * the word?
 *
 * Asked of the syntax tree rather than of the text. `backend/index.md` fences
 * the `RebaseBackendConfig` interface, whose `collections?: CollectionConfig[]`
 * member matched a regular expression looking for the annotated form — and an
 * interface produces no object, so the gate reported a fence that was never a
 * config as one whose `slug` had gone missing.
 */
function declaresCollection(code, source) {
    if (/\bdefineCollection\s*\(/.test(code)) return true;
    return source.statements.some((statement) =>
        ts.isVariableStatement(statement) &&
        statement.declarationList.declarations.some((d) =>
            COLLECTION_TYPE_NAMES.has(annotationName(d.type) ?? "")));
}

/** Does this value look like somebody's collection config? */
function looksLikeCollection(value) {
    return Boolean(
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        typeof value.slug === "string"
    );
}

const isPlainObject = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);
/** A property is the one shape in this config language that always says its `type`. */
const isPropertyShaped = (v) => isPlainObject(v) && typeof v.type === "string";

/**
 * The slug a fragment is validated under.
 *
 * A fragment has no identity of its own, and the validator needs one to build
 * the paths it reports. It is prefixed so a reader of the output never mistakes
 * it for a slug the page wrote.
 */
export const FRAGMENT_SLUG = "«example»";

/**
 * Wrap an object-literal excerpt so it can be evaluated.
 *
 * Most collection examples in these docs are not programs. `relations.md` shows
 * a relation property as three lines of `author: { … }`, and the top-level
 * `widget` that would refuse to boot lived in exactly that shape — no
 * `defineCollection`, no annotation, nothing for a whole-program check to hold.
 * Skipping them would leave the gate blind to the majority of what the pages
 * teach.
 *
 * Two shapes, matching what the pages write: a fence that opens with `{` is an
 * object, and one that opens with `key:` is the inside of one.
 */
function fragmentSource(code) {
    const trimmed = code.trim();
    if (trimmed.startsWith("{")) return `const __fragment = (\n${code}\n);\n__recordFragment(__fragment);`;
    if (/^[A-Za-z_$][\w$]*\s*:/.test(trimmed)) return `const __fragment = {\n${code}\n};\n__recordFragment(__fragment);`;
    return null;
}

/**
 * What a fragment is a fragment *of*, decided by shape.
 *
 * Order matters: a `map` property carries `properties` of its own, so the
 * single-property test has to run before the collection test or every map
 * example would be validated as a collection whose keys are all unknown.
 *
 * Anything that matches none of the three — an `admin` block, a `validation`
 * block, an `enum` array — is not a config this validator can judge, and is
 * passed over rather than guessed at.
 */
function collectionsFromFragment(fragment) {
    if (isPropertyShaped(fragment)) {
        return [{ slug: FRAGMENT_SLUG, properties: { field: fragment } }];
    }
    if (isPlainObject(fragment) && isPlainObject(fragment.properties)) {
        return [{ slug: FRAGMENT_SLUG, ...fragment }];
    }
    const values = isPlainObject(fragment) ? Object.values(fragment) : [];
    if (values.length > 0 && values.every(isPropertyShaped)) {
        return [{ slug: FRAGMENT_SLUG, properties: fragment }];
    }
    return [];
}

/**
 * Every collection object a fence produces.
 *
 * @param {string} program  the code to run, already wrapped if it is a fragment
 * @returns {Promise<{ collections: object[], error: Error | null }>}
 */
async function runSnippet(program, filename) {
    const transpiled = ts.transpileModule(program, {
        fileName: filename,
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
            jsx: ts.JsxEmit.React,
            // A fence that trails off mid-expression is a fragment, and the
            // transform below throws on it — which the caller reports.
            isolatedModules: true
        },
        reportDiagnostics: false
    }).outputText;

    /** Collections in the order the fence produced them, deduplicated by identity. */
    const found = new Set();

    const record = (value) => {
        if (looksLikeCollection(value)) found.add(value);
        return value;
    };

    const recordDeclared = (bindings) => {
        for (const value of Object.values(bindings)) {
            if (Array.isArray(value)) value.forEach(record);
            else record(value);
        }
    };

    const recordFragment = (value) => {
        for (const collection of collectionsFromFragment(value)) found.add(collection);
    };

    /**
     * `defineCollection` is the identity function at runtime, which is exactly
     * what it is in the package too — so recording here changes nothing about
     * what the fence computes.
     */
    const moduleStub = new Proxy({}, {
        get(_t, prop) {
            if (prop === "defineCollection") return record;
            if (prop === "__esModule") return true;
            if (prop === "default") return makeStub("default");
            return makeStub(String(prop));
        },
        has() { return true; }
    });

    const globals = {
        require: () => moduleStub,
        module: { exports: {} },
        exports: {},
        __recordDeclared: recordDeclared,
        __recordFragment: recordFragment,
        // Also a global, not only an import: plenty of fences call
        // `defineCollection` without repeating the import line above it, and
        // one that resolved to the generic stub recorded nothing at all — the
        // gate then reported "produced no collection object" for a page whose
        // example was perfectly good.
        defineCollection: record,
        console: { log() { }, warn() { }, error() { }, info() { }, debug() { } },
        // React, because a fence may put a component in an `entityViews` entry
        // and the transform emits `React.createElement`.
        React: { createElement: () => ({}), Fragment: "Fragment" },
        Promise, Date, Math, JSON, Object, Array, String, Number, Boolean,
        RegExp, Error, Symbol, Map, Set, BigInt, URL, URLSearchParams,
        setTimeout, clearTimeout, structuredClone,
        process: { env: new Proxy({}, { get: () => "" } ) }
    };

    // Every other name the fence reaches for resolves rather than throwing:
    // scaffolding the prose owns, which the compiler already judges.
    const sandbox = new Proxy(globals, {
        has: () => true,
        get(target, prop) {
            if (prop in target) return target[prop];
            if (prop === Symbol.unscopables) return undefined;
            return makeStub(String(prop));
        }
    });

    const context = vm.createContext(sandbox);
    try {
        // Wrapped, because fences use top-level `await` and CommonJS output
        // cannot carry it.
        const result = vm.runInContext(
            `(async () => {\n${transpiled}\n})()`,
            context,
            { filename, timeout: 5000 }
        );
        await result;
    } catch (error) {
        return { collections: [...found], error };
    }
    return { collections: [...found], error: null };
}

/**
 * Every fence in the English docs that declares a collection, with the objects
 * it evaluates to.
 *
 * @param {string} root
 * @param {{ globs?: string[] }} [opts]
 */
export async function collectionSnippets(root, opts = {}) {
    const { snippets } = extractSnippets(root, opts.globs ?? COLLECTION_DOC_GLOBS);
    const results = [];
    let fragments = 0;

    for (const snippet of snippets) {
        if (EXCLUDED.some((re) => re.test(snippet.file))) continue;

        const code = snippet.code.replace(EMPTY_SPREAD, "").replace(/…/g, "");
        const jsx = /^(tsx|jsx)$/.test(snippet.lang) || LOOKS_LIKE_JSX.test(code);
        const filename = `${snippet.id}.${jsx ? "tsx" : "ts"}`;
        const source = ts.createSourceFile(
            filename, code, ts.ScriptTarget.ESNext, false,
            jsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS
        );

        const whole = declaresCollection(code, source);
        const program = whole ? withRecorder(code, source) : fragmentSource(code);
        if (!program) continue;
        if (isMarkedFragment(root, snippet)) { fragments++; continue; }

        const { collections, error } = await runSnippet(program, filename);
        // An excerpt that turned out to be neither a collection nor properties —
        // an `admin` block, a `validation` block, an `enum` — is simply not this
        // gate's business, and saying so for a few hundred fences would bury the
        // findings that are.
        if (!whole && collections.length === 0 && !error) continue;
        results.push({ snippet, collections, error, whole });
    }

    return { results, fragments };
}

/** Reads the line above the fence, which `extractSnippets` does not carry. */
const fileLines = new Map();
function isMarkedFragment(root, snippet) {
    let lines = fileLines.get(snippet.file);
    if (!lines) {
        lines = readFileSync(path.join(root, snippet.file), "utf8").split("\n");
        fileLines.set(snippet.file, lines);
    }
    // `snippet.line` is the first body line; the fence is above it, and the
    // marker above that.
    const marker = lines[snippet.line - 3];
    return typeof marker === "string" && FRAGMENT_OPT_OUT.test(marker);
}
