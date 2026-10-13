/**
 * @jest-environment jsdom
 */
/**
 * One collection's table, or one record's form, in a page of the host app.
 *
 * `CollectionPanel` and the record form worked only inside the whole CMS:
 * `<Rebase>` → `<RebaseCMS collections>` → `<RebaseNavigation>` under a React
 * Router *data* router, plus `<SideDialogs/>`. Anywhere else the panel said
 * "Collection not found" and the form's hooks threw. Here they are rendered the
 * way an app that already has its own pages would: inside `<Rebase>` and a
 * plain `<BrowserRouter>`, with the collection handed over as a value, and
 * nothing else.
 */
import React from "react";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { BrowserRouter } from "react-router";
import type { DataDriver } from "@rebasepro/types";
import type { AdminCollection } from "@rebasepro/cms-types";
import { Rebase } from "@rebasepro/app";
import { CollectionPanel, CollectionsProvider, EntityFormPanel } from "@rebasepro/cms";

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

const posts: AdminCollection = {
    slug: "posts",
    name: "Posts",
    singularName: "Post",
    table: "posts",
    properties: {
        id: { type: "string", name: "Id", isId: "uuid" },
        title: { type: "string", name: "Title" }
    }
} as AdminCollection;

const authors: AdminCollection = {
    slug: "authors",
    name: "Authors",
    table: "authors",
    properties: {
        handle: { type: "string", name: "Handle", isId: true },
        name: { type: "string", name: "Name" }
    }
} as AdminCollection;

type Row = Record<string, unknown>;
let rows: Record<string, Row[]>;
const saves: { path: string, values: Row }[] = [];

function keyOf(path: string): string {
    return path === "authors" ? "handle" : "id";
}

const driver: DataDriver = {
    key: "memory",
    fetchCollection: async ({ path }) => rows[path] ?? [],
    fetchOne: async ({ path, id }) => (rows[path] ?? []).find(r => String(r[keyOf(path)]) === String(id)),
    save: async ({ path, values, id: savedId }) => {
        saves.push({ path, values: { ...values } });
        const key = keyOf(path);
        const id = savedId ?? values[key];
        const saved = { ...(rows[path] ?? []).find(r => String(r[key]) === String(id)), ...values, [key]: id };
        rows[path] = [...(rows[path] ?? []).filter(r => String(r[key]) !== String(id)), saved];
        return saved;
    },
    delete: async () => undefined,
    count: async ({ path }) => (rows[path] ?? []).length,
    // Unique when no other stored row holds the value.
    checkUniqueField: async (path, name, value, id) => !(rows[path] ?? [])
        .some(row => row[name] === value && String(row[keyOf(path)]) !== String(id))
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

function Page({ children }: { children: React.ReactNode }) {
    return (
        <Rebase authController={authController} storageSource={{} as never}
            dataSources={[{ key: "(default)", engine: "postgres", driver }]}>
            <BrowserRouter>
                <main data-testid={"host-page"}>{children}</main>
            </BrowserRouter>
        </Rebase>
    );
}

beforeEach(() => {
    rows = {
        posts: [{ id: "p1", title: "Hello world" }, { id: "p2", title: "Second post" }],
        authors: [{ handle: "ada", name: "Ada Lovelace" }]
    };
    saves.length = 0;
    window.history.replaceState(null, "", "/my-page");
});

describe("a collection's table in a page of the host app", () => {
    it("renders the rows, without RebaseCMS, RebaseNavigation or a data router", async () => {
        render(<Page><CollectionPanel collection={posts}/></Page>);

        expect(await screen.findByText("Hello world")).toBeTruthy();
        expect(screen.getByText("Second post")).toBeTruthy();
    });

    it("opens a row's record over the page, leaving the URL alone", async () => {
        render(<Page><CollectionPanel collection={posts}/></Page>);

        fireEvent.click(await screen.findByText("Hello world"));

        const dialog = await screen.findByRole("dialog");
        await waitFor(() => expect(within(dialog).getByDisplayValue("Hello world")).toBeTruthy());
        expect(window.location.pathname).toBe("/my-page");
        expect(screen.getByTestId("host-page")).toBeTruthy();
    });

    it("gives the rows of every scope on the page their address", async () => {
        render(
            <Page>
                <CollectionsProvider collections={[posts, authors]}>
                    <CollectionPanel path={"authors"}/>
                </CollectionsProvider>
                <CollectionPanel collection={posts}/>
            </Page>
        );
        expect(await screen.findByText("Hello world")).toBeTruthy();

        // The author's key is `handle`, known only to the first scope: a row
        // with no address opens nothing.
        fireEvent.click(await screen.findByText("Ada Lovelace"));

        const dialog = await screen.findByRole("dialog");
        await waitFor(() => expect(within(dialog).getByDisplayValue("Ada Lovelace")).toBeTruthy());
    });
});

describe("one record's form in a page of the host app", () => {
    it("loads the record, and saves an edit through the data layer", async () => {
        const onSaved = jest.fn();
        render(<Page><EntityFormPanel collection={posts} entityId={"p1"} onSaved={onSaved}/></Page>);

        const title = await screen.findByDisplayValue("Hello world");
        await act(async () => {
            fireEvent.change(title, { target: { value: "Hello again" } });
        });
        fireEvent.click(screen.getByRole("button", { name: /save/i }));

        await waitFor(() => expect(onSaved).toHaveBeenCalled());
        // Once per save, not once from the binding and again from the form.
        expect(onSaved).toHaveBeenCalledTimes(1);
        expect(saves).toEqual([expect.objectContaining({ path: "posts", values: expect.objectContaining({ title: "Hello again" }) })]);
        expect(window.location.pathname).toBe("/my-page");
    });

    it("creates a record when given no id", async () => {
        const onSaved = jest.fn();
        render(<Page><EntityFormPanel collection={posts} onSaved={onSaved}/></Page>);

        const title = await screen.findByRole("textbox", { name: "Title" });
        await act(async () => {
            fireEvent.change(title, { target: { value: "A new post" } });
        });
        fireEvent.click(screen.getByRole("button", { name: /create/i }));

        await waitFor(() => expect(onSaved).toHaveBeenCalled());
        expect(onSaved).toHaveBeenCalledTimes(1);
        expect(saves).toEqual([expect.objectContaining({ path: "posts", values: expect.objectContaining({ title: "A new post" }) })]);
    });
});
