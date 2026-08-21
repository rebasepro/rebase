#!/usr/bin/env node
/**
 * Give the emitted declarations the file extensions ESM resolution requires.
 *
 * `tsc` writes relative specifiers into `.d.ts` exactly as the source wrote
 * them. The source of every package here is compiled by a bundler, so it writes
 * them extensionless — `from "./init"`, `from "../api/types"` — and that is
 * correct for the bundler and correct for `tsc` itself.
 *
 * It is not correct for a consumer. Every package here is `"type": "module"`,
 * and under `moduleResolution: "node16"`/`"nodenext"` an extensionless relative
 * specifier inside an ESM declaration file is an error. TypeScript's response is
 * the dangerous part: it does not fail at the consumer's import. It resolves the
 * package, discards the declarations it could not follow, and types the whole
 * import as `any` — so the first symptom is an implicit-any error in the
 * consumer's own file, pointing at their code, in a project that has done
 * nothing wrong.
 *
 * Appending `.js` fixes it in every mode at once, and this is the part that
 * makes the rewrite safe rather than a trade: TypeScript maps a `./x.js`
 * specifier onto `./x.d.ts` under node10, bundler and nodenext alike. Nothing
 * that works today stops working.
 *
 * Two specifier shapes, and the difference matters: `./x` where `x.d.ts` exists
 * becomes `./x.js`, while `./x` where `x/index.d.ts` exists becomes
 * `./x/index.js`. Guessing instead of checking the filesystem would turn every
 * directory re-export into a dangling path — which resolves to nothing, which
 * degrades to `any`, which is the bug this script exists to remove.
 *
 * Idempotent: a specifier that already carries an extension is left alone.
 *
 * Usage: node scripts/add-dts-extensions.mjs <dist-dir> [...more]
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const ts = require(path.join(ROOT, "node_modules/typescript"));

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const NC = "\x1b[0m";

/** Extensions that already answer the question, so the specifier is left as is. */
const RESOLVED_EXTENSIONS = [".js", ".mjs", ".cjs", ".json", ".node", ".css", ".d.ts"];

function declarationFiles(dir) {
    const found = [];
    const walk = (current) => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith(".d.ts")) found.push(full);
        }
    };
    walk(dir);
    return found;
}

/**
 * Every module specifier in a declaration file, as `{ start, end, text }`.
 *
 * Collected from the AST rather than by pattern, because a declaration file is
 * full of string literals that look like specifiers and are not — a string
 * literal *type* (`type Mode = "./legacy"`), an ambient `declare module "x"`
 * whose name must never be rewritten, a template in a doc comment. Position
 * data also lets the rewrite be applied back-to-front, so earlier edits cannot
 * shift later offsets.
 */
function moduleSpecifiers(source) {
    const found = [];

    const record = (node) => {
        if (node && ts.isStringLiteral(node)) {
            found.push({ start: node.getStart(source), end: node.getEnd(), text: node.text });
        }
    };

    const visit = (node) => {
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
            record(node.moduleSpecifier);
        } else if (ts.isImportTypeNode(node)) {
            // `import("./x").Thing` — the shape `tsc` emits whenever a
            // declaration references a type it did not import by name. There
            // are more of these in a generated `.d.ts` than real imports.
            if (node.argument && ts.isLiteralTypeNode(node.argument)) record(node.argument.literal);
        } else if (ts.isImportEqualsDeclaration(node)) {
            if (ts.isExternalModuleReference(node.moduleReference)) record(node.moduleReference.expression);
        } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
            record(node.arguments[0]);
        }
        ts.forEachChild(node, visit);
    };

    visit(source);
    return found;
}

/** What a relative specifier should become, or `undefined` to leave it alone. */
function rewritten(specifier, fromFile) {
    if (!specifier.startsWith("./") && !specifier.startsWith("../")) return undefined;
    if (RESOLVED_EXTENSIONS.some(extension => specifier.endsWith(extension))) return undefined;

    const base = path.resolve(path.dirname(fromFile), specifier);
    if (fs.existsSync(`${base}.d.ts`)) return `${specifier}.js`;
    if (fs.existsSync(path.join(base, "index.d.ts"))) return `${specifier.replace(/\/$/, "")}/index.js`;
    return null; // resolves to nothing — reported, not guessed at
}

function processDirectory(dir) {
    // Relative to the caller, not to the repository root: every build script
    // runs from its own package directory and passes a bare `dist`.
    const absolute = path.resolve(process.cwd(), dir);
    if (!fs.existsSync(absolute)) {
        return { dir, missing: true };
    }

    // A `dist` that lives somewhere else is a symlink into another checkout —
    // the shape a git worktree gets when its node_modules are linked back to the
    // primary. Rewriting through it would silently edit the other checkout's
    // published artifacts, which is a bad afternoon for whoever is using them.
    const real = fs.realpathSync(absolute);
    const expected = fs.realpathSync(path.dirname(absolute));
    if (path.dirname(real) !== expected) {
        return { dir, escaped: real };
    }

    let filesChanged = 0;
    let specifiersRewritten = 0;
    const unresolved = [];

    for (const file of declarationFiles(absolute)) {
        const original = fs.readFileSync(file, "utf8");
        const source = ts.createSourceFile(file, original, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

        const edits = [];
        for (const specifier of moduleSpecifiers(source)) {
            const replacement = rewritten(specifier.text, file);
            if (replacement === undefined) continue;
            if (replacement === null) {
                unresolved.push(`${path.relative(ROOT, file)} → "${specifier.text}"`);
                continue;
            }
            edits.push({ ...specifier, replacement });
        }

        if (edits.length === 0) continue;

        // Back to front: an edit changes the length of the text after it.
        let updated = original;
        for (const edit of edits.sort((a, b) => b.start - a.start)) {
            const quote = original[edit.start];
            updated = updated.slice(0, edit.start) + quote + edit.replacement + quote + updated.slice(edit.end);
        }

        fs.writeFileSync(file, updated, "utf8");
        filesChanged += 1;
        specifiersRewritten += edits.length;
    }

    return { dir, filesChanged, specifiersRewritten, unresolved };
}

const targets = process.argv.slice(2);
if (targets.length === 0) {
    console.error("usage: add-dts-extensions.mjs <dist-dir> [...more]");
    process.exit(2);
}

let failed = false;
for (const target of targets) {
    const result = processDirectory(target);

    if (result.missing) {
        console.error(`${RED}✖${NC} ${target}: does not exist — build the package first.`);
        failed = true;
        continue;
    }

    if (result.escaped) {
        console.error(
            `${RED}✖${NC} ${target} resolves to ${result.escaped}, outside this checkout.\n` +
            `    Refusing to rewrite: that is another checkout's published output, reached\n` +
            "    through a symlinked node_modules. Build in the checkout that owns it."
        );
        failed = true;
        continue;
    }

    if (result.unresolved.length > 0) {
        failed = true;
        console.error(`\n${RED}✖ ${target}: ${result.unresolved.length} relative specifier(s) resolve to nothing${NC}\n`);
        for (const entry of result.unresolved.slice(0, 20)) console.error(`    ${entry}`);
        console.error(`
${DIM}A relative specifier in a .d.ts that matches no file on disk is a broken emit,
not a formatting problem, and it degrades the importing module to \`any\` in
every resolution mode. Left unrewritten so the cause stays visible.${NC}
`);
        continue;
    }

    const detail = result.specifiersRewritten === 0
        ? "already extension-complete"
        : `${result.specifiersRewritten} specifier(s) in ${result.filesChanged} file(s)`;
    console.log(`${GREEN}✓${NC} ${target}: ${detail}`);
}

process.exit(failed ? 1 : 0);
