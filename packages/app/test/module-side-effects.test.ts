/**
 * `package.json` declares `"sideEffects": ["**\/*.css"]` for this package: a
 * bundler may drop any module of it whose exports nobody uses. That is what
 * lets an app that imports one hook from the barrel leave the rest out —
 * without it, a module reached through the barrel stays in the bundle as soon
 * as it has one top-level call (a `React.memo(...)`, a `createContext(...)`),
 * used or not.
 *
 * The flag is a promise about every module, so this holds it: importing a
 * module must not DO anything another module relies on — register something,
 * patch a global, listen to the window. Such code would be silently dropped
 * the day nothing imports a binding from its module. Top-level statements
 * must be imports, exports, declarations, or one of the harmless shapes below
 * (a `displayName` on a local component, a directive). Anything else needs a
 * reason in ALLOWED, or the flag has to go.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const SRC = path.resolve(__dirname, "../src");

/** file (relative to src) → why its module-scope effect is safe to drop with it. */
const ALLOWED: Record<string, string> = {};

function sources(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return sources(full);
        return /\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$|\.d\.ts$/.test(entry.name) ? [full] : [];
    });
}

const GLOBALS = new Set(["window", "document", "globalThis", "self", "navigator", "localStorage", "sessionStorage"]);
const EFFECT_CALLS = /^(addEventListener|setInterval|setTimeout|register\w*|define\w*)$/;

/**
 * Does evaluating this expression touch the outside world? Function bodies are
 * skipped — they run when called, not when the module loads — so
 * `React.memo(function Row() { window.… })` is fine and
 * `const off = window.addEventListener(…)` is not.
 */
function touchesGlobals(node: ts.Node): boolean {
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node) ||
        ts.isMethodDeclaration(node) || ts.isGetAccessor(node) || ts.isSetAccessor(node) || ts.isClassExpression(node)) {
        return false;
    }
    // `typeof window !== "undefined"` reads, it does not touch.
    if (ts.isTypeOfExpression(node)) return false;
    if (ts.isIdentifier(node) && GLOBALS.has(node.text)) return true;
    if (ts.isCallExpression(node)) {
        const callee = node.expression;
        const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : "";
        if (EFFECT_CALLS.test(name)) return true;
    }
    return ts.forEachChild(node, touchesGlobals) ?? false;
}

function harmlessExpression(statement: ts.ExpressionStatement): boolean {
    const expression = statement.expression;
    // "use client" and friends.
    if (ts.isStringLiteral(expression)) return true;
    // `void x` — a type-level assertion kept alive.
    if (ts.isVoidExpression(expression) && ts.isIdentifier(expression.expression)) return true;
    // `Component.displayName = "…"` on a module-local binding.
    if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isPropertyAccessExpression(expression.left) && ts.isIdentifier(expression.left.expression) &&
        ts.isStringLiteralLike(expression.right)) return true;
    return false;
}

function moduleEffects(file: string): string[] {
    const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true,
        file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const found: string[] = [];
    for (const statement of source.statements) {
        const text = statement.getText(source).replace(/\s+/g, " ").slice(0, 100);
        if (ts.isImportDeclaration(statement)) {
            const spec = (statement.moduleSpecifier as ts.StringLiteral).text;
            if (!statement.importClause && !/\.css$/.test(spec)) found.push(`bare import: ${text}`);
        } else if (ts.isExpressionStatement(statement)) {
            if (!harmlessExpression(statement)) found.push(`statement: ${text}`);
        } else if (ts.isVariableStatement(statement)) {
            for (const declaration of statement.declarationList.declarations) {
                const init = declaration.initializer;
                if (init && touchesGlobals(init)) found.push(`initializer: ${text}`);
            }
        } else if (!(ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) ||
            ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) ||
            ts.isEnumDeclaration(statement) || ts.isExportDeclaration(statement) ||
            ts.isExportAssignment(statement) || ts.isModuleDeclaration(statement) ||
            ts.isEmptyStatement(statement))) {
            found.push(`statement: ${text}`);
        }
    }
    return found;
}

describe("no module of this package does anything just by being imported", () => {
    it("matches the sideEffects claim in package.json", () => {
        const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf8"));
        expect(manifest.sideEffects).toEqual(["**/*.css"]);
    });

    it("has no module-scope effects outside the allowlist", () => {
        const offenders = sources(SRC).flatMap(file => {
            const rel = path.relative(SRC, file);
            if (ALLOWED[rel]) return [];
            return moduleEffects(file).map(effect => `${rel}: ${effect}`);
        });
        expect(offenders).toEqual([]);
    });
});
