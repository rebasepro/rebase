/**
 * The view's stylesheet gives the page its own text colour, in both themes,
 * outside any layer: a host page's base styles (a Claude artifact's) beat a
 * layered rule, and a cell, panel or dialog with no colour of its own then
 * read dark grey on a dark view.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.resolve(import.meta.dirname, "../views/index.css"), "utf8");

/** The stylesheet with every `@layer` block and comment taken out. */
function unlayered(source: string): string {
    const text = source.replace(/\/\*[\s\S]*?\*\//g, "");
    let out = "";
    let i = 0;
    while (i < text.length) {
        const start = text.indexOf("@layer", i);
        const open = start === -1 ? -1 : text.indexOf("{", start);
        const semicolon = start === -1 ? -1 : text.indexOf(";", start);
        if (start === -1 || open === -1 || (semicolon !== -1 && semicolon < open)) {
            out += text.slice(i);
            break;
        }
        out += text.slice(i, start);
        let depth = 0;
        let j = open;
        for (; j < text.length; j++) {
            if (text[j] === "{") depth++;
            else if (text[j] === "}" && --depth === 0) break;
        }
        i = j + 1;
    }
    return out;
}

describe("the view's stylesheet", () => {
    it("sets body's text colour in both themes, outside any layer", () => {
        const rules = unlayered(css);
        expect(rules).toMatch(/(^|\n)body\s*\{[^}]*color:\s*var\(--color-text-primary\)/);
        expect(rules).toMatch(/\.dark body\s*\{[^}]*color:\s*var\(--color-text-primary-dark\)/);
    });
});
