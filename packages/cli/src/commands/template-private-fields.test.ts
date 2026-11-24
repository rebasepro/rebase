/**
 * No table customization a scaffold ships names a `.private()` column.
 *
 * A private column is never served, so the admin cannot apply a customization
 * to it: it logs `customizeTable("users") fields.<key>: the "users" table
 * serves no field "<key>" to this user. Skipped.` on every page load of every
 * new project. b361de94d1 removed two such entries (passwordHash,
 * emailVerificationToken); 610bdcfb07 then made emailChangeToken private while
 * the template still hid it, and the warning came back. This holds the class,
 * not the key.
 */
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const CLI_ROOT = path.resolve(__dirname, "..", "..");
const TEMPLATES = path.join(CLI_ROOT, "templates");
const REPO_ROOT = path.resolve(CLI_ROOT, "..", "..");

/** A project root, and where its schema files fall back to (a preset overlays the template). */
const ROOTS: Array<{ name: string; root: string; fallback?: string }> = [
    { name: "template", root: path.join(TEMPLATES, "template") },
    ...fs.readdirSync(path.join(TEMPLATES, "presets")).map((preset) => ({
        name: `presets/${preset}`,
        root: path.join(TEMPLATES, "presets", preset),
        fallback: path.join(TEMPLATES, "template")
    })),
    { name: "app (reference)", root: path.join(REPO_ROOT, "app") }
];

function privateColumns(schemaFile: string): string[] {
    const source = fs.readFileSync(schemaFile, "utf8");
    return [...source.matchAll(/^\s*(\w+):\s*col\.[^\n]*\.private\(\)/gm)].map((m) => m[1]);
}

/** Keys of the `fields: { … }` block, at its first nesting level. */
function customizedFields(source: string): string[] {
    const start = source.search(/\bfields:\s*\{/);
    if (start === -1) return [];
    const open = source.indexOf("{", start);
    const keys: string[] = [];
    let depth = 0;
    for (let i = open; i < source.length; i++) {
        const ch = source[i];
        if (ch === "{") {
            depth++;
        } else if (ch === "}") {
            depth--;
            if (depth === 0) break;
        } else if (depth === 1) {
            const match = /^(\w+)\s*:/.exec(source.slice(i));
            if (match && /[\s{,]/.test(source[i - 1])) {
                keys.push(match[1]);
                i += match[0].length - 1;
            }
        }
    }
    return keys;
}

describe("scaffold table customizations name no private column", () => {
    for (const { name, root, fallback } of ROOTS) {
        const cmsDir = path.join(root, "frontend", "src", "cms");
        if (!fs.existsSync(cmsDir)) continue;
        for (const file of fs.readdirSync(cmsDir).filter((f) => f.endsWith(".tsx"))) {
            const source = fs.readFileSync(path.join(cmsDir, file), "utf8");
            const imported = /import type \{[^}]*\} from "(?:\.\.\/)+backend\/schema\/([\w-]+)"/.exec(source);
            if (!imported) continue;
            const candidates = [root, fallback].filter((r): r is string => Boolean(r))
                .map((r) => path.join(r, "backend", "schema", `${imported[1]}.ts`));
            const schemaFile = candidates.find((f) => fs.existsSync(f));
            if (!schemaFile) continue;

            it(`${name}: frontend/src/cms/${file}`, () => {
                const hidden = privateColumns(schemaFile);
                const offending = customizedFields(source).filter((key) => hidden.includes(key));
                expect(offending).toEqual([]);
            });
        }
    }

    it("reads the users table's private columns (the parser is not vacuous)", () => {
        expect(privateColumns(path.join(TEMPLATES, "template", "backend", "schema", "users.ts")))
            .toEqual(expect.arrayContaining(["passwordHash", "emailVerificationToken"]));
    });
});
