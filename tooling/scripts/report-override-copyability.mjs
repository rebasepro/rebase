/**
 * How far each overridable built-in part is from being copyable.
 *
 * The customization model says: when a built-in part does not fit, copy it into
 * your project and change it, and register the copy as its override. A copy only
 * compiles if everything the part imports is reachable from a package entry point
 * — a relative import of something `@rebasepro/cms` or `@rebasepro/app` does not
 * export has nowhere to point once the file lives in a user's project.
 *
 * For every name in `<Rebase components>` this finds the built-in component
 * (the second argument of its `useComponentOverride("<name>", Default)` call),
 * reads that component's file, and lists each relative import that is not a
 * public export of `@rebasepro/cms` or `@rebasepro/app`. Zero means a copy of
 * that file compiles once its relative imports are rewritten to package imports.
 *
 * It reports; it does not fail. The numbers are the work list for making the
 * parts copyable, and a part's count only ever needs to go down.
 *
 *     node tooling/scripts/report-override-copyability.mjs [--json]
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const require = createRequire(import.meta.url);
const ts = require("typescript");

const ENTRIES = {
    "@rebasepro/cms": path.join(ROOT, "packages/cms/src/index.ts"),
    "@rebasepro/app": path.join(ROOT, "packages/app/src/index.ts")
};
const SEARCHED = ["packages/cms/src", "packages/app/src"];

function sourceFiles(dir) {
    const out = [];
    const walk = (d) => {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
            const full = path.join(d, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
        }
    };
    walk(path.join(ROOT, dir));
    return out;
}

const configPath = path.join(ROOT, "tsconfig.typecheck.json");
const config = ts.parseJsonConfigFileContent(ts.readConfigFile(configPath, ts.sys.readFile).config, ts.sys, ROOT);
const files = SEARCHED.flatMap(sourceFiles);
const program = ts.createProgram([...Object.values(ENTRIES), ...files], config.options);
const checker = program.getTypeChecker();

function resolved(symbol) {
    return symbol && (symbol.flags & ts.SymbolFlags.Alias) ? checker.getAliasedSymbol(symbol) : symbol;
}

/** Every declaration a package entry point exports, by identity. */
const publicDeclarations = new Set();
for (const entry of Object.values(ENTRIES)) {
    const moduleSymbol = checker.getSymbolAtLocation(program.getSourceFile(entry));
    for (const exported of checker.getExportsOfModule(moduleSymbol)) {
        for (const declaration of resolved(exported)?.declarations ?? []) publicDeclarations.add(declaration);
    }
}

function isPublic(symbol) {
    return (resolved(symbol)?.declarations ?? []).some(d => publicDeclarations.has(d));
}

/** `useComponentOverride("Name", Default)` call sites → the default's declaring file. */
const sites = new Map();
for (const file of files) {
    const source = program.getSourceFile(file);
    const visit = (node) => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "useComponentOverride"
            && node.arguments.length >= 2 && ts.isStringLiteral(node.arguments[0]) && ts.isIdentifier(node.arguments[1])) {
            const name = node.arguments[0].text;
            const declaration = resolved(checker.getSymbolAtLocation(node.arguments[1]))?.declarations?.[0];
            if (declaration && !sites.has(name)) {
                sites.set(name, { component: node.arguments[1].text, file: declaration.getSourceFile().fileName });
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
}

/** The relative imports of a file that no package entry point exports. */
function internalImports(file) {
    const source = program.getSourceFile(file);
    const internal = [];
    for (const statement of source.statements) {
        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
        if (!statement.moduleSpecifier.text.startsWith(".")) continue;
        const clause = statement.importClause;
        if (!clause || clause.isTypeOnly) continue;
        const names = [];
        if (clause.name) names.push(clause.name);
        if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
            for (const element of clause.namedBindings.elements) if (!element.isTypeOnly) names.push(element.name);
        }
        for (const name of names) {
            if (!isPublic(checker.getSymbolAtLocation(name))) internal.push(`${name.text} (${statement.moduleSpecifier.text})`);
        }
    }
    return internal;
}

const rows = [...sites].map(([name, { component, file }]) => ({
    name,
    component,
    file: path.relative(ROOT, file),
    internal: internalImports(file)
})).sort((a, b) => a.internal.length - b.internal.length || a.name.localeCompare(b.name));

if (process.argv.includes("--json")) {
    console.log(JSON.stringify(rows, null, 2));
} else {
    for (const row of rows) {
        console.log(`${String(row.internal.length).padStart(3)}  ${row.name.padEnd(28)} ${row.component} — ${row.file}`);
        for (const item of row.internal) console.log(`       · ${item}`);
    }
    const ready = rows.filter(r => r.internal.length === 0).length;
    console.log(`\n${ready} of ${rows.length} overridable parts can be copied with only package imports.`);
}
