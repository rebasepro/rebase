/**
 * @jest-environment jsdom
 */
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { renderHook } from "@testing-library/react";
import { chainSchema } from "./helpers/schemaFixtures";

/**
 * A schema too large to draw whole.
 *
 * Even off the main thread, dagre needs 90 s for 500 cross-linked tables, and
 * a canvas of 500 tables is not something anyone reads. Above
 * `LARGE_SCHEMA_TABLES` the visualizer draws one table and the tables within
 * one or two relations of it — and lays out only those.
 */

/** How many tables each dagre run was given. */
const mockLaidOut: number[] = [];
jest.mock("dagre", () => {
    const actual = jest.requireActual<{ default?: Record<string, unknown> } & Record<string, unknown>>("dagre");
    const dagre = (actual.default ?? actual) as Record<string, unknown> & { layout: (graph: { nodeCount: () => number }) => void };
    return {
        __esModule: true,
        default: {
            ...dagre,
            layout: (graph: { nodeCount: () => number }) => {
                mockLaidOut.push(graph.nodeCount());
                dagre.layout(graph);
            }
        }
    };
});

import { LARGE_SCHEMA_TABLES, useSchemaGraph } from "../src/components/SchemaVisualizer/useSchemaGraph";

/** See `chainSchema`: `<prefix>_c<i>`, `c5` the most connected. */
const chain = (prefix: string, count: number) => chainSchema(`${prefix}_`, count);

const ids = (nodes: { id: string }[]) => nodes.map(node => node.id).sort();

beforeEach(() => {
    mockLaidOut.length = 0;
});

describe(`a schema of more than ${LARGE_SCHEMA_TABLES} tables`, () => {
    it("draws the most connected table and the tables one relation from it, and lays out only those", () => {
        const { result } = renderHook(() => useSchemaGraph(chain("big", 320), null));

        expect(result.current.neighbourhood).toEqual({ focus: "table-big_c5", depth: 1, shown: 7, total: 320 });
        // A many-to-many is one relation, drawn through its junction.
        expect(ids(result.current.nodes)).toEqual(ids([
            { id: "table-big_c5" }, { id: "table-big_c4" }, { id: "table-big_c6" },
            { id: "table-big_c100" }, { id: "table-big_c200" },
            { id: "junction-big_peers" }, { id: "table-big_c300" }
        ]));
        // Every relation between the drawn tables, and none to a table not drawn.
        expect(result.current.edges).toHaveLength(6);
        expect(mockLaidOut).toEqual([7]);
        // The list and the totals are the whole schema.
        expect(result.current.allNodes).toHaveLength(321);
        expect(result.current.tableCount).toBe(321);
    });

    it("reaches two relations out when asked", () => {
        const { result } = renderHook(() => useSchemaGraph(chain("deep", 320), null, null, 2));

        expect(result.current.neighbourhood).toMatchObject({ focus: "table-deep_c5", depth: 2, shown: 15 });
        expect(ids(result.current.nodes)).toEqual(expect.arrayContaining([
            "table-deep_c3", "table-deep_c7", "table-deep_c99", "table-deep_c101",
            "table-deep_c199", "table-deep_c201", "table-deep_c299", "table-deep_c301"
        ]));
        expect(mockLaidOut).toEqual([15]);
    });

    it("draws the table it is pointed at", () => {
        const collections = chain("moved", 320);
        const { result, rerender } = renderHook(({ focus }) => useSchemaGraph(collections, null, focus), {
            initialProps: { focus: null as string | null }
        });

        rerender({ focus: "table-moved_c250" });

        expect(result.current.neighbourhood).toMatchObject({ focus: "table-moved_c250", shown: 3 });
        expect(ids(result.current.nodes)).toEqual(["table-moved_c249", "table-moved_c250", "table-moved_c251"]);
        expect(mockLaidOut).toEqual([7, 3]);
    });

    it("falls back to the most connected table for a focus that is not in the schema", () => {
        const { result } = renderHook(() => useSchemaGraph(chain("gone", 320), null, "table-not_here"));
        expect(result.current.neighbourhood?.focus).toBe("table-gone_c5");
    });
});

describe(`a schema of ${LARGE_SCHEMA_TABLES} tables`, () => {
    it("is drawn whole", () => {
        const { result } = renderHook(() => useSchemaGraph(chain("whole", LARGE_SCHEMA_TABLES), null, "table-whole_c5"));

        expect(result.current.neighbourhood).toBeNull();
        expect(result.current.nodes).toHaveLength(LARGE_SCHEMA_TABLES);
        expect(mockLaidOut).toEqual([LARGE_SCHEMA_TABLES]);
    });
});
