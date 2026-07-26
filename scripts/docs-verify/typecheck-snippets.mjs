/**
 * Typechecks the fenced ts/js blocks in the English docs and the agent skills
 * against the *workspace source* of `@rebasepro/*` (via tsconfig.typecheck.json
 * paths), so a renamed or removed API breaks the docs build instead of breaking
 * the reader.
 *
 * Docs snippets are fragments, not programs: they reference `client` without
 * constructing it, import from `../config/collections`, and lean on scaffolding
 * variables that only exist in the surrounding prose. Three accommodations make
 * them checkable without gutting the check:
 *
 *   1. Unresolvable imports (relative paths, `virtual:` ids, deps the monorepo
 *      does not carry) are rewritten to a shorthand ambient module, so they
 *      type as `any` instead of erroring. `@rebasepro/*` is never stubbed —
 *      that is the surface under test.
 *   2. Free identifiers are discovered by *compiling twice*: pass 1 collects
 *      the compiler's own "Cannot find name" diagnostics, pass 2 re-runs with a
 *      synthesized prelude. Using real scope resolution avoids reimplementing
 *      it. A name the SDK exports is auto-imported so it keeps its real type;
 *      anything else becomes `declare const x: any`.
 *   3. The prelude occupies exactly one line, so mapping a diagnostic back to
 *      `doc.md:line` is arithmetic rather than a source map.
 *
 * What survives all that is the part worth checking: member access and call
 * signatures on real SDK types. `channel.on("message", …)` fails because
 * `RebaseRealtimeChannel` has no `on`.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { extractSnippets } from "./extract.mjs";
import { loadSdkExports } from "./sdk-exports.mjs";

const require = createRequire(import.meta.url);

/** Ambients that must keep their real SDK type — the whole point of the check. */
const TYPED_AMBIENTS = {
    client: { type: "CreateRebaseClientResult", from: "@rebasepro/client" },
    rebase: { type: "CreateRebaseClientResult", from: "@rebasepro/client" },
    rebaseClient: { type: "CreateRebaseClientResult", from: "@rebasepro/client" },
    channel: { type: "RebaseRealtimeChannel", from: "@rebasepro/client" }
};

/**
 * Names that belong to a third-party module even though a `@rebasepro/*`
 * barrel also exports something by that name. Auto-importing the SDK's `Hono`
 * when the snippet means hono's `Hono` produces a cascade of confident-looking
 * nonsense, so pin these explicitly.
 */
const THIRD_PARTY_AMBIENTS = {
    Hono: { from: "hono", named: "Hono" },
    z: { from: "zod", named: "z" },
    React: { from: "react", namespace: true }
};

/**
 * Names the SDK exports but which docs overwhelmingly mean in another sense.
 * Two groups: types that collide with a platform type (node's `http.Server`,
 * not the MCP `Server`), and lowercase conventional local-variable names that
 * happen to match an export — `{ server, app }` in an options object is the
 * reader's own server, not `@rebasepro/*`'s. Stub rather than auto-import.
 */
const NEVER_AUTO_IMPORT = new Set([
    "Server", "Context", "Client", "Config", "Options",
    "server", "app", "db", "env", "router", "handler", "collections", "storage"
]);

/**
 * A permissive stand-in for a name the prose owns, declared in both the value
 * and type namespaces.
 *
 * The value stays `any`: it is assignable in both directions, which a concrete
 * callable-object type is not (trying that traded ~30 spurious "not generic"
 * errors for ~150 spurious "not assignable" ones). The *type* alias is generic
 * only so that `FieldProps<string>` does not report "Type 'X' is not generic",
 * which reads like a docs bug but is an artefact of the stub.
 */
const anyValue = (name) => `declare const ${name}: any;`;
const anyType = (name) => `type ${name}<A = any, B = any, C = any> = any;`;

/**
 * Diagnostics meaning "this name is not in scope" — the pass-1 signal.
 * 18004 is the object-shorthand form (`{ server, app }` with nothing in scope),
 * which reports differently from a bare reference but means the same thing.
 */
const UNBOUND_NAME_CODES = new Set([2304, 2552, 18004]);
/** "Cannot find module" — should not survive import rewriting; report if it does. */
const MODULE_NOT_FOUND = 2307;

/**
 * Suppressed because they fire on well-formed fragments rather than on drift.
 * The bar: would a reader copying this block hit a *runtime* failure? Missing
 * parameter annotations and unguarded nulls are prose economy, not a wrong API;
 * a property that does not exist is the bug we are hunting.
 */
const IGNORED_CODES = new Set([
    1005, 1109, 1128, 1160, 1161, 1434, // fragment/parse artefacts
    6133, 6196, // declared but never read
    2451, // redeclared block-scoped variable (same name across sibling snippets)
    2657, // "JSX expressions must have one parent" — sibling elements in a fragment
    7006, 7031, 7005, 7034, // implicit any (docs elide parameter types by design)
    2454 // "used before being assigned" across an elided section
]);

function isStubbable(specifier, root) {
    if (specifier.startsWith("@rebasepro/")) return false; // the surface under test
    if (specifier.startsWith(".") || specifier.startsWith("/")) return true;
    if (specifier.includes(":")) return true; // virtual:, node:… (node: resolves anyway)
    try {
        // Resolve from the packages that actually depend on these, not just the
        // workspace root. `react`, `hono` and `zod` are not root dependencies, so
        // resolving from the root alone stubbed them out — and a stubbed module is
        // `any`, which silently un-checks every snippet that imports it. That is how
        // `useRef<HTMLDivElement>(null)` came to report "untyped function calls may
        // not accept type arguments": React was never really in the program.
        require.resolve(specifier, {
            paths: [
                root,
                path.join(root, "packages/app"),
                path.join(root, "packages/server"),
                path.join(root, "packages/admin")
            ]
        });
        return false;
    } catch {
        return true;
    }
}

/** Rewrites unresolvable import/export specifiers in place, preserving line count. */
function rewriteImports(code, root) {
    return code.replace(
        /(\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)(["'])([^"'\n]+)\2/gm,
        (match, lead, quote, spec) =>
            isStubbable(spec, root) ? `${lead}${quote}docsverify-stub:${spec}${quote}` : match
    );
}

/**
 * Docs routinely fence a React example as ```typescript rather than ```tsx.
 * Parsing that as `.ts` turns every element into a cascade of comparison-
 * operator errors, so infer JSX from the body as well as the fence.
 */
const LOOKS_LIKE_JSX = /<\/[A-Za-z][\w.]*>|<[A-Z][\w.]*[\s/>]|<>/;

function scratchName(snippet) {
    const ext =
        /^(tsx|jsx)$/.test(snippet.lang) || LOOKS_LIKE_JSX.test(snippet.code) ? "tsx" : "ts";
    return `${snippet.id}.${ext}`;
}

/**
 * Builds the single-line prelude for a snippet from the names pass 1 found
 * unbound.
 */
function buildPrelude(missing, ownerOf) {
    if (!missing.size) return "";
    /** @type {Map<string, Set<string>>} */
    const imports = new Map();
    const declares = [];

    const namespaceImports = [];

    for (const name of [...missing].sort()) {
        const typed = TYPED_AMBIENTS[name];
        if (typed) {
            if (!imports.has(typed.from)) imports.set(typed.from, new Set());
            imports.get(typed.from).add(typed.type);
            declares.push(`declare const ${name}: ${typed.type};`);
            continue;
        }
        const thirdParty = THIRD_PARTY_AMBIENTS[name];
        if (thirdParty) {
            if (thirdParty.namespace) {
                namespaceImports.push(`import * as ${name} from "${thirdParty.from}";`);
            } else {
                if (!imports.has(thirdParty.from)) imports.set(thirdParty.from, new Set());
                imports.get(thirdParty.from).add(thirdParty.named);
            }
            continue;
        }
        const owner = NEVER_AUTO_IMPORT.has(name) ? undefined : ownerOf.get(name);
        if (owner) {
            // The SDK really exports this — import it so it keeps its real type
            // and a future rename surfaces here.
            if (!imports.has(owner)) imports.set(owner, new Set());
            imports.get(owner).add(name);
            continue;
        }
        // Not an SDK symbol: scaffolding the prose owns. Declare it in both the
        // value and type namespaces — docs use such names either way
        // (`const p: Product = …` next to `Product.find(…)`), and a value-only
        // declaration turns the type usage into a spurious TS2749.
        declares.push(`${anyValue(name)} ${anyType(name)}`);
    }

    const importLines = [...imports].map(
        ([from, names]) => `import { ${[...names].sort().join(", ")} } from "${from}";`
    );
    return [...importLines, ...namespaceImports, ...declares].join(" ");
}

/**
 * @param {string} root
 * @param {object} [opts]
 * @param {string[]} [opts.globs]
 * @returns {Promise<{ failures: Array<object>, snippetCount: number, skipped: number, files: number, stubbed: Map<string, number> }>}
 */
export async function typecheckSnippets(root, opts = {}) {
    const { ts, ownerOf } = loadSdkExports(root);
    const { snippets, skipped, files } = extractSnippets(root, opts.globs);

    const scratch = path.join(root, "node_modules/.cache/docs-verify");
    rmSync(scratch, { recursive: true, force: true });
    mkdirSync(scratch, { recursive: true });

    const prepared = snippets.map((s) => ({
        snippet: s,
        name: scratchName(s),
        code: rewriteImports(s.code, root)
    }));

    // Stub modules for specifiers we cannot resolve. A shorthand ambient
    // (`declare module "x";`) would type every import as `any`, but `any` from
    // a shorthand module is not usable in *type* position — and docs do exactly
    // that with generated schema types (`createRebaseClient<Database>()`). So
    // emit a real module per specifier, declaring each imported name in both
    // the value and type namespaces.
    const stubImports = new Map();
    for (const p of prepared) {
        for (const m of p.code.matchAll(
            /import\s+(?:type\s+)?(?:(\*\s+as\s+[\w$]+|[\w$]+)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s*["'](docsverify-stub:[^"']+)["']/g
        )) {
            if (!stubImports.has(m[3])) stubImports.set(m[3], new Set());
            const names = stubImports.get(m[3]);
            for (const raw of (m[2] || "").replace(/\/\/[^\n]*/g, "").split(",")) {
                const name = raw.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop()?.trim();
                if (name && /^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
            }
        }
    }
    const stubBody = [...stubImports]
        .map(([spec, names]) => {
            const members = [...names]
                .map((n) => `    export ${anyValue(n).replace(/^declare /, "")}\n    export ${anyType(n)}`)
                .join("\n");
            return `declare module "${spec}" {\n${members}\n    const _default: any;\n    export default _default;\n}`;
        })
        .join("\n");
    // `import.meta.env.VITE_*` is a Vite ambient, not an SDK API. The compiler options
    // below ask for `vite/client`, but vite is not a dependency of the workspace root,
    // so that request silently resolves to nothing and every frontend snippet reading
    // `import.meta.env` reported a missing property. Declaring it here needs no
    // dependency and cannot drift.
    const importMetaEnv = [
        "interface ImportMetaEnv { readonly [key: string]: string | boolean | undefined }",
        "interface ImportMeta { readonly env: ImportMetaEnv }"
    ].join("\n");
    writeFileSync(
        path.join(scratch, "stubs.d.ts"),
        // The wildcard catches specifiers with no named imports.
        `declare module "docsverify-stub:*";\n${importMetaEnv}\n${stubBody}\n`
    );

    const configPath = path.join(root, "tsconfig.typecheck.json");
    const parsed = ts.parseJsonConfigFileContent(
        ts.readConfigFile(configPath, ts.sys.readFile).config,
        ts.sys,
        root
    );
    const options = {
        ...parsed.options,
        noEmit: true,
        noUnusedLocals: false,
        noUnusedParameters: false,
        allowUnreachableCode: true,
        skipLibCheck: true,
        // Fragments legitimately fall off the end of a function.
        noImplicitReturns: false,
        // Docs omit parameter annotations and null guards for readability.
        // Neither can express API drift, and leaving them on buries the
        // diagnostics that can under hundreds that cannot.
        noImplicitAny: false,
        strictNullChecks: false,
        strictPropertyInitialization: false,
        // Frontend snippets read `import.meta.env.VITE_*`, which is a Vite
        // ambient rather than an SDK API.
        types: [...(parsed.options.types ?? []), "vite/client"],
        // Backend snippets legitimately import `hono` and `zod`. Neither is a
        // dependency of the workspace root, and `tsconfig.typecheck.json` maps hono to
        // `node_modules/hono`, which does not exist — that mapping only ever worked for
        // files sitting inside `packages/server`, whose own node_modules has both.
        // Snippets compile from a scratch directory, so they need the real location or
        // every backend example reports a missing module.
        paths: {
            ...(parsed.options.paths ?? {}),
            hono: [path.join(root, "packages/server/node_modules/hono")],
            "hono/*": [path.join(root, "packages/server/node_modules/hono/*")],
            zod: [path.join(root, "packages/server/node_modules/zod")],
            // React is not a root dependency either, so `useRef<HTMLDivElement>(null)` in a
            // frontend snippet hit "untyped function calls may not accept type arguments" —
            // the stub had swallowed the whole module.
            // Point at the *types*, not the runtime package: React ships no declarations
            // of its own, so mapping the JS package leaves every call untyped.
            react: [path.join(root, "node_modules/.pnpm/node_modules/@types/react")],
            "react-dom": [path.join(root, "node_modules/.pnpm/node_modules/@types/react-dom")],
            // Same story for the backend's own dependencies: resolvable from
            // packages/server, invisible from the scratch directory snippets compile in.
            "drizzle-orm": [path.join(root, "packages/server/node_modules/drizzle-orm")],
            "drizzle-orm/*": [path.join(root, "packages/server/node_modules/drizzle-orm/*")],
            "@hono/node-server": [path.join(root, "packages/server/node_modules/@hono/node-server")]
        }
    };

    const stubDecl = path.join(scratch, "stubs.d.ts");

    /** Writes scratch files with the given per-snippet prelude and compiles. */
    function compile(preludeFor) {
        // @rebasepro/admin-types declares a collection's and a property's `admin`
        // block onto the core types by declaration merging. Documentation examples are
        // CMS examples, so the program needs it or every `admin: { … }` in a fence is
        // an error. Added as a *file* rather than a `/// <reference types>`: that
        // directive resolves through typeRoots, which cannot see the workspace `paths`
        // this program relies on.
        const fileNames = [stubDecl, path.join(root, "packages/admin-types/src/augment.ts")];
        for (const p of prepared) {
            const prelude = preludeFor(p);
            const file = path.join(scratch, p.name);
            // Prelude is exactly one line; `export {}` forces module scope so
            // snippets cannot collide in the global namespace.
            writeFileSync(file, `${prelude}\n${p.code}\nexport {};\n`);
            p.file = file;
            fileNames.push(file);
        }
        const program = ts.createProgram(fileNames, options);
        /** @type {Map<string, import("typescript").Diagnostic[]>} */
        const byFile = new Map();
        for (const p of prepared) {
            const sf = program.getSourceFile(p.file);
            if (!sf) continue;
            const diags = [
                ...program.getSemanticDiagnostics(sf),
                ...program.getSyntacticDiagnostics(sf)
            ].filter((d) => !IGNORED_CODES.has(d.code));
            byFile.set(p.name, diags);
        }
        return byFile;
    }

    // ── Pass 1: no prelude. Harvest the names the compiler cannot resolve. ──
    const pass1 = compile(() => "");
    for (const p of prepared) {
        const missing = new Set();
        for (const d of pass1.get(p.name) || []) {
            if (!UNBOUND_NAME_CODES.has(d.code)) continue;
            const text = ts.flattenDiagnosticMessageText(d.messageText, " ");
            const m =
                /Cannot find name '([^']+)'/.exec(text) ||
                /shorthand property '([^']+)'/.exec(text);
            if (m) missing.add(m[1]);
        }
        p.prelude = buildPrelude(missing, ownerOf);
        p.stubbedNames = missing;
    }

    // ── Pass 2: with preludes. Whatever remains is a real finding. ──
    const pass2 = compile((p) => p.prelude);

    const failures = [];
    const stubbed = new Map();
    for (const p of prepared) {
        for (const n of p.stubbedNames) stubbed.set(n, (stubbed.get(n) || 0) + 1);
        const diags = pass2.get(p.name) || [];
        if (!diags.length) continue;
        const messages = diags.map((d) => {
            const { line } = d.file
                ? d.file.getLineAndCharacterOfPosition(d.start ?? 0)
                : { line: 0 };
            // scratch line 0 is the prelude; snippet body starts at scratch line 1.
            const docLine = p.snippet.line + Math.max(0, line - 1);
            return {
                code: d.code,
                docLine,
                text: ts.flattenDiagnosticMessageText(d.messageText, " ")
            };
        });
        failures.push({ snippet: p.snippet, messages });
    }

    return { failures, snippetCount: snippets.length, skipped, files, stubbed, MODULE_NOT_FOUND };
}
