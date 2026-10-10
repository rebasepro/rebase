/**
 * @jest-environment jsdom
 */
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { renderHook } from "@testing-library/react";
import type { AdminCollection } from "@rebasepro/cms-types";

/**
 * How often the schema visualizer runs its layout.
 *
 * Dagre lays the graph out on the main thread: 4.5–5 s at 200 cross-linked
 * collections, 90 s at 500. It ran when the view opened, again when the live
 * RLS answer arrived a moment later (which changes a badge, not the graph),
 * and again every time the view was reopened. The positions are now kept
 * per graph — its tables, their sizes and its edges — so a graph is laid out
 * once.
 */

const mockLayoutCalls = { count: 0 };
jest.mock("dagre", () => {
    const actual = jest.requireActual<{ default?: Record<string, unknown> } & Record<string, unknown>>("dagre");
    const dagre = (actual.default ?? actual) as Record<string, unknown> & { layout: (graph: unknown) => void };
    return {
        __esModule: true,
        default: {
            ...dagre,
            layout: (graph: unknown) => {
                mockLayoutCalls.count++;
                dagre.layout(graph);
            }
        }
    };
});

import { useSchemaGraph, type TableNodeData } from "../src/components/SchemaVisualizer/useSchemaGraph";

function schema(prefix: string): AdminCollection[] {
    const authors: AdminCollection = {
        slug: `${prefix}_authors`,
        name: "Authors",
        properties: { name: { type: "string", name: "Name" } }
    };
    const posts: AdminCollection = {
        slug: `${prefix}_posts`,
        name: "Posts",
        properties: {
            title: { type: "string", name: "Title" },
            author: { type: "relation", name: "Author", relation: { kind: "belongsTo", target: () => authors, localKey: "author_id" } }
        }
    } as AdminCollection;
    return [authors, posts];
}

beforeEach(() => {
    mockLayoutCalls.count = 0;
});

describe("the schema visualizer's layout", () => {
    it("runs once when the live RLS answer arrives after the graph", () => {
        const collections = schema("rls");
        const { result, rerender } = renderHook(({ liveRls }) => useSchemaGraph(collections, liveRls), {
            initialProps: { liveRls: null as Set<string> | null }
        });
        const before = result.current.nodes.map(node => node.position);

        rerender({ liveRls: new Set(["public.rls_posts"]) });

        expect(mockLayoutCalls.count).toBe(1);
        expect(result.current.nodes.map(node => node.position)).toEqual(before);
        const posts = result.current.nodes.find(node => (node.data as TableNodeData).tableName === "rls_posts");
        expect((posts?.data as TableNodeData).rlsEnabled).toBe(true);
    });

    it("does not run again when the view is opened again on the same schema", () => {
        const first = renderHook(() => useSchemaGraph(schema("reopen"), null));
        const positions = first.result.current.nodes.map(node => node.position);
        first.unmount();

        const second = renderHook(() => useSchemaGraph(schema("reopen"), null));

        expect(mockLayoutCalls.count).toBe(1);
        expect(second.result.current.nodes.map(node => node.position)).toEqual(positions);
    });

    it("runs again when the schema changes", () => {
        renderHook(() => useSchemaGraph(schema("change"), null));
        const changed = schema("change");
        changed.push({ slug: "change_tags", name: "Tags", properties: { label: { type: "string", name: "Label" } } });
        renderHook(() => useSchemaGraph(changed, null));

        expect(mockLayoutCalls.count).toBe(2);
    });
});
