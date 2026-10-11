import fs from "fs";
import path from "path";

/**
 * A `ResizablePanels` divider is a focusable `role="separator"`: Tab reaches
 * it and the arrow keys move it. Without `dividerAriaLabel` a screen reader
 * announces it as "separator, 30" — nothing says what it resizes. Every
 * caller in the admin packages names it, translated.
 */
const ROOT = path.resolve(__dirname, "../..");
const PACKAGES = ["ui", "cms", "studio", "app", "plugin-ai"];

function sourceFiles(dir: string): string[] {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return sourceFiles(full);
        return entry.name.endsWith(".tsx") && !/\.test\.tsx$/.test(entry.name) ? [full] : [];
    });
}

/** The opening tag starting at `start`, braces balanced. */
function openingTag(source: string, start: number): string {
    let depth = 0;
    for (let i = start; i < source.length; i++) {
        const c = source[i];
        if (c === "{") depth++;
        else if (c === "}") depth--;
        else if (c === ">" && depth === 0) return source.slice(start, i);
    }
    return source.slice(start);
}

test("every ResizablePanels caller names its divider", () => {
    let callers = 0;
    const unnamed: string[] = [];
    for (const pkg of PACKAGES) {
        const src = path.join(ROOT, pkg, "src");
        for (const file of sourceFiles(src)) {
            const source = fs.readFileSync(file, "utf8");
            for (const m of source.matchAll(/<ResizablePanels\b/g)) {
                callers++;
                const tag = openingTag(source, m.index ?? 0);
                if (!/\bdividerAriaLabel=|\{\.\.\./.test(tag)) {
                    unnamed.push(`${pkg}/src/${path.relative(src, file)}:${source.slice(0, m.index).split("\n").length}`);
                }
            }
        }
    }
    // The scan found the callers it is meant to check.
    expect(callers).toBeGreaterThan(0);
    expect(unnamed).toEqual([]);
});
