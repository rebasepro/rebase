// @vitest-environment jsdom
/**
 * The view as a host opens it, with the admin panel's own components in it:
 * a show_* result handed over, every read and write a `tools/call` caught on
 * the bridge.
 *
 * - A collection block draws the rows its read returned; the page the
 *   result already carries is its first read, when the read is that page.
 * - A record block opens the row's form; a save the server answers with a
 *   plan waits for the person's yes, then goes again with the token, and the
 *   model is told what changed.
 * - An app the model wrote runs on the project's data with the packages'
 *   own parts — `@rebasepro/cms`'s blocks, `@rebasepro/app`'s row hooks, the
 *   UI kit; a change its code makes through `useRowWrites` is asked first,
 *   once, while a save made with the admin's own controls in it is not asked
 *   again; a change
 *   refreshes every view of the collection on the screen once; it is held
 *   to its collections; what it imports wrong, or throws, is shown and told
 *   to the model with the line.
 */
import React, { act } from "react";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MCP_APP_MODULES } from "@rebasepro/types";
import * as UI from "@rebasepro/ui";
import { McpAppBridge, type ToolResult } from "@rebasepro/cms/mcp-view";
import { SHOW_APP_CODE_GUIDE } from "../../server/src/mcp/show-app-guide";
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

// Every root the view mounts, unmounted after each test: one left mounted
// would follow the next test's embed host, and read through its bridge.
const mounted = vi.hoisted(() => ({ roots: [] as { unmount(): void }[] }));
vi.mock("react-dom/client", async importOriginal => {
    const actual = await importOriginal<typeof import("react-dom/client")>();
    return {
        ...actual,
        createRoot: (...args: Parameters<typeof actual.createRoot>) => {
            const root = actual.createRoot(...args);
            mounted.roots.push(root);
            return root;
        }
    };
});

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
    act(() => {
        for (const root of mounted.roots.splice(0)) root.unmount();
    });
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

    /** The data tools over ROWS, as an app's own `/mcp` answers them. */
    function own(name: string, args: Record<string, unknown>): ToolResult {
        if (name === "count_documents") return ok({ count: ROWS.length });
        if (name === "get_document") return ok(ROWS.find(row => row.id === args.id));
        return ok({ data: ROWS.map(row => ({ ...row, number: `${row.number} (read)` })), meta: { total: ROWS.length, hasMore: false } });
    }

    it("draws the page the result carries, with no read of its own, when the panel reads exactly that page", async () => {
        const { calls } = open(screenResult(
            [{ key: "rows", type: "collection", collection: "orders", view: "list", where: { status: ["==", "pending"] }, orderBy: "number:desc" }],
            { data: ROWS, meta: { limit: 50, offset: 0, hasMore: false } }), own);

        await findText("ORD-41");
        await findText("ORD-42");
        expect(calls.filter(call => call.name === "query_collection")).toEqual([]);
    });

    it("reads its page where the result's page was read with other arguments", async () => {
        const { calls } = open(screenResult(
            [{ key: "rows", type: "collection", collection: "orders", view: "list", searchString: "ORD" }],
            { data: ROWS, meta: { limit: 50, offset: 0, hasMore: false } }), own);

        await findText("ORD-41 (read)");
        expect(calls.filter(call => call.name === "query_collection")).toHaveLength(1);
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
        const compiled = compileApp(code, MCP_APP_MODULES);
        if (!compiled.ok) throw new Error(compiled.error);
        return screenResult([{ key: "app", type: "app", code: compiled.code, collections: ["orders"] }], extra, "Order desk");
    }

    /** The data tools over ROWS, as an app's own `/mcp` answers them. */
    function own(name: string, args: Record<string, unknown>): ToolResult {
        if (name === "count_documents") return ok({ count: args.where ? 1 : ROWS.length });
        if (name === "get_document") return ok(ROWS.find(row => row.id === args.id));
        if (name === "update_document") return ok({ ...ROWS[0], ...(args.data as object) });
        if (name === "aggregate_documents") return ok({ data: [{ status: "pending", count: 1 }, { status: "sent", count: 1 }] });
        return ok({ data: ROWS, meta: { total: 2, hasMore: false } });
    }

    const DESK = `
import { Button, KpiGrid, KpiTile, Typography } from "@rebasepro/ui";
import { useRowCount, useRows, useRowWrites } from "@rebasepro/app";

export default function Desk() {
    const pending = useRowCount("orders", { status: ["==", "pending"] });
    const { rows } = useRows("orders", { orderBy: ["number", "asc"] });
    const { update } = useRowWrites();
    return (
        <div>
            <KpiGrid><KpiTile label="Pending" value={pending.count} loading={pending.loading} /></KpiGrid>
            {rows.map(row => (
                <div key={String(row.id)}>
                    <Typography>{String(row.number)}</Typography>
                    <Button onClick={() => update("orders", String(row.id), { status: "sent" }).catch(() => undefined)}>Ship {String(row.number)}</Button>
                </div>
            ))}
        </div>
    );
}`;

    it("runs on the project's data, and asks before the change its button makes, then tells the model", async () => {
        const { calls, context } = open(appResult(DESK), own);

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

    it("sends nothing the person declines, and the write rejects as not saved", async () => {
        const { calls } = open(appResult(`
import { useState } from "react";
import { Button, Typography } from "@rebasepro/ui";
import { useRowWrites } from "@rebasepro/app";

export default function App() {
    const { update } = useRowWrites();
    const [outcome, setOutcome] = useState("waiting");
    return (
        <div>
            <Typography>{outcome}</Typography>
            <Button onClick={() => update("orders", "o1", { status: "sent" }).then(() => setOutcome("saved"), error => setOutcome(error.message))}>Ship</Button>
        </div>
    );
}`), own);

        await findText("waiting");
        await act(async () => buttonNamed("Ship").click());
        const dialog = await vi.waitFor(() => {
            const found = document.querySelector("[role=dialog]");
            if (!found) throw new Error("no confirmation");
            return found;
        }, { timeout: 5000 });
        await act(async () => buttonNamed("Cancel", dialog).click());

        await findText("Not saved: the change was not confirmed.");
        expect(calls.some(call => call.name === "update_document")).toBe(false);
    }, 20000);

    /** The data tools over rows a write changes, as an app's own `/mcp` answers them. */
    function stored() {
        const rows = ROWS.map(row => ({ ...row }));
        return (name: string, args: Record<string, unknown>): ToolResult => {
            if (name === "count_documents") return ok({ count: rows.length });
            if (name === "get_document") return ok(rows.find(row => row.id === args.id));
            if (name === "update_document") {
                const row = rows.find(candidate => candidate.id === args.id);
                if (row) Object.assign(row, args.data);
                return ok(row);
            }
            return ok({ data: rows.map(row => ({ ...row })), meta: { total: rows.length, hasMore: false } });
        };
    }

    /** Waits for the reads a change starts, then a moment more for any that should not come. */
    async function settled(): Promise<void> {
        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 300));
        });
    }

    it("saves the admin form in it with no confirmation of its own, refreshes its rows and its panel once each, and tells the model", async () => {
        const { calls, context } = open(appResult(`
import { Typography } from "@rebasepro/ui";
import { useRows } from "@rebasepro/app";
import { CollectionPanel, EntityFormPanel, useCollectionRegistryController } from "@rebasepro/cms";

export default function Desk() {
    const { rows } = useRows("orders", { limit: 10 });
    const orders = useCollectionRegistryController().getCollection("orders");
    return (
        <div>
            <Typography>{"Rows: " + rows.map(row => String(row.number)).join(", ")}</Typography>
            <CollectionPanel path="orders" viewMode="list" title={false} fields={["number"]} />
            {orders && <EntityFormPanel collection={orders} entityId="o1" />}
        </div>
    );
}`), stored());

        await findText("Rows: ORD-41, ORD-42");
        const input = await vi.waitFor(() => {
            const field = document.querySelector<HTMLInputElement>("input[value='ORD-41']");
            if (!field) throw new Error("the form has not loaded the row");
            return field;
        }, { timeout: 5000 });
        await settled();
        // The hook asks for its 10 rows; the panel for its page. The form
        // reads its row by key, an `in` on it.
        const reads = () => {
            const pages = calls.filter(call => call.name === "query_collection" && !JSON.stringify(call.args.where ?? {}).includes("\"in\""));
            const hook = pages.filter(call => call.args.limit === 10 || call.args.limit === 11).length;
            return { hook, panel: pages.length - hook };
        };
        const before = reads();

        await act(async () => {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
            setter?.call(input, "ORD-41-A");
            input.dispatchEvent(new Event("input", { bubbles: true }));
        });
        await act(async () => {
            input.closest("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        });

        await findText("Rows: ORD-41-A, ORD-42");
        await findText("ORD-41-A");
        await settled();
        expect(calls.filter(call => call.name === "update_document").map(call => call.args))
            .toEqual([{ collection: "orders", id: "o1", data: { number: "ORD-41-A" } }]);
        // The person's click on Save was the yes.
        expect(document.querySelector("[role=dialog]")).toBeNull();
        const after = reads();
        expect({ hook: after.hook - before.hook, panel: after.panel - before.panel }).toEqual({ hook: 1, panel: 1 });
        await vi.waitFor(() => expect(context).toHaveBeenCalledWith(expect.stringContaining("updated number on row o1 of orders")));
    }, 20000);

    it("asks once before the change its code makes, and the panel beside it shows the change", async () => {
        const { calls } = open(appResult(`
import { Button } from "@rebasepro/ui";
import { useRowWrites } from "@rebasepro/app";
import { CollectionPanel } from "@rebasepro/cms";

export default function Desk() {
    const { update } = useRowWrites();
    return (
        <div>
            <Button onClick={() => update("orders", "o1", { number: "ORD-41-B" }).catch(() => undefined)}>Renumber</Button>
            <CollectionPanel path="orders" viewMode="list" title={false} fields={["number"]} />
        </div>
    );
}`), stored());

        await findText("ORD-41");
        await act(async () => buttonNamed("Renumber").click());
        const dialog = await vi.waitFor(() => {
            const found = document.querySelector("[role=dialog]");
            if (!found?.textContent?.includes("Change number on row o1 of orders.")) throw new Error("no confirmation");
            return found;
        }, { timeout: 5000 });
        await act(async () => buttonNamed("Save", dialog).click());

        await findText("ORD-41-B");
        await settled();
        expect(calls.filter(call => call.name === "update_document")).toHaveLength(1);
        // Asked once: nothing else waits for a yes.
        expect(document.querySelector("[role=dialog]")).toBeNull();
    }, 20000);

    it("composes @rebasepro/cms's CollectionPanel with @rebasepro/app's rows", async () => {
        open(appResult(`
import { Typography } from "@rebasepro/ui";
import { useRows } from "@rebasepro/app";
import { CollectionPanel, FieldValue } from "@rebasepro/cms";

export default function Board() {
    const { rows, total } = useRows("orders");
    return (
        <div className="flex flex-col gap-2">
            <Typography>{total ?? 0} orders</Typography>
            {rows[0] && <FieldValue row={rows[0]} collection="orders" field="status" />}
            <CollectionPanel path="orders" viewMode="list" title={false} fields={["number"]} />
        </div>
    );
}`), own);

        await findText("2 orders");
        await findText("ORD-42");
        await findText("Pending");
    }, 20000);

    it("hands the app the row a click picks, with no read of its own", async () => {
        const { calls } = open(appResult(`
import { useState } from "react";
import { Typography } from "@rebasepro/ui";
import { CollectionPanel } from "@rebasepro/cms";

export default function Picker() {
    const [picked, setPicked] = useState("nothing");
    return (
        <div>
            <Typography>Picked {picked}</Typography>
            <CollectionPanel path="orders" viewMode="list" onRowClick={row => setPicked(String(row.number))} />
        </div>
    );
}`), own);

        const row = await findText("ORD-42");
        await act(async () => row.click());

        await findText("Picked ORD-42");
        expect(calls.some(call => call.name === "get_document")).toBe(false);
        // Nothing opened over the app: the click was the app's.
        expect(document.querySelector("[role=dialog]")).toBeNull();
    }, 20000);

    it("aggregates with the aggregate tool", async () => {
        const { calls } = open(appResult(`
import { BarChart } from "@rebasepro/ui";
import { useAggregate } from "@rebasepro/app";

export default function ByStatus() {
    const { result } = useAggregate("orders", { select: [{ fn: "count" }], groupBy: ["status"] });
    return <BarChart bars={(result ?? []).map(group => ({ key: String(group.status), label: "status " + String(group.status), value: Number(group.count) }))} />;
}`), own);

        await findText("status pending");
        expect(calls.find(call => call.name === "aggregate_documents")?.args)
            .toEqual({ collection: "orders", select: ["count()"], groupBy: ["status"] });
    }, 20000);

    it("holds the app to the collections it was opened with", async () => {
        const { context, calls } = open(appResult(`
import { useRows } from "@rebasepro/app";
export default function App() {
    const { rows } = useRows("customers");
    return <p>{rows.length}</p>;
}`), own);

        await vi.waitFor(() => {
            if (!document.body.textContent?.includes("\"customers\" is not one of this app's collections (orders). List it in show_app's `collections`.")) {
                throw new Error(`not refused: ${document.body.textContent?.slice(0, 300)}`);
            }
        }, { timeout: 5000 });
        expect(calls.some(call => call.args.collection === "customers")).toBe(false);
        expect(context).toHaveBeenCalledWith(expect.stringContaining("is not one of this app's collections"));
    }, 20000);

    it("names an export the kit does not have, and tells the model", async () => {
        const { context } = open(appResult(`
import { Sparkline } from "@rebasepro/ui";
export default function App() { return <Sparkline />; }`), () => ok({}));

        await findText("The app failed at line 3: \"Sparkline\" is not exported by \"@rebasepro/ui\".");
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

/**
 * show_app's guide against what the view serves: its kit names are the kit's,
 * every component it draws is served, and its example opens. (The server's
 * suite holds its imports and hooks to `MCP_APP_MODULES`.)
 */
describe("show_app's guide", () => {
    const UI_NAMES = new Set(Object.keys(UI));
    const CMS_NAMES = new Set<string>(MCP_APP_MODULES["@rebasepro/cms"]);

    it("names only parts of the kit the kit has", () => {
        const listed = /- "@rebasepro\/ui", the UI kit: ([^\n]*?), Lucide icons/.exec(SHOW_APP_CODE_GUIDE)?.[1].split(", ") ?? [];
        expect(listed.length).toBeGreaterThan(10);
        expect(listed.filter(name => !UI_NAMES.has(name))).toEqual([]);
        expect(UI_NAMES.has("PlusIcon") && UI_NAMES.has("formatNumber")).toBe(true);
    });

    it("draws only components the view serves", () => {
        const drawn = [...new Set([...SHOW_APP_CODE_GUIDE.matchAll(/<([A-Z]\w*)/g)].map(match => match[1]))];
        expect(drawn.filter(name => !UI_NAMES.has(name) && !CMS_NAMES.has(name))).toEqual([]);
    });

    it("opens its example", async () => {
        const example = SHOW_APP_CODE_GUIDE.slice(SHOW_APP_CODE_GUIDE.indexOf("Example:") + "Example:".length);
        const compiled = compileApp(example, MCP_APP_MODULES);
        if (!compiled.ok) throw new Error(compiled.error);
        open(screenResult([{ key: "app", type: "app", code: compiled.code, collections: ["orders"] }]), name => name === "count_documents"
            ? ok({ count: 1 })
            : ok({ data: ROWS, meta: { total: ROWS.length, hasMore: false } }));

        await findText("Pending");
        await findText("ORD-42");
    }, 20000);
});
