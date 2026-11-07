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
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { BrowserRouter } from "react-router";
import type { DataDriver, Entity } from "@rebasepro/types";
import type { AdminCollection, EntityAction, UserConfigurationPersistence } from "@rebasepro/cms-types";
import { Rebase } from "@rebasepro/app";
import {
    CollectionAddButton,
    CollectionPanel,
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

const driver: DataDriver = {
    key: "memory",
    fetchCollection: async () => rows,
    fetchOne: async ({ id }) => rows.find(r => String(r.id) === String(id)),
    save: async ({ values }) => values,
    delete: async () => undefined,
    count: async () => rows.length
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

function Page({ children, persistence }: { children: React.ReactNode, persistence?: UserConfigurationPersistence }) {
    return (
        <Rebase authController={authController} storageSource={{} as never}
            userConfigPersistence={persistence}
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

    it("leave the column order the user saved alone", async () => {
        const persistence = savedConfig({ tasks: { propertiesOrder: ["notes", "title", "status", "priority"] } });
        render(<Page persistence={persistence}><CollectionPanel collection={tasks} viewMode={"table"} fields={["title", "status"]}/></Page>);
        expect(await screen.findByText("Write the plan")).toBeTruthy();
        expect(tableHeaders().filter(name => name !== "Id")).toEqual(["Title", "Status"]);
        expect(persistence.modified.filter(([, config]) => "propertiesOrder" in config)).toEqual([]);
    });
});

describe("a panel's toolbar", () => {
    it("is the full toolbar by default", async () => {
        render(<Page><CollectionPanel collection={tasks} viewMode={"table"}/></Page>);
        expect(await screen.findByText("Write the plan")).toBeTruthy();
        expect(screen.getByPlaceholderText("Search")).toBeTruthy();
        expect(screen.getByRole("button", { name: /add task/i })).toBeTruthy();
    });

    it("is not drawn when it is null", async () => {
        render(<Page><CollectionPanel collection={tasks} viewMode={"table"} toolbar={null}/></Page>);
        expect(await screen.findByText("Write the plan")).toBeTruthy();
        expect(screen.queryByPlaceholderText("Search")).toBeNull();
        expect(screen.queryByRole("button", { name: /add task/i })).toBeNull();
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

describe("a panel's onEntityClick", () => {
    it("receives the clicked row, and nothing opens", async () => {
        const clicked: Entity[] = [];
        render(<Page><CollectionPanel collection={tasks} viewMode={"table"} collectionOverrides={{ inlineEditing: false }}
            onEntityClick={(entity) => clicked.push(entity)}/></Page>);
        fireEvent.click(await screen.findByText("Write the plan"));
        await waitFor(() => expect(clicked).toHaveLength(1));
        expect(clicked[0]).toEqual(expect.objectContaining({ id: "t1", values: expect.objectContaining({ title: "Write the plan" }) }));
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("receives the row a table's edit action opens", async () => {
        const clicked: Entity[] = [];
        render(<Page><CollectionPanel collection={tasks} viewMode={"table"} onEntityClick={(entity) => clicked.push(entity)}/></Page>);
        expect(await screen.findByText("Write the plan")).toBeTruthy();
        fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
        await waitFor(() => expect(clicked.map(e => e.id)).toEqual(["t1"]));
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("receives the clicked card too", async () => {
        const clicked: Entity[] = [];
        render(<Page><CollectionPanel collection={tasks} viewMode={"cards"} onEntityClick={(entity) => clicked.push(entity)}/></Page>);
        fireEvent.click(await screen.findByText("Ship it"));
        await waitFor(() => expect(clicked.map(e => e.id)).toEqual(["t2"]));
        expect(screen.queryByRole("dialog")).toBeNull();
    });
});

describe("a collection's entityActions", () => {
    function withApprove(onClick: (entity: Entity | undefined) => void): AdminCollection {
        const approve: EntityAction = {
            key: "approve",
            name: "Approve",
            collapsed: false,
            onClick: ({ entity }) => onClick(entity)
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
