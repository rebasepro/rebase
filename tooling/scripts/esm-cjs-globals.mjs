#!/usr/bin/env node
/**
 * Which CommonJS globals (`__filename`, `__dirname`) an ES module bundle
 * references — section 5 of `check-packages.sh`.
 *
 * Those names do not exist in an ES module, so a bundle that reads one throws
 * a ReferenceError the moment that line runs. The section grepped the bundle
 * for the words, and a word is not a reference: `@rebasepro/server` evaluates
 * a schema file the editor imports inside a CommonJS wrapper it builds as
 * TEXT — `` `(function (exports, require, module, __filename, __dirname) {…})` ``
 * handed to `vm.runInThisContext` — and that string was reported as a crash.
 *
 * This parses the bundle and reports identifiers, so a name inside a string,
 * a template literal, a comment or a regular expression is not one. A name
 * the bundle declares itself (a parameter, a `const __dirname = …` shim)
 * still counts: the check stays as strict as it was about code, and a shim
 * is worth a look.
 *
 * Usage: node tooling/scripts/esm-cjs-globals.mjs <file.js>…
 * Prints `<file>: <name>` per reference, exits 1 when there is one.
 */
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const CJS_GLOBALS = new Set(["__filename", "__dirname"]);

/**
 * The CommonJS globals `source` names as identifiers, each once, in the order
 * they first appear. A property name (`x.__dirname`, `{ __dirname: 1 }`) is
 * not a use of the global and is not counted.
 *
 * @param {string} fileName
 * @param {string} source
 * @returns {string[]}
 */
export function cjsGlobalReferences(fileName, source) {
    const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const found = new Set();
    const visit = (node) => {
        if (ts.isIdentifier(node) && CJS_GLOBALS.has(node.text) && !isPropertyName(node)) found.add(node.text);
        ts.forEachChild(node, visit);
    };
    visit(file);
    return [...found];
}

function isPropertyName(node) {
    const parent = node.parent;
    if (!parent) return false;
    if (ts.isPropertyAccessExpression(parent) && parent.name === node) return true;
    if ((ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent) || ts.isPropertyDeclaration(parent)) && parent.name === node) return true;
    return false;
}

const isDirectRun = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isDirectRun) {
    let references = 0;
    for (const file of process.argv.slice(2)) {
        for (const name of cjsGlobalReferences(file, fs.readFileSync(file, "utf8"))) {
            console.log(`${file}: ${name}`);
            references++;
        }
    }
    process.exit(references > 0 ? 1 : 0);
}
