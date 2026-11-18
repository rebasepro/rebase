import { readFileSync } from "fs";
import path from "path";

const css = readFileSync(path.join(__dirname, "../src/index.css"), "utf8");

describe("the kit stylesheet", () => {
    it("sets caption at 12px, so nothing a person reads is under it", () => {
        expect(css).toMatch(/\.typography-caption\s*\{\s*@apply text-xs leading-\[1\.45\];/);
    });

    it("keeps micro, the uppercase label, as the one tier under 12px", () => {
        expect(css).toMatch(/\.typography-micro\s*\{\s*@apply text-2xs font-medium uppercase/);
    });

    it("draws Lucide icons at 1.5, except icons at 12px and under and an opted-out one", () => {
        const rule = css.match(/svg\.lucide([^{]*)\{\s*stroke-width:\s*1\.5;/);
        expect(rule).not.toBeNull();
        const selector = rule![1];
        expect(selector).toContain(":not(.stroke-keep)");
        for (const size of [8, 9, 10, 11, 12]) expect(selector).toContain(`:not([width="${size}"])`);
    });

    it("selects only Lucide's svg, so charts and hand-drawn icons keep their stroke", () => {
        expect(css).not.toMatch(/^\s*svg\s*\{[^}]*stroke-width/m);
        expect(css).not.toMatch(/^\s*path\s*\{[^}]*stroke-width/m);
    });

    it("defines the dot-grid ground on the strong hairline, which switches with the theme", () => {
        expect(css).toMatch(/\.bg-dot-grid\s*\{[^}]*radial-gradient\(circle, var\(--hairline-strong\) 1px, transparent 1px\);[^}]*background-size: 16px 16px;/);
    });
});
