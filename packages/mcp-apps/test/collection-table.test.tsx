// @vitest-environment jsdom
/**
 * The table view against a bridge whose host is a stub: the tool input and
 * result are set on the bridge as a host would have sent them, and every
 * `tools/call` the view makes is caught on `callTool`.
 *
 * - Opening a cell and leaving it unchanged saves nothing — an empty cell
 *   stays null, not "".
 * - Load more asks for the page after the one shown, counted from the
 *   offset the model asked for.
 * - A save the server refuses is shown, and the cell keeps its value.
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { McpAppBridge, type ToolResult } from "../views/bridge";
import { CollectionTable } from "../views/collection-table/CollectionTable";

declare global {
    // React's flag for a test environment that wraps updates in `act`.
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const COLUMNS = [
    { key: "id", title: "ID", type: "string", editable: false },
    { key: "name", title: "Name", type: "string", editable: true }
];

function tableResult(rows: Record<string, unknown>[], meta: Record<string, unknown> = {}): ToolResult {
    return {
        structuredContent: {
            collection: "candidates",
            title: "Candidates",
            idKey: "id",
            columns: COLUMNS,
            writable: true,
            data: rows,
            meta
        }
    };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    // jsdom has no layout, so no ResizeObserver; the view only measures with it.
    vi.stubGlobal("ResizeObserver", class {
        observe(): void {}
        disconnect(): void {}
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

/** A bridge with the host's tool input and result already in, as the host sends them before the view's effects run. */
function bridgeWith(input: Record<string, unknown> | undefined, result: ToolResult) {
    const bridge = new McpAppBridge({ postMessage: () => undefined }, new EventTarget());
    bridge.toolInput = input;
    bridge.toolResult = result;
    const callTool = vi.spyOn(bridge, "callTool");
    vi.spyOn(bridge, "updateModelContext").mockResolvedValue(undefined);
    return { bridge, callTool };
}

async function render(bridge: McpAppBridge): Promise<void> {
    await act(async () => root.render(<CollectionTable bridge={bridge}/>));
}

/** The cell of `row` (0-based, body rows only) in the column at `column`. */
function cell(row: number, column: number): HTMLElement {
    const rows = container.querySelectorAll("tbody tr");
    const target = rows[row]?.children[column];
    if (!(target instanceof HTMLElement)) throw new Error(`no cell at ${row}, ${column}`);
    return target;
}

async function openEditor(row: number, column: number): Promise<HTMLInputElement> {
    const display = cell(row, column).querySelector("div");
    if (!display) throw new Error("the cell has no display to click");
    await act(async () => display.click());
    const input = cell(row, column).querySelector("input");
    if (!input) throw new Error("clicking the cell opened no editor");
    return input;
}

/** Types as a person does: React reads the value through its own setter tracking. */
function type(input: HTMLInputElement, value: string): void {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
}

function button(label: string): HTMLButtonElement {
    const found = Array.from(container.querySelectorAll("button")).find(candidate => candidate.textContent === label);
    if (!found) throw new Error(`no "${label}" button`);
    return found;
}

describe("editing a cell", () => {
    it("saves nothing when an empty cell is opened and left unchanged", async () => {
        const { bridge, callTool } = bridgeWith({ collection: "candidates" }, tableResult([{ id: "1", name: null }]));
        await render(bridge);

        const input = await openEditor(0, 1);
        expect(input.value).toBe("");
        await act(async () => {
            input.focus();
            input.blur();
        });

        expect(callTool).not.toHaveBeenCalled();
        expect(cell(0, 1).querySelector("input")).toBeNull();
    });

    it("shows a save the server refuses, and keeps the cell's value", async () => {
        const { bridge, callTool } = bridgeWith({ collection: "candidates" }, tableResult([{ id: "1", name: "Ada" }]));
        callTool.mockResolvedValue({ isError: true, content: [{ type: "text", text: "Permission denied by a row policy." }] });
        await render(bridge);

        const input = await openEditor(0, 1);
        await act(async () => {
            type(input, "Grace");
            input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        });

        expect(callTool).toHaveBeenCalledWith("update_document", { collection: "candidates", id: "1", data: { name: "Grace" } });
        expect(container.querySelector("[role='alert']")?.textContent).toContain("Permission denied by a row policy.");
        expect(cell(0, 1).textContent).toBe("Ada");
        expect(bridge.updateModelContext).not.toHaveBeenCalled();
    });
});

describe("load more", () => {
    const rows = [{ id: "21", name: "a" }, { id: "22", name: "b" }];

    it("asks for the page after the one shown, from the offset the model asked for", async () => {
        const { bridge, callTool } = bridgeWith(
            { collection: "candidates", offset: 20, limit: 2, where: { name: ["!=", null] } },
            tableResult(rows, { hasMore: true })
        );
        callTool.mockResolvedValue({ structuredContent: { data: [{ id: "23", name: "c" }], meta: { hasMore: false } } });
        await render(bridge);

        await act(async () => button("Load more").click());

        expect(callTool).toHaveBeenCalledWith("query_collection", {
            collection: "candidates", offset: 22, limit: 2, where: { name: ["!=", null] }
        });
        expect(container.querySelectorAll("tbody tr")).toHaveLength(3);
    });

    it("names the page's collection when the host sent no tool input", async () => {
        const { bridge, callTool } = bridgeWith(undefined, tableResult(rows, { hasMore: true }));
        callTool.mockResolvedValue({ structuredContent: { data: [], meta: { hasMore: false } } });
        await render(bridge);

        await act(async () => button("Load more").click());

        expect(callTool).toHaveBeenCalledWith("query_collection", { collection: "candidates", offset: 2 });
    });
});
