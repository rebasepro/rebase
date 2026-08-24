#!/usr/bin/env node
/**
 * Guards the published packages against importing something they never declared.
 *
 * Rollup externalises every bare specifier, so an import in `src/` survives into
 * `dist/` verbatim. Inside this monorepo — and for anyone installing with npm or
 * yarn — an undeclared package still resolves, because a hoisted `node_modules`
 * puts a transitive dependency at the top level. Under pnpm's isolated layout it
 * does not, and the consumer gets ERR_MODULE_NOT_FOUND on first import. Nothing
 * in the pipeline could see the difference: it type-checks, it builds, it tests.
 *
 * That is how `@rebasepro/firebase` shipped importing seven `@firebase/*`
 * subpackages it only had as devDependencies, while declaring the `firebase`
 * umbrella as its peer.
 *
 * Type-only imports are ignored — they leave no runtime require behind.
 *
 * Usage: node tooling/scripts/check-undeclared-deps.mjs
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { builtinModules } from "node:module";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BUILTIN = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);
/** Bare specifiers only; skips prose and SQL that a regex would mistake for one. */
const VALID = /^(@[\w.~-]+\/)?[\w.~-]+(\/[\w.~/-]+)?$/;

const RED = "\x1b[0;31m";
const GREEN = "\x1b[0;32m";
const DIM = "\x1b[2m";
const NC = "\x1b[0m";

/**
 * Imports that are deliberately not declared, with the reason. Keyed
 * `<package>::<specifier>`. Keep this list short and each entry justified — an
 * entry is a promise that the import cannot fail for a consumer.
 */
const ALLOWED = new Map([
    [
        "@rebasepro/cli::typescript",
        "Resolved with createRequire() against the *user's* project root, to read "
        + "their tsconfig with their TypeScript. Wrapped in try/catch with a "
        + "documented JSON fallback, so an absent TypeScript is a supported state."
    ]
]);

function walk(dir, out = []) {
    for (const e of readdirSync(dir)) {
        const f = path.join(dir, e);
        if (statSync(f).isDirectory()) {
            if (["node_modules", "dist", "__mocks__", "__tests__"].includes(e)) continue;
            walk(f, out);
        } else if (/\.(ts|tsx|mts|cts|js|mjs|jsx)$/.test(e) && !/\.(test|spec|d)\./.test(e)) {
            out.push(f);
        }
    }
    return out;
}

/** Bare specifiers a file imports for their *value*, via the real parser. */
function valueImports(file) {
    const kind = file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const src = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, kind);
    const out = new Set();
    const visit = (n) => {
        if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
            const c = n.importClause;
            const typeOnly = c?.isTypeOnly
                || (c?.namedBindings
                    && ts.isNamedImports(c.namedBindings)
                    && c.namedBindings.elements.length > 0
                    && c.namedBindings.elements.every((el) => el.isTypeOnly));
            if (!typeOnly) out.add(n.moduleSpecifier.text);
        } else if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
            if (!n.isTypeOnly) out.add(n.moduleSpecifier.text);
        } else if (
            ts.isCallExpression(n)
            && (n.expression.kind === ts.SyntaxKind.ImportKeyword
                || (ts.isIdentifier(n.expression) && n.expression.text === "require"))
            && n.arguments[0] && ts.isStringLiteral(n.arguments[0])
        ) {
            out.add(n.arguments[0].text);
        }
        ts.forEachChild(n, visit);
    };
    visit(src);
    return out;
}

const findings = [];
const usedAllowances = new Set();

for (const d of readdirSync(path.join(ROOT, "packages")).sort()) {
    const pkgPath = path.join(ROOT, "packages", d, "package.json");
    if (!existsSync(pkgPath)) continue;
    const j = JSON.parse(readFileSync(pkgPath, "utf8"));
    if (j.private) continue;
    const src = path.join(ROOT, "packages", d, "src");
    if (!existsSync(src)) continue;

    const runtime = new Set([
        ...Object.keys(j.dependencies || {}),
        ...Object.keys(j.peerDependencies || {}),
        ...Object.keys(j.optionalDependencies || {})
    ]);
    const dev = new Set(Object.keys(j.devDependencies || {}));

    for (const file of walk(src)) {
        for (const spec of valueImports(file)) {
            if (spec.startsWith(".") || spec.startsWith("/")) continue;
            if (BUILTIN.has(spec) || spec.startsWith("node:")) continue;
            if (!VALID.test(spec)) continue;
            const pkg = spec.split("/").slice(0, spec.startsWith("@") ? 2 : 1).join("/");
            if (pkg === j.name || runtime.has(pkg)) continue;
            const key = `${j.name}::${pkg}`;
            if (ALLOWED.has(key)) { usedAllowances.add(key); continue; }
            findings.push({
                pkg: j.name,
                dep: pkg,
                where: dev.has(pkg) ? "devDependencies only" : "not declared at all",
                file: path.relative(ROOT, file)
            });
        }
    }
}

// A stale allowance is a quiet hole in the gate.
const stale = [...ALLOWED.keys()].filter((k) => !usedAllowances.has(k));

if (findings.length === 0 && stale.length === 0) {
    console.log(`${GREEN}✓ Every published package declares what it imports.${NC}`);
    process.exit(0);
}

if (findings.length) {
    console.error(`${RED}✗ ${findings.length} undeclared runtime import(s):${NC}\n`);
    const byPkg = new Map();
    for (const f of findings) {
        if (!byPkg.has(f.pkg)) byPkg.set(f.pkg, []);
        byPkg.get(f.pkg).push(f);
    }
    for (const [pkg, fs_] of byPkg) {
        console.error(`  ${pkg}`);
        const seen = new Set();
        for (const f of fs_) {
            if (seen.has(f.dep)) continue;
            seen.add(f.dep);
            console.error(`    ${f.dep} ${DIM}(${f.where})${NC}`);
            console.error(`      ${DIM}${f.file}${NC}`);
        }
    }
    console.error(
        `\n${DIM}These resolve here and under npm/yarn hoisting, and fail under pnpm's`
        + `\nisolated layout. Declare them as a dependency or peerDependency — or, if a`
        + `\nparent package already covers them, import its public entry point instead.${NC}`
    );
}

for (const k of stale) {
    console.error(`${RED}✗ Stale allowance in ${path.basename(fileURLToPath(import.meta.url))}: ${k} no longer imports it — remove the entry.${NC}`);
}

process.exit(1);
