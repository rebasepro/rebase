/**
 * @jest-environment jsdom
 */
/**
 * What a page composes a collection view from: the fields it shows, the
 * toolbar above it, what a click on a row does, the actions on every card,
 * and the view mode it opens in — none of them reaching into the URL or the
 * saved state of the collection's own page.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { BrowserRouter } from "react-router";
import type { DataDriver } from "@rebasepro/types";
import type { AdminCollection, AnySlotContribution, EntityAction, UserConfigurationPersistence } from "@rebasepro/cms-types";
import { Rebase } from "@rebasepro/app";
import {
    CollectionAddButton,
    CollectionPanel,
    CollectionsProvider,
    CollectionSearchBar,
    CollectionToolbar
} from "@rebasepro/cms";

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

const tasks: AdminCollection = {
    slug: "tasks",
    name: "Tasks",
    singularName: "Task",
    table: "tasks",
    properties: {
        id: { type: "string", name: "Id", isId: true },
        title: { type: "string", name: "Title" },
        status: { type: "string", name: "Status", enum: { todo: "To do", done: "Done" } },
        notes: { type: "string", name: "Notes" },
        priority: { type: "number", name: "Priority" }
    },
    kanban: { columnProperty: "status" }
} as AdminCollection;

type Row = Record<string, unknown>;
let rows: Row[];

/** The rows an `==` filter keeps, as the server would. */
function filtered(filter: Record<string, unknown> | undefined): Row[] {
    const conditions = Object.entries(filter ?? {});
    return rows.filter(row => conditions.every(([field, condition]) => {
        const [op, value] = condition as [string, unknown];
        return op !== "==" || row[field] === value;
    }));
}

const driver: DataDriver = {
    key: "memory",
    fetchCollection: async ({ filter }) => filtered(filter as Record<string, unknown> | undefined),
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

/** A user config store holding what the collection's own page saved. */
function savedConfig(saved: Record<string, Row>): UserConfigurationPersistence & { modified: [string, Row][] } {
    const modified: [string, Row][] = [];
    return {
        modified,
        getCollectionConfig: (path: string) => (saved[path] ?? {}) as never,
        onCollectionModified: (path: string, config: unknown) => {
            modified.push([path, config as Row]);
            saved[path] = config as Row;
        },
        recentlyVisitedPaths: [],
        setRecentlyVisitedPaths: () => undefined,
        favouritePaths: [],
        setFavouritePaths: () => undefined,
        collapsedGroups: [],
        setCollapsedGroups: () => undefined
    };
}

function Page({ children, persistence, slots }: {
    children: React.ReactNode,
    persistence?: UserConfigurationPersistence,
    slots?: AnySlotContribution[]
}) {
    return (
        <Rebase authController={authController} storageSource={{} as never}
            userConfigPersistence={persistence}
            slots={slots}
            dataSources={[{ key: "(default)", engine: "postgres", driver }]}>
            <BrowserRouter>
                <main data-testid={"host-page"}>{children}</main>
            </BrowserRouter>
        </Rebase>
    );
}

function tableHeaders(): string[] {
    const table = document.getElementById("virtual-table");
    if (!table) return [];
    return ["Id", "Title", "Status", "Notes", "Priority"]
        .map(name => ({ name, node: within(table).queryAllByText(name)[0] }))
        .filter(({ node }) => Boolean(node))
        .sort((a, b) => a.node!.compareDocumentPosition(b.node!) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)
        .map(({ name }) => name);
}

beforeEach(() => {
    rows = [
        { id: "t1", title: "Write the plan", status: "todo", notes: "Secret note", priority: 3 },
        { id: "t2", title: "Ship it", status: "done", notes: "Another note", priority: 1 }
    ];
    window.history.replaceState(null, "", "/my-page");
});

describe("a panel's fields", () => {
    it("are the table's columns, in their order, and nothing else", async () => {
        render(<Page><CollectionPanel collection={tasks} viewMode={"table"} fields={["priority", "title"]}/></Page>);
        expect(await screen.findByText("Write the plan")).toBeTruthy();
        expect(tableHeaders().filter(name => name !== "Id")).toEqual(["Priority", "Title"]);
        expect(screen.queryByText("Secret note")).toBeNull();
    });

    it("are what a list row shows", async () => {
        render(<Page><CollectionPanel collection={tasks} viewMode={"list"} fields={["title"]}/></Page>);
        expect(await screen.findByText("Write the plan")).toBeTruthy();
        expect(screen.queryByText("Secret note")).toBeNull();
        expect(screen.queryByText("To do")).toBeNull();
    });

    it("are what a card shows", async () => {
        render(<Page><CollectionPanel collection={tasks} viewMode={"cards"} fields={["title", "status"]}/></Page>);
        expect(await screen.findByText("Write the plan")).toBeTruthy();
        expect(screen.getAllByText("To do").length).toBeGreaterThan(0);
        expect(screen.queryByText("Secret note")).toBeNull();
    });

    it("are what a kanban card shows, while the board still groups by its column", async () => {
        render(<Page><CollectionPanel collection={tasks} viewMode={"kanban"} fields={["notes"]}/></Page>);
        expect(await screen.findByText("Secret note")).toBeTruthy();
        expect(screen.queryByText("Write the plan")).toBeNull();
        // The columns come from `status`, which the cards no longer show.
        expect(screen.getAllByText("Done").length).toBeGreaterThan(0);
    });

    describe("that leave every image out", () => {
        const LIST_THUMBNAIL = "main .flex-shrink-0.relative.w-10.h-10";
        const CARD_THUMBNAIL = "main [class*='aspect-[4/3]']";
        const withCover = {
            ...tasks,
            properties: { ...tasks.properties, cover: { type: "string", name: "Cover", admin: { urlPreview: "image" } } }
        } as AdminCollection;

        it("draw a list row with no image place, where one with no fields keeps the icon there", async () => {
            const view = render(<Page><CollectionPanel collection={tasks} viewMode={"list"} fields={["title", "status"]}/></Page>);
            expect(await screen.findByText("Write the plan")).toBeTruthy();
            expect(document.querySelectorAll(LIST_THUMBNAIL)).toHaveLength(0);
            view.unmount();

            render(<Page><CollectionPanel collection={tasks} viewMode={"list"}/></Page>);
            expect(await screen.findByText("Write the plan")).toBeTruthy();
            expect(document.querySelectorAll(LIST_THUMBNAIL).length).toBeGreaterThan(0);
        });

        it("draw a card with no image place", async () => {
            const view = render(<Page><CollectionPanel collection={tasks} viewMode={"cards"} fields={["title", "status"]}/></Page>);
            expect(await screen.findByText("Write the plan")).toBeTruthy();
            expect(document.querySelectorAll(CARD_THUMBNAIL)).toHaveLength(0);
            view.unmount();

            render(<Page><CollectionPanel collection={tasks} viewMode={"cards"}/></Page>);
            expect(await screen.findByText("Write the plan")).toBeTruthy();
            expect(document.querySelectorAll(CARD_THUMBNAIL).length).toBeGreaterThan(0);
        });

        it("keep the place where they name an image, filled or not", async () => {
            render(<Page><CollectionPanel collection={withCover} viewMode={"list"} fields={["title", "cover"]}/></Page>);
            expect(await screen.findByText("Write the plan")).toBeTruthy();
            expect(document.querySelectorAll(LIST_THUMBNAIL)).toHaveLength(2);
        });
    });

    it("leave the column order the user saved alone", async () => {
        const persistence = savedConfig({ tasks: { propertiesOrder: ["notes", "title", "status", "priority"] } });
        render(<Page persistence={persistence}><CollectionPanel collection={tasks} viewMode={"table"} fields={["title", "status"]}/></Page>);
        expect(await screen.findByText("Write the plan")).toBeTruthy();
        expect(tableHeaders().filter(name => name !== "Id")).toEqual(["Title", "Status"]);
        expect(persistence.modified.filter(([, config]) => "propertiesOrder" in config)).toEqual([]);
    });
});

describe("a panel's where", () => {
    it("holds only the rows it names", async () => {
        render(<Page><CollectionPanel collection={tasks} viewMode={"list"} where={{ status: ["==", "done"] }}/></Page>);
        expect(await screen.findByText("Ship it")).toBeTruthy();
        expect(screen.queryByText("Write the plan")).toBeNull();
    });

    it("follows the prop, so state can drive it", async () => {
        function Tabs() {
            const [status, setStatus] = React.useState<string | undefined>("todo");
            return <>
                <button onClick={() => setStatus("done")}>Done tab</button>
                <button onClick={() => setStatus(undefined)}>All tab</button>
                <CollectionPanel collection={tasks} viewMode={"list"}
                    where={status ? { status: ["==", status] } : undefined}/>
            </>;
        }
        render(<Page><Tabs/></Page>);
        expect(await screen.findByText("Write the plan")).toBeTruthy();
        expect(screen.queryByText("Ship it")).toBeNull();

        fireEvent.click(screen.getByText("Done tab"));
        expect(await screen.findByText("Ship it")).toBeTruthy();
        await waitFor(() => expect(screen.queryByText("Write the plan")).toBeNull());

        // Without it, the panel holds every row again.
        fireEvent.click(screen.getByText("All tab"));
        expect(await screen.findByText("Write the plan")).toBeTruthy();
        expect(screen.getByText("Ship it")).toBeTruthy();
    });

    it("is not re-read for an equal filter built again on every render", async () => {
        const reads = jest.spyOn(driver, "fetchCollection");
        function Rerendering() {
            const [n, setN] = React.useState(0);
            return <>
                <button onClick={() => setN(n + 1)}>Render again</button>
                <CollectionPanel collection={tasks} viewMode={"list"} where={{ status: ["==", "done"] }}/>
            </>;
        }
        render(<Page><Rerendering/></Page>);
        expect(await screen.findByText("Ship it")).toBeTruthy();
        await waitFor(() => expect(reads).toHaveBeenCalled());
        const before = reads.mock.calls.length;
        fireEvent.click(screen.getByText("Render again"));
        fireEvent.click(screen.getByText("Render again"));
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(reads.mock.calls.length).toBe(before);
        reads.mockRestore();
    });
});

describe("a panel named by path", () => {
    it("says so when no scope registers it", async () => {
        render(<Page><CollectionPanel collection={"nowhere"}/></Page>);
        expect(await screen.findByText(/Collection "nowhere" not found/)).toBeTruthy();
    });
});

describe("a panel's toolbar", () => {
    it("is the full toolbar by default", async () => {
        render(<Page><CollectionPanel collection={tasks} viewMode={"table"}/></Page>);
        expect(await screen.findByText("Write the plan")).toBeTruthy();
        expect(screen.getByPlaceholderText("Search")).toBeTruthy();
        expect(screen.getByRole("button", { name: /add task/i })).toBeTruthy();
    });


    it("is the full toolbar for \"full\", none for \"none\"", async () => {
        const { unmount } = render(<Page><CollectionPanel collection={tasks} viewMode={"table"} toolbar={"full"}/></Page>);
        expect(await screen.findByText("Write the plan")).toBeTruthy();
        expect(screen.getByPlaceholderText("Search")).toBeTruthy();
        expect(screen.getByRole("button", { name: /^filters?$/i })).toBeTruthy();
        unmount();
        render(<Page><CollectionPanel collection={tasks} viewMode={"table"} toolbar={"none"}/></Page>);
        expect(await screen.findByText("Write the plan")).toBeTruthy();
        expect(screen.queryByPlaceholderText("Search")).toBeNull();
        expect(screen.queryByText("none")).toBeNull();
    });

    it("is search, the view switch and New for \"compact\", without the filters", async () => {
        render(<Page><CollectionPanel collection={tasks} viewMode={"table"} toolbar={"compact"}/></Page>);
        expect(await screen.findByText("Write the plan")).toBeTruthy();
        expect(screen.getByPlaceholderText("Search")).toBeTruthy();
        expect(screen.getByRole("button", { name: /add task/i })).toBeTruthy();
        expect(screen.getByRole("button", { name: /^table$/i })).toBeTruthy();
        expect(screen.queryByRole("button", { name: /^filters?$/i })).toBeNull();
        expect(screen.queryByText("compact")).toBeNull();
    });

    it("holds only the pieces it is composed of", async () => {
        render(<Page>
            <CollectionPanel collection={tasks} viewMode={"table"}
                toolbar={<CollectionToolbar end={<CollectionAddButton/>}/>}/>
        </Page>);
        expect(await screen.findByText("Write the plan")).toBeTruthy();
        expect(screen.getByRole("button", { name: /add task/i })).toBeTruthy();
        expect(screen.queryByPlaceholderText("Search")).toBeNull();
    });

    it("pieces search the view they are drawn in", async () => {
        const searches: (string | undefined)[] = [];
        const searching: DataDriver = {
            ...driver,
            fetchCollection: async (props) => {
                searches.push(props.searchString);
                return rows;
            }
        };
        render(
            <Rebase authController={authController} storageSource={{} as never}
                dataSources={[{ key: "(default)", engine: "postgres", driver: searching }]}>
                <BrowserRouter>
                    <CollectionPanel collection={tasks} viewMode={"table"}
                        toolbar={<CollectionToolbar start={<CollectionSearchBar/>}/>}/>
                </BrowserRouter>
            </Rebase>
        );
        expect(await screen.findByText("Write the plan")).toBeTruthy();
        fireEvent.change(screen.getByPlaceholderText("Search"), { target: { value: "ship" } });
        await waitFor(() => expect(searches).toContain("ship"));
    });

    it("pieces say where they belong when drawn outside a view", () => {
        const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
        expect(() => render(<CollectionSearchBar/>)).toThrow(/CollectionSearchBar must be drawn inside a collection view/);
        error.mockRestore();
    });
});

describe("a panel's onRowClick", () => {
    it("receives the clicked row, and nothing opens", async () => {
        const clicked: Row[] = [];
        render(<Page><CollectionPanel collection={tasks} viewMode={"table"} collectionOverrides={{ inlineEditing: false }}
            onRowClick={(row) => clicked.push(row)}/></Page>);
        fireEvent.click(await screen.findByText("Write the plan"));
        await waitFor(() => expect(clicked).toHaveLength(1));
        expect(clicked[0]).toEqual(expect.objectContaining({ id: "t1", title: "Write the plan" }));
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("receives the row as the server sends it, as useRows reads it", async () => {
        const dated = {
            ...tasks,
            properties: {
                ...tasks.properties,
                due: { type: "date", name: "Due", columnType: "date" },
                updatedAt: { type: "date", name: "Updated" }
            }
        } as AdminCollection;
        rows = [{ id: "t1", title: "Write the plan", status: "todo", due: "2026-11-08", updatedAt: "2026-11-08T09:30:00.000Z" }];
        const clicked: Row[] = [];
        render(<Page><CollectionPanel collection={dated} viewMode={"cards"} onRowClick={(row) => clicked.push(row)}/></Page>);
        fireEvent.click(await screen.findByText("Write the plan"));
        await waitFor(() => expect(clicked).toHaveLength(1));
        // The view drew Dates; the app gets back the strings the row held.
        expect(clicked[0]).toEqual(expect.objectContaining({ due: "2026-11-08", updatedAt: "2026-11-08T09:30:00.000Z" }));
    });

    it("receives the row a table's edit action opens", async () => {
        const clicked: Row[] = [];
        render(<Page><CollectionPanel collection={tasks} viewMode={"table"} onRowClick={(row) => clicked.push(row)}/></Page>);
        expect(await screen.findByText("Write the plan")).toBeTruthy();
        fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
        await waitFor(() => expect(clicked.map(row => row.id)).toEqual(["t1"]));
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("receives the clicked card too", async () => {
        const clicked: Row[] = [];
        render(<Page><CollectionPanel collection={tasks} viewMode={"cards"} onRowClick={(row) => clicked.push(row)}/></Page>);
        fireEvent.click(await screen.findByText("Ship it"));
        await waitFor(() => expect(clicked.map(row => row.id)).toEqual(["t2"]));
        expect(screen.queryByRole("dialog")).toBeNull();
    });
});

describe("a collection's entityActions", () => {
    function withApprove(onClick: (row: Record<string, unknown> | undefined) => void): AdminCollection {
        const approve: EntityAction = {
            key: "approve",
            name: "Approve",
            collapsed: false,
            onClick: ({ row }) => onClick(row)
        };
        return { ...tasks, entityActions: [approve] } as AdminCollection;
    }

    it("are on every card, and run without opening the record", async () => {
        const approved: unknown[] = [];
        render(<Page><CollectionPanel collection={withApprove(e => approved.push(e?.id))} viewMode={"cards"}/></Page>);
        expect(await screen.findByText("Write the plan")).toBeTruthy();
        const buttons = await screen.findAllByRole("button", { name: "Approve" });
        expect(buttons).toHaveLength(2);
        fireEvent.click(buttons[1]);
        expect(approved).toEqual(["t2"]);
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("are on every kanban card", async () => {
        const approved: unknown[] = [];
        render(<Page><CollectionPanel collection={withApprove(e => approved.push(e?.id))} viewMode={"kanban"}/></Page>);
        expect(await screen.findByText("Write the plan")).toBeTruthy();
        const buttons = await screen.findAllByRole("button", { name: "Approve" });
        expect(buttons).toHaveLength(2);
        fireEvent.click(buttons[0]);
        expect(approved).toHaveLength(1);
        expect(screen.queryByRole("dialog")).toBeNull();
    });
});

describe("a panel's rowActions", () => {
    function shipButton(shipped: string[]) {
        return function ShipButton(row: Record<string, unknown>, id: string) {
            return <button onClick={() => shipped.push(`${id}:${String(row.title)}`)}>Ship</button>;
        };
    }

    it("are the table's last column, on every row, and a click on one does not open the record", async () => {
        const shipped: string[] = [];
        render(<Page><CollectionPanel collection={tasks} viewMode={"table"} fields={["title", "status"]} rowActions={shipButton(shipped)}/></Page>);
        expect(await screen.findByText("Write the plan")).toBeTruthy();
        const buttons = await screen.findAllByRole("button", { name: "Ship" });
        expect(buttons).toHaveLength(2);
        fireEvent.click(buttons[1]);
        expect(shipped).toEqual(["t2:Ship it"]);
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("are on every list row", async () => {
        const shipped: string[] = [];
        render(<Page><CollectionPanel collection={tasks} viewMode={"list"} rowActions={shipButton(shipped)}/></Page>);
        expect(await screen.findByText("Write the plan")).toBeTruthy();
        const buttons = await screen.findAllByRole("button", { name: "Ship" });
        expect(buttons).toHaveLength(2);
        fireEvent.click(buttons[0]);
        expect(shipped).toHaveLength(1);
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("are on every card and kanban card", async () => {
        for (const viewMode of ["cards", "kanban"] as const) {
            const shipped: string[] = [];
            const { unmount } = render(<Page><CollectionPanel collection={tasks} viewMode={viewMode} rowActions={shipButton(shipped)}/></Page>);
            expect(await screen.findByText("Write the plan")).toBeTruthy();
            const buttons = await screen.findAllByRole("button", { name: "Ship" });
            expect(buttons).toHaveLength(2);
            fireEvent.click(buttons[0]);
            expect(shipped).toHaveLength(1);
            unmount();
        }
    });

    it("draw with the caller's latest state", async () => {
        function Desk() {
            const [label, setLabel] = React.useState("Ship");
            return <>
                <button onClick={() => setLabel("Shipping…")}>Busy</button>
                <CollectionPanel collection={tasks} viewMode={"list"} rowActions={() => <span>{label}</span>}/>
            </>;
        }
        render(<Page><Desk/></Page>);
        expect(await screen.findAllByText("Ship")).toHaveLength(2);
        fireEvent.click(screen.getByText("Busy"));
        expect(await screen.findAllByText("Shipping…")).toHaveLength(2);
    });
});

describe("a panel's orderBy", () => {
    it("is the order its rows are read in, written either way", async () => {
        for (const orderBy of ["priority:desc", ["priority", "desc"]] as const) {
            const reads = jest.spyOn(driver, "fetchCollection");
            const { unmount } = render(<Page><CollectionPanel collection={tasks} viewMode={"list"} orderBy={orderBy}/></Page>);
            expect(await screen.findByText("Write the plan")).toBeTruthy();
            const orders = reads.mock.calls.map(([props]) => JSON.stringify(props.orderBy));
            expect(orders.some(order => order.includes("priority") && order.includes("desc"))).toBe(true);
            reads.mockRestore();
            unmount();
        }
    });
});

describe("a panel named by its collection", () => {
    it("takes the name of a collection the scope registers", async () => {
        render(<Page><CollectionsProvider collections={[tasks]}><CollectionPanel collection={"tasks"} viewMode={"list"}/></CollectionsProvider></Page>);
        expect(await screen.findByText("Write the plan")).toBeTruthy();
    });
});

describe("a panel's view mode", () => {
    function viewShown(): "table" | "other" {
        return document.getElementById("virtual-table") ? "table" : "other";
    }

    it("is the caller's at mount, over the one the person saved", async () => {
        render(<Page persistence={savedConfig({ tasks: { defaultViewMode: "table" } })}>
            <CollectionPanel collection={tasks} viewMode={"list"}/>
        </Page>);
        expect(await screen.findByText("Write the plan")).toBeTruthy();
        expect(viewShown()).toBe("other");
    });

    it("is the caller's at mount, over the URL's", async () => {
        window.history.replaceState(null, "", "/my-page?__view=list");
        render(<Page><CollectionPanel collection={tasks} viewMode={"table"} updateUrl={true}/></Page>);
        expect(await screen.findByText("Write the plan")).toBeTruthy();
        expect(viewShown()).toBe("table");
    });

    it("neither reads nor writes the URL's __view without updateUrl", async () => {
        window.history.replaceState(null, "", "/my-page?__view=list");
        render(<Page persistence={savedConfig({ tasks: { defaultViewMode: "cards" } })}>
            <CollectionPanel collection={{ ...tasks, defaultViewMode: "table" } as AdminCollection}/>
        </Page>);
        expect(await screen.findByText("Write the plan")).toBeTruthy();
        // The saved mode, not the URL's.
        expect(viewShown()).toBe("other");
        expect(document.querySelector("[aria-hidden='true'].grid")).toBeTruthy();
        expect(window.location.search).toBe("?__view=list");
    });

    it("does not put the saved mode in the URL without updateUrl", async () => {
        render(<Page persistence={savedConfig({ tasks: { defaultViewMode: "cards" } })}>
            <CollectionPanel collection={{ ...tasks, defaultViewMode: "table" } as AdminCollection}/>
        </Page>);
        expect(await screen.findByText("Write the plan")).toBeTruthy();
        expect(window.location.search).toBe("");
    });

    it("loads a user config saved before, column order and all", async () => {
        const persistence = savedConfig({
            tasks: {
                defaultViewMode: "table",
                propertiesOrder: ["priority", "title"],
                properties: { title: { admin: { columnWidth: 320 } } }
            }
        });
        render(<Page persistence={persistence}><CollectionPanel collection={tasks}/></Page>);
        expect(await screen.findByText("Write the plan")).toBeTruthy();
        // A saved order reorders and keeps the rest: nothing vanishes.
        expect(tableHeaders().filter(name => name !== "Id")).toEqual(["Priority", "Title", "Status", "Notes"]);
    });
});

describe("a panel's title", () => {
    it("draws the list's own title by default", async () => {
        render(<Page><CollectionPanel collection={tasks} viewMode={"list"}/></Page>);
        expect(await screen.findByText("Write the plan")).toBeTruthy();
        expect(screen.getByRole("heading", { level: 4, name: "Tasks" })).toBeTruthy();
    });

    it("removes the list's title too when false", async () => {
        render(<Page><CollectionPanel collection={tasks} viewMode={"list"} title={false}/></Page>);
        expect(await screen.findByText("Write the plan")).toBeTruthy();
        expect(screen.queryByRole("heading", { level: 4, name: "Tasks" })).toBeNull();
        expect(screen.queryByText("Tasks")).toBeNull();
    });
});

describe("a panel's size", () => {
    it("is its rows when its parent gives it no height", async () => {
        render(<Page><CollectionPanel collection={tasks} viewMode={"table"}/></Page>);
        expect(await screen.findByText("Write the plan")).toBeTruthy();
        const table = document.getElementById("virtual-table")!;
        const root = table.closest("[style*='max-height']") as HTMLElement;
        // A header and two rows, not the 900px the table was measured at.
        expect(parseFloat(root.style.height)).toBeGreaterThan(0);
        expect(parseFloat(root.style.height)).toBeLessThan(300);
    });
});

describe("a panel's layout", () => {
    const realRect = HTMLElement.prototype.getBoundingClientRect;
    const realMatchMedia = window.matchMedia;

    function measureViewsAt(width: number) {
        HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
            const rect = realRect.call(this);
            if (!this.className.includes("@container/collection")) return rect;
            return { x: 0, y: 0, top: 0, left: 0, bottom: 600, right: width, height: 600, width, toJSON: () => ({}) };
        };
    }

    beforeEach(() => {
        // The window is wide.
        window.matchMedia = ((query: string) => ({
            matches: true,
            media: query,
            onchange: null,
            addListener: () => undefined,
            removeListener: () => undefined,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
            dispatchEvent: () => false
        })) as typeof window.matchMedia;
    });
    afterEach(() => {
        HTMLElement.prototype.getBoundingClientRect = realRect;
        window.matchMedia = realMatchMedia;
    });

    it("follows the view's own width, not the window's", async () => {
        measureViewsAt(600);
        render(<Page><CollectionPanel collection={tasks} viewMode={"table"}/></Page>);
        expect(await screen.findByText("Write the plan")).toBeTruthy();
        // Icon-only in a narrow view, in a wide window.
        await waitFor(() => expect(screen.getByRole("button", { name: /add task/i }).textContent).toBe(""));
    });

    it("is labelled in a wide view", async () => {
        measureViewsAt(1280);
        render(<Page><CollectionPanel collection={tasks} viewMode={"table"}/></Page>);
        expect(await screen.findByText("Write the plan")).toBeTruthy();
        await waitFor(() => expect(screen.getByRole("button", { name: /add task/i }).textContent).toMatch(/add task/i));
    });
});

describe("the plugin slots of a collection view", () => {
    function marker(name: string): AnySlotContribution {
        return {
            slot: name,
            Component: () => <span data-testid={`slot:${name}`}/>
        } as AnySlotContribution;
    }

    it("are all drawn: the toolbar's, the table's and a row's", async () => {
        const slots = ["collection.toolbar", "collection.actions", "collection.actions.start", "collection.add-column", "entity.row.actions"]
            .map(marker);
        render(<Page slots={slots}><CollectionPanel collection={tasks} viewMode={"table"}/></Page>);
        expect(await screen.findByText("Write the plan")).toBeTruthy();
        for (const name of ["collection.toolbar", "collection.actions", "collection.actions.start", "collection.add-column"]) {
            expect(screen.getAllByTestId(`slot:${name}`).length).toBeGreaterThan(0);
        }
        expect(screen.getAllByTestId("slot:entity.row.actions")).toHaveLength(2);
    });

    it("draw the list's widgets", async () => {
        render(<Page slots={[marker("collection.widgets")]}><CollectionPanel collection={tasks} viewMode={"list"}/></Page>);
        expect(await screen.findByText("Write the plan")).toBeTruthy();
        expect(screen.getByTestId("slot:collection.widgets")).toBeTruthy();
    });

    it("draw the empty state of an empty collection", async () => {
        rows = [];
        render(<Page slots={[marker("collection.empty-state")]}><CollectionPanel collection={tasks} viewMode={"table"}/></Page>);
        expect(await screen.findByTestId("slot:collection.empty-state")).toBeTruthy();
    });

    it("draw the error view of a collection that failed to load", async () => {
        const failing: DataDriver = { ...driver, fetchCollection: async () => { throw new Error("boom"); } };
        render(
            <Rebase authController={authController} storageSource={{} as never}
                slots={[marker("collection.error")]}
                dataSources={[{ key: "(default)", engine: "postgres", driver: failing }]}>
                <BrowserRouter>
                    <CollectionPanel collection={tasks} viewMode={"table"}/>
                </BrowserRouter>
            </Rebase>
        );
        expect(await screen.findByTestId("slot:collection.error")).toBeTruthy();
    });

    it("keep the toolbar's when the toolbar is composed of the default", async () => {
        render(<Page slots={[marker("collection.toolbar")]}>
            <CollectionPanel collection={tasks} viewMode={"table"} toolbar={<CollectionToolbar/>}/>
        </Page>);
        expect(await screen.findByTestId("slot:collection.toolbar")).toBeTruthy();
    });
});
