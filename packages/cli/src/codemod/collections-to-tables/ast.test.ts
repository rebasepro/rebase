/**
 * `spreadSource`: a value spread in from one shared object is carried as that
 * object's member, and only when nothing else in the literal could provide it.
 */
import { describe, expect, it } from "vitest";
import type { ObjectLiteralExpression } from "ts-morph";

import { createAstContext, spreadSource, type AstContext } from "./ast";

async function literalOf(source: string): Promise<{ ctx: AstContext; literal: ObjectLiteralExpression }> {
    const ctx = createAstContext(await import("ts-morph"));
    const sf = ctx.project.createSourceFile(`/virtual/case-${Math.random().toString(36).slice(2)}.ts`, source);
    const literal = sf.getVariableDeclarationOrThrow("collection").getInitializerOrThrow();
    if (!ctx.tsm.Node.isObjectLiteralExpression(literal)) throw new Error("not an object literal");
    return { ctx, literal };
}

const PATH = ["properties", "slug", "dynamicProps"];

describe("spreadSource", () => {
    it("names the member of the one imported object a property spreads", async () => {
        const { ctx, literal } = await literalOf(`import { fixed } from "./rules";
const collection = { properties: { slug: { name: "Slug", ...fixed } } };`);
        expect(spreadSource(ctx, literal, PATH)?.text).toBe("fixed.dynamicProps");
    });

    it("follows a top-level const and a property chain on it", async () => {
        const { ctx, literal } = await literalOf(`const rules = { fixed: { dynamicProps: () => ({}) } };
const collection = { properties: { slug: { ...rules.fixed } } };`);
        expect(spreadSource(ctx, literal, PATH)?.text).toBe("rules.fixed.dynamicProps");
    });

    it("carries the rest of the path when the spread provides an object on the way", async () => {
        const { ctx, literal } = await literalOf(`import { WRITTEN } from "./shared";
const collection = { admin: { ...WRITTEN } };`);
        expect(spreadSource(ctx, literal, ["admin", "browserCallbacks", "beforeSave"])?.text).toBe("WRITTEN.browserCallbacks.beforeSave");
    });

    it.each([
        ["two spreads", `import { a, b } from "./r";\nconst collection = { properties: { slug: { ...a, ...b } } };`],
        ["a member of that name before the spread", `import { a } from "./r";\nconst collection = { properties: { slug: { dynamicProps: () => ({}), ...a } } };`],
        ["a computed key", `import { a } from "./r";\nconst k = "x";\nconst collection = { properties: { slug: { [k]: 1, ...a } } };`],
        ["a spread of a call", `import { make } from "./r";\nconst collection = { properties: { slug: { ...make() } } };`],
        ["a spread of a let", `let a = {};\nconst collection = { properties: { slug: { ...a } } };`]
    ])("gives up on %s: something else could provide the value", async (_label, source) => {
        const { ctx, literal } = await literalOf(source);
        expect(spreadSource(ctx, literal, PATH)).toBeUndefined();
    });
});
