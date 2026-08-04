/**
 * The public API surface of the packages the platform image forces onto a bundle.
 *
 * `docker/entrypoint.mjs` symlinks exactly one package over a deployed bundle's
 * own copy — `RUNTIME_PROVIDED = ["@rebasepro/server"]`. Everything else in a
 * bundle is whatever it shipped with. So this package is the one whose exports
 * change *underneath already-deployed code*, on a schedule nobody rebuilding
 * chose: the managed tier moves projects onto new images in waves.
 *
 * That makes removing an export from it a different act than removing one
 * anywhere else. A tenant whose hooks import the removed symbol does not fail to
 * compile — it is already built — it fails at boot, in a rollout, across the
 * fleet at once. 0.13.0 removed `DatabaseConnection` and
 * `createApiKeyRateLimiter` from this package with nothing in CI to notice.
 *
 * So the surface is checked in, and `check:api-surface` diffs it. Additions are
 * fine and only need the baseline regenerated; removals and signature changes
 * are contract breaks that need a deliberate decision.
 *
 * Read from `dist/index.d.ts` rather than from source: that file IS what a
 * consumer resolves through `exports["."].types`, so it is the surface as
 * published rather than the surface as intended. Requires a build first, which
 * is why the CI step sits after "Build packages".
 *
 *     node scripts/api-surface.mjs            # print the surface
 *     node scripts/api-surface.mjs --write    # rewrite the baseline
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Only packages whose code is swapped under a deployed bundle belong here.
 * `@rebasepro/server-postgres` deliberately does NOT: a bundle keeps the driver
 * it shipped with, so changing that package cannot break already-deployed code
 * the way this one can. The skew it *does* cause is the corpus's job.
 */
const TRACKED = [
    { pkg: "@rebasepro/server", dts: "packages/server/dist/index.d.ts" }
];

export const BASELINE = path.join(ROOT, "api-surface", "server.api.txt");

/**
 * Public members of an interface/class, so losing one is caught as well as
 * losing the whole export.
 *
 * Private, protected and `_`-prefixed members are excluded on purpose. They are
 * not reachable from a tenant's code, so renaming one is not a contract change —
 * and a gate that reddens on internal refactors is a gate people learn to
 * regenerate without reading, which is worse than no gate.
 */
function memberNames(decl) {
    const members = decl.members ?? decl.type?.members;
    if (!members) return null;
    return members
        .filter(m => !m.modifiers?.some(mod =>
            mod.kind === ts.SyntaxKind.PrivateKeyword || mod.kind === ts.SyntaxKind.ProtectedKeyword))
        .map(m => m.name && ts.isIdentifier(m.name) ? m.name.text
            : m.name && ts.isStringLiteral(m.name) ? m.name.text
                : null)
        .filter(name => name && !name.startsWith("_"))
        .sort();
}

function kindOf(decl) {
    if (ts.isFunctionDeclaration(decl)) return "function";
    if (ts.isClassDeclaration(decl)) return "class";
    if (ts.isInterfaceDeclaration(decl)) return "interface";
    if (ts.isTypeAliasDeclaration(decl)) return "type";
    if (ts.isEnumDeclaration(decl)) return "enum";
    if (ts.isVariableDeclaration(decl)) return "const";
    if (ts.isModuleDeclaration(decl)) return "namespace";
    return ts.SyntaxKind[decl.kind];
}

export function extractSurface({ pkg, dts }) {
    const entry = path.join(ROOT, dts);
    if (!fs.existsSync(entry)) {
        throw new Error(
            `${pkg}: ${dts} does not exist. Build first — \`pnpm --filter ${pkg} run build\`.`
        );
    }

    const program = ts.createProgram([entry], {
        noEmit: true,
        skipLibCheck: true,
        target: ts.ScriptTarget.ES2022,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        module: ts.ModuleKind.ESNext
    });
    const checker = program.getTypeChecker();
    const source = program.getSourceFile(entry);
    if (!source) throw new Error(`${pkg}: could not load ${dts}`);

    const moduleSymbol = checker.getSymbolAtLocation(source);
    if (!moduleSymbol) throw new Error(`${pkg}: ${dts} exports nothing at all — suspicious, refusing.`);

    const lines = [];
    for (const symbol of checker.getExportsOfModule(moduleSymbol)) {
        const name = symbol.getName();
        // Follow aliases so `export { x } from "./y"` records what x actually is
        // rather than recording every re-export as an opaque alias.
        const resolved = symbol.flags & ts.SymbolFlags.Alias
            ? checker.getAliasedSymbol(symbol)
            : symbol;
        const decl = resolved.declarations?.[0] ?? symbol.declarations?.[0];
        if (!decl) {
            lines.push(`${name}  <unresolved>`);
            continue;
        }

        const kind = kindOf(decl);
        const members = memberNames(decl);
        if (members && members.length) {
            lines.push(`${kind} ${name} { ${members.join(", ")} }`);
        } else {
            lines.push(`${kind} ${name}`);
        }
    }

    // Sorted so the file is a set, not a transcript of declaration order — a
    // reordered barrel must not read as a contract change.
    return lines.sort().join("\n") + "\n";
}

export function renderAll() {
    let out =
        "# Public API surface of the runtime-provided packages.\n" +
        "# GENERATED by scripts/api-surface.mjs — do not hand-edit.\n" +
        "#\n" +
        "# These exports change underneath already-deployed bundles when the fleet\n" +
        "# is moved onto a new image. Removing one breaks tenants at boot.\n";
    for (const target of TRACKED) {
        out += `\n## ${target.pkg}\n${extractSurface(target)}`;
    }
    return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const surface = renderAll();
    if (process.argv.includes("--write")) {
        fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
        fs.writeFileSync(BASELINE, surface);
        console.log(`Wrote ${path.relative(ROOT, BASELINE)}`);
    } else {
        process.stdout.write(surface);
    }
}
