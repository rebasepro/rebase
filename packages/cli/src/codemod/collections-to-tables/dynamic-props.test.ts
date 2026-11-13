/**
 * `dynamicProps` builders rewritten to 0.31's flat return shape, and the cases
 * left for the manual step.
 */
import { describe, expect, it } from "vitest";

import { createAstContext, unwrap } from "./ast";
import { rewriteDynamicProps } from "./dynamic-props";

async function rewrite(source: string): Promise<string | { reason: string }> {
    const ctx = createAstContext(await import("ts-morph"));
    const sf = ctx.project.createSourceFile(`/virtual/dp-${Math.random().toString(36).slice(2)}.ts`, source);
    const fn = unwrap(ctx, sf.getVariableDeclarationOrThrow("builder").getInitializerOrThrow());
    const result = rewriteDynamicProps(ctx, fn, sf, [fn]);
    if (!result.edits) return { reason: result.reason };
    let text = sf.getFullText();
    for (const edit of [...result.edits].sort((a, b) => b.start - a.start)) text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
    return text;
}

describe("rewriteDynamicProps", () => {
    it("hoists `admin` through a ternary, routing each key as a static admin block is", async () => {
        expect(await rewrite(`const builder = ({ id }) => (id ? { admin: { readOnly: true, hideFromCollection: true } } : {});`))
            .toBe(`const builder = ({ id }) => (id ? { readOnly: true, hidden: true } : {});`);
    });

    it("rewrites a shared const every read of which is a builder's return", async () => {
        expect(await rewrite(`const LOCKED = { admin: { readOnly: true } };\nconst builder = ({ id }) => { if (!id) return {}; return LOCKED; };`))
            .toBe(`const LOCKED = { readOnly: true };\nconst builder = ({ id }) => { if (!id) return {}; return LOCKED; };`);
    });

    it.each([
        ["a key with no flat equivalent", `const builder = () => ({ admin: { disabled: { hidden: true } } });`, /admin\.disabled/],
        ["an admin block spread from elsewhere", `const base = { readOnly: true };\nconst builder = () => ({ admin: { ...base } });`, /no flat equivalent/],
        ["a return that is not a literal", `const make = () => ({});\nconst builder = () => make();`, /not an object literal/],
        ["a property outside `admin`", `const builder = () => ({ validation: { required: true } });`, /not an `admin` block/],
        ["a const read elsewhere", `const LOCKED = { admin: { readOnly: true } };\nexport const other = LOCKED;\nconst builder = () => LOCKED;`, /also read outside the builders/]
    ])("leaves %s for the manual step", async (_label, source, reason) => {
        const result = await rewrite(source);
        expect(typeof result === "string" ? result : result.reason).toMatch(reason);
    });
});
