/**
 * @jest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { AdminCollection } from "@rebasepro/cms-types";

/**
 * Where the schema visualizer's layout runs.
 *
 * Dagre lays a graph out in 5 s at 200 cross-linked tables and 90 s at 500,
 * and it ran in render: opening the view froze the tab for that long. A graph
 * not laid out before now goes to a worker, and the hook answers "laying out"
 * at once, with nothing placed; the positions arrive when the worker replies.
 *
 * jsdom has no `Worker`, so this file brings one: a stand-in for the inlined
 * worker module that runs the same `runDagre` the real one does, when the test
 * says so — which is what lets it tell "laid out in render" from "laid out off
 * the main thread".
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

type Listener = (event: { data?: unknown; preventDefault: () => void }) => void;

/** The workers started, in order, each with what it was asked and how to answer. */
const mockWorkers: MockLayoutWorker[] = [];
let mockConstructorThrows = false;

class MockLayoutWorker {
    readonly listeners: Record<string, Listener[]> = {};
    received: unknown;
    terminated = false;

    constructor() {
        if (mockConstructorThrows) throw new Error("worker-src refused");
        mockWorkers.push(this);
    }

    addEventListener(type: string, listener: Listener) {
        (this.listeners[type] ??= []).push(listener);
    }

    postMessage(data: unknown) {
        this.received = data;
    }

    terminate() {
        this.terminated = true;
    }

    /** Run the layout, as the real worker does, and reply. */
    async run() {
        const { runDagre } = await import("../src/components/SchemaVisualizer/dagre-layout");
        const positions = runDagre(this.received as Parameters<typeof runDagre>[0]);
        for (const listener of this.listeners.message ?? []) listener({ data: { positions }, preventDefault: () => undefined });
    }

    /** The script never ran: what a blocked or failed worker load looks like. */
    fail() {
        for (const listener of this.listeners.error ?? []) listener({ preventDefault: () => undefined });
    }
}

jest.mock(
    "../src/components/SchemaVisualizer/dagre-layout.worker?worker&inline",
    () => ({ __esModule: true, default: MockLayoutWorker }),
    { virtual: true }
);

import { useSchemaGraph } from "../src/components/SchemaVisualizer/useSchemaGraph";

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

const realCreateObjectURL = URL.createObjectURL;

beforeEach(() => {
    mockLayoutCalls.count = 0;
    mockWorkers.length = 0;
    mockConstructorThrows = false;
    // What `canLayOutOffThread` looks for: a browser that can start a worker.
    Object.assign(globalThis, { Worker: MockLayoutWorker });
    URL.createObjectURL = () => "blob:layout";
});

afterEach(() => {
    delete (globalThis as { Worker?: unknown }).Worker;
    URL.createObjectURL = realCreateObjectURL;
});

/** Let the dynamic import of the worker module settle and the worker start. */
async function workerStarted(count = 1) {
    await waitFor(() => expect(mockWorkers.length).toBe(count));
}

describe("a graph the visualizer has not laid out before", () => {
    it("is laid out in a worker, not in render", async () => {
        const { result } = renderHook(() => useSchemaGraph(schema("off"), null));

        // Render returned without running dagre, and says it is laying out.
        expect(mockLayoutCalls.count).toBe(0);
        expect(result.current.layingOut).toBe(true);
        expect(result.current.nodes).toEqual([]);
        // What the sidebar lists does not wait for the layout.
        expect(result.current.tableCount).toBe(2);

        await workerStarted();
        const [worker] = mockWorkers;
        expect(worker.received).toEqual({
            nodes: [
                { id: "table-off_authors", width: 280, height: expect.any(Number) },
                { id: "table-off_posts", width: 280, height: expect.any(Number) }
            ],
            edges: [{ source: "table-off_posts", target: "table-off_authors" }]
        });
        expect(mockLayoutCalls.count).toBe(0);

        await act(() => worker.run());

        await waitFor(() => expect(result.current.layingOut).toBe(false));
        expect(worker.terminated).toBe(true);
        expect(result.current.nodes.map(node => node.id)).toEqual(["table-off_authors", "table-off_posts"]);
        // Placed — top to bottom, a foreign key's table above the one it
        // points at — and the edge's handles sided from those places.
        const [authors, posts] = result.current.nodes;
        expect(authors.position.y).toBeGreaterThan(posts.position.y);
        expect(result.current.edges[0].sourceHandle).toMatch(/-(left|right)$/);
    });

    it("lands where the main-thread layout puts it", async () => {
        const offThread = renderHook(() => useSchemaGraph(schema("same"), null));
        await workerStarted();
        await act(() => mockWorkers[0].run());
        await waitFor(() => expect(offThread.result.current.layingOut).toBe(false));

        // No worker: the layout runs where it is asked for, as it always did.
        delete (globalThis as { Worker?: unknown }).Worker;
        const here = renderHook(() => useSchemaGraph(schema("same2"), null));

        expect(offThread.result.current.nodes.map(node => node.position))
            .toEqual(here.result.current.nodes.map(node => node.position));
        expect(offThread.result.current.edges.map(edge => [edge.sourceHandle, edge.targetHandle]))
            .toEqual(here.result.current.edges.map(edge => [edge.sourceHandle, edge.targetHandle]));
    });

    it("is not laid out again when the live RLS answer arrives", async () => {
        const collections = schema("rls");
        const { result, rerender } = renderHook(({ liveRls }) => useSchemaGraph(collections, liveRls), {
            initialProps: { liveRls: null as Set<string> | null }
        });
        await workerStarted();
        await act(() => mockWorkers[0].run());
        await waitFor(() => expect(result.current.layingOut).toBe(false));

        rerender({ liveRls: new Set(["public.rls_posts"]) });

        // Drawn in the same render, from the positions already in hand.
        expect(result.current.layingOut).toBe(false);
        expect(result.current.nodes).toHaveLength(2);
        expect(mockWorkers).toHaveLength(1);
    });

    it("asked for twice while laying out, is laid out once", async () => {
        const first = renderHook(() => useSchemaGraph(schema("twice"), null));
        const second = renderHook(() => useSchemaGraph(schema("twice"), null));
        await workerStarted();
        await act(() => mockWorkers[0].run());

        await waitFor(() => expect(second.result.current.layingOut).toBe(false));
        expect(first.result.current.layingOut).toBe(false);
        expect(mockWorkers).toHaveLength(1);
    });

    it("is laid out on the main thread when the worker cannot start", async () => {
        mockConstructorThrows = true;
        const { result } = renderHook(() => useSchemaGraph(schema("refused"), null));

        await waitFor(() => expect(result.current.layingOut).toBe(false));
        expect(result.current.nodes).toHaveLength(2);
        expect(mockLayoutCalls.count).toBe(1);
    });

    it("is laid out on the main thread when the worker's script fails to load", async () => {
        const { result } = renderHook(() => useSchemaGraph(schema("failed"), null));
        await workerStarted();

        act(() => mockWorkers[0].fail());

        await waitFor(() => expect(result.current.layingOut).toBe(false));
        expect(result.current.nodes).toHaveLength(2);
        expect(mockWorkers[0].terminated).toBe(true);
    });
});
