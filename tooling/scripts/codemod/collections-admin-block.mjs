/**
 * Move a collection file's presentation fields into a nested `admin` block.
 *
 * This is the 0.11 migration. Before:
 *
 *     export default {
 *         slug: "posts", table: "posts", properties: { … },
 *         icon: "FileText", listProperties: ["title"], defaultViewMode: "table"
 *     };
 *
 * After:
 *
 *     export default {
 *         slug: "posts", table: "posts", properties: { … },
 *         admin: { icon: "FileText", listProperties: ["title"], defaultViewMode: "table" }
 *     };
 *
 * ts-morph rather than a regex, because the fields being moved include object and
 * array literals, arrow functions (`defaultSelectedView`), and component
 * references — and a nested `properties` entry can carry keys with the same names
 * (`ui.hideFromCollection`, an array's `sortable`). Only the *top level* of the
 * collection object may be touched.
 *
 * The key list comes from `@rebasepro/types` so it cannot drift from the type.
 *
 * Run:
 *   node tooling/scripts/codemod/collections-admin-block.mjs [--dry] <dir-or-file>...
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Project, SyntaxKind, IndentationText } = require("ts-morph");

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

/**
 * Read the key list from source rather than importing the built package: the
 * codemod has to run in a user's project before anything is built, and against
 * whatever version of the types they have.
 */
function loadAdminKeys() {
    const candidates = [
        path.join(repoRoot, "packages/types/src/types/admin_block.ts"),
        path.join(repoRoot, "node_modules/@rebasepro/types/src/types/admin_block.ts")
    ];
    for (const file of candidates) {
        if (!fs.existsSync(file)) continue;
        const src = fs.readFileSync(file, "utf8");
        const block = src.slice(src.indexOf("export const ADMIN_COLLECTION_KEYS"));
        const keys = [...block.matchAll(/^\s{4}"(\w+)",?$/gm)].map((m) => m[1]);
        if (keys.length > 0) return keys;
    }
    throw new Error("Could not locate ADMIN_COLLECTION_KEYS — is @rebasepro/types installed?");
}

const ADMIN_KEYS = new Set(loadAdminKeys());

const args = process.argv.slice(2);
const dryRun = args.includes("--dry");
const targets = args.filter((a) => !a.startsWith("--"));

if (targets.length === 0) {
    console.error("usage: collections-admin-block.mjs [--dry] <dir-or-file>...");
    process.exit(2);
}

/** Collection files, mirroring the loader's filter in @rebasepro/server. */
function collectionFiles(target) {
    const abs = path.resolve(target);
    if (!fs.existsSync(abs)) return [];
    if (fs.statSync(abs).isFile()) return [abs];
    const out = [];
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name === "node_modules" || entry.name === "dist") continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) { walk(full); continue; }
            if (!/\.tsx?$/.test(entry.name)) continue;
            if (/\.(test|spec|d)\.tsx?$/.test(entry.name)) continue;
            if (entry.name === "index.ts" || entry.name === "index.js") continue;
            out.push(full);
        }
    };
    walk(abs);
    return out;
}

/**
 * The object literal a collection file exports.
 *
 * Handles the three shapes real files use: `export default { … }`,
 * `export default defineCollection({ … })`, and
 * `const x = { … }; export default x;`.
 */
function collectionObjectsIn(sourceFile) {
    const objects = [];

    const unwrap = (expr) => {
        if (!expr) return undefined;
        if (expr.isKind?.(SyntaxKind.ObjectLiteralExpression)) return expr;
        // defineCollection({ … }) — and any other single-object-argument
        // wrapper, including the removed buildCollection, since this codemod
        // runs against pre-0.11 sources that may still use it.
        if (expr.isKind?.(SyntaxKind.CallExpression)) {
            const [first] = expr.getArguments();
            if (first?.isKind(SyntaxKind.ObjectLiteralExpression)) return first;
        }
        // `satisfies` / `as` wrappers
        if (expr.isKind?.(SyntaxKind.SatisfiesExpression) || expr.isKind?.(SyntaxKind.AsExpression)) {
            return unwrap(expr.getExpression());
        }
        return undefined;
    };

    for (const statement of sourceFile.getStatements()) {
        if (statement.isKind(SyntaxKind.ExportAssignment)) {
            const expr = statement.getExpression();
            const direct = unwrap(expr);
            if (direct) { objects.push(direct); continue; }
            if (expr.isKind(SyntaxKind.Identifier)) {
                const decl = sourceFile.getVariableDeclaration(expr.getText());
                const viaVar = unwrap(decl?.getInitializer());
                if (viaVar) objects.push(viaVar);
            }
        }
    }

    // Exported consts, for files that export several collections.
    for (const decl of sourceFile.getVariableDeclarations()) {
        if (!decl.isExported()) continue;
        const obj = unwrap(decl.getInitializer());
        if (obj && !objects.includes(obj)) objects.push(obj);
    }

    return objects;
}

let changedFiles = 0;
let movedFields = 0;
const warnings = [];

/**
 * Presentation keys can also appear inside `relations[].overrides`, which is a
 * `Partial<CollectionConfig>` describing the *target* collection. Those need the
 * same nesting, but rewriting them safely means deciding which nested object
 * literal is an override and which is an unrelated config — so they are reported
 * rather than guessed at. Leaving them silent would turn a migration into a type
 * error the user has to trace back to here.
 */
function warnAboutNestedOverrides(sourceFile, file) {
    for (const assignment of sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAssignment)) {
        if (assignment.getName().replace(/^["']|["']$/g, "") !== "overrides") continue;
        const block = assignment.getInitializerIfKind(SyntaxKind.ObjectLiteralExpression);
        if (!block) continue;
        const stray = block
            .getProperties()
            .filter((p) => p.isKind(SyntaxKind.PropertyAssignment))
            .map((p) => p.getName().replace(/^["']|["']$/g, ""))
            .filter((name) => ADMIN_KEYS.has(name));
        if (stray.length === 0) continue;
        warnings.push(
            `${path.relative(repoRoot, file)}:${assignment.getStartLineNumber()} — ` +
                `relation override carries ${stray.join(", ")}; nest by hand as ` +
                `overrides: { admin: { ${stray[0]}: … } }`
        );
    }
}

for (const target of targets) {
    for (const file of collectionFiles(target)) {
        const project = new Project({
            manipulationSettings: { indentationText: IndentationText.FourSpaces }
        });
        const sourceFile = project.addSourceFileAtPath(file);
        let touched = false;

        warnAboutNestedOverrides(sourceFile, file);

        for (const collection of collectionObjectsIn(sourceFile)) {
            const toMove = collection
                .getProperties()
                .filter((p) => p.isKind(SyntaxKind.PropertyAssignment))
                .map((p) => ({ prop: p, name: p.getName().replace(/^["']|["']$/g, "") }))
                .filter(({ name }) => ADMIN_KEYS.has(name));

            if (toMove.length === 0) continue;

            // Capture text before removing — a removed node cannot be read.
            const entries = toMove.map(({ prop, name }) => {
                const initializer = prop.getInitializerOrThrow().getText();
                const key = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
                return `${key}: ${initializer}`;
            });

            const existing = collection.getProperty("admin");
            for (const { prop } of toMove) prop.remove();

            if (existing?.isKind(SyntaxKind.PropertyAssignment)) {
                const block = existing.getInitializerIfKind(SyntaxKind.ObjectLiteralExpression);
                if (block) {
                    for (const entry of entries) {
                        const [key, ...rest] = entry.split(": ");
                        block.addPropertyAssignment({ name: key, initializer: rest.join(": ") });
                    }
                }
            } else {
                collection.addPropertyAssignment({
                    name: "admin",
                    initializer: `{\n${entries.map((e) => `    ${e}`).join(",\n")}\n}`
                });
            }

            movedFields += entries.length;
            touched = true;
        }

        if (!touched) continue;
        sourceFile.formatText({ indentSize: 4 });
        changedFiles++;
        const rel = path.relative(repoRoot, file);
        if (dryRun) console.log(`would migrate ${rel}`);
        else { sourceFile.saveSync(); console.log(`migrated ${rel}`); }
    }
}

console.log(
    `${dryRun ? "[dry] " : ""}${changedFiles} collection file(s), ${movedFields} field(s) moved into \`admin\``
);

if (warnings.length > 0) {
    console.warn(`\n${warnings.length} place(s) need a hand edit:\n`);
    for (const warning of warnings) console.warn(`  ${warning}`);
    // Not a failure: what could be migrated was, and a type error surfaces the
    // rest. Exiting non-zero would suggest nothing landed.
}
