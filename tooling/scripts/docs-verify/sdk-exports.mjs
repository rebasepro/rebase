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
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** Package entry points, relative to the monorepo root. */
export const PACKAGE_ENTRIES = {
    "@rebasepro/client": "packages/client/src/index.ts",
    "@rebasepro/server": "packages/server/src/index.ts",
    // A published subpath, and the one the documentation tells people to import
    // in a function file — so its named imports need checking like any package
    // root's. Keyed by the full specifier: `byPackage` is looked up by whatever
    // the snippet wrote.
    "@rebasepro/server/functions": "packages/server/src/functions/index.ts",
    "@rebasepro/server-postgres": "packages/server-postgres/src/index.ts",
    "@rebasepro/server-mongo": "packages/server-mongo/src/index.ts",
    "@rebasepro/client-postgres": "packages/client-postgres/src/index.ts",
    "@rebasepro/types": "packages/types/src/index.ts",
    "@rebasepro/common": "packages/common/src/index.ts",
    "@rebasepro/utils": "packages/utils/src/index.ts",
    "@rebasepro/ui": "packages/ui/src/index.ts",
    "@rebasepro/app": "packages/app/src/index.ts",
    "@rebasepro/admin": "packages/admin/src/index.ts",
    "@rebasepro/forms": "packages/forms/src/index.ts",
    "@rebasepro/studio": "packages/studio/src/index.ts",
    "@rebasepro/codegen": "packages/codegen/src/index.ts",
    "@rebasepro/inference": "packages/inference/src/index.ts",
    "@rebasepro/firebase": "packages/firebase/src/index.ts",
    "@rebasepro/plugin-ai": "packages/plugin-ai/src/index.ts",
    "@rebasepro/plugin-insights": "packages/plugin-insights/src/index.ts",
    "@rebasepro/mcp": "packages/mcp/src/index.ts"
};

/** Building the program costs ~15s; both verifier stages share one. */
let cached = null;

/**
 * @param {string} root monorepo root
 * @returns {{ ts: any, program: any, checker: any, byPackage: Map<string, Set<string>>, ownerOf: Map<string, string>, membersOf: (pkg: string, typeName: string) => Set<string> }}
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

    const entries = Object.entries(PACKAGE_ENTRIES).filter(([, rel]) =>
        existsSync(path.join(root, rel))
    );
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

    cached = { ts, program, checker, byPackage, ownerOf, membersOf };
    return cached;
}
