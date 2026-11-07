/**
 * The admin panel's data driver over the server's tools, against a stub of
 * the host's `tools/call`.
 *
 * - A read is the read tool's call: the filter and sort in its dialect, a
 *   belongsTo by its foreign key, a relation value by its id.
 * - One row read many times (a table's relation previews) is one call, until
 *   a write to its collection.
 * - A write the server answers with a plan runs only once the person
 *   confirms, with the plan's token; declined, nothing more is sent.
 * - A write reads the lists of its collection again, and the model is told
 *   what changed.
 * - The hosted connector's tools and arguments, where a result names them.
 * - An app's own change is confirmed in the view first, unless the tool
 *   plans it itself; declined, nothing is sent.
 */
import { describe, expect, it, vi } from "vitest";
import { EntityRelation, type CollectionConfig, type ListenCollectionProps } from "@rebasepro/types";
import type { ToolResult } from "@rebasepro/cms/mcp-view";
import {
    DEFAULT_ACTIONS,
    SaveCancelledError,
    actionsOf,
    createToolDriver,
    describeChanges,
    filterOf,
    parseResult,
    type CallTool,
    type ViewChange,
    type WritePlan
} from "@rebasepro/cms/mcp-view";

const customers: CollectionConfig = {
    slug: "customers",
    name: "Customers",
    table: "customers",
    properties: { id: { type: "string", isId: true }, name: { type: "string" } }
};

const orders: CollectionConfig = {
    slug: "orders",
    name: "Orders",
    table: "orders",
    properties: {
        id: { type: "string", isId: true },
        status: { type: "string" },
        customer: { type: "relation", relation: { kind: "belongsTo", target: () => customers } }
    }
};

function ok(structuredContent: unknown): ToolResult {
    return { structuredContent, content: [{ type: "text", text: JSON.stringify(structuredContent) }] };
}

const PLAN = ok({ status: "confirmation_required", confirm: "token-1", plan: { summary: "Change status on row o1 of orders in shop." } });

function driverWith(answer: (name: string, args: Record<string, unknown>) => ToolResult, options: {
    confirm?: (plan: WritePlan) => Promise<boolean>;
    actions?: typeof DEFAULT_ACTIONS;
} = {}) {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const callTool: CallTool = async (name, args) => {
        calls.push({ name, args });
        return answer(name, args);
    };
    const changes: ViewChange[][] = [];
    const { driver, data } = createToolDriver({
        callTool,
        actions: options.actions ?? DEFAULT_ACTIONS,
        confirm: options.confirm ?? (async () => true),
        onChange: list => changes.push([...list])
    });
    return { driver, data, calls, changes };
}

describe("reading", () => {
    it("reads a page through the read tool, in its dialect", async () => {
        const { driver, calls } = driverWith(() => ok({ data: [{ id: "o1", customerId: "c1" }], meta: {} }));

        const rows = await driver.fetchCollection({
            path: "orders",
            collection: orders,
            filter: { customer: ["==", new EntityRelation("c1", "customers")], status: ["in", ["paid", "sent"]] },
            orderBy: [["customer", "desc"]],
            searchString: "ada",
            limit: 5000,
            offset: 20
        });

        expect(rows).toEqual([{ id: "o1", customerId: "c1" }]);
        expect(calls).toEqual([{
            name: "query_collection",
            args: {
                collection: "orders",
                where: { customerId: ["==", "c1"], status: ["in", ["paid", "sent"]] },
                orderBy: [["customerId", "desc"]],
                searchString: "ada",
                // The read tools refuse a limit past their ceiling.
                limit: 1000,
                offset: 20
            }
        }]);
    });

    it("reads a row once however often it is drawn, until its collection is written", async () => {
        const { driver, calls } = driverWith((name, args) => name === "get_document"
            ? ok({ id: args.id, name: "Ada" })
            : ok({ id: "c1", name: "Ada L." }));

        await Promise.all([1, 2, 3].map(() => driver.fetchOne({ path: "customers", id: "c1" })));
        expect(calls.filter(call => call.name === "get_document")).toHaveLength(1);

        await driver.save({ path: "customers", id: "c1", values: { name: "Ada L." }, status: "existing" });
        await driver.fetchOne({ path: "customers", id: "c1" });
        expect(calls.filter(call => call.name === "get_document")).toHaveLength(2);
    });

    it("answers no row for one the server says is not there", async () => {
        const { driver } = driverWith(() => ({ content: [{ type: "text", text: "No row with id \"x\" in orders." }], isError: true }));
        await expect(driver.fetchOne({ path: "orders", id: "x" })).resolves.toBeUndefined();
    });

    it("says what the server refused", async () => {
        const { driver } = driverWith(() => ({ content: [{ type: "text", text: "Unknown field \"nope\"." }], isError: true }));
        await expect(driver.fetchCollection({ path: "orders" })).rejects.toThrow("Unknown field \"nope\".");
    });

    it("opens no subcollection, which no tool reads", async () => {
        const { driver, calls } = driverWith(() => ok({ data: [] }));
        await expect(driver.fetchCollection({ path: "orders/o1/items" })).rejects.toThrow(/subcollection/);
        expect(calls).toEqual([]);
    });
});

describe("writing", () => {
    it("sends a relation as its id and a date as ISO text, and nothing undefined", async () => {
        const { driver, calls } = driverWith((_name, args) => ok({ id: "o9", ...(args.data as object) }));

        await driver.save({
            path: "orders",
            collection: orders,
            values: { customer: new EntityRelation("c2", "customers"), placed: new Date("2026-11-07T10:00:00.000Z"), note: undefined },
            status: "new"
        });

        expect(calls[0]).toEqual({
            name: "create_document",
            args: { collection: "orders", data: { customer: "c2", placed: "2026-11-07T10:00:00.000Z" } }
        });
    });

    it("runs a planned write only once the person confirms it, with the plan's token", async () => {
        const shown: WritePlan[] = [];
        const { driver, calls } = driverWith((_name, args) => args.confirm ? ok({ id: "o1", status: "sent" }) : PLAN, {
            confirm: async plan => {
                shown.push(plan);
                return true;
            }
        });

        await driver.save({ path: "orders", id: "o1", values: { status: "sent" }, status: "existing" });

        expect(shown).toEqual([{ summary: "Change status on row o1 of orders in shop." }]);
        expect(calls.map(call => call.args)).toEqual([
            { collection: "orders", id: "o1", data: { status: "sent" } },
            { collection: "orders", id: "o1", data: { status: "sent" }, confirm: "token-1" }
        ]);
    });

    it("sends nothing more when the person declines the plan", async () => {
        const { driver, calls, changes } = driverWith(() => PLAN, { confirm: async () => false });

        await expect(driver.delete({ row: { id: "o1", path: "orders" } })).rejects.toBeInstanceOf(SaveCancelledError);
        expect(calls).toHaveLength(1);
        expect(changes).toEqual([]);
    });

    it("reads its collection's lists again after a write, and says what changed", async () => {
        let status = "pending";
        const { driver, changes } = driverWith((name, args) => {
            if (name === "update_document") {
                status = String((args.data as Record<string, unknown>).status);
                return ok({ id: "o1", status });
            }
            return ok({ data: [{ id: "o1", status }] });
        });
        const seen: unknown[] = [];
        const props: ListenCollectionProps = { path: "orders", onUpdate: rows => seen.push(rows) };
        const stop = driver.listenCollection!(props);
        await vi.waitFor(() => expect(seen).toHaveLength(1));

        await driver.save({ path: "orders", id: "o1", values: { status: "sent" }, status: "existing" });

        await vi.waitFor(() => expect(seen).toEqual([[{ id: "o1", status: "pending" }], [{ id: "o1", status: "sent" }]]));
        stop();
        expect(changes.at(-1)).toEqual([{ action: "updated", collection: "orders", id: "o1", fields: ["status"] }]);
        expect(describeChanges(changes.at(-1) ?? [])).toBe("In the Rebase view, the user saved these changes: "
            + "updated status on row o1 of orders. Rows you read before them may be out of date.");
    });
});

describe("an app's data", () => {
    it("reads pages, rows and counts with the read tools, in their shape", async () => {
        const { data, calls } = driverWith((name, args) => name === "count_documents"
            ? ok({ count: 2 })
            : name === "get_document" ? ok({ id: args.id }) : ok({ data: [{ id: "o1" }], meta: { total: 9, hasMore: true } }));

        expect(await data.find("orders", { where: { status: ["==", "paid"] }, limit: 5 }))
            .toEqual({ data: [{ id: "o1" }], total: 9, hasMore: true });
        expect(await data.get("orders", "o1")).toEqual({ id: "o1" });
        expect(await data.count("orders", { status: ["==", "paid"] })).toBe(2);
        expect(calls.map(call => call.name)).toEqual(["query_collection", "get_document", "count_documents"]);
    });

    it("asks the person before a change the tool does not plan, and sends nothing when they decline", async () => {
        const asked: WritePlan[] = [];
        let answer = false;
        const { data, calls } = driverWith(() => ok({ id: "o1", status: "sent" }), {
            confirm: async plan => {
                asked.push(plan);
                return answer;
            }
        });

        await expect(data.update("orders", "o1", { status: "sent" })).rejects.toBeInstanceOf(SaveCancelledError);
        expect(calls).toEqual([]);

        answer = true;
        await data.remove("orders", "o2");
        expect(asked.map(plan => plan.summary)).toEqual(["Change status on row o1 of orders.", "Delete row o2 of orders."]);
        expect(calls).toEqual([{ name: "delete_document", args: { collection: "orders", id: "o2" } }]);
    });

    it("leaves the asking to a tool that plans, once", async () => {
        const asked: WritePlan[] = [];
        const actions = actionsOf({ update: { tool: "write", arguments: { project: "shop", action: "update" }, plans: true } });
        const { data, calls } = driverWith((_name, args) => args.confirm ? ok({ id: "o1" }) : PLAN, {
            actions,
            confirm: async plan => {
                asked.push(plan);
                return true;
            }
        });

        await data.update("orders", "o1", { status: "sent" });
        expect(asked.map(plan => plan.summary)).toEqual(["Change status on row o1 of orders in shop."]);
        expect(calls).toHaveLength(2);
    });

    it("refreshes the admin panel's lists of a collection the app changed, by whatever name it used", async () => {
        const { driver: base, calls } = driverWith(() => ok({ data: [], meta: {} }));
        void base;
        const tools = createToolDriver({
            callTool: async (name, args) => {
                calls.push({ name, args });
                return name === "update_document" ? ok({ id: "o1" }) : ok({ data: [], meta: {} });
            },
            actions: DEFAULT_ACTIONS,
            confirm: async () => true,
            canonical: name => name === "public.orders" ? "orders" : name
        });
        const seen: unknown[] = [];
        tools.driver.listenCollection!({ path: "orders", onUpdate: rows => seen.push(rows) });
        await vi.waitFor(() => expect(seen).toHaveLength(1));

        await tools.data.update("public.orders", "o1", { status: "sent" });
        await vi.waitFor(() => expect(seen).toHaveLength(2));
    });
});

describe("the tools a result names", () => {
    it("reads and writes with the hosted connector's tools, and their arguments", async () => {
        const actions = actionsOf({
            page: { tool: "query", arguments: { project: "shop" } },
            get: { tool: "query", arguments: { project: "shop" } },
            count: { tool: "query", arguments: { project: "shop", count: true } },
            update: { tool: "write", arguments: { project: "shop", action: "update" } }
        });
        const { driver, calls } = driverWith(name => name === "query" ? ok({ count: 3 }) : ok({ id: "o1" }), { actions });

        await driver.count!({ path: "orders", filter: { status: ["==", "paid"] } });
        await driver.save({ path: "orders", id: "o1", values: { status: "paid" }, status: "existing" });

        expect(calls).toEqual([
            { name: "query", args: { project: "shop", count: true, collection: "orders", where: { status: ["==", "paid"] } } },
            { name: "write", args: { project: "shop", action: "update", collection: "orders", id: "o1", data: { status: "paid" } } }
        ]);
    });

    it("takes the table's `edit` from before for `update`, and the app's own tools where none are named", () => {
        expect(actionsOf({ edit: { tool: "write", arguments: { project: "shop", action: "update" } } }).update)
            .toEqual({ tool: "write", arguments: { project: "shop", action: "update" } });
        expect(actionsOf(undefined)).toEqual(DEFAULT_ACTIONS);
    });
});

describe("reading a show_* result", () => {
    it("draws the old table for a result that carries only its columns", () => {
        expect(parseResult(ok({ collection: "orders", columns: [], data: [] }))).toEqual({ kind: "table" });
    });

    it("refuses a payload of a version it does not know, rather than misdraw it", () => {
        const parsed = parseResult(ok({ view: { version: 2, blocks: [] } }));
        expect(parsed.kind).toBe("error");
    });

    it("rebuilds the collections, their relations pointing at each other", () => {
        const parsed = parseResult(ok({
            view: {
                version: 1,
                blocks: [{ key: "rows", type: "collection", collection: "orders" }],
                collections: [
                    { slug: "customers", name: "Customers", properties: {} },
                    { slug: "orders", name: "Orders", properties: { customer: { type: "relation", relation: { kind: "belongsTo", target: { __collectionRef: "customers" } } } } }
                ],
                viewer: { uid: "u1", roles: ["admin"] }
            }
        }));
        if (parsed.kind !== "screen") throw new Error(`parsed as ${parsed.kind}`);
        const property = parsed.screen.collections[1].properties.customer;
        expect(property.type === "relation" && property.relation?.target().slug).toBe("customers");
        expect(parsed.screen.viewer).toEqual({ uid: "u1", roles: ["admin"] });
    });

    it("keeps the conditions of a block's filter the read tools take", () => {
        expect(filterOf({ status: ["==", "paid"], total: [[">", 1], ["<", 9]], bad: ["nope", 1], odd: "x" }))
            .toEqual({ status: ["==", "paid"], total: [[">", 1], ["<", 9]] });
    });
});
