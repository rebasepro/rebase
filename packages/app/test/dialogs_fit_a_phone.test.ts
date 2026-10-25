import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "@jest/globals";

/**
 * A dialog's or a popover's content must fit a 375px phone.
 *
 * The kit's `Dialog` sizes its paper to the viewport (`w-11/12` up to its
 * `maxWidth`). A fixed `min-w-[420px]` on the content inside it overrides that:
 * on a phone the dialog ran wider than the screen and the page scrolled
 * sideways — the branch merge dialog did. A minimum width belongs behind a
 * breakpoint (`sm:min-w-[420px]`).
 *
 * A popover is the same: it is positioned inside the viewport, never shrunk
 * to it, so a `min-w-[360px]` panel ran off a phone's edge (the AI collection
 * generator's, a `Menu`, did). Its whole content is read, from `<Popover` or
 * `<Menu` to the closing tag.
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

    it("never sets one in a popover's or a menu's content either", () => {
        const offenders: string[] = [];
        for (const file of PACKAGES.flatMap(sourceFiles)) {
            const source = fs.readFileSync(file, "utf8");
            for (const open of source.matchAll(/<(Popover|Menu)\b/g)) {
                const start = open.index ?? 0;
                const end = source.indexOf(`</${open[1]}>`, start);
                const content = source.slice(start, end === -1 ? undefined : end);
                const unprefixed = [...content.matchAll(/(?<![\w:-])min-w-\[(\d+)px\]/g)]
                    .filter(m => Number(m[1]) > 343)
                    .map(m => m[0]);
                if (unprefixed.length) offenders.push(`${path.relative(path.resolve(__dirname, "../.."), file)}: ${unprefixed.join(" ")}`);
            }
        }
        expect(offenders).toEqual([]);
    });
});
