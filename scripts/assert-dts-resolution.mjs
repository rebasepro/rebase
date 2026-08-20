#!/usr/bin/env node
/**
 * Fail a build whose published types resolve to `any`.
 *
 * A package's `.d.ts` can be present, complete, and still useless. If the
 * declarations use extensionless relative specifiers (`from "./init"`) and the
 * package is `"type": "module"`, TypeScript's `node16`/`nodenext` resolution
 * rejects them — and then does something worse than erroring: it resolves the
 * *package* fine and silently types the whole thing as `any`.
 *
 * There is no diagnostic at the import site. The only symptom is an implicit-any
 * error in the **consumer's own file**, which reads as their tsconfig being
 * broken. `moduleResolution: "node"` and `"bundler"` are unaffected, so nothing
 * in this repository ever saw it: the scaffolded backend compiles with `node`,
 * the docs verifier uses path mappings onto source, and `pnpm typecheck`
 * resolves `@rebasepro/*` to source too. Every gate looked at something other
 * than the published artifact.
 *
 * So this one looks at the artifact, the way a stranger's project would: it
 * installs the package into a throwaway directory by symlink, imports it as a
 * namespace, and asks the type checker one question — **is this `any`?** That
 * question needs no knowledge of the package's API, which is why the same probe
 * covers all twenty packages and keeps working as they change.
 *
 * Run in all three resolution modes, because they fail differently:
 *
 *   - `node10`  — ignores `exports`; a subpath with no redirect directory is
 *                 TS2307 "Cannot find module".
 *   - `bundler` — reads `exports`, tolerates extensionless relative specifiers.
 *                 The mode most likely to pass while the others do not.
 *   - `nodenext`— reads `exports`, rejects extensionless relative specifiers.
 *                 The silent-`any` mode.
 *
 * Usage:
 *   node scripts/assert-dts-resolution.mjs <package-dir> [...more]
 *   node scripts/assert-dts-resolution.mjs --all
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const ts = require(path.join(ROOT, "node_modules/typescript"));

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const NC = "\x1b[0m";

/**
 * The three ways a consumer can be configured, and what each one is worth
 * catching.
 *
 * `module` is pinned per mode because TypeScript refuses some combinations —
 * `nodenext` resolution demands `nodenext` module, and `bundler` resolution
 * requires an ESM module target.
 */
const MODES = [
    {
        name: "node10",
        options: {
            module: ts.ModuleKind.ESNext,
            moduleResolution: ts.ModuleResolutionKind.Node10,
            ignoreDeprecations: "6.0"
        }
    },
    {
        name: "bundler",
        options: {
            module: ts.ModuleKind.ESNext,
            moduleResolution: ts.ModuleResolutionKind.Bundler
        }
    },
    {
        name: "nodenext",
        options: {
            module: ts.ModuleKind.NodeNext,
            moduleResolution: ts.ModuleResolutionKind.NodeNext
        }
    }
];

/** Extensions that mean "this export is not a module a type checker can read". */
const NON_MODULE = [".css", ".svg", ".png", ".json", ".woff", ".woff2"];

/**
 * Subpaths that must work under node10, and who breaks if they stop.
 *
 * Support for a subpath under node10 is otherwise inferred from the presence of
 * a redirect directory — which makes deleting the redirect a silent loss of
 * coverage rather than a failure. For a subpath something in this repository
 * actually depends on, that is not good enough: the file would go, the probe
 * would quietly check one mode fewer, and the breakage would surface in a
 * generated project nobody here runs `tsc` on.
 */
const REQUIRED_NODE10_SUBPATHS = {
    "@rebasepro/server": {
        functions: "the backend `rebase init` scaffolds compiles with " +
            "`moduleResolution: \"node\"`, and its example function imports this subpath"
    }
};

/** Whatever an `exports` entry points at, whether it is a string or a map. */
function exportTarget(value) {
    if (typeof value === "string") return value;
    if (!value || typeof value !== "object") return undefined;
    return value.types ?? value.import ?? value.default ?? Object.values(value).find(v => typeof v === "string");
}

/**
 * Every entry point a consumer may import, and which resolution modes are
 * expected to reach it.
 *
 * The root is expected in all three: `main`/`types` are read by every mode,
 * including node10, which ignores `exports` entirely.
 *
 * A **subpath** is a different question, and the honest answer is not "all
 * three". node10 cannot see `exports` at all, so a subpath only works there if
 * the package ships a redirect directory for it — an opt-in, not an oversight.
 * Demanding one everywhere would mean adding files to `@rebasepro/admin` and
 * `@rebasepro/app` whose subpaths are imported exclusively from Vite configs
 * and React apps, all of which resolve with `bundler`. The one node10 consumer
 * in this system is the scaffolded backend (`moduleResolution: "node"`), and
 * the one subpath it imports is `@rebasepro/server/functions`, which ships the
 * redirect. So: node10 is checked wherever the package claims to support it,
 * and the claim is the redirect's presence.
 */
function entrySpecifiers(packageDir, manifest) {
    const entries = [{ specifier: manifest.name, modes: MODES, kind: "root" }];

    for (const [key, value] of Object.entries(manifest.exports ?? {})) {
        if (key === "." || key.endsWith("package.json") || key.includes("*")) continue;

        const target = exportTarget(value);
        if (target && NON_MODULE.some(extension => target.endsWith(extension))) continue;

        const subpath = key.replace(/^\.\//, "");
        const hasRedirect = fs.existsSync(path.join(packageDir, subpath, "package.json"));
        const required = REQUIRED_NODE10_SUBPATHS[manifest.name]?.[subpath];
        entries.push({
            specifier: path.posix.join(manifest.name, subpath),
            modes: hasRedirect || required ? MODES : MODES.filter(mode => mode.name !== "node10"),
            requiredReason: required,
            kind: hasRedirect ? "subpath+node10" : "subpath"
        });
    }

    return entries;
}

/**
 * A throwaway project with the package installed by symlink.
 *
 * Symlink rather than copy so the probe reads exactly the bytes that would be
 * published, and so the package's own `node_modules` — where its dependencies'
 * types live — stays reachable by ordinary upward resolution from inside its
 * `dist`.
 */
function stageConsumer(packageDir, manifest) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-dts-probe-"));
    const scoped = manifest.name.startsWith("@");
    const target = scoped
        ? path.join(dir, "node_modules", manifest.name.split("/")[0])
        : path.join(dir, "node_modules");
    fs.mkdirSync(target, { recursive: true });
    fs.symlinkSync(
        packageDir,
        path.join(dir, "node_modules", manifest.name),
        "dir"
    );
    return dir;
}

/** Symbol flags that mean "this export exists at runtime and has a type". */
// eslint-disable-next-line no-bitwise
const VALUE_FLAGS = ts.SymbolFlags.Function | ts.SymbolFlags.Variable | ts.SymbolFlags.Class | ts.SymbolFlags.Enum;

/**
 * Inspect one namespace import in one resolution mode.
 *
 * Not "did it compile" — a degraded import compiles perfectly, which is the
 * whole problem. What is measured is the **surface the checker can actually
 * see**: which names the module exports, and which of those carry a real type
 * rather than `any`.
 *
 * Type-only exports are counted separately and never judged: asking for the
 * type of an `interface` at a value position legitimately answers `any`, so
 * including them would report every healthy package as broken. Value exports —
 * functions, consts, classes — are the honest signal.
 */
function inspect(consumerDir, specifier, mode, packageDir) {
    const fixture = path.join(consumerDir, `probe-${mode.name}.ts`);
    fs.writeFileSync(
        fixture,
        `import * as probed from ${JSON.stringify(specifier)};\nexport const used = probed;\n`,
        "utf8"
    );

    const program = ts.createProgram([fixture], {
        noEmit: true,
        strict: true,
        target: ts.ScriptTarget.ES2022,
        // Errors inside third-party `@types` are not this probe's business.
        // `explain()` re-checks without this when a failure needs a cause.
        skipLibCheck: true,
        ...mode.options
    });

    const source = program.getSourceFile(fixture);
    const checker = program.getTypeChecker();

    const unresolved = ts
        .getPreEmitDiagnostics(program, source)
        .filter(diagnostic => diagnostic.code === 2307);

    if (unresolved.length > 0) {
        return {
            mode: mode.name,
            resolved: false,
            reason: ts.flattenDiagnosticMessageText(unresolved[0].messageText, " ")
        };
    }

    const declaration = source?.statements.find(ts.isImportDeclaration);
    const nameNode = declaration?.importClause?.namedBindings;
    if (!nameNode) return { mode: mode.name, resolved: false, reason: "probe fixture did not parse" };

    const local = checker.getSymbolAtLocation(nameNode.name);
    // eslint-disable-next-line no-bitwise
    const moduleSymbol = local && (local.flags & ts.SymbolFlags.Alias)
        ? checker.getAliasedSymbol(local)
        : local;
    if (!moduleSymbol) return { mode: mode.name, resolved: false, reason: "no module symbol" };

    const exported = checker.getExportsOfModule(moduleSymbol);
    const names = new Set(exported.map(symbol => symbol.getName()));
    const valueNames = new Set();
    const anyValued = [];

    for (const symbol of exported) {
        // eslint-disable-next-line no-bitwise
        const target = (symbol.flags & ts.SymbolFlags.Alias) ? checker.getAliasedSymbol(symbol) : symbol;
        // eslint-disable-next-line no-bitwise
        if (!(target.flags & VALUE_FLAGS)) continue;
        valueNames.add(symbol.getName());
        const type = checker.getTypeOfSymbolAtLocation(target, nameNode);
        // eslint-disable-next-line no-bitwise
        if (type.flags & ts.TypeFlags.Any) anyValued.push(symbol.getName());
    }

    return {
        mode: mode.name,
        resolved: true,
        fixture,
        names,
        valueNames,
        anyValued
    };
}

/** Why the declarations were discarded — the diagnostics inside the package. */
function explain(fixture, mode, packageDir) {
    const program = ts.createProgram([fixture], {
        noEmit: true,
        strict: true,
        target: ts.ScriptTarget.ES2022,
        skipLibCheck: false,
        ...mode.options
    });

    const inPackage = ts
        .getPreEmitDiagnostics(program)
        .filter(diagnostic => diagnostic.file?.fileName.startsWith(packageDir.replace(/\\/g, "/")));

    if (inPackage.length === 0) return undefined;
    const first = inPackage[0];
    const { line } = first.file.getLineAndCharacterOfPosition(first.start ?? 0);
    return `${path.relative(ROOT, first.file.fileName)}:${line + 1} TS${first.code}: ` +
        `${ts.flattenDiagnosticMessageText(first.messageText, " ")} (${inPackage.length} such)`;
}

function checkPackage(packageDirInput) {
    // Relative to the caller. `--all` passes repo-root-relative paths and is
    // only ever run from there; an explicit argument should mean what it says
    // from wherever it was typed.
    const packageDir = path.resolve(process.cwd(), packageDirInput);
    const manifestPath = path.join(packageDir, "package.json");
    if (!fs.existsSync(manifestPath)) {
        return { name: packageDirInput, skipped: "no package.json" };
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const types = manifest.types ?? manifest.typings;
    if (!types || !fs.existsSync(path.join(packageDir, types))) {
        // Not built. Saying so beats passing: a probe that silently skips an
        // unbuilt package is a green check that means nothing.
        return { name: manifest.name, skipped: "not built (no declarations)" };
    }

    const consumerDir = stageConsumer(packageDir, manifest);
    const failures = [];
    const passes = [];

    try {
        for (const entry of entrySpecifiers(packageDir, manifest)) {
            const { specifier } = entry;
            const results = entry.modes.map(mode => inspect(consumerDir, specifier, mode, packageDir));

            for (const result of results.filter(one => !one.resolved)) {
                failures.push({
                    specifier,
                    mode: result.mode,
                    reason: entry.requiredReason && result.mode === "node10"
                        ? `does not resolve, and must — ${entry.requiredReason}. ` +
                          `Restore the redirect directory (a package.json beside dist pointing into it).`
                        : `does not resolve — ${result.reason}`
                });
            }

            const resolved = results.filter(one => one.resolved);
            if (resolved.length === 0) continue;

            // A value export typed `any` is the direct evidence.
            for (const result of resolved) {
                if (result.anyValued.length > 0) {
                    failures.push({
                        specifier,
                        mode: result.mode,
                        reason: `${result.anyValued.length} value export(s) are \`any\`, e.g. ${result.anyValued.slice(0, 3).join(", ")}`,
                        cause: explain(result.fixture, MODES.find(m => m.name === result.mode), packageDir)
                    });
                }
            }

            // …and a mode that sees fewer exports than another is the same
            // failure in its other shape: the re-export could not be followed,
            // so the name is simply absent rather than wrongly typed. Comparing
            // the modes against each other needs no external notion of what the
            // package "should" export, which is what keeps this probe honest as
            // the packages change.
            const best = resolved.reduce((a, b) => (b.valueNames.size > a.valueNames.size ? b : a));
            for (const result of resolved) {
                if (result === best) continue;
                const missing = [...best.valueNames].filter(name => !result.valueNames.has(name));
                if (missing.length === 0) continue;
                failures.push({
                    specifier,
                    mode: result.mode,
                    reason: `sees ${result.valueNames.size} value exports where ${best.mode} sees ${best.valueNames.size}` +
                        ` — missing e.g. ${missing.slice(0, 3).join(", ")}`,
                    cause: explain(result.fixture, MODES.find(m => m.name === result.mode), packageDir)
                });
            }

            for (const result of resolved) {
                passes.push(`${specifier} @ ${result.mode} (${result.valueNames.size} value exports)`);
            }
        }
    } finally {
        fs.rmSync(consumerDir, { recursive: true, force: true });
    }

    const failing = new Set(failures.map(failure => `${failure.specifier} @ ${failure.mode}`));
    return {
        name: manifest.name,
        failures,
        passes: passes.filter(entry => !failing.has(entry.split(" (")[0]))
    };
}

const argv = process.argv.slice(2);
const targets = argv.includes("--all")
    ? fs.readdirSync(path.join(ROOT, "packages"))
        .map(name => path.join("packages", name))
        .filter(dir => fs.existsSync(path.join(ROOT, dir, "package.json")))
    : argv;

if (targets.length === 0) {
    console.error("usage: assert-dts-resolution.mjs <package-dir> [...more]  |  --all");
    process.exit(2);
}

let failed = false;
for (const target of targets) {
    const result = checkPackage(target);

    if (result.skipped) {
        console.log(`${DIM}– ${result.name}: skipped (${result.skipped})${NC}`);
        continue;
    }

    if (result.failures.length === 0) {
        console.log(`${GREEN}✓${NC} ${result.name}: types resolve in all modes ${DIM}(${result.passes.length} checks)${NC}`);
        continue;
    }

    failed = true;
    console.error(`\n${RED}✖ ${result.name}: published types do not survive resolution${NC}\n`);
    for (const failure of result.failures) {
        console.error(`    ${failure.specifier} @ ${YELLOW}${failure.mode}${NC} — ${failure.reason}`);
        if (failure.cause) console.error(`      ${DIM}cause: ${failure.cause}${NC}`);
    }
    console.error(`
${DIM}"Resolves, but its types are \`any\`" is the dangerous one: there is no error
at the import site, so the first thing a consumer sees is an implicit-any error
in their own file. Nothing in this repository catches it, because every other
gate resolves @rebasepro/* to source rather than to the built package.

  Extensionless relative specifiers in .d.ts → run the rewrite step:
      node scripts/add-dts-extensions.mjs packages/<name>/dist
  Missing subpath under node10 → add a redirect directory beside dist (see
      packages/server/functions/package.json).${NC}
`);
}

process.exit(failed ? 1 : 0);
