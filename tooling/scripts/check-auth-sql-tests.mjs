#!/usr/bin/env node
/**
 * check:auth-sql-tests — every auth module that issues SQL is run against a
 * real database by at least one test.
 *
 * The MFA challenge cap rests on one statement, `attempts = attempts + 1
 * RETURNING`, and the code-replay guard on another; both lived in
 * `server-postgres/src/auth/services.ts`, and for months the only tests of
 * them mocked `drizzle-orm` wholesale or drove the routes over a JavaScript
 * fake of the repository. A read-then-write rewrite of either counter passed
 * every test. The shared rate-limit store was in the same state. Security
 * counters are exactly the SQL whose concurrency a mock cannot see.
 *
 * So: a module under `packages/<pkg>/src/**\/auth/` that issues SQL (imports
 * drizzle-orm, writes a sql`` template, or calls execute/executeSql) must be
 * imported by a test file that constructs a real database — PGlite, or a `pg`
 * Pool or Client — itself or through a local helper it imports.
 *
 *     pnpm check:auth-sql-tests
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Whether a repository path is non-test source under some package's `src/**\/auth/`. */
export function isAuthSource(file) {
    if (!/^packages\/[^/]+\/src\/(.+\/)?auth\//.test(file)) return false;
    if (!/\.(ts|tsx|mts|cts)$/.test(file) || /\.d\.(ts|mts|cts)$/.test(file)) return false;
    return !/\.(test|spec)\.[cm]?tsx?$/.test(file) && !/\/(__tests__|test|tests)\//.test(file);
}

/** The text with line and block comments removed (string contents are kept). */
function withoutComments(text) {
    return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

/** Whether a module's code (not its comments) issues SQL. */
export function issuesSql(text) {
    const code = withoutComments(text);
    return /from\s+["']drizzle-orm(\/[^"']*)?["']/.test(code)
        || /\bsql`/.test(code)
        || /\.(execute|executeSql|unsafe)\s*\(/.test(code)
        || /\bexecuteSql\s*\(/.test(code);
}

/** Whether a test (or helper) constructs a real database: PGlite, or a pg Pool/Client. */
export function constructsRealDatabase(text) {
    const code = withoutComments(text);
    if (/\bnew\s+PGlite\s*\(|\bPGlite\.create\s*\(/.test(code)) return true;
    const importsPg = /from\s+["']pg["']|require\(\s*["']pg["']\s*\)/.test(code);
    return importsPg && /\bnew\s+(?:\w+\.)?(Pool|Client)\s*\(/.test(code);
}

/** Every module specifier a file imports, re-exports, `import()`s or `require`s, in order. */
export function importsOf(text) {
    const specs = [];
    const pattern = /(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*|\brequireActual(?:<[^>]*>)?\s*\(\s*)["']([^"']+)["']/g;
    for (const match of withoutComments(text).matchAll(pattern)) specs.push(match[1]);
    return specs;
}

/** The repository file a relative specifier from `from` names, or null. */
function resolveRelative(from, spec, exists) {
    if (!spec.startsWith(".")) return null;
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec)).replace(/\.(m?js|cjs)$/, "");
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}.mts`, `${base}/index.ts`, `${base}/index.tsx`]) {
        if (exists(candidate)) return candidate;
    }
    return null;
}

/**
 * The SQL-issuing auth modules that no real-database test imports.
 * @param {{ sources: string[], tests: string[], read: (file: string) => string, exists: (file: string) => boolean }} input
 */
export function uncoveredModules({ sources, tests, read, exists }) {
    const sqlModules = sources.filter((file) => issuesSql(read(file)));
    const covered = new Set();
    for (const testFile of tests) {
        const text = read(testFile);
        const imported = importsOf(text).map((spec) => resolveRelative(testFile, spec, exists)).filter(Boolean);
        // One level of local helpers: a test whose database is built by a helper it imports.
        const real = constructsRealDatabase(text)
            || imported.some((file) => !isAuthSource(file) && constructsRealDatabase(read(file)));
        if (!real) continue;
        for (const file of imported) covered.add(file);
    }
    return sqlModules.filter((file) => !covered.has(file)).sort();
}

function main() {
    const listed = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "packages"], { cwd: ROOT, encoding: "utf8" })
        .split("\n")
        .filter(Boolean)
        .filter((file) => fs.existsSync(path.join(ROOT, file)));
    const known = new Set(listed);
    const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
    const exists = (file) => known.has(file);
    const sources = listed.filter(isAuthSource);
    const tests = listed.filter((file) => /\.(test|spec)\.[cm]?tsx?$/.test(file));
    const sqlModules = sources.filter((file) => issuesSql(read(file)));

    if (sqlModules.length === 0) {
        console.error("✗ check:auth-sql-tests found no auth module that issues SQL — the file walk is broken.");
        process.exit(1);
    }
    const missing = uncoveredModules({ sources, tests, read, exists });
    if (missing.length === 0) {
        console.log(`✓ Every auth module that issues SQL (${sqlModules.length}) is run against a real database by a test.`);
        return;
    }
    for (const file of missing) console.error(`✗ ${file} issues SQL, and no test that builds a real database imports it`);
    console.error(`
  A mocked driver cannot see what a security counter's SQL does under
  concurrency. Add a test that runs it on PGlite (see
  packages/server-postgres/test/mfa-counters-pglite.test.ts) and imports the
  module by its relative path.`);
    process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
