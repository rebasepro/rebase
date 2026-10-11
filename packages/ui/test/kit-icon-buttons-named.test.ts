import fs from "fs";
import path from "path";

/**
 * Every `IconButton` the kit renders itself has a name. Three did not — the
 * table header's filter button, the collection toolbar's view settings and a
 * board column's add button — so a screen reader heard "button". A ratchet:
 * an icon-only control in the kit says what it does (`aria-label`), or
 * forwards one (`{...props}`).
 */
const SRC = path.resolve(__dirname, "../src");

function files(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) return files(full);
        return e.name.endsWith(".tsx") && !e.name.includes(".test.") ? [full] : [];
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

test("every IconButton in the kit is named", () => {
    const unnamed: string[] = [];
    for (const file of files(SRC)) {
        if (file.endsWith(path.join("components", "IconButton.tsx"))) continue;
        const source = fs.readFileSync(file, "utf8");
        for (const m of source.matchAll(/<IconButton\b/g)) {
            const tag = openingTag(source, m.index ?? 0);
            if (!/aria-label|aria-labelledby|\{\.\.\./.test(tag)) {
                unnamed.push(`${path.relative(SRC, file)}:${source.slice(0, m.index).split("\n").length}`);
            }
        }
    }
    expect(unnamed).toEqual([]);
});
