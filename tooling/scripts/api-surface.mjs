/**
 * The public API surface of the packages the platform image forces onto a bundle.
 *
 * `infra/docker/entrypoint.mjs` symlinks exactly one package over a deployed bundle's
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
 *     node tooling/scripts/api-surface.mjs            # print the surface
 *     node tooling/scripts/api-surface.mjs --write    # rewrite the baseline
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * The packages whose code is swapped under a deployed bundle.
 *
 * DERIVED from `infra/docker/entrypoint.mjs`, not written out here, and that is
 * the whole point. This list used to be a literal naming `@rebasepro/server`
 * alone, which was correct when it was written and stopped being correct at
 * b0a97a1f3 (2026-08-22), where the entrypoint went from symlinking one package
 * to symlinking five. Nothing connected the two, so the gate went on guarding a
 * fifth of the surface it was named after, and its own docstring kept saying
 * `RUNTIME_PROVIDED = ["@rebasepro/server"]` — the stale sentence being the only
 * remaining trace of the assumption.
 *
 * What that cost, precisely: `d99d7db9d` removed `client` from `CronJobContext`
 * in `@rebasepro/types`. This gate would have printed
 * `interface CronJobContext — lost client` on that PR, with the message about
 * breaking deployed bundles at boot. It printed nothing, because `types` was not
 * in the list. Every cron in rebase-growth then broke on promotion, silently,
 * with a clean typecheck.
 *
 * `@rebasepro/server-postgres` is deliberately absent — and is absent from the
 * entrypoint too, so deriving keeps that right for free: a bundle keeps the
 * driver it shipped with, so changing that package cannot break already-deployed
 * code the way these can. The skew it *does* cause is the corpus's job.
 */
export function runtimeProvidedPackages() {
    const src = fs.readFileSync(path.join(ROOT, "infra/docker/entrypoint.mjs"), "utf8");
    const block = /const RUNTIME_PROVIDED = \[([\s\S]*?)\]/.exec(src);
    if (!block) {
        throw new Error(
            "could not find RUNTIME_PROVIDED in infra/docker/entrypoint.mjs — " +
            "this gate derives its scope from there, and a silent empty scope is " +
            "how it came to guard one package out of five."
        );
    }
    return [...block[1].matchAll(/"(@rebasepro\/[^"]+)"/g)].map((m) => m[1]);
}

/** `@rebasepro/server` -> `packages/server/dist/index.d.ts`. */
const dtsFor = (pkg) => `packages/${pkg.replace("@rebasepro/", "")}/dist/index.d.ts`;

/**
 * Extra entry points that are published separately and carry their own contract.
 *
 * `@rebasepro/server/functions` is what every custom function imports, and those
 * functions are the user code most likely to be running unchanged across an
 * image swap. Its surface is small enough that a removal is never an accident of
 * refactoring — it is a decision, and it should have to look like one in a diff.
 */
const EXTRA_ENTRY_POINTS = [
    {
        pkg: "@rebasepro/server/functions",
        dts: "packages/server/dist/functions/index.d.ts",
        mustHaveMembers: ["rebase"]
    }
];

/**
 * Exports that MUST render with members, or the render is refused.
 *
 * A floor, in the same sense as `rls:check --min-tables`: this file spent its
 * whole life reporting `const rebase` as a bare name, because reading
 * `decl.type?.members` off a type *reference* returns nothing and nothing
 * complained about nothing. The singleton is the export every tenant hook,
 * function and cron imports, so the one entry that must never be empty is the
 * one that was empty. If a TypeScript upgrade breaks the resolution again, this
 * fails loudly instead of quietly recording a bare name.
 */
const MUST_HAVE_MEMBERS = {
    "@rebasepro/server": ["rebase"],
    "@rebasepro/types": ["CronJobContext"]
};

export const TRACKED = [
    ...runtimeProvidedPackages().map((pkg) => ({
        pkg,
        dts: dtsFor(pkg),
        mustHaveMembers: MUST_HAVE_MEMBERS[pkg] ?? []
    })),
    ...EXTRA_ENTRY_POINTS
];


export const BASELINE = path.join(ROOT, "contracts", "server.api.txt");

/**
 * Public members of an interface/class, so losing one is caught as well as
 * losing the whole export.
 *
 * Private, protected and `_`-prefixed members are excluded on purpose. They are
 * not reachable from a tenant's code, so renaming one is not a contract change —
 * and a gate that reddens on internal refactors is a gate people learn to
 * regenerate without reading, which is worse than no gate.
 */
function syntacticMemberNames(decl) {
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

/**
 * The members a declaration reaches through a *name* rather than through its own
 * syntax.
 *
 * `decl.members` is the declaration body and nothing else, which is the whole
 * story for `interface X { a: string }` and no story at all for the two shapes
 * this package exports most of its surface through:
 *
 *     export declare const rebase: RebaseServerClient;
 *     interface AuthRepository extends UserRepository, RoleRepository { }
 *
 * The first is a `TypeReferenceNode` — no `.members` — and it is the singleton
 * every tenant hook, function and cron imports. Recording it as a bare
 * `const rebase` meant `check-api-surface.mjs` computed its `goneMembers`
 * against an empty list, so dropping `rebase.email` or renaming
 * `rebase.dataAsAdmin` read as "API surface unchanged" — the exact fleet-wide
 * boot failure the top of this file exists to catch. The second loses everything
 * it inherits, and would lose its entire surface if the base were not itself
 * exported.
 *
 * Members that arrive from an ambient global declaration are dropped: `stack` and
 * `cause` on a class extending `Error` (lib.es5.d.ts), `captureStackTrace` on its
 * static side (`@types/node`), every `Array.prototype` method on an exported
 * `string[]`. Those belong to the platform, no release of this package can remove
 * them, and a baseline listing them is one people regenerate without reading.
 * Being declared in an external module is the test — every member this package
 * really owns is declared in one, whether here or in `@rebasepro/types`.
 */
function resolvedMemberNames(decl, symbol, { checker }) {
    const fromType = type => (type ? checker.getPropertiesOfType(type) : [])
        .filter(member => {
            // Zero declarations is a synthesized member — `prototype` on a class's
            // static side — and drops out of the same test, since nothing declared
            // nowhere was declared in a module.
            const decls = member.declarations ?? [];
            if (!decls.some(d => ts.isExternalModule(d.getSourceFile()))) return false;
            return !decls.some(d => ts.getCombinedModifierFlags(d) &
                (ts.ModifierFlags.Private | ts.ModifierFlags.Protected));
        })
        .map(member => member.getName());

    let names;
    if (ts.isVariableDeclaration(decl)) {
        names = fromType(checker.getTypeAtLocation(decl));
    } else if (ts.isModuleDeclaration(decl)) {
        // A namespace's exports are its members. Same blindness, same fix: there
        // is nothing to read off the declaration node.
        names = checker.getExportsOfModule(symbol).map(member => member.getName());
    } else {
        names = fromType(checker.getDeclaredTypeOfSymbol(symbol));
        if (ts.isClassDeclaration(decl)) {
            // The declared type is the instance side only, so statics — `ApiError.notFound`
            // and friends — need the static side too.
            names = names.concat(fromType(checker.getTypeOfSymbolAtLocation(symbol, decl)));
        }
    }
    return [...new Set(names)].filter(name => !name.startsWith("_")).sort();
}

/** True when the answer is behind a name, so syntax alone cannot see it. */
function resolvesThroughAName(decl) {
    if (ts.isVariableDeclaration(decl) || ts.isModuleDeclaration(decl)) return true;
    return (ts.isInterfaceDeclaration(decl) || ts.isClassDeclaration(decl))
        && Boolean(decl.heritageClauses?.length);
}

function memberNames(decl, symbol, ctx) {
    if (resolvesThroughAName(decl)) {
        const resolved = resolvedMemberNames(decl, symbol, ctx);
        if (resolved.length) return resolved;
    }
    return syntacticMemberNames(decl);
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

export function extractSurface({ pkg, dts, mustHaveMembers = [] }) {
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
        const members = memberNames(decl, resolved, { checker });
        if (members && members.length) {
            lines.push(`${kind} ${name} { ${members.join(", ")} }`);
        } else {
            if (mustHaveMembers.includes(name)) {
                throw new Error(
                    `${pkg}: \`${name}\` rendered with no members, which is how this gate went blind ` +
                    "before — a bare name has no members to lose, so nothing it loses is ever reported. " +
                    "Fix the resolution in memberNames(); do NOT regenerate the baseline."
                );
            }
            lines.push(`${kind} ${name}`);
        }
    }

    // An entry in `mustHaveMembers` that is gone from the barrel entirely is NOT
    // an error here: that is a removed export, and the diff reports it as one,
    // with a better message than this file could write.

    // Sorted so the file is a set, not a transcript of declaration order — a
    // reordered barrel must not read as a contract change.
    return lines.sort().join("\n") + "\n";
}

/** `targets` is a parameter so the gate's own tests can render a fixture surface. */
export function renderAll(targets = TRACKED) {
    let out =
        "# Public API surface of the runtime-provided packages.\n" +
        "# GENERATED by tooling/scripts/api-surface.mjs — do not hand-edit.\n" +
        "#\n" +
        "# These exports change underneath already-deployed bundles when the fleet\n" +
        "# is moved onto a new image. Removing one breaks tenants at boot.\n";
    for (const target of targets) {
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
