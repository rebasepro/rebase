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
import type { AdminCollection, PluginFormActionProps } from "@rebasepro/cms-types";
import { Rebase, RlsSimulationContext } from "@rebasepro/app";
import type { RlsSimulationController } from "@rebasepro/app";
import { CollectionPanel, CollectionsProvider, EntityFormPanel, RecordForm, FormField } from "@rebasepro/cms";
import { resetDeprecationWarningsForTests } from "@rebasepro/common";
import { clearFetchCache } from "../../../app/src/hooks/data/useFetch";
import { fakeStorageSource } from "../helpers/fakes";
import { NO_TABLES } from "../helpers/tables";

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

const comments: AdminCollection = {
    slug: "comments",
    name: "Comments",
    table: "comments",
    properties: {
        id: { type: "string", name: "Id", isId: true },
        body: { type: "string", name: "Body" }
    }
} as AdminCollection;

const postsWithComments: AdminCollection = { ...posts, childCollections: () => [comments] } as AdminCollection;

type Row = Record<string, unknown>;
let rows: Record<string, Row[]>;
const saves: { path: string, id?: unknown, values: Row }[] = [];

function keyOf(path: string): string {
    return path === "authors" ? "handle" : "id";
}

const driver: DataDriver = {
    key: "memory",
    fetchCollection: async ({ path }) => rows[path] ?? [],
    fetchOne: async ({ path, id }) => (rows[path] ?? []).find(r => String(r[keyOf(path)]) === String(id)),
    save: async ({ path, values, id: savedId }) => {
        saves.push({ path, id: savedId, values: { ...values } });
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
};

function Page({ children, dataDriver = driver }: { children: React.ReactNode, dataDriver?: DataDriver }) {
    return (
        <Rebase authController={authController} storageSource={fakeStorageSource()}
            dataSources={[{ key: "(default)", engine: "postgres", driver: dataDriver }]}>
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
    // A record a form read or saved stays in the record cache for the rest
    // of the session, as signing out empties it: each test is a new session.
    clearFetchCache();
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
                <CollectionsProvider externalCollections={[posts, authors]} tables={NO_TABLES}>
                    <CollectionPanel collection={"authors"}/>
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

    it("applies its overrides to a collection the scope registers", async () => {
        // The view draws the registry's copy of a registered collection; the
        // panel's filter used to be spread onto props it never read.
        const filters: unknown[] = [];
        const filtering: DataDriver = {
            ...driver,
            fetchCollection: async (props) => {
                filters.push(props.filter);
                return (rows[props.path] ?? []).filter(row => !props.filter?.title || row.title === props.filter.title[1]);
            }
        };
        render(
            <Page dataDriver={filtering}>
                <CollectionsProvider externalCollections={[posts]} tables={NO_TABLES}>
                    <CollectionPanel collection={"posts"} collectionOverrides={{ fixedFilter: { title: ["==", "Second post"] } }}/>
                </CollectionsProvider>
            </Page>
        );

        expect(await screen.findByText("Second post")).toBeTruthy();
        expect(screen.queryByText("Hello world")).toBeNull();
        expect(filters).toContainEqual({ title: ["==", "Second post"] });
    });
});

describe("one record's form in a page of the host app", () => {
    it("loads the record, and saves an edit through the data layer", async () => {
        const onSaved = jest.fn();
        render(<Page><RecordForm collection={posts} id={"p1"} onSaved={onSaved}/></Page>);

        const title = await screen.findByDisplayValue("Hello world");
        await act(async () => {
            fireEvent.change(title, { target: { value: "Hello again" } });
        });
        fireEvent.click(screen.getByRole("button", { name: /save/i }));

        await waitFor(() => expect(onSaved).toHaveBeenCalled());
        // Once per save, not once from the binding and again from the form.
        expect(onSaved).toHaveBeenCalledTimes(1);
        // Handed the saved record as the server sends the row, and its id.
        expect(onSaved.mock.calls[0][0]).toMatchObject({ id: "p1", row: expect.objectContaining({ id: "p1", title: "Hello again" }) });
        expect(saves).toEqual([expect.objectContaining({ path: "posts", values: expect.objectContaining({ title: "Hello again" }) })]);
        expect(window.location.pathname).toBe("/my-page");
    });

    it("takes the collection by name, from the scope that registers it, and saves through it", async () => {
        const onSaved = jest.fn();
        render(<Page>
            <CollectionsProvider externalCollections={[posts]} tables={NO_TABLES}>
                <RecordForm collection={"posts"} id={"p1"} onSaved={onSaved}/>
            </CollectionsProvider>
        </Page>);

        const title = await screen.findByDisplayValue("Hello world");
        await act(async () => {
            fireEvent.change(title, { target: { value: "By path" } });
        });
        fireEvent.click(screen.getByRole("button", { name: /save/i }));

        await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
        expect(saves).toEqual([expect.objectContaining({ path: "posts", values: expect.objectContaining({ title: "By path" }) })]);
    });


    it("named, never mounts its existing record as a new one while the scope registers it", async () => {
        // Until the scope has registered "posts" the form has no collection,
        // and the record read reported p1 absent: the form mounted as a "new"
        // one for an id that exists, and Save would have created it again.
        const statuses: string[] = [];
        render(<Page>
            <CollectionsProvider externalCollections={[posts]} tables={NO_TABLES}>
                <RecordForm collection={"posts"} id={"p1"}
                    formProps={{ onFormContextReady: (context) => { statuses.push(String(context.status)); } }}/>
            </CollectionsProvider>
        </Page>);

        expect(await screen.findByDisplayValue("Hello world")).toBeTruthy();
        expect(statuses).toContain("existing");
        expect(statuses).not.toContain("new");
    });

    it("compact, draws medium controls and no record metadata", async () => {
        const { unmount } = render(<Page><RecordForm collection={posts} id={"p1"}/></Page>);
        const large = await screen.findByDisplayValue("Hello world");
        expect(large.className).toContain("min-h-[48px]");
        expect(screen.queryAllByText("Record").length).toBeGreaterThan(0);
        unmount();

        render(<Page><RecordForm collection={posts} id={"p1"} compact/></Page>);
        const medium = await screen.findByDisplayValue("Hello world");
        expect(medium.className).toContain("min-h-[40px]");
        expect(medium.className).not.toContain("min-h-[48px]");
        expect(screen.queryAllByText("Record")).toHaveLength(0);
    });


    it("is still drawn under its old name, EntityFormPanel, which warns once", async () => {
        resetDeprecationWarningsForTests();
        const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
        render(<Page><EntityFormPanel collection={posts} id={"p1"}/><EntityFormPanel collection={posts} id={"p2"}/></Page>);
        expect(await screen.findByDisplayValue("Hello world")).toBeTruthy();
        expect(warn.mock.calls.filter(([message]) => String(message).includes("`EntityFormPanel` is now `RecordForm`"))).toHaveLength(1);
        warn.mockRestore();
    });

    it("EntityFormPanel given entityId loads and saves that record", async () => {
        // 0.28's EntityFormPanel took `entityId`. Untyped code still passing
        // it got an empty create form, and Save inserted a duplicate.
        resetDeprecationWarningsForTests();
        const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
        const onSaved = jest.fn();
        const legacy = { collection: posts, entityId: "p1", onSaved };
        render(<Page><EntityFormPanel {...legacy}/></Page>);

        const title = await screen.findByDisplayValue("Hello world");
        await act(async () => {
            fireEvent.change(title, { target: { value: "Edited under the old name" } });
        });
        fireEvent.click(screen.getByRole("button", { name: /save/i }));

        await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
        expect(rows.posts).toHaveLength(2);
        expect(rows.posts.find(r => r.id === "p1")).toEqual(expect.objectContaining({ title: "Edited under the old name" }));
        // 0.28 handed onSaved the saved record as `entity`; it still does, and warns.
        const params = onSaved.mock.calls[0][0] as { id: string, entity: { id: unknown, values: Row } };
        expect(params.id).toBe("p1");
        expect(params.entity).toEqual(expect.objectContaining({ id: "p1", values: expect.objectContaining({ title: "Edited under the old name" }) }));
        const messages = warn.mock.calls.map(([message]) => String(message));
        expect(messages.filter(m => m.includes("`entityId`"))).toHaveLength(1);
        expect(messages.filter(m => m.includes("`entity`"))).toHaveLength(1);
        warn.mockRestore();
    });

    it("says so when no scope registers the path it names", async () => {
        render(<Page><RecordForm collection={"nowhere"} id={"p1"}/></Page>);
        await waitFor(() => expect(screen.getByText("Entity not found")).toBeTruthy());
    });

    it("creates the record under its id when no record has that id yet", async () => {
        // A record kept at a known key — a site's settings, a user's profile
        // keyed by their uid — said "not found" until something seeded it.
        const onSaved = jest.fn();
        render(<Page><RecordForm collection={posts} id={"site"} onSaved={onSaved}
            defaultValues={{ title: "Untitled site" }}/></Page>);

        const title = await screen.findByDisplayValue("Untitled site");
        await act(async () => {
            fireEvent.change(title, { target: { value: "My site" } });
        });
        fireEvent.click(screen.getByRole("button", { name: /create/i }));

        await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
        expect(rows.posts.find(r => r.id === "site")).toEqual(expect.objectContaining({ title: "My site" }));

        // From then on the form edits it, under the same id.
        const saved = await screen.findByDisplayValue("My site");
        await act(async () => {
            fireEvent.change(saved, { target: { value: "My site, renamed" } });
        });
        fireEvent.click(screen.getByRole("button", { name: /save/i }));
        await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(2));
        expect(rows.posts.filter(r => r.id === "site")).toEqual([expect.objectContaining({ title: "My site, renamed" })]);
        expect(rows.posts).toHaveLength(3);
    });

    it("saves the record it shows after its id changes", async () => {
        // A host route /posts/:id moving from p1 to p2 re-renders the panel
        // with another id and no remount. The form showed p2 and saved into p1.
        const { rerender } = render(<Page><RecordForm collection={posts} id={"p1"}/></Page>);
        await screen.findByDisplayValue("Hello world");

        rerender(<Page><RecordForm collection={posts} id={"p2"}/></Page>);
        const title = await screen.findByDisplayValue("Second post");
        await act(async () => {
            fireEvent.change(title, { target: { value: "Second post, edited" } });
        });
        fireEvent.click(screen.getByRole("button", { name: /save/i }));

        await waitFor(() => expect(saves).toHaveLength(1));
        expect(saves[0]).toEqual(expect.objectContaining({ path: "posts", id: "p2" }));
        expect(rows.posts.find(r => r.id === "p1")).toEqual(expect.objectContaining({ title: "Hello world" }));
        expect(rows.posts.find(r => r.id === "p2")).toEqual(expect.objectContaining({ title: "Second post, edited" }));
    });

    it("loads a subcollection's record by its full path, under a scope that holds its parent", async () => {
        // The documented `path` of a subcollection record. The panel compared
        // the scope's top-level slugs to the whole path, mounted a scope of
        // its own holding only `comments`, and said "Entity not found".
        rows["posts/p1/comments"] = [{ id: "c1", body: "Nice post" }];
        render(
            <Page>
                <CollectionsProvider externalCollections={[postsWithComments]} tables={NO_TABLES}>
                    <RecordForm collection={comments} path={"posts/p1/comments"} id={"c1"}/>
                </CollectionsProvider>
            </Page>
        );
        expect(await screen.findByDisplayValue("Nice post")).toBeTruthy();
    });

    it("names its record to the form slots by `id`", async () => {
        const seen: PluginFormActionProps[] = [];
        render(
            <Rebase authController={authController} storageSource={fakeStorageSource()}
                slots={[{
                    slot: "form.before",
                    Component: (props: PluginFormActionProps) => {
                        seen.push(props);
                        return null;
                    }
                }]}
                dataSources={[{ key: "(default)", engine: "postgres", driver }]}>
                <BrowserRouter><RecordForm collection={posts} id={"p1"}/></BrowserRouter>
            </Rebase>
        );
        expect(await screen.findByDisplayValue("Hello world")).toBeTruthy();
        expect(seen[seen.length - 1]).toMatchObject({ id: "p1", path: "posts" });
        expect("entityId" in seen[seen.length - 1]).toBe(false);
    });

    it("offers no record to create where creating is not allowed", async () => {
        // The create-under-id form checked only canEdit, and only for an
        // existing record: while access was simulated (or insert was denied)
        // the record-to-create was editable and failed on the server.
        const simulating: RlsSimulationController = {
            available: true,
            simulation: { role: "customer" },
            label: null,
            setSimulation: () => undefined
        };
        render(
            <Page>
                <RlsSimulationContext.Provider value={simulating}>
                    <RecordForm collection={posts} id={"p1"}/>
                    <RecordForm collection={posts} id={"site"} defaultValues={{ title: "Untitled site" }}/>
                </RlsSimulationContext.Provider>
            </Page>
        );
        const existing = await screen.findByDisplayValue("Hello world");
        expect((existing as HTMLInputElement).disabled).toBe(true);
        const toCreate = await screen.findByDisplayValue("Untitled site");
        expect((toCreate as HTMLInputElement).disabled).toBe(true);
        expect((screen.getByRole("button", { name: /create/i }) as HTMLButtonElement).disabled).toBe(true);
    });

    it("creates a record when given no id", async () => {
        const onSaved = jest.fn();
        render(<Page><RecordForm collection={posts} onSaved={onSaved}/></Page>);

        const title = await screen.findByRole("textbox", { name: "Title" });
        await act(async () => {
            fireEvent.change(title, { target: { value: "A new post" } });
        });
        fireEvent.click(screen.getByRole("button", { name: /create/i }));

        await waitFor(() => expect(onSaved).toHaveBeenCalled());
        expect(onSaved).toHaveBeenCalledTimes(1);
        expect(saves).toEqual([expect.objectContaining({ path: "posts", values: expect.objectContaining({ title: "A new post" }) })]);
    });

    it("says when its record was deleted elsewhere, keeps what was typed, and saves it as a new record", async () => {
        // The live read stopped delivering the record. The form used to carry
        // on as if nothing happened: Save answered 404 and nothing said why.
        const listeners = new Map<string, (row: Row | null) => void>();
        const live: DataDriver = {
            ...driver,
            listenOne: ({ path, id, onUpdate }) => {
                listeners.set(`${path}/${id}`, onUpdate);
                onUpdate((rows[path] ?? []).find(r => String(r.id) === String(id)) ?? null);
                return () => listeners.delete(`${path}/${id}`);
            }
        };
        const onSaved = jest.fn();
        render(<Page dataDriver={live}><RecordForm collection={posts} id={"p1"} onSaved={onSaved}/></Page>);

        const title = await screen.findByDisplayValue("Hello world");
        await act(async () => {
            fireEvent.change(title, { target: { value: "Hello again" } });
        });
        expect(screen.queryByText(/deleted elsewhere/i)).toBeNull();

        await act(async () => {
            rows.posts = rows.posts.filter(r => r.id !== "p1");
            listeners.get("posts/p1")?.(null);
        });

        expect(await screen.findByText(/This record was deleted elsewhere/)).toBeTruthy();
        expect(screen.getByDisplayValue("Hello again")).toBeTruthy();

        fireEvent.click(screen.getByRole("button", { name: /save as new/i }));
        await waitFor(() => expect(screen.queryByText(/deleted elsewhere/i)).toBeNull());
        expect(screen.getByDisplayValue("Hello again")).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: /create/i }));

        await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
        expect(saves).toHaveLength(1);
        expect(saves[0].id).not.toBe("p1");
        expect(saves[0].values).toEqual(expect.objectContaining({ title: "Hello again" }));
    });
});

describe("one record's form, composed", () => {
    it("applies its overrides to a collection the scope registers", async () => {
        // The form draws the registry's copy of a registered collection, and
        // the overrides go over that copy.
        const onSaved = jest.fn();
        render(
            <Page>
                <CollectionsProvider externalCollections={[posts]} tables={NO_TABLES}>
                    <RecordForm collection={posts} id={"p1"} onSaved={onSaved}
                        collectionOverrides={{
                            properties: { ...posts.properties, title: { type: "string", name: "Headline" } }
                        }}/>
                </CollectionsProvider>
            </Page>
        );

        const headline = await screen.findByLabelText("Headline");
        await act(async () => {
            fireEvent.change(headline, { target: { value: "Hello again" } });
        });
        fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
        await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
        expect(saves[0].values).toEqual(expect.objectContaining({ title: "Hello again" }));
    });

    it("lays out the fields its children place, and saves only those", async () => {
        const onSaved = jest.fn();
        render(<Page>
            <RecordForm collection={authors} id={"ada"} onSaved={onSaved}>
                <div data-testid={"my-layout"}><FormField name={"name"}/></div>
            </RecordForm>
        </Page>);

        const name = await screen.findByDisplayValue("Ada Lovelace");
        expect(within(screen.getByTestId("my-layout")).getByDisplayValue("Ada Lovelace")).toBe(name);
        expect(document.querySelector("[data-form-field=\"handle\"]")).toBeNull();
        // Its pieces are spaced as generated fields are, so siblings do not touch.
        expect(screen.getByTestId("my-layout").parentElement?.className).toMatch(/flex-col.*gap-6/);
        await act(async () => {
            fireEvent.change(name, { target: { value: "Ada King" } });
        });
        fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
        await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
        expect(saves[0].values).toEqual({ name: "Ada King" });
    });

    it("shows only its fields, in their order", async () => {
        render(<Page><RecordForm collection={authors} id={"ada"} fields={["name"]}/></Page>);
        await screen.findByDisplayValue("Ada Lovelace");
        const keys = Array.from(document.querySelectorAll("[data-form-field]")).map(el => el.getAttribute("data-form-field"));
        expect(keys).toEqual(["name"]);
    });

    it("puts two forms on one page without sharing an id", async () => {
        render(<Page>
            <RecordForm collection={posts} id={"p1"}/>
            <RecordForm collection={posts} id={"p2"}/>
        </Page>);
        await screen.findByDisplayValue("Hello world");
        await screen.findByDisplayValue("Second post");

        const ids = Array.from(document.querySelectorAll("[id]")).map(el => el.id);
        expect(new Set(ids).size).toBe(ids.length);
        const forms = document.querySelectorAll("[data-form-path=\"posts\"]");
        expect(forms).toHaveLength(2);
        expect(within(forms[1] as HTMLElement).getByDisplayValue("Second post")).toBeTruthy();
    });
});
