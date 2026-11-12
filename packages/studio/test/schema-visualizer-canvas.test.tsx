/**
 * @jest-environment jsdom
 */
import { en } from "../../app/src/locales/en";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { TableDescriptorsState } from "@rebasepro/app";
import { chainSchema } from "./helpers/schemaFixtures";
import { readyTables } from "./helpers/tableDescriptors";

/**
 * The schema visualizer's canvas around its layout: it says "laying out"
 * while the worker runs, a large schema says which part of it is drawn and
 * lets the list move it, and the list and totals always cover every table.
 *
 * React Flow is stood in for by a list of the nodes it is handed: what is
 * under test is what this view gives it, not how it paints.
 */

let tables: TableDescriptorsState = readyTables([]);

jest.mock("@rebasepro/app", () => ({
    useTranslation: () => ({
        t: (key: string, params?: Record<string, unknown>) =>
            (en[key as keyof typeof en] ?? key).replace(/\{\{(\w+)\}\}/g, (_: string, name: string) => String(params?.[name] ?? "")),
        i18n: { language: "en" }
    }),
    useTableDescriptors: () => tables,
    useRebaseContext: () => ({}),
    IconForView: () => null
}));

const mockFitView = jest.fn(async () => true);
jest.mock("@xyflow/react", () => {
    const ReactModule = jest.requireActual<typeof React>("react");
    return {
        ReactFlow: ({ nodes, children }: { nodes: { id: string }[]; children?: React.ReactNode }) =>
            ReactModule.createElement("div", null,
                ReactModule.createElement("ul", { "aria-label": "canvas" },
                    nodes.map((node) => ReactModule.createElement("li", { key: node.id }, node.id))),
                children),
        ReactFlowProvider: ({ children }: { children?: React.ReactNode }) => children,
        Controls: () => null,
        MiniMap: () => null,
        Background: () => null,
        BackgroundVariant: { Dots: "dots" },
        MarkerType: { ArrowClosed: "arrowclosed" },
        Handle: () => null,
        Position: { Left: "left", Right: "right" },
        BaseEdge: () => null,
        EdgeLabelRenderer: () => null,
        getSmoothStepPath: () => ["", 0, 0],
        useReactFlow: () => ({ fitView: mockFitView, setCenter: jest.fn() }),
        applyNodeChanges: (_changes: unknown, nodes: unknown) => nodes,
        applyEdgeChanges: (_changes: unknown, edges: unknown) => edges
    };
});

type Listener = (event: { data?: unknown; preventDefault: () => void }) => void;
const mockWorkers: { received: unknown; listeners: Record<string, Listener[]>; run: () => Promise<void> }[] = [];
jest.mock(
    "../src/components/SchemaVisualizer/dagre-layout.worker?worker&inline",
    () => ({
        __esModule: true,
        default: class {
            listeners: Record<string, Listener[]> = {};
            received: unknown;
            constructor() {
                mockWorkers.push(this);
            }
            addEventListener(type: string, listener: Listener) {
                (this.listeners[type] ??= []).push(listener);
            }
            postMessage(data: unknown) {
                this.received = data;
            }
            terminate() {
                return undefined;
            }
            async run() {
                const { runDagre } = await import("../src/components/SchemaVisualizer/dagre-layout");
                const positions = runDagre(this.received as Parameters<typeof runDagre>[0]);
                for (const listener of this.listeners.message ?? []) listener({ data: { positions }, preventDefault: () => undefined });
            }
        }
    }),
    { virtual: true }
);

import { SchemaVisualizer } from "../src/components/SchemaVisualizer/SchemaVisualizer";

/** A chain of tables `c<i>`, each belonging to the one before; `c5` also has `c100` and `c200` pointing at it. */
const chain = (count: number) => readyTables(chainSchema("", count, false));

const drawn = () => screen.getByRole("list", { name: "canvas" }).textContent;

beforeEach(() => {
    mockFitView.mockClear();
    mockWorkers.length = 0;
});

afterEach(() => {
    delete (globalThis as { Worker?: unknown }).Worker;
});

describe("the schema visualizer's canvas", () => {
    it("says it is laying out while the worker runs, then draws the result", async () => {
        Object.assign(globalThis, { Worker: class {} });
        const realCreateObjectURL = URL.createObjectURL;
        URL.createObjectURL = () => "blob:layout";
        try {
            tables = chain(3);
            render(<SchemaVisualizer/>);

            expect(screen.getByRole("status").textContent).toBe("Laying out the diagram…");
            expect(drawn()).toBe("");
            // The list does not wait for the layout.
            expect(screen.getByText("c2")).toBeTruthy();

            await waitFor(() => expect(mockWorkers).toHaveLength(1));
            await act(() => mockWorkers[0].run());

            await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
            expect(drawn()).toBe("table-c0table-c1table-c2");
            expect(mockFitView).toHaveBeenCalledTimes(1);
        } finally {
            URL.createObjectURL = realCreateObjectURL;
        }
    });

    it("draws a large schema one neighbourhood at a time, moved from the list", async () => {
        tables = chain(320);
        render(<SchemaVisualizer/>);

        expect(screen.getByText(/Showing 5 of 320 tables: c5 and the tables around it/)).toBeTruthy();
        expect(drawn()).toBe("table-c4table-c5table-c6table-c100table-c200");
        await waitFor(() => expect(mockFitView).toHaveBeenCalledTimes(1));

        // Every table is still listed, drawn or not.
        fireEvent.click(screen.getByText("c250"));

        await waitFor(() => expect(drawn()).toBe("table-c249table-c250table-c251"));
        expect(screen.getByText(/Showing 3 of 320 tables: c250/)).toBeTruthy();
        await waitFor(() => expect(mockFitView).toHaveBeenCalledTimes(2));

        fireEvent.click(screen.getByRole("button", { name: "2 relations away" }));

        await waitFor(() => expect(drawn()).toBe("table-c248table-c249table-c250table-c251table-c252"));
        await waitFor(() => expect(mockFitView).toHaveBeenCalledTimes(3));
    });

    it("draws a schema of 300 tables whole", () => {
        tables = chain(300);
        render(<SchemaVisualizer/>);

        expect(screen.queryByText(/Showing/)).toBeNull();
        expect(screen.getByRole("list", { name: "canvas" }).children).toHaveLength(300);
    });
});
