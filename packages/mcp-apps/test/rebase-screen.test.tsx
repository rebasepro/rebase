// @vitest-environment jsdom
/**
 * The view as a host opens it, with the admin panel's own components in it:
 * a show_* result handed over, every read and write a `tools/call` caught on
 * the bridge.
 *
 * - A collection block draws the rows its read returned.
 * - A record block opens the row's form; a save the server answers with a
 *   plan waits for the person's yes, then goes again with the token, and the
 *   model is told what changed.
 * - An app the model wrote runs on the project's data with the SDK; its own
 *   changes are confirmed first; what it imports wrong, or throws, is shown
 *   and told to the model with the line.
 */
import React, { act } from "react";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { McpAppBridge, type ToolResult } from "@rebasepro/cms/mcp-view";
import { startGenericView } from "../views/app/main";
import { compileApp } from "../src/compile";

declare global {
    // React's flag for a test environment that wraps updates in `act`.
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const ORDERS = {
    slug: "orders",
    name: "Orders",
    singularName: "Order",
    table: "orders",
    properties: {
        id: { type: "string", name: "ID", isId: true },
        number: { type: "string", name: "Number" },
        status: { type: "string", name: "Status", enum: [{ id: "pending", label: "Pending" }, { id: "sent", label: "Sent" }] }
    }
};

const ROWS = [
    { id: "o1", number: "ORD-41", status: "pending" },
    { id: "o2", number: "ORD-42", status: "sent" }
];

function ok(structuredContent: unknown): ToolResult {
    return { structuredContent, content: [{ type: "text", text: JSON.stringify(structuredContent) }] };
}

function screenResult(blocks: unknown[], extra: Record<string, unknown> = {}, title?: string): ToolResult {
    return ok({ view: { version: 1, title, blocks, collections: [ORDERS], viewer: { uid: "u1", roles: ["admin"] } }, ...extra });
}

const HOSTED_ACTIONS = {
    page: { tool: "query", arguments: { project: "shop" } },
    get: { tool: "query", arguments: { project: "shop" } },
    count: { tool: "query", arguments: { project: "shop", count: true } },
    update: { tool: "write", arguments: { project: "shop", action: "update" } }
};

let container: HTMLDivElement;
beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("ResizeObserver", class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
    });
    // The generic view mounts its app into #root, as a page would have it.
    container = document.createElement("div");
    container.id = "root";
    document.body.appendChild(container);
});

afterEach(() => {
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

/** A bridge with the result already in, answering each `tools/call` from `answer`. */
function open(result: ToolResult, answer: (name: string, args: Record<string, unknown>) => ToolResult) {
    const bridge = new McpAppBridge({ postMessage: () => undefined }, new EventTarget());
    bridge.toolResult = result;
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    vi.spyOn(bridge, "callTool").mockImplementation(async (name, args) => {
        calls.push({ name, args });
        return answer(name, args);
    });
    const context = vi.spyOn(bridge, "updateModelContext").mockResolvedValue(undefined);
    act(() => {
        startGenericView(bridge);
    });
    return { calls, context };
}

/** The data tools over ROWS, as the hosted connector answers them: a write plans first. */
function hosted(name: string, args: Record<string, unknown>): ToolResult {
    if (name === "query" && args.count) return ok({ count: ROWS.length });
    if (name === "query" && args.id) return ok(ROWS.find(row => row.id === args.id));
    if (name === "query") return ok({ data: ROWS, meta: { total: ROWS.length, hasMore: false } });
    if (name === "write" && !args.confirm) {
        return ok({ status: "confirmation_required", confirm: "token-1", plan: { summary: "Change number on row o1 of orders in shop." } });
    }
    return ok({ ...ROWS[0], ...(args.data as object) });
}

async function findText(text: string): Promise<HTMLElement> {
    let found: HTMLElement | undefined;
    await vi.waitFor(() => {
        found = Array.from(document.querySelectorAll<HTMLElement>("body *"))
            .find(element => element.children.length === 0 && element.textContent === text);
        if (!found) throw new Error(`"${text}" is not on the screen: ${document.body.textContent?.slice(0, 400)}`);
    }, { timeout: 5000 });
    return found!;
}

function buttonNamed(label: string, within: ParentNode = document): HTMLButtonElement {
    const found = Array.from(within.querySelectorAll("button")).find(candidate => candidate.textContent?.trim() === label);
    if (!(found instanceof HTMLButtonElement)) throw new Error(`no "${label}" button`);
    return found;
}

describe("a collection block", () => {
    it("draws the rows its read returned, read through the tools the result names", async () => {
        const { calls } = open(screenResult([{ key: "rows", type: "collection", collection: "orders", view: "list" }],
            { actions: HOSTED_ACTIONS }), hosted);

        await findText("ORD-41");
        await findText("ORD-42");
        expect(calls.some(call => call.name === "query" && call.args.project === "shop" && call.args.collection === "orders")).toBe(true);
    });
});

describe("a record block", () => {
    it("saves an edit once the person confirms the server's plan, and tells the model", async () => {
        const { calls, context } = open(screenResult([{ key: "record", type: "record", collection: "orders", id: "o1" }],
            { actions: HOSTED_ACTIONS }), hosted);

        const input = await vi.waitFor(() => {
            const field = document.querySelector<HTMLInputElement>("input[value='ORD-41']");
            if (!field) throw new Error("the form has not loaded the row");
            return field;
        }, { timeout: 5000 });
        await act(async () => {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
            setter?.call(input, "ORD-41-A");
            input.dispatchEvent(new Event("input", { bubbles: true }));
        });
        await act(async () => {
            const form = input.closest("form");
            form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        });

        const dialog = await vi.waitFor(() => {
            const found = document.querySelector("[role=dialog]");
            if (!found?.textContent?.includes("Change number on row o1")) throw new Error("no plan shown");
            return found;
        }, { timeout: 5000 });
        expect(calls.filter(call => call.name === "write")).toHaveLength(1);

        await act(async () => buttonNamed("Save", dialog).click());

        await vi.waitFor(() => expect(calls.filter(call => call.name === "write").map(call => call.args)).toEqual([
            { project: "shop", action: "update", collection: "orders", id: "o1", data: { number: "ORD-41-A" } },
            { project: "shop", action: "update", collection: "orders", id: "o1", data: { number: "ORD-41-A" }, confirm: "token-1" }
        ]), { timeout: 5000 });
        await vi.waitFor(() => expect(context).toHaveBeenCalledWith(expect.stringContaining("updated number on row o1 of orders")));
    }, 20000);
});

describe("an app the model wrote", () => {
    function appResult(code: string, extra: Record<string, unknown> = {}): ToolResult {
        const compiled = compileApp(code);
        if (!compiled.ok) throw new Error(compiled.error);
        return screenResult([{ key: "app", type: "app", code: compiled.code, collections: ["orders"] }], extra, "Order desk");
    }

    const DESK = `
import { useState } from "react";
import { Button, Typography } from "@rebasepro/ui";
import { KpiGrid, KpiTile } from "@rebasepro/plugin-insights";
import { useCount, useMutate, useQuery } from "@rebasepro/mcp-apps";

export default function Desk() {
    const pending = useCount("orders", { status: ["==", "pending"] });
    const { data } = useQuery("orders", { orderBy: "number" });
    const { update } = useMutate();
    return (
        <div>
            <KpiGrid><KpiTile label="Pending" value={pending.count ?? 0} /></KpiGrid>
            {data.map(row => (
                <div key={String(row.id)}>
                    <Typography>{String(row.number)}</Typography>
                    <Button onClick={() => update("orders", String(row.id), { status: "sent" }).catch(() => undefined)}>Ship {String(row.number)}</Button>
                </div>
            ))}
        </div>
    );
}`;

    it("runs on the project's data, and asks before the change its button makes", async () => {
        const { calls, context } = open(appResult(DESK), (name, args) => {
            if (name === "count_documents") return ok({ count: 1 });
            if (name === "update_document") return ok({ ...ROWS[0], ...(args.data as object) });
            return ok({ data: ROWS, meta: { total: 2, hasMore: false } });
        });

        await findText("Order desk");
        await findText("ORD-41");
        await act(async () => buttonNamed("Ship ORD-41").click());

        // The app's own change: confirmed in the view before it is sent.
        const dialog = await vi.waitFor(() => {
            const found = document.querySelector("[role=dialog]");
            if (!found?.textContent?.includes("Change status on row o1 of orders.")) throw new Error("no confirmation");
            return found;
        }, { timeout: 5000 });
        expect(calls.some(call => call.name === "update_document")).toBe(false);
        await act(async () => buttonNamed("Save", dialog).click());

        await vi.waitFor(() => expect(calls.find(call => call.name === "update_document")?.args)
            .toEqual({ collection: "orders", id: "o1", data: { status: "sent" } }), { timeout: 5000 });
        await vi.waitFor(() => expect(context).toHaveBeenCalledWith(expect.stringContaining("updated status on row o1 of orders")));
    }, 20000);

    it("names an import the view does not have, and tells the model", async () => {
        const { context } = open(appResult(`
import { Sparkline } from "@rebasepro/plugin-insights";
export default function App() { return <Sparkline />; }`), () => ok({}));

        await findText("The app failed at line 3: \"Sparkline\" is not exported by \"@rebasepro/plugin-insights\".");
        expect(context).toHaveBeenCalledWith(expect.stringContaining("Fix the code and call show_app again."));
    }, 20000);

    it("shows what the app threw while drawing, with the line it wrote", async () => {
        const { context } = open(appResult(`export default function App() {
    const rows: { name: string }[] = [];
    return <p>{rows[0].name}</p>;
}`), () => ok({}));

        const shown = await vi.waitFor(() => {
            const alert = Array.from(document.querySelectorAll("[role=alert], div")).find(element => element.textContent?.startsWith("The app failed at line 3"));
            if (!alert) throw new Error(`no failure shown: ${document.body.textContent?.slice(0, 200)}`);
            return alert;
        }, { timeout: 5000 });
        expect(shown.textContent).toContain("Cannot read properties of undefined");
        expect(context).toHaveBeenCalledWith(expect.stringContaining("(line 3 of its code)"));
    }, 20000);
});

describe("a result it cannot draw", () => {
    it("says what is wrong with a result it cannot draw", async () => {
        open(ok({ view: { version: 9 } }), () => ok({}));
        await findText("This view is older than the server that answered; it cannot draw this screen.");
    });
});
