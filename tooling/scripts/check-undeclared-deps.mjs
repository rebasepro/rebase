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

import { publishablePackages } from "./publishable-packages.mjs";

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

/**
 * @param {string} dir
 * @param {{ includeTests?: boolean }} [opts] When walking a test directory the
 *   test files are the point, so `.test.` / `.spec.` are kept rather than
 *   skipped. Declaration files stay excluded either way — they leave no
 *   runtime require behind.
 * @param {string[]} [out]
 */
function walk(dir, opts = {}, out = []) {
    for (const e of readdirSync(dir)) {
        const f = path.join(dir, e);
        if (statSync(f).isDirectory()) {
            if (["node_modules", "dist", "__mocks__"].includes(e)) continue;
            if (!opts.includeTests && e === "__tests__") continue;
            // `packages/types/__tests__/bivariance/` holds probes that are meant
            // to fail to compile — they are excluded from `tsconfig.tests.json`
            // for the same reason. They are assertions about the type system,
            // not code anything installs, so their imports are not declarations
            // this package owes anyone.
            if (e === "bivariance") continue;
            walk(f, opts, out);
        } else if (/\.(ts|tsx|mts|cts|js|mjs|jsx)$/.test(e)
            && !/\.d\./.test(e)
            && (opts.includeTests || !/\.(test|spec)\./.test(e))) {
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

/**
 * The span of MAJORS a range admits, as `[low, highExclusive]`, or null.
 *
 * Deliberately coarse and deliberately timid. Majors are the granularity that
 * decides whether a user's `node_modules` holds one copy or two, and anything
 * this cannot read with certainty — an alternation, a tag, a `*` — returns null
 * so the pair is not compared at all. A gate that refuses a release over a
 * range it merely failed to parse would be worse than the duplication.
 */
function majorSpan(range) {
    if (typeof range !== "string") return null;
    const text = range.trim();
    if (text.includes("||")) return null;                 // `^4 || ^5` spans both
    if (/^[a-z]+:/.test(text)) return null;               // workspace:, npm:, git:, file:
    const low = text.match(/(\d+)/);
    if (!low) return null;                                // `*`, `latest`, a dist-tag
    const lowMajor = Number(low[1]);

    const capped = text.match(/<(=?)\s*v?(\d+)/);
    if (capped) return [lowMajor, Number(capped[2]) + (capped[1] === "=" ? 1 : 0)];
    if (/^[\^~=]?v?\d/.test(text)) return [lowMajor, lowMajor + 1];
    if (/^>/.test(text)) return [lowMajor, null];         // open above
    return null;
}

/**
 * Two publishable packages asking for majors that cannot both be satisfied.
 *
 * A user installing `@rebasepro/{server,server-postgres,client,cli}` got
 * `chalk@4.1.2` AND `chalk@5.6.2` in their tree, because the CLI moved to 5 and
 * the driver stayed on 4. Nothing was broken by it and nothing could see it
 * either: each package's own manifest is internally consistent, every gate here
 * asked about one package at a time, and the duplication is only visible in a
 * consumer's `node_modules` — which nothing in CI builds.
 *
 * `dependencies` and `optionalDependencies` are what land in that tree.
 * `peerDependencies` are included because a consumer cannot satisfy two
 * disjoint peer ranges at all: that is an install error rather than a wasted
 * megabyte.
 */
function disjointMajorRanges() {
    const declarations = new Map();

    for (const pkg of publishablePackages(ROOT)) {
        const manifest = JSON.parse(readFileSync(path.join(ROOT, pkg.dir, "package.json"), "utf8"));
        for (const block of ["dependencies", "optionalDependencies", "peerDependencies"]) {
            for (const [dep, range] of Object.entries(manifest[block] || {})) {
                // Framework packages travel in lockstep and are `workspace:*`
                // in the tree; `check:publishable-set` owns that invariant.
                if (dep.startsWith("@rebasepro/")) continue;
                const span = majorSpan(range);
                if (!span) continue;
                if (!declarations.has(dep)) declarations.set(dep, []);
                declarations.get(dep).push({ pkg: pkg.name, range, span });
            }
        }
    }

    const clashes = [];
    for (const [dep, declared] of declarations) {
        for (let i = 0; i < declared.length; i++) {
            for (let j = i + 1; j < declared.length; j++) {
                const [a, b] = [declared[i], declared[j]];
                if (a.pkg === b.pkg) continue;
                const overlap = (a.span[1] === null || a.span[1] > b.span[0])
                    && (b.span[1] === null || b.span[1] > a.span[0]);
                if (overlap) continue;
                clashes.push({ dep, a, b });
            }
        }
    }
    return clashes;
}

const versionClashes = disjointMajorRanges();

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

    // Test directories, checked against dependencies *and* devDependencies.
    //
    // A test may import a dev-only package — that is what devDependencies are
    // for — but it may not import one the package never declares at all. That
    // hole was real: `packages/cms/test/form/undoable_discard.test.tsx` imported
    // `notistack`, which only `@rebasepro/app` declared, so the suite resolved
    // it by hoisting on some layouts and failed with "Cannot find module" on
    // pnpm's isolated one. `Tests: 823 passed` alongside `Test Suites: 1 failed`
    // is what that looks like, and it is easy to read past.
    const testRoots = ["test", "tests", "__tests__"]
        .map((dir) => path.join(ROOT, "packages", d, dir))
        .filter(existsSync);

    for (const root of testRoots) {
        for (const file of walk(root, { includeTests: true })) {
            for (const spec of valueImports(file)) {
                if (spec.startsWith(".") || spec.startsWith("/")) continue;
                if (BUILTIN.has(spec) || spec.startsWith("node:")) continue;
                if (!VALID.test(spec)) continue;
                const pkg = spec.split("/").slice(0, spec.startsWith("@") ? 2 : 1).join("/");
                if (pkg === j.name || runtime.has(pkg) || dev.has(pkg)) continue;
                const key = `${j.name}::${pkg}`;
                if (ALLOWED.has(key)) { usedAllowances.add(key); continue; }
                findings.push({
                    pkg: j.name,
                    dep: pkg,
                    where: "not declared at all (imported from a test)",
                    file: path.relative(ROOT, file)
                });
            }
        }
    }

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

if (findings.length === 0 && stale.length === 0 && versionClashes.length === 0) {
    console.log(
        `${GREEN}✓ Every published package declares what it imports, and no two ask for `
        + `majors a user cannot install together.${NC}`
    );
    process.exit(0);
}

if (versionClashes.length) {
    console.error(`${RED}✗ ${versionClashes.length} dependency major(s) no single install can satisfy:${NC}\n`);
    for (const { dep, a, b } of versionClashes) {
        console.error(`  ${dep}`);
        console.error(`    ${a.range} ${DIM}(${a.pkg})${NC}`);
        console.error(`    ${b.range} ${DIM}(${b.pkg})${NC}`);
    }
    console.error(
        `\n${DIM}A user installing both gets two copies in node_modules — or, for a peer`
        + `\nrange, an install that cannot be satisfied at all. Move them onto one major.${NC}`
    );
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
