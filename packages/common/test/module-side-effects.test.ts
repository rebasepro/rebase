import { describe, it, expect } from "@jest/globals";
import * as fs from "node:fs";
import * as path from "node:path";
import * as ts from "typescript";

/**
 * `package.json` declares `"sideEffects": false` for this package, and the
 * build emits one file per source module (`preserveModules`): a bundler may
 * drop any file of it whose exports nobody uses. That is what keeps
 * `json-logic-js` (only util/conditions.ts imports it) out of a client app
 * that never evaluates a condition — the `sdk-minimal` target of
 * tooling/scripts/check-bundle-budget.mjs measures it.
 *
 * The flag is a promise about every module, so this holds it: importing a
 * module must not DO anything another module relies on — register something,
 * patch a global, listen to an event. Such code would be silently dropped the
 * day nothing imports a binding from its module. Top-level statements must be
 * imports, exports, declarations, or a directive. Anything else needs a reason
 * in ALLOWED, or the flag has to go.
 */

const SRC = path.resolve(__dirname, "../src");

/** file (relative to src) → why its module-scope call is safe to drop with it. */
const ALLOWED: Record<string, string> = {
    "collections/default-collections.ts": "builds its exported collection objects with defineCollection, an identity function over the literal (resource handles become keys); it registers nothing"
};

function sources(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return sources(full);
        return /\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$|\.d\.ts$/.test(entry.name) ? [full] : [];
    });
}

const GLOBALS = new Set(["window", "document", "globalThis", "self", "global", "process", "navigator", "localStorage", "sessionStorage"]);
const EFFECT_CALLS = /^(addEventListener|on|once|setInterval|setTimeout|add_operation|register\w*|define\w*|use)$/;

/**
 * Does evaluating this expression touch the outside world? Function bodies are
 * skipped — they run when called, not when the module loads — so
 * `export const f = () => process.env.X` is fine and
 * `const x = process.env.X` is not.
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

function moduleEffects(file: string): string[] {
    const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true,
        file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const found: string[] = [];
    for (const statement of source.statements) {
        const text = statement.getText(source).replace(/\s+/g, " ").slice(0, 100);
        if (ts.isImportDeclaration(statement)) {
            if (!statement.importClause) found.push(`bare import: ${text}`);
        } else if (ts.isExpressionStatement(statement)) {
            // "use strict" and friends; anything else runs on import.
            if (!ts.isStringLiteral(statement.expression)) found.push(`statement: ${text}`);
        } else if (ts.isVariableStatement(statement)) {
            for (const declaration of statement.declarationList.declarations) {
                const init = declaration.initializer;
                if (init && touchesGlobals(init)) found.push(`initializer: ${text}`);
            }
        } else if (ts.isClassDeclaration(statement)) {
            for (const member of statement.members) {
                if (ts.isClassStaticBlockDeclaration(member) ||
                    (ts.isPropertyDeclaration(member) && member.initializer &&
                        member.modifiers?.some(m => m.kind === ts.SyntaxKind.StaticKeyword) &&
                        touchesGlobals(member.initializer))) {
                    found.push(`static member: ${member.getText(source).replace(/\s+/g, " ").slice(0, 100)}`);
                }
            }
        } else if (!(ts.isFunctionDeclaration(statement) || ts.isInterfaceDeclaration(statement) ||
            ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement) ||
            ts.isExportDeclaration(statement) || ts.isExportAssignment(statement) ||
            ts.isModuleDeclaration(statement) || ts.isEmptyStatement(statement))) {
            found.push(`statement: ${text}`);
        }
    }
    return found;
}

describe("no module of this package does anything just by being imported", () => {
    it("matches the sideEffects claim in package.json", () => {
        const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf8"));
        expect(manifest.sideEffects).toBe(false);
    });

    it("has no module-scope effects outside the allowlist", () => {
        const offenders = sources(SRC).flatMap(file => {
            const rel = path.relative(SRC, file).split(path.sep).join("/");
            if (ALLOWED[rel]) return [];
            return moduleEffects(file).map(effect => `${rel}: ${effect}`);
        });
        expect(offenders).toEqual([]);
    });
});
