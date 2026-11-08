/**
 * @jest-environment jsdom
 */
/**
 * What a collection view hands an app's code — a custom view, a collection
 * action, a toolbar slot, a caller's own selection controller: the rows as the
 * server sends them, and ids, never the admin's `Entity` view model.
 */
import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BrowserRouter } from "react-router";
import type { DataDriver } from "@rebasepro/types";
import type {
    AdminCollection,
    AnySlotContribution,
    CollectionActionsProps,
    CollectionCustomView,
    CollectionCustomViewParams,
    CollectionToolbarProps,
    SelectionController
} from "@rebasepro/cms-types";
import { Rebase } from "@rebasepro/app";
import { CollectionPanel, useSelectionController } from "@rebasepro/cms";
import { CustomViewHost } from "../../src/components/CollectionViewBinding/CustomViewHost";

if (typeof globalThis.IntersectionObserver === "undefined") {
    class NoopIntersectionObserver {
        observe() { /* nothing scrolls in jsdom */ }
        unobserve() { /* nothing scrolls in jsdom */ }
        disconnect() { /* nothing scrolls in jsdom */ }
        takeRecords() { return []; }
    }
    Object.defineProperty(globalThis, "IntersectionObserver", { value: NoopIntersectionObserver, configurable: true });
}

if (typeof globalThis.ResizeObserver === "undefined") {
    class NoopResizeObserver {
        observe() { /* nothing to observe in jsdom */ }
        unobserve() { /* nothing to observe in jsdom */ }
        disconnect() { /* nothing to observe in jsdom */ }
    }
    Object.defineProperty(globalThis, "ResizeObserver", { value: NoopResizeObserver, configurable: true });
}

// jsdom measures nothing: give the table a laptop-sized viewport.
jest.mock("react-use-measure", () => {
    const mod = jest.requireActual("react-use-measure") as { default?: (o?: unknown) => unknown };
    const actual = (typeof mod === "function" ? mod : mod.default) as (o?: unknown) => unknown;
    return (options?: { offsetSize?: boolean }) => {
        const real = actual(options) as [unknown, unknown];
        if (options?.offsetSize) return [real[0], { width: 1440, height: 900, top: 0, left: 0, bottom: 0, right: 0, x: 0, y: 0 }];
        return real;
    };
});

type Row = Record<string, unknown>;

const tasks = {
    slug: "tasks",
    name: "Tasks",
    singularName: "Task",
    table: "tasks",
    properties: {
        id: { type: "string", name: "Id", isId: true },
        title: { type: "string", name: "Title" },
        due: { type: "date", name: "Due", columnType: "date" }
    }
} as AdminCollection;

let rows: Row[];

const driver: DataDriver = {
    key: "memory",
    fetchCollection: async () => rows,
    fetchOne: async ({ id }) => rows.find(r => String(r.id) === String(id)),
    save: async ({ values }) => values,
    delete: async () => undefined,
    count: async () => rows.length,
    checkUniqueField: async () => true
};

const authController = {
    user: { uid: "u1", email: "u1@rebase.pro", displayName: "u1", photoURL: null, providerId: "password", isAnonymous: false, roles: ["admin"] },
    initialLoading: false,
    authLoading: false,
    loginSkipped: false,
    getAuthToken: async () => "t",
    signOut: async () => undefined,
    extra: null,
    setExtra: () => undefined
} as never;

function Page({ children, slots, collectionViews }: {
    children: React.ReactNode,
    slots?: AnySlotContribution[],
    collectionViews?: CollectionCustomView[]
}) {
    return (
        <Rebase authController={authController} storageSource={{} as never}
            slots={slots}
            collectionViews={collectionViews}
            dataSources={[{ key: "(default)", engine: "postgres", driver }]}>
            <BrowserRouter>{children}</BrowserRouter>
        </Rebase>
    );
}

beforeEach(() => {
    rows = [
        { id: "t1", title: "Write the plan", due: "2026-11-08" },
        { id: "t2", title: "Ship it", due: "2026-11-09" }
    ];
    window.history.replaceState(null, "", "/my-page");
});

/** Tick a table row's checkbox, by the row's position. */
async function tick(index: number) {
    const checkboxes = screen.getAllByRole("checkbox").slice(-rows.length);
    await act(async () => {
        fireEvent.click(checkboxes[index]);
    });
}

describe("a custom view", () => {
    let seen: CollectionCustomViewParams[];
    function Probe(params: CollectionCustomViewParams) {
        seen.push(params);
        return <div>
            {params.tableController.rows.map(row =>
                <button key={String(row.id)} onClick={() => params.onRowClick?.(row)}>{String(row.title)}</button>)}
        </div>;
    }
    const probeView: CollectionCustomView = { key: "probe", name: "Probe", Builder: Probe };
    const withProbe = { ...tasks, customViews: ["probe"], defaultViewMode: "probe" } as AdminCollection;

    beforeEach(() => {
        seen = [];
    });

    it("is handed the rows as the server sends them, and a click that takes a row", async () => {
        const clicked: Row[] = [];
        render(<Page collectionViews={[probeView]}>
            <CollectionPanel collection={withProbe} onRowClick={(row) => clicked.push(row)}/>
        </Page>);
        fireEvent.click(await screen.findByText("Ship it"));

        const last = seen[seen.length - 1];
        expect(last.tableController.rows).toEqual([
            { id: "t1", title: "Write the plan", due: "2026-11-08" },
            { id: "t2", title: "Ship it", due: "2026-11-09" }
        ]);
        expect("data" in last.tableController).toBe(false);
        expect(typeof last.tableController.loading).toBe("boolean");
        await waitFor(() => expect(clicked).toEqual([{ id: "t2", title: "Ship it", due: "2026-11-09" }]));
    });

    it("is handed the highlighted rows' ids, and a selection that speaks rows", async () => {
        render(<Page collectionViews={[probeView]}>
            <CollectionPanel collection={withProbe} highlightedIds={["t2"]}/>
        </Page>);
        expect(await screen.findByText("Ship it")).toBeTruthy();
        await waitFor(() => expect(seen[seen.length - 1].highlightedIds).toEqual(["t2"]));

        const { selectionController } = seen[seen.length - 1];
        act(() => selectionController!.toggleSelection(seen[seen.length - 1].tableController.rows[0], true));
        await waitFor(() => expect(seen[seen.length - 1].selectionController!.selection).toEqual({
            type: "rows",
            ids: ["t1"],
            rows: [{ id: "t1", title: "Write the plan", due: "2026-11-08" }]
        }));
        expect(seen[seen.length - 1].selectionController!.isSelected("t1")).toBe(true);
        expect(seen[seen.length - 1].selectionController!.isSelected("t2")).toBe(false);
    });
});

describe("a collection action and the toolbar slots", () => {
    it("are handed the rows, and the ticked rows by id", async () => {
        const actionProps: CollectionActionsProps[] = [];
        const toolbarProps: CollectionToolbarProps[] = [];
        function Action(props: CollectionActionsProps) {
            actionProps.push(props);
            return null;
        }
        const withAction = { ...tasks, Actions: [Action] } as AdminCollection;
        const slots: AnySlotContribution[] = [{
            slot: "collection.toolbar",
            Component: (props: CollectionToolbarProps) => {
                toolbarProps.push(props);
                return null;
            }
        }];
        render(<Page slots={slots}><CollectionPanel collection={withAction} viewMode={"table"}/></Page>);
        expect(await screen.findByText("Write the plan")).toBeTruthy();
        await tick(1);

        await waitFor(() => expect(actionProps[actionProps.length - 1].selectionController.selection).toEqual({
            type: "rows",
            ids: ["t2"],
            rows: [{ id: "t2", title: "Ship it", due: "2026-11-09" }]
        }));
        const last = actionProps[actionProps.length - 1];
        expect(last.tableController.rows.map(row => row.id)).toEqual(["t1", "t2"]);
        expect(last.selectionController.selectedCount).toBe(1);
        expect(toolbarProps[toolbarProps.length - 1].tableController.rows.map(row => row.due)).toEqual(["2026-11-08", "2026-11-09"]);
    });
});

describe("useSelectionController as admin.selectionController", () => {
    it("is what the view's ticks change, read as rows", async () => {
        let mine: SelectionController | undefined;
        function Host() {
            const selection = useSelectionController(tasks);
            mine = selection;
            return <CollectionPanel collection={tasks} viewMode={"table"}
                collectionOverrides={{ selectionController: selection }}/>;
        }
        render(<Page><Host/></Page>);
        expect(await screen.findByText("Write the plan")).toBeTruthy();
        await tick(0);

        await waitFor(() => expect(mine!.selection).toEqual({
            type: "rows",
            ids: ["t1"],
            rows: [{ id: "t1", title: "Write the plan", due: "2026-11-08" }]
        }));
        act(() => mine!.clearSelection());
        await waitFor(() => expect(mine!.hasSelection).toBe(false));
    });

    it("says once, not on every render, that a controller it did not make is not adopted", async () => {
        const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
        const foreign: SelectionController = {
            selection: { type: "rows", ids: [], rows: [] },
            selectedCount: 0,
            hasSelection: false,
            isSelected: () => false,
            toggleSelection: () => undefined,
            setSelectedRows: () => undefined,
            selectAllMatching: () => undefined,
            clearSelection: () => undefined
        };
        const foreignTasks = { ...tasks, slug: "foreign_tasks" } as AdminCollection;
        const view = render(<Page><CollectionPanel collection={foreignTasks} viewMode={"table"}
            collectionOverrides={{ selectionController: foreign }}/></Page>);
        expect(await screen.findByText("Write the plan")).toBeTruthy();
        view.rerender(<Page><CollectionPanel collection={foreignTasks} viewMode={"table"}
            collectionOverrides={{ selectionController: foreign }}/></Page>);
        await tick(0);

        const said = warn.mock.calls.filter(([message]) => String(message).includes("was not made by useSelectionController()"));
        warn.mockRestore();
        expect(said).toHaveLength(1);
    });
});

/**
 * A row is exactly its columns: on a collection keyed by an integer column,
 * `row.id` is that column's number. The id handed beside a row — a
 * selection's ids, a click's, the highlighted ones — is the string the admin
 * addresses the record by, and an id handed back is read either way.
 */
describe("a collection keyed by an integer", () => {
    const orders = {
        slug: "orders",
        name: "Orders",
        singularName: "Order",
        table: "orders",
        properties: {
            id: { type: "number", name: "Id", isId: true },
            title: { type: "string", name: "Title" }
        }
    } as AdminCollection;
    let seen: CollectionCustomViewParams[];
    function Probe(params: CollectionCustomViewParams) {
        seen.push(params);
        return <div>
            {params.tableController.rows.map(row =>
                <button key={String(row.id)} onClick={() => params.onRowClick?.(row)}>{String(row.title)}</button>)}
        </div>;
    }
    const probeView: CollectionCustomView = { key: "probe", name: "Probe", Builder: Probe };
    const withProbe = { ...orders, customViews: ["probe"], defaultViewMode: "probe" } as AdminCollection;
    const latest = () => seen[seen.length - 1];

    beforeEach(() => {
        seen = [];
        rows = [
            { id: 5, title: "Five" },
            { id: 7, title: "Seven" }
        ];
    });

    it("hands rows with the key column's number, and a click its string id", async () => {
        const clicked: [Row, string][] = [];
        render(<Page collectionViews={[probeView]}>
            <CollectionPanel collection={withProbe} onRowClick={(row, id) => clicked.push([row, id])}/>
        </Page>);
        fireEvent.click(await screen.findByText("Five"));

        expect(latest().tableController.rows).toEqual([{ id: 5, title: "Five" }, { id: 7, title: "Seven" }]);
        await waitFor(() => expect(clicked).toEqual([[{ id: 5, title: "Five" }, "5"]]));
    });

    it("highlights by id, as a string", async () => {
        render(<Page collectionViews={[probeView]}>
            <CollectionPanel collection={withProbe} highlightedIds={[5]}/>
        </Page>);
        expect(await screen.findByText("Five")).toBeTruthy();
        await waitFor(() => expect(latest().highlightedIds).toEqual(["5"]));
    });

    it("hands the deleted and highlighted rows' ids as strings, whatever the records hold", () => {
        const deleted = { id: 7, path: "orders", values: { id: 7, title: "Seven" } };
        const highlighted = { id: 5, path: "orders", values: { id: 5, title: "Five" } };
        render(<CustomViewHost Builder={Probe} collection={orders} path="orders"
            tableController={{ data: [highlighted], dataLoading: false, noMoreToLoad: true }}
            highlightedEntities={[highlighted]}
            deletedEntities={[deleted]}/>);
        expect(latest().highlightedIds).toEqual(["5"]);
        expect(latest().deletedIds).toEqual(["7"]);
    });

    it("selects, unselects and toggles a row twice — by the row, and by either spelling of its id", async () => {
        render(<Page collectionViews={[probeView]}>
            <CollectionPanel collection={withProbe}/>
        </Page>);
        expect(await screen.findByText("Five")).toBeTruthy();
        const five = latest().tableController.rows[0];

        act(() => latest().selectionController!.toggleSelection(five, true));
        await waitFor(() => expect(latest().selectionController!.selection).toEqual({ type: "rows", ids: ["5"], rows: [five] }));
        expect(latest().selectionController!.isSelected(5)).toBe(true);
        expect(latest().selectionController!.isSelected("5")).toBe(true);
        expect(latest().selectionController!.isSelected(7)).toBe(false);

        act(() => latest().selectionController!.toggleSelection(five, false));
        await waitFor(() => expect(latest().selectionController!.hasSelection).toBe(false));

        // A row built by the app, not the view's: found by its key column.
        act(() => latest().selectionController!.toggleSelection({ id: 5, title: "Five" }));
        await waitFor(() => expect(latest().selectionController!.isSelected(5)).toBe(true));
        act(() => latest().selectionController!.toggleSelection(five));
        await waitFor(() => expect(latest().selectionController!.hasSelection).toBe(false));
    });
});
