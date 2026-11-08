/**
 * The admin panel's data driver over the server's tools, against a stub of
 * the host's `tools/call`.
 *
 * - A read is the read tool's call: the filter and sort in its dialect, a
 *   belongsTo by its foreign key, a relation value by its id.
 * - One row read many times (a table's relation previews) is one call, until
 *   a write to its collection or until it is 30 seconds old.
 * - The rows of one collection drawn in one tick are one page call, an `in`
 *   on the collection's key; a row the page does not carry is no row.
 * - A write the server answers with a plan runs only once the person
 *   confirms, with the plan's token; declined, nothing more is sent.
 * - A write drops what was read of its collection, under whichever name it
 *   was read, and the model is told what changed. The driver does not
 *   subscribe: `<Rebase>`'s change signal refreshes the views.
 * - The hosted connector's tools and arguments, where a result names them.
 * - The row hooks' driver confirms every change in the view first, unless
 *   the tool plans it itself; declined, nothing is sent. The admin's own
 *   driver asks nothing of its own.
 * - The flat data layer an app's hooks read: the same tools, and aggregates
 *   through the aggregate tool, in REST's `select` grammar.
 * - The page a show_collection result carries is the first read's, when
 *   the read asks for exactly it; any other read, or one after a write, goes
 *   to the server.
 */
import { describe, expect, it, vi } from "vitest";
import { EntityRelation, type CollectionConfig, type FetchCollectionProps } from "@rebasepro/types";
import { buildRebaseData, wrapAsSdkData } from "@rebasepro/common";
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
    type SeedPage,
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
    seed?: SeedPage;
    collection?: (name: string) => CollectionConfig | undefined;
} = {}) {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const callTool: CallTool = async (name, args) => {
        calls.push({ name, args });
        return answer(name, args);
    };
    const changes: ViewChange[][] = [];
    const { driver, confirmingDriver } = createToolDriver({
        callTool,
        actions: options.actions ?? DEFAULT_ACTIONS,
        confirm: options.confirm ?? (async () => true),
        onChange: list => changes.push([...list]),
        ...(options.seed && { seed: options.seed }),
        ...(options.collection && { collection: options.collection })
    });
    // What an app's row hooks read and write: the confirming driver through
    // the flat layer, rows as the wire has them.
    const flat = wrapAsSdkData(buildRebaseData(confirmingDriver));
    return { driver, flat, calls, changes };
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

    it("opens a row a page listed with no call of its own", async () => {
        const { driver, flat, calls } = driverWith((name, args) => name === "get_document"
            ? ok({ id: args.id, name: "from get" })
            : name === "count_documents" ? ok({ count: 2 })
                : ok({ data: [{ id: "c1", name: "Ada" }, { id: "c2", name: "Grace" }], meta: {} }));

        await driver.fetchCollection({ path: "customers", collection: customers });
        expect(await driver.fetchOne({ path: "customers", id: "c2" })).toEqual({ id: "c2", name: "Grace" });
        expect(await flat.collection("customers").findById("c1")).toEqual({ id: "c1", name: "Ada" });
        expect(calls.map(call => call.name)).toEqual(["query_collection"]);

        // An app's own page fills it too.
        await flat.collection("orders").find({ limit: 5 });
        await flat.collection("orders").findById("c1");
        expect(calls.filter(call => call.name === "get_document")).toHaveLength(0);
    });

    it("reads a listed row again once its collection is written", async () => {
        const { driver, calls } = driverWith((name, args) => name === "get_document"
            ? ok({ id: args.id, name: "Ada L." })
            : name === "query_collection" ? ok({ data: [{ id: "c1", name: "Ada" }], meta: {} }) : ok({ id: "c1" }));

        await driver.fetchCollection({ path: "customers", collection: customers });
        await driver.save({ path: "customers", id: "c1", values: { name: "Ada L." }, status: "existing" });
        expect(await driver.fetchOne({ path: "customers", id: "c1" })).toEqual({ id: "c1", name: "Ada L." });
        expect(calls.filter(call => call.name === "get_document")).toHaveLength(1);
    });

    it("reads a row again once it is 30 seconds old: the model may have changed it with its own tools", async () => {
        vi.useFakeTimers();
        try {
            const { driver, calls } = driverWith((name, args) => name === "get_document"
                ? ok({ id: args.id, name: "Ada L." })
                : ok({ data: [{ id: "c1", name: "Ada" }], meta: {} }));

            await driver.fetchCollection({ path: "customers", collection: customers });
            vi.advanceTimersByTime(29_000);
            // Within it, the listed row the person clicks opens with no call.
            expect(await driver.fetchOne({ path: "customers", id: "c1" })).toEqual({ id: "c1", name: "Ada" });
            expect(calls.filter(call => call.name === "get_document")).toHaveLength(0);

            vi.advanceTimersByTime(2_000);
            expect(await driver.fetchOne({ path: "customers", id: "c1" })).toEqual({ id: "c1", name: "Ada L." });
            expect(calls.filter(call => call.name === "get_document")).toHaveLength(1);
            // And that read is shared, in its turn.
            await Promise.all([1, 2].map(() => driver.fetchOne({ path: "customers", id: "c1" })));
            expect(calls.filter(call => call.name === "get_document")).toHaveLength(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it("keys a listed row by the collection's own key", async () => {
        const authors: CollectionConfig = {
            slug: "authors",
            name: "Authors",
            table: "authors",
            properties: { handle: { type: "string", isId: true }, name: { type: "string" } }
        };
        const { driver, calls } = driverWith(() => ok({ data: [{ handle: "ada", name: "Ada" }], meta: {} }));

        await driver.fetchCollection({ path: "authors", collection: authors });
        expect(await driver.fetchOne({ path: "authors", id: "ada" })).toEqual({ handle: "ada", name: "Ada" });
        expect(calls.map(call => call.name)).toEqual(["query_collection"]);
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

describe("rows read by key: a table's relation previews", () => {
    /** The ids a read's `in` asks for. */
    const byKey = (args: Record<string, unknown>): unknown[] => {
        const condition = typeof args.where === "object" && args.where !== null ? Object.values(args.where)[0] : undefined;
        return Array.isArray(condition) && Array.isArray(condition[1]) ? condition[1] : [];
    };
    /** The page tool, answering the rows of `known` an `in` asks for. */
    const pageOf = (known: Record<string, unknown>[], field = "id") => (_name: string, args: Record<string, unknown>) =>
        ok({ data: known.filter(row => byKey(args).includes(row[field])), meta: {} });
    const people = ["c1", "c2", "c3", "c4", "c5"].map(id => ({ id, name: `Customer ${id}` }));

    it("are one page call for every row drawn in the same tick, each row asked for once", async () => {
        const { driver, calls } = driverWith(pageOf(people), { collection: name => name === "customers" ? customers : undefined });

        // A page of orders draws its customers: five distinct, some twice.
        const drawn = ["c1", "c2", "c1", "c3", "c4", "c5", "c2"];
        const read = await Promise.all(drawn.map(id => driver.fetchOne({ path: "customers", id })));

        expect(read.map(row => row?.name)).toEqual(drawn.map(id => `Customer ${id}`));
        expect(calls).toEqual([{
            name: "query_collection",
            args: { collection: "customers", where: { id: ["in", ["c1", "c2", "c3", "c4", "c5"]] }, limit: 5 }
        }]);
    });

    it("answer no row for an id the page does not carry: absent, or not visible to the person", async () => {
        const { driver, calls } = driverWith(pageOf(people.slice(0, 2)), { collection: () => customers });

        const read = await Promise.all(["c1", "gone", "c2", "hidden"].map(id => driver.fetchOne({ path: "customers", id, collection: customers })));

        expect(read).toEqual([people[0], undefined, people[1], undefined]);
        expect(calls).toHaveLength(1);
    });

    it("are read again together once they are 30 seconds old, and not before", async () => {
        vi.useFakeTimers();
        try {
            const { driver, calls } = driverWith(pageOf(people), { collection: () => customers });
            const drawAll = () => Promise.all(people.map(({ id }) => driver.fetchOne({ path: "customers", id })));

            await drawAll();
            vi.advanceTimersByTime(29_000);
            await drawAll();
            expect(calls).toHaveLength(1);

            vi.advanceTimersByTime(2_000);
            await drawAll();
            expect(calls).toHaveLength(2);
            expect(byKey(calls[1].args)).toEqual(["c1", "c2", "c3", "c4", "c5"]);
        } finally {
            vi.useRealTimers();
        }
    });

    it("go through the hosted connector's query, whose page and get are one tool", async () => {
        const actions = actionsOf({
            page: { tool: "query", arguments: { project: "shop" } },
            get: { tool: "query", arguments: { project: "shop" } }
        });
        const { driver, calls } = driverWith(pageOf(people), { actions, collection: () => customers });

        await Promise.all(people.map(({ id }) => driver.fetchOne({ path: "customers", id })));

        expect(calls).toEqual([{
            name: "query",
            args: { project: "shop", collection: "customers", where: { id: ["in", ["c1", "c2", "c3", "c4", "c5"]] }, limit: 5 }
        }]);
    });

    it("put the `in` on the collection's own key, a number key with numbers", async () => {
        const invoices: CollectionConfig = {
            slug: "invoices",
            name: "Invoices",
            table: "invoices",
            properties: { number: { type: "number", isId: true }, total: { type: "number" } }
        };
        const { driver, calls } = driverWith(pageOf([{ number: 7, total: 10 }, { number: 8, total: 20 }], "number"), { collection: () => invoices });

        const read = await Promise.all([7, "8"].map(id => driver.fetchOne({ path: "invoices", id })));

        expect(read).toEqual([{ number: 7, total: 10 }, { number: 8, total: 20 }]);
        expect(calls[0].args.where).toEqual({ number: ["in", [7, 8]] });
    });

    it("are chunked at the read tools' ceiling", async () => {
        const many = Array.from({ length: 1001 }, (_, i) => ({ id: `c${i}` }));
        const { driver, calls } = driverWith(pageOf(many), { collection: () => customers });

        const read = await Promise.all(many.map(({ id }) => driver.fetchOne({ path: "customers", id })));

        expect(read.every(row => row !== undefined)).toBe(true);
        expect(calls.map(call => call.args.limit)).toEqual([1000, 1]);
    });

    it("fail together when the page call fails, and are not kept: the next draw reads again", async () => {
        let refuse = true;
        const { driver, calls } = driverWith((name, args) => refuse
            ? { content: [{ type: "text", text: "The server is busy." }], isError: true }
            : pageOf(people)(name, args), { collection: () => customers });

        const failed = await Promise.allSettled(["c1", "c2"].map(id => driver.fetchOne({ path: "customers", id })));
        expect(failed.map(result => result.status)).toEqual(["rejected", "rejected"]);

        refuse = false;
        expect(await driver.fetchOne({ path: "customers", id: "c1" })).toEqual(people[0]);
        expect(calls).toHaveLength(2);
    });

    it("are read one by one through the get tool where the collection has no single key column", async () => {
        const lines: CollectionConfig = {
            slug: "lines",
            name: "Lines",
            table: "lines",
            properties: { order: { type: "string", isId: true }, line: { type: "number", isId: true } }
        };
        const { driver, calls } = driverWith((name, args) => ok({ id: args.id }), { collection: () => lines });

        await Promise.all(["o1:1", "o1:2"].map(id => driver.fetchOne({ path: "lines", id })));
        expect(calls.map(call => call.name)).toEqual(["get_document", "get_document"]);
    });
});

describe("writing", () => {
    it("sends a belongsTo as its id under its foreign key, a date as ISO text, and nothing undefined", async () => {
        const { driver, calls } = driverWith((_name, args) => ok({ id: "o9", ...(args.data as object) }));

        await driver.save({
            path: "orders",
            collection: orders,
            values: { customer: new EntityRelation("c2", "customers"), placed: new Date("2026-11-07T10:00:00.000Z"), note: undefined },
            status: "new"
        });

        expect(calls[0]).toEqual({
            name: "create_document",
            args: { collection: "orders", data: { customerId: "c2", placed: "2026-11-07T10:00:00.000Z" } }
        });
    });

    it("sends a save by the collection's config where the save names none, as the row hooks and forms save", async () => {
        const dated: CollectionConfig = { ...orders, properties: { ...orders.properties, due: { type: "date", columnType: "date" } } };
        const { driver, calls } = driverWith((_name, args) => ok({ id: "o1", ...(args.data as object) }), {
            collection: name => name === "orders" || name === "public.orders" ? dated : undefined
        });

        await driver.save({
            path: "public.orders",
            id: "o1",
            values: { due: new Date("2026-11-08T00:00:00.000Z"), customer: new EntityRelation("c2", "customers") },
            status: "existing"
        });

        expect(calls[0].args).toEqual({ collection: "public.orders", id: "o1", data: { due: "2026-11-08", customerId: "c2" } });
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

    it("subscribes to nothing: <Rebase>'s change signal refreshes the views of what it writes", () => {
        const { driver } = driverWith(() => ok({}));
        expect(driver.listenCollection).toBeUndefined();
        expect(driver.listenOne).toBeUndefined();
        expect(driver.subscribeToExternalChanges).toBeUndefined();
    });

    it("says what changed", async () => {
        const { driver, changes } = driverWith(() => ok({ id: "o1", status: "sent" }));

        await driver.save({ path: "orders", id: "o1", values: { status: "sent" }, status: "existing" });

        expect(changes.at(-1)).toEqual([{ action: "updated", collection: "orders", id: "o1", fields: ["status"] }]);
        expect(describeChanges(changes.at(-1) ?? [])).toBe("In the Rebase view, the user saved these changes: "
            + "updated status on row o1 of orders. Rows you read before them may be out of date.");
    });
});

describe("the row hooks' writes", () => {
    it("ask the person before a change the tool does not plan, and send nothing when they decline", async () => {
        const asked: WritePlan[] = [];
        let answer = false;
        const { flat, calls, changes } = driverWith((_name, args) => ok({ id: "o9", ...(args.data as object) }), {
            confirm: async plan => {
                asked.push(plan);
                return answer;
            }
        });

        await expect(flat.collection("orders").update("o1", { status: "sent" })).rejects.toBeInstanceOf(SaveCancelledError);
        expect(calls).toEqual([]);
        expect(changes).toEqual([]);

        answer = true;
        await flat.collection("orders").create({ status: "new" });
        await flat.collection("orders").delete("o2");
        expect(asked.map(plan => plan.summary)).toEqual([
            "Change status on row o1 of orders.",
            "Create a row in orders.",
            "Delete row o2 of orders."
        ]);
        expect(calls.map(call => call.name)).toEqual(["create_document", "delete_document"]);
        expect(describeChanges(changes.at(-1) ?? [])).toContain("created row o9 of orders; deleted row o2 of orders");
    });

    it("leave the asking to a tool that plans, once", async () => {
        const asked: WritePlan[] = [];
        const actions = actionsOf({ update: { tool: "write", arguments: { project: "shop", action: "update" }, plans: true } });
        const { flat, calls } = driverWith((_name, args) => args.confirm ? ok({ id: "o1" }) : PLAN, {
            actions,
            confirm: async plan => {
                asked.push(plan);
                return true;
            }
        });

        await flat.collection("orders").update("o1", { status: "sent" });
        expect(asked.map(plan => plan.summary)).toEqual(["Change status on row o1 of orders in shop."]);
        expect(calls).toHaveLength(2);
    });

    it("are the only ones asked: the admin's driver asks nothing of its own, the person's click on Save was the yes", async () => {
        const confirm = vi.fn(async () => true);
        const { driver } = driverWith(() => ok({ id: "o1" }), { confirm });
        await driver.save({ path: "orders", id: "o1", values: { status: "sent" }, status: "existing" });
        await driver.delete({ row: { id: "o1", path: "orders" } });
        expect(confirm).not.toHaveBeenCalled();
    });

    it("drop the rows read of a collection the app changed, by whatever name it used", async () => {
        const { driver, flat, calls } = driverWith((name, args) => name === "update_document"
            ? ok({ id: "o1" })
            : ok({ data: [{ id: "o1", status: args.where ? "sent" : "pending" }], meta: {} }), {
            collection: name => name === "orders" || name === "public.orders" ? orders : undefined
        });
        await driver.fetchCollection({ path: "orders", collection: orders });

        await flat.collection("public.orders").update("o1", { status: "sent" });
        expect(await driver.fetchOne({ path: "orders", id: "o1" })).toEqual({ id: "o1", status: "sent" });
        expect(calls.filter(call => call.name === "query_collection" && call.args.where)).toHaveLength(1);
    });
});

describe("aggregates", () => {
    it("are the aggregate tool's, in REST's select grammar, each value under its alias", async () => {
        const { flat, calls } = driverWith(() => ok({
            data: [{ status: "paid", sum_total: 410, count: 3 }, { status: "sent", sum_total: 90, count: 1 }],
            meta: { limit: 10, offset: 0, hasMore: false }
        }));

        const result = await flat.collection("orders").aggregate({
            select: [{ fn: "sum", field: "total" }, { fn: "count" }],
            groupBy: ["status"],
            where: { placed: [">=", "2026-11-01"] },
            orderBy: ["sum_total", "desc"],
            limit: 10
        });

        expect([...result]).toEqual([{ status: "paid", sum_total: 410, count: 3 }, { status: "sent", sum_total: 90, count: 1 }]);
        expect(calls).toEqual([{
            name: "aggregate_documents",
            args: {
                collection: "orders",
                select: ["sum(total)", "count()"],
                groupBy: ["status"],
                where: { placed: [">=", "2026-11-01"] },
                orderBy: [["sum_total", "desc"]],
                // One group past the page, so the layer knows whether there are more.
                limit: 11
            }
        }]);
    });

    it("go through the tool a result names for them: the hosted connector's query", async () => {
        const actions = actionsOf({ aggregate: { tool: "query", arguments: { project: "shop" } } });
        const { flat, calls } = driverWith(() => ok({ data: [{ count: 7 }] }), { actions });

        expect([...await flat.collection("orders").aggregate({ select: [{ fn: "count" }] })]).toEqual([{ count: 7 }]);
        expect(calls).toEqual([{ name: "query", args: { project: "shop", collection: "orders", select: ["count()"] } }]);
    });

    it("refuse an or()/and() group the tools cannot express, rather than aggregate wider", async () => {
        const { flat, calls } = driverWith(() => ok({ data: [] }));
        await expect(flat.collection("orders").aggregate({
            select: [{ fn: "count" }],
            logical: {
                type: "or",
                conditions: [{ column: "status", operator: "==", value: "paid" }, { column: "status", operator: "==", value: "sent" }]
            }
        })).rejects.toThrow(/or\(\)\/and\(\)/);
        expect(calls).toEqual([]);
    });
});

describe("the page a show_collection result carries", () => {
    const seed: SeedPage = {
        collection: "orders",
        args: { where: { status: ["==", "paid"] }, orderBy: "placed:desc", limit: 50 },
        rows: [{ id: "o1", status: "paid" }]
    };
    const read: FetchCollectionProps = { path: "orders", filter: { status: ["==", "paid"] }, orderBy: "placed", order: "desc", limit: 50 };

    it("is the first read, with no call, when the read asks for exactly it", async () => {
        const { driver, calls } = driverWith(() => ok({ data: [{ id: "o1", status: "paid" }, { id: "o2", status: "paid" }] }), { seed });

        expect(await driver.fetchCollection(read)).toEqual([{ id: "o1", status: "paid" }]);
        expect(calls).toEqual([]);
        // Its rows open with no read of their own.
        expect(await driver.fetchOne({ path: "orders", id: "o1" })).toEqual({ id: "o1", status: "paid" });
        expect(calls).toEqual([]);

        // Once: the next read is the server's.
        await driver.fetchCollection(read);
        expect(calls.map(call => call.name)).toEqual(["query_collection"]);
    });

    it("is not a read that asks for anything else", async () => {
        const { driver, calls } = driverWith(() => ok({ data: [] }), { seed });
        await driver.fetchCollection({ ...read, limit: 25 });
        await driver.fetchCollection({ ...read, searchString: "ada" });
        await driver.fetchCollection({ ...read, filter: { status: ["==", "sent"] } });
        expect(calls.map(call => call.name)).toEqual(["query_collection", "query_collection", "query_collection"]);
        // And not one, even matching, after those.
        await driver.fetchCollection(read);
        expect(calls).toHaveLength(3);
    });

    it("answers a read one row past its page where it held every row, but not where it was full", async () => {
        const short = driverWith(() => ok({ data: [] }), { seed });
        expect(await short.driver.fetchCollection({ ...read, limit: 51 })).toEqual([{ id: "o1", status: "paid" }]);
        expect(short.calls).toEqual([]);

        const full = driverWith(() => ok({ data: [] }), { seed: { ...seed, args: { ...seed.args, limit: 1 } } });
        await full.driver.fetchCollection({ ...read, limit: 2 });
        expect(full.calls.map(call => call.name)).toEqual(["query_collection"]);
    });

    it("is not served once it is 30 seconds old", async () => {
        vi.useFakeTimers();
        try {
            const { driver, calls } = driverWith(() => ok({ data: [] }), { seed });
            vi.advanceTimersByTime(31_000);
            await driver.fetchCollection(read);
            expect(calls.map(call => call.name)).toEqual(["query_collection"]);
        } finally {
            vi.useRealTimers();
        }
    });

    it("is dropped by a write", async () => {
        const { driver, calls } = driverWith(name => name === "update_document" ? ok({ id: "o1" }) : ok({ data: [] }), { seed });
        await driver.save({ path: "orders", id: "o1", values: { status: "sent" }, status: "existing" });
        await driver.fetchCollection(read);
        expect(calls.map(call => call.name)).toEqual(["update_document", "query_collection"]);
    });

    it("is read from a show_collection result, with the window the server read", () => {
        const parsed = parseResult(ok({
            data: [{ id: "o1" }],
            meta: { limit: 50, offset: 0, hasMore: false },
            view: {
                version: 1,
                blocks: [{ key: "rows", type: "collection", collection: "orders", where: { status: ["==", "paid"] }, orderBy: "placed:desc" }],
                collections: [{ slug: "orders", name: "Orders", properties: {} }],
                viewer: { uid: "u1", roles: [] }
            }
        }));
        if (parsed.kind !== "screen") throw new Error(`parsed as ${parsed.kind}`);
        expect(parsed.screen.firstPage).toEqual({
            collection: "orders",
            args: { where: { status: ["==", "paid"] }, orderBy: "placed:desc", limit: 50, offset: 0 },
            rows: [{ id: "o1" }]
        });
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

describe("what the driver sends, and refuses to", () => {
    const page = ok({ data: [{ id: "o1", status: "paid" }], meta: {} });

    it("asks for deleted rows only where the read does: none for false, `only` for the trash, `include` for both", async () => {
        const { driver, calls } = driverWith(() => page);
        await driver.fetchCollection({ path: "orders", withDeleted: false });
        await driver.fetchCollection({ path: "orders", withDeleted: "only" });
        await driver.fetchCollection({ path: "orders", withDeleted: true });
        expect(calls.map(call => call.args.deleted)).toEqual([undefined, "only", "include"]);
    });

    it("counts the trash as the trash, and aggregates it too", async () => {
        const { driver, calls } = driverWith(name => name === "count_documents" ? ok({ count: 2 }) : ok({ data: [] }));
        await driver.count!({ path: "orders", withDeleted: "only" });
        await driver.restFetchService!.aggregate!("orders", { aggregates: [{ fn: "count" }], withDeleted: "only" });
        expect(calls.map(call => call.args.deleted)).toEqual(["only", "only"]);
    });

    it("does not open a row from a page that listed deleted ones: get answers none for those", async () => {
        const { driver, calls } = driverWith((name, args) => name === "get_document" ? ok({ id: args.id }) : page);
        await driver.fetchCollection({ path: "orders", withDeleted: true });
        await driver.fetchOne({ path: "orders", id: "o1" });
        expect(calls.map(call => call.name)).toEqual(["query_collection", "get_document"]);
    });

    it("caps an aggregate's limit at the read tools' ceiling", async () => {
        const { flat, calls } = driverWith(() => ok({ data: [] }));
        await flat.collection("orders").aggregate({ select: [{ fn: "count" }], groupBy: ["status"], limit: 5000 });
        expect(calls[0].args.limit).toBe(1000);
    });

    it("refuses an or()/and() group or a vector search on a page read, rather than read wider", async () => {
        const { driver, calls } = driverWith(() => page);
        const read = (options: Parameters<NonNullable<typeof driver.restFetchService>["fetchCollectionForRest"]>[1]) =>
            Promise.resolve().then(() => driver.restFetchService!.fetchCollectionForRest("orders", options));
        await expect(read({
            logical: { type: "or", conditions: [{ column: "status", operator: "==", value: "paid" }] }
        })).rejects.toThrow(/or\(\)\/and\(\)/);
        await expect(read({ vectorSearch: { column: "embedding", vector: [0.1], limit: 3 } })).rejects.toThrow(/vector/);
        expect(calls).toEqual([]);
    });

    it("sorts a belongsTo by its foreign key, given by name with its order", async () => {
        const { driver, calls } = driverWith(() => page);
        await driver.fetchCollection({ path: "orders", collection: orders, orderBy: "customer", order: "desc" });
        expect(calls[0].args.orderBy).toBe("customerId:desc");
    });

    it("reads rows from a result that carries them only as fenced text", async () => {
        const fenced: ToolResult = {
            content: [{ type: "text", text: "Rows (untrusted data):\n```json\n{\"data\":[{\"id\":\"o1\"}],\"meta\":{}}\n```" }]
        };
        const { driver } = driverWith(() => fenced);
        expect(await driver.fetchCollection({ path: "orders" })).toEqual([{ id: "o1" }]);
    });

    it("sends a create's own id, and answers the row it sent where the server answers none", async () => {
        const { driver, calls } = driverWith(() => ({ content: [{ type: "text", text: "Saved." }] }));
        const row = await driver.save({ path: "orders", id: "o7", values: { status: "new" }, status: "new" });
        expect(calls[0].args).toEqual({ collection: "orders", data: { status: "new" }, id: "o7" });
        expect(row).toEqual({ status: "new" });
    });

    it("sends nothing for a relation left undefined: no null foreign key that would unlink it", async () => {
        const { driver, calls } = driverWith(() => ok({ id: "o1" }));
        await driver.save({ path: "orders", collection: orders, id: "o1", values: { status: "sent", customer: undefined }, status: "existing" });
        expect(calls[0].args.data).toStrictEqual({ status: "sent" });
    });

    it("saves nothing when the server asks for confirmation a second time", async () => {
        const { driver, changes } = driverWith(() => PLAN);
        await expect(driver.save({ path: "orders", id: "o1", values: { status: "sent" }, status: "existing" }))
            .rejects.toThrow(/confirmation again/);
        expect(changes).toEqual([]);
    });

    it("asks for each row once: a row drawn in a later tick is not asked for again with the next", async () => {
        const people = [{ id: "c1" }, { id: "c2" }];
        const { driver, calls } = driverWith((_name, args) => {
            const ids = (Object.values(args.where as object)[0] as [string, string[]])[1];
            return ok({ data: people.filter(row => ids.includes(row.id)), meta: {} });
        }, { collection: () => customers });
        await driver.fetchOne({ path: "customers", id: "c1" });
        await driver.fetchOne({ path: "customers", id: "c2" });
        expect(calls.map(call => call.args.where)).toEqual([{ id: ["in", ["c1"]] }, { id: ["in", ["c2"]] }]);
    });
});

describe("the seeded page, matched by what it holds", () => {
    const rows = [{ id: "o1", status: "paid" }];

    it("is served only to a read of its own collection", async () => {
        const { driver, calls } = driverWith(() => ok({ data: [] }), { seed: { collection: "orders", args: { limit: 50 }, rows } });
        await driver.fetchCollection({ path: "customers", limit: 50 });
        expect(calls.map(call => call.args.collection)).toEqual(["customers"]);
    });

    it("is the same read whatever order the filter's fields come in, and a sort with no direction is ascending", async () => {
        const { driver, calls } = driverWith(() => ok({ data: [] }), {
            seed: {
                collection: "orders",
                args: { where: { status: ["==", "paid"], total: [">", 1] }, orderBy: [["placed"]], limit: 50 },
                rows
            }
        });
        expect(await driver.fetchCollection({
            path: "orders",
            filter: { total: [">", 1], status: ["==", "paid"] },
            orderBy: [["placed", "asc"]],
            limit: 50
        })).toEqual(rows);
        expect(calls).toEqual([]);
    });
});
