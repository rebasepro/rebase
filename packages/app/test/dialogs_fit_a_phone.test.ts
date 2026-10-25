import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "@jest/globals";

/**
 * A dialog's content must fit a 375px phone.
 *
 * The kit's `Dialog` sizes its paper to the viewport (`w-11/12` up to its
 * `maxWidth`). A fixed `min-w-[420px]` on the content inside it overrides that:
 * on a phone the dialog ran wider than the screen and the page scrolled
 * sideways — the branch merge dialog did. A minimum width belongs behind a
 * breakpoint (`sm:min-w-[420px]`).
 */
const PACKAGES = ["app", "cms", "studio"].map(name => path.resolve(__dirname, "../..", name, "src"));

function sourceFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return sourceFiles(full);
        return entry.name.endsWith(".tsx") && !entry.name.includes(".test.") ? [full] : [];
    });
}

describe("dialog content", () => {
    it("never sets a fixed minimum width wider than a phone outside a breakpoint", () => {
        const offenders: string[] = [];
        for (const file of PACKAGES.flatMap(sourceFiles)) {
            const source = fs.readFileSync(file, "utf8");
            for (const match of source.matchAll(/<DialogContent\b[^>]*className=\{?["'`]([^"'`]*)["'`]/g)) {
                const unprefixed = match[1].split(/\s+/).filter(c => /^min-w-\[(\d+)px\]$/.test(c) && Number(c.match(/\d+/)![0]) > 343);
                if (unprefixed.length) offenders.push(`${path.relative(path.resolve(__dirname, "../.."), file)}: ${unprefixed.join(" ")}`);
            }
        }
        expect(offenders).toEqual([]);
    });
});
