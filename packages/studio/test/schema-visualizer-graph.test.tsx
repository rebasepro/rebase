/**
 * @jest-environment jsdom
 */
import { describe, expect, it } from "@jest/globals";
import { renderHook } from "@testing-library/react";
import type { AdminCollection } from "@rebasepro/cms-types";

import { useSchemaGraph, type TableNodeData } from "../src/components/SchemaVisualizer/useSchemaGraph";

/** A collection that leaves its table to the slug, as the docs' own example does. */
const blogPosts: AdminCollection = {
    slug: "blog-posts",
    name: "Blog posts",
    properties: {
        title: { type: "string", name: "Title" },
        subtotal: { type: "number", name: "Subtotal" },
        published: { type: "date", name: "Published" }
    }
};

function nodeOf(collections: AdminCollection[], liveRls: Set<string> | null): TableNodeData {
    const { result } = renderHook(() => useSchemaGraph(collections, liveRls));
    const [node] = result.current.nodes;
    return node.data as TableNodeData;
}

describe("a collection whose table is derived from its slug", () => {

    it("is drawn as the table db push creates", () => {
        expect(nodeOf([blogPosts], null).tableName).toBe("blog_posts");
    });

    it("shows the RLS the database reports for that table", () => {
        expect(nodeOf([blogPosts], new Set(["public.blog_posts"])).rlsEnabled).toBe(true);
    });
});

describe("a column's type", () => {

    it("is the type the collection declares, not a guess at the database's", () => {
        // A `number` with no `columnType` is NUMERIC in the database, not
        // INTEGER; the diagram is drawn from the collection, so it says what
        // the collection says.
        const columns = nodeOf([blogPosts], null).columns;
        expect(columns.map(c => [c.name, c.typeLabel])).toEqual([
            ["title", "string"],
            ["subtotal", "number"],
            ["published", "date"]
        ]);
    });
});
