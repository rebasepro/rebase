/**
 * Resolves the *public* export surface of the workspace `@rebasepro/*` packages
 * by asking the TypeScript compiler, rather than regexing `index.ts`. Barrels
 * re-export across packages (`@rebasepro/client` republishes types from
 * `@rebasepro/types`), so a textual scan both misses names and invents them.
 *
 * Two consumers:
 *   - the snippet typechecker, to auto-import SDK symbols a doc used without
 *     showing the import line;
 *   - the locale API-name check, as the allowlist of symbols docs may mention.
 */
import path from "node:path";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/**
 * The packages the docs may import from, SDK-first.
 *
 * The order is the contract: when two packages export the same name, `ownerOf`
 * keeps the first, and "import `EntityCollection` from `@rebasepro/client`" is
 * better advice than "from `@rebasepro/inference`". Membership is not a
 * contract — {@link packageEntries} derives the actual map from each package's
 * own `exports`, so a published subpath cannot be absent from it.
 */
const PACKAGE_ORDER = [
    "@rebasepro/client",
    "@rebasepro/server",
    "@rebasepro/server-postgres",
    "@rebasepro/server-mongo",
    "@rebasepro/types",
    "@rebasepro/common",
    "@rebasepro/utils",
    "@rebasepro/ui",
    "@rebasepro/app",
    "@rebasepro/cms",
    // The React-flavoured half of the type surface, and the package a scaffold
    // actually installs: `AdminPropertyOptions`, `FieldProps`, `EntityCollection`
    // and the rest of the admin vocabulary live here, not in `@rebasepro/types`.
    "@rebasepro/cms-types",
    "@rebasepro/forms",
    "@rebasepro/studio",
    "@rebasepro/codegen",
    "@rebasepro/inference",
    "@rebasepro/firebase",
    "@rebasepro/plugin-ai",
    "@rebasepro/plugin-insights",
    "@rebasepro/mcp"
];

/**
 * A published subpath's source file, from its `types` condition.
 *
 * `"./dist/editor/index.d.ts"` is built from `src/editor/index.ts`. Every
 * package in this workspace builds `dist/` out of `src/` with the same layout,
 * so the mapping is a rename rather than a lookup.
 *
 * @param {unknown} target the value of one `exports` key
 * @returns {string | null} a path relative to the package, or null if this
 *   subpath is not TypeScript the verifier could load
 */
function sourceOfSubpath(target) {
    const types = typeof target === "string"
        ? (target.endsWith(".d.ts") ? target : null)
        : (target && typeof target === "object" ? target.types : null);
    if (typeof types !== "string" || !types.endsWith(".d.ts")) return null;
    return types.replace(/^\.\/dist\//, "src/").replace(/\.d\.ts$/, ".ts");
}

/**
 * Package entry points, relative to the monorepo root, derived from each
 * package's own `exports` map.
 *
 * Hand-written, this listed one of the workspace's published subpaths.
 * `@rebasepro/cms/editor` and `@rebasepro/cms/collection_editor_ui` were not in
 * it, and the name check *skips* a specifier it has no export set for — so four
 * fences in the agent skills importing `RichTextEditor` from
 * `@rebasepro/cms/editor` asserted nothing at all. Deriving the map means a new
 * subpath is covered the day it is published rather than the day someone
 * notices.
 *
 * A subpath with no `types` — `./package.json`, the `.css` bundles — is not a
 * module anyone imports names from and is skipped.
 */
export const PACKAGE_ENTRIES = packageEntries();

function packageEntries() {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    /** @type {Record<string, string>} */
    const entries = {};
    const dirs = readdirSync(path.join(root, "packages"), { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);

    /** @type {Map<string, { dir: string, manifest: any }>} */
    const byName = new Map();
    for (const dir of dirs) {
        const manifestPath = path.join(root, "packages", dir, "package.json");
        if (!existsSync(manifestPath)) continue;
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
        if (manifest.name) byName.set(manifest.name, { dir, manifest });
    }

    // Ordered packages first, then anything else the workspace publishes, so a
    // new package is covered without being ranked.
    const names = [
        ...PACKAGE_ORDER.filter(n => byName.has(n)),
        ...[...byName.keys()].filter(n => !PACKAGE_ORDER.includes(n)).sort()
    ];

    for (const name of names) {
        const { dir, manifest } = byName.get(name);
        const rel = sub => `packages/${dir}/${sub}`;
        entries[name] = rel("src/index.ts");
        const exported = manifest.exports;
        if (!exported || typeof exported !== "object") continue;
        for (const [subpath, target] of Object.entries(exported)) {
            if (subpath === ".") continue;
            const source = sourceOfSubpath(target);
            if (!source) continue;
            entries[`${name}${subpath.slice(1)}`] = rel(source);
        }
    }
    return entries;
}

/** Building the program costs ~15s; both verifier stages share one. */
let cached = null;

/**
 * @param {string} root monorepo root
 * @returns {{ ts: any, program: any, checker: any, byPackage: Map<string, Set<string>>, ownerOf: Map<string, string>, membersOf: (pkg: string, typeName: string) => Set<string>, missingEntries: Array<{ specifier: string, entry: string }> }}
 *   `byPackage` maps a specifier to its exported names; `ownerOf` maps an
 *   exported name to the package that should be imported from for it. When a
 *   name is exported by several packages the first entry in PACKAGE_ENTRIES
 *   wins, which is why the map is ordered SDK-first.
 */
export function loadSdkExports(root) {
    if (cached) return cached;
    const ts = require(path.join(root, "node_modules/typescript"));
    const configPath = path.join(root, "tsconfig.typecheck.json");
    const parsed = ts.parseJsonConfigFileContent(
        ts.readConfigFile(configPath, ts.sys.readFile).config,
        ts.sys,
        root
    );

    // An entry whose file has moved or whose package was deleted used to be
    // filtered out here in silence, and a specifier with no export set is
    // *skipped* by the name check rather than failing it — so a stale entry
    // reads as "clean" for every fence that imports it. Record them instead.
    const all = Object.entries(PACKAGE_ENTRIES);
    const entries = all.filter(([, rel]) => existsSync(path.join(root, rel)));
    const missingEntries = all
        .filter(([, rel]) => !existsSync(path.join(root, rel)))
        .map(([specifier, rel]) => ({ specifier, entry: rel }));
    const program = ts.createProgram(
        entries.map(([, rel]) => path.join(root, rel)),
        { ...parsed.options, noEmit: true }
    );
    const checker = program.getTypeChecker();

    const byPackage = new Map();
    const ownerOf = new Map();

    for (const [specifier, rel] of entries) {
        const sourceFile = program.getSourceFile(path.join(root, rel));
        if (!sourceFile) continue;
        const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
        if (!moduleSymbol) continue;

        const names = new Set();
        for (const sym of checker.getExportsOfModule(moduleSymbol)) {
            names.add(sym.getName());
            if (!ownerOf.has(sym.getName())) ownerOf.set(sym.getName(), specifier);
        }
        byPackage.set(specifier, names);
    }

    /**
     * Property names of an exported type — used to check documented member
     * access (`channel.on(...)`) against the real surface, in every locale.
     * Returns an empty set if the type cannot be resolved, so callers degrade
     * to "no check" rather than to "everything is wrong".
     */
    function membersOf(pkg, typeName) {
        const rel = PACKAGE_ENTRIES[pkg];
        const sourceFile = rel && program.getSourceFile(path.join(root, rel));
        if (!sourceFile) return new Set();
        const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
        if (!moduleSymbol) return new Set();
        const sym = checker
            .getExportsOfModule(moduleSymbol)
            .find((s) => s.getName() === typeName);
        if (!sym) return new Set();

        const declared = checker.getDeclaredTypeOfSymbol(
            sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym
        );
        const type =
            declared && declared.getProperties().length
                ? declared
                : checker.getTypeOfSymbolAtLocation(sym, sourceFile);
        // Public members only. A `private send()` is not part of the documented
        // surface, so treating it as known would let `channel.send(...)` — one
        // of the invented APIs this check exists to catch — pass silently.
        const isPublic = (sym) =>
            !sym.declarations?.some((d) =>
                ts
                    .getCombinedModifierFlags(d)
                    // eslint-disable-next-line no-bitwise
                    & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)
            );
        return new Set(
            type
                .getProperties()
                .filter(isPublic)
                .map((p) => p.getName())
        );
    }

    cached = { ts, program, checker, byPackage, ownerOf, membersOf, missingEntries };
    return cached;
}
