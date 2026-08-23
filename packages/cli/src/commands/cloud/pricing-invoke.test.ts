/**
 * The pricing call addresses a sub-path, not a function called "pricing/quote".
 *
 * `invoke()` URL-encodes the function name, so a slash inside it becomes `%2F`
 * and the route 404s. Both CLI call sites had the slash in the name and both
 * swallowed the failure in a bare `catch {}` whose comment blamed "a control
 * plane without the quote endpoint" — so `rebase cloud billing` and
 * `rebase cloud resources` never printed a price, and the absence looked
 * deliberate. The saas console makes the same call correctly, with a comment
 * explaining exactly this.
 *
 * Asserted against the source rather than by running the command, because what
 * went wrong is a string, and the command needs a control plane.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const RAW = readFileSync(resolve(import.meta.dirname, "./resources.ts"), "utf-8");

/**
 * Comments stripped, because the fix's own comment quotes the broken string to
 * explain it — and a test that fails on an explanation is one that teaches
 * people to delete explanations.
 */
const SOURCE = RAW
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ");

describe("cloud resources pricing calls", () => {
    it("finds the invoke calls at all", () => {
        // Guards the two assertions below from passing vacuously if these
        // calls move or are renamed.
        expect(SOURCE).toContain("invoke<ResourceQuote>");
        expect(SOURCE.match(/invoke<ResourceQuote>/g)!.length).toBe(2);
    });

    it("never puts a slash in the function name", () => {
        expect(SOURCE).not.toContain('"pricing/quote"');
    });

    it("addresses the sub-path with the `path` option", () => {
        const calls = SOURCE.match(/invoke<ResourceQuote>\([\s\S]{0,220}?\)/g) ?? [];
        expect(calls.length).toBe(2);
        for (const call of calls) {
            expect(call).toContain('"pricing"');
            expect(call).toContain('path: "quote"');
        }
    });
});
