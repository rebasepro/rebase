import { describe, it, expect } from "vitest";

/**
 * `emit`'s JSON argument must be a value, not a producer of one.
 *
 * The human argument beside it IS a thunk, so mirroring it reads natural — and
 * four call sites in `resources.ts` did exactly that. `json: unknown` accepted a
 * function without complaint, `printJson` stringified it, and
 * `JSON.stringify(fn)` is `undefined`. So `rebase cloud resources`,
 * `resources set`, `clusters verify` and `clusters add` printed the single word
 * `undefined` on every piped or `--json` run — and this command family forces
 * JSON mode off a TTY, so that was every scripted use.
 *
 * The guard is the TYPE (`JsonArg<T>` resolves a function to `never`), which is
 * why this file asserts the property that made the bug invisible rather than
 * re-testing the compiler.
 */
describe("what made `undefined` printable", () => {
    it("JSON.stringify of a function is undefined, not an error", () => {
        // No throw, no empty string, no "[Function]" — the exact shape that let
        // a wrong argument reach a user as a one-word output.
        expect(JSON.stringify(() => ({ cpu: "250m" }))).toBeUndefined();
        expect(JSON.stringify({ cpu: "250m" })).toBe('{"cpu":"250m"}');
    });

    it("no call site in the cloud commands passes a thunk as the payload", async () => {
        // Belt and braces beside the type: a `@ts-expect-error` or an `as any`
        // at a call site would slip past the compiler, and this catches it.
        const { readFileSync, readdirSync } = await import("node:fs");
        const { join } = await import("node:path");
        const dir = join(__dirname);
        const offenders: string[] = [];

        for (const file of readdirSync(dir).filter(f => f.endsWith(".ts") && !f.includes(".test."))) {
            const src = readFileSync(join(dir, file), "utf8");
            for (const m of src.matchAll(/\bemit\(\s*\(\)\s*=>\s*\{/g)) {
                // Walk to the end of the human thunk, then read the next argument.
                let depth = 1;
                let i = m.index! + m[0].length;
                while (i < src.length && depth > 0) {
                    if (src[i] === "{") depth++;
                    else if (src[i] === "}") depth--;
                    i++;
                }
                if (/^\s*,\s*\(\)\s*=>/.test(src.slice(i, i + 40))) {
                    offenders.push(`${file}:${src.slice(0, m.index).split("\n").length}`);
                }
            }
        }

        expect(offenders).toEqual([]);
    });
});
