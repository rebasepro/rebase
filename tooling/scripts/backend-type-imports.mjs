/**
 * A frontend may import the backend's tables as types, never as values.
 *
 * `frontend/src/cms/posts.tsx` writes `import type { posts } from
 * "../../../backend/schema/posts"` so `customizeTable<typeof posts>` can check
 * every field name against the table. A *value* import of the same file puts
 * the table into the browser bundle — and with it whatever the table pulls in:
 * its hooks, the helpers they call, the server modules those import. The Vite
 * collections plugin used to strip server code out of shared collection files;
 * with tables in `backend/` and presentation in `frontend/`, the rule that does
 * that job is this one: across the line, types only.
 *
 * Exported for `check-templates.mjs` (every scaffold) and for a repo-wide gate
 * over `app/` and the examples. It reads TypeScript with the compiler's parser,
 * so a commented-out import or an import inside a string is not reported, and
 * every form that reaches a module at runtime is: `import … from`, a bare
 * `import "…"`, `export … from`, `import("…")`, `require("…")` and
 * `import x = require("…")`.
 *
 * A clause counts as type-only when it is written `import type …` /
 * `export type …`. `import { type posts }` does not count: with
 * `verbatimModuleSyntax` (or a bundler that preserves imports) it still loads
 * the module for its side effects, which is exactly what this rule exists to
 * stop. Say `import type`.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

/**
 * Every value import, in `files`, of a module under `backendDir`.
 *
 * @param {object} options
 * @param {string[]} options.files absolute paths of the frontend files to read (`.ts`, `.tsx`, `.mts`, `.js`, `.jsx`)
 * @param {string} options.backendDir absolute path of the backend directory nothing may import a value from
 * @param {(file: string) => string} [options.read] how to read a file (for tests)
 * @returns {{ file: string, line: number, specifier: string, form: string }[]} one entry per offending import, 1-based lines
 */
export function findValueImportsOfBackend({ files, backendDir, read = file => fs.readFileSync(file, "utf8") }) {
    const backend = path.resolve(backendDir);
    const inBackend = (from, specifier) => {
        if (!specifier.startsWith(".")) return false;
        const target = path.resolve(path.dirname(from), specifier);
        return target === backend || target.startsWith(backend + path.sep);
    };
    const findings = [];

    for (const file of files) {
        const text = read(file);
        const kind = /\.tsx$|\.jsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
        const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
        const report = (node, specifier, form) => {
            if (!inBackend(file, specifier)) return;
            const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
            findings.push({ file, line: line + 1, specifier, form });
        };

        const visit = (node) => {
            if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
                const clause = node.importClause;
                const typeOnly = clause !== undefined && clause.isTypeOnly;
                if (!typeOnly) report(node, node.moduleSpecifier.text, clause ? "import" : "side-effect import");
            } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
                if (!node.isTypeOnly) report(node, node.moduleSpecifier.text, "export … from");
            } else if (ts.isImportEqualsDeclaration(node)
                && ts.isExternalModuleReference(node.moduleReference)
                && ts.isStringLiteral(node.moduleReference.expression)) {
                if (!node.isTypeOnly) report(node, node.moduleReference.expression.text, "import = require");
            } else if (ts.isCallExpression(node) && node.arguments.length > 0 && ts.isStringLiteralLike(node.arguments[0])) {
                const callee = node.expression;
                if (callee.kind === ts.SyntaxKind.ImportKeyword) report(node, node.arguments[0].text, "import()");
                else if (ts.isIdentifier(callee) && callee.text === "require") report(node, node.arguments[0].text, "require()");
            }
            ts.forEachChild(node, visit);
        };
        visit(source);
    }
    return findings;
}

/** Every TypeScript/JavaScript source file under `dir`, skipping `node_modules` and build output. */
export function sourceFilesUnder(dir) {
    const out = [];
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...sourceFilesUnder(full));
        else if (/\.(ts|tsx|mts|cts|js|jsx|mjs)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) out.push(full);
    }
    return out;
}
