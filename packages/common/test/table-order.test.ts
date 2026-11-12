import { describe, expect, it } from "@jest/globals";
import { sortTablesBySlug } from "../src/table";

describe("sortTablesBySlug", () => {
    it("orders by slug with localeCompare, without touching the input", () => {
        const input = [{ descriptor: { slug: "posts" } }, { descriptor: { slug: "Authors" } }, { descriptor: { slug: "authors" } }];
        const sorted = sortTablesBySlug(input);
        expect(sorted.map(t => t.descriptor.slug)).toEqual(["authors", "Authors", "posts"]);
        expect(input.map(t => t.descriptor.slug)).toEqual(["posts", "Authors", "authors"]);
    });
});
