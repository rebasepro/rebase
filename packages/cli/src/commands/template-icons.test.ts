/**
 * Every icon a scaffold or the reference app names is an icon that exists.
 *
 * The blog template shipped `icon: "Article"` and `icon: "Person"`, and the
 * ecommerce preset `icon: "Category"` — names from the Material set the admin
 * no longer draws from. An unknown name is not an error anywhere: the admin
 * draws a placeholder picked from the table's slug, so a new project's very
 * first screen showed two of its four tables with the wrong icon and nothing
 * said why. The names are checked here the way the admin resolves them
 * (`getIcon` in @rebasepro/app): as written, lowercased, or snake_cased.
 */
import fs from "fs";
import path from "path";
import { describe, it, expect } from "vitest";

const REPO = path.resolve(__dirname, "../../../..");

/** The icon names `@rebasepro/ui` draws, read from its source list. */
function knownIconKeys(): Set<string> {
    const source = fs.readFileSync(path.join(REPO, "packages/ui/src/icons/icon_keys.ts"), "utf-8");
    const keys = [...source.matchAll(/^\s*"([A-Za-z0-9]+)",?\s*$/gm)].map(match => match[1]);
    const known = new Set<string>();
    for (const key of keys) {
        known.add(key);
        known.add(key.toLowerCase());
        known.add(key.replace(/([A-Z])/g, "_$1").toLowerCase().replace(/^_/, ""));
    }
    return known;
}

/** Every `.tsx` file under `dir`, recursively. */
function tsxFiles(dir: string): string[] {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === "node_modules" ? [] : tsxFiles(full);
        return entry.name.endsWith(".tsx") ? [full] : [];
    });
}

/** The customization files a scaffold writes, and the reference app's. */
const CMS_DIRS = [
    "packages/cli/templates",
    "app/frontend/src/cms"
];

describe("icons named by the templates and the reference app", () => {
    const known = knownIconKeys();

    it("reads a plausible icon list", () => {
        // A regex that stopped matching would pass every name below.
        expect(known.has("FileText")).toBe(true);
        expect(known.size).toBeGreaterThan(1000);
    });

    it("names only icons that exist", () => {
        const files = CMS_DIRS.flatMap(dir => tsxFiles(path.join(REPO, dir)))
            .filter(file => file.includes(`${path.sep}cms${path.sep}`));
        expect(files.length).toBeGreaterThan(5);

        const unknown: string[] = [];
        for (const file of files) {
            const source = fs.readFileSync(file, "utf-8");
            for (const match of source.matchAll(/\bicon:\s*"([^"]+)"/g)) {
                if (!known.has(match[1])) unknown.push(`${path.relative(REPO, file)}: "${match[1]}"`);
            }
        }
        expect(unknown, "not an icon the admin can draw — use a Lucide name (https://lucide.dev/icons)").toEqual([]);
    });
});
