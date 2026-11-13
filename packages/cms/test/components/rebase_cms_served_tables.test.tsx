/**
 * @jest-environment jsdom
 */
/**
 * The hybrid app of POSTGRES-FIRST.md §6.3, rendered as written:
 *
 * ```tsx
 * <Rebase client={rebaseClient} dataSources={[firestoreSource]} authController={authController}>
 *     <RebaseAuth/>
 *     <RebaseCMS tableCustomizations={[postsCms]} externalCollections={[firestoreEvents]}/>
 *     <RebaseShell title="Acme Ops"/>
 * </Rebase>
 * ```
 *
 * The client serves the descriptors `compileTables` makes of the spec's
 * `posts`, `users` and `tags`; `postsCms` is a real `customizeTable` with a
 * `Field` component imported by value; `firestoreEvents` is a real
 * `defineFirestoreCollection`, read through a stand-in Firestore driver. The
 * panel shows the tables and the Firestore collection side by side, renders
 * the customized posts, routes a Firestore document's reference to a Postgres
 * user through the default source — and while the tables are on their way, a
 * deep link waits rather than saying the collection does not exist.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import type {
    AuthClient,
    DataDriver,
    DataSourceDefinition,
    RebaseClient,
    SchemaAPI,
    TableDescriptor
} from "@rebasepro/types";
import { col, defineAuthTable, defineTable, RebaseApiError, rel } from "@rebasepro/types";
import { buildSdkData, compileTables } from "@rebasepro/common";
import type { AuthController, FieldProps } from "@rebasepro/cms-types";
import { Rebase, RebaseAuth } from "@rebasepro/app";
// The module itself, not the package root: the root also loads the Firebase
// SDK's auth and storage, which want a browser's `fetch` before any test runs.
import { defineFirestoreCollection } from "../../../firebase/src/collections/defineFirestoreCollection";
import { customizeTable, RebaseCMS, RebaseShell } from "@rebasepro/cms";
import { clearFetchCache } from "../../../app/src/hooks/data/useFetch";
import { fakeStorageSource } from "../helpers/fakes";
import { fakeFetch, jsonResponse } from "../helpers/http";

if (typeof globalThis.ResizeObserver === "undefined") {
    class NoopResizeObserver {
        observe() { /* jsdom measures nothing */ }
        unobserve() { /* jsdom measures nothing */ }
        disconnect() { /* jsdom measures nothing */ }
    }
    Object.defineProperty(globalThis, "ResizeObserver", { value: NoopResizeObserver, configurable: true });
}

// jsdom measures nothing: give the views a laptop-sized viewport.
jest.mock("react-use-measure", () => {
    const mod = jest.requireActual("react-use-measure") as { default?: (o?: unknown) => unknown };
    const actual = (typeof mod === "function" ? mod : mod.default) as (o?: unknown) => unknown;
    return (options?: { offsetSize?: boolean }) => {
        const real = actual(options) as [unknown, unknown];
        if (options?.offsetSize) return [real[0], { width: 1440, height: 900, top: 0, left: 0, bottom: 0, right: 0, x: 0, y: 0 }];
        return real;
    };
});

// ── backend/schema: the spec's tables (§4.1), compiled as the server would ──

const users = defineAuthTable("users", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        email: col.text().notNull().unique().validate({ email: true }),
        displayName: col.text()
    },
    auth: { roles: { admin: { scopes: [] }, editor: { scopes: [] } } },
    rls: "admin-only"
});

const tags = defineTable("tags", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        name: col.text().notNull()
    },
    rls: [{ operation: "select", access: "public" }, { operations: ["insert", "update", "delete"], roles: ["editor"] }]
});

const posts = defineTable("posts", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        title: col.text().notNull().validate({ min: 3, max: 200 }),
        slug: col.varchar({ length: 160 }).notNull().unique(),
        // The column §6.2's customization gives a custom editor.
        content: col.text(),
        status: col.enum(["draft", "needs_review", "published", "archived"]).notNull().default("draft"),
        publishDate: col.timestamp({ withTimezone: true }),
        createdAt: col.timestamp({ withTimezone: true }).notNull().onCreateNow(),
        updatedAt: col.timestamp({ withTimezone: true }).notNull().onUpdateNow(),
        __order: col.text()
    },
    relations: {
        author: rel.belongsTo(() => users, { localKey: "author_id", onDelete: "restrict" }),
        tags: rel.manyToMany(() => tags, { through: "posts_tags" })
    },
    rls: [
        { operation: "select", access: "public", condition: { status: "published" } },
        { operations: ["select", "insert", "update"], roles: ["editor"] },
        { operation: "delete", roles: ["admin"] }
    ]
});

const served: TableDescriptor[] = compileTables([posts, users, tags]);

// ── frontend/src/cms: the customization and the Firestore collection ────────

function CustomMarkdownEditor({ value, setValue }: FieldProps): React.ReactElement {
    return (
        <textarea data-testid="custom-markdown-editor"
            value={typeof value === "string" ? value : ""}
            onChange={event => setValue(event.target.value)}/>
    );
}

const postsCms = customizeTable<typeof posts>("posts", {
    name: "Blog Posts",
    singularName: "Blog Post",
    icon: "FileText",
    group: "Content",
    fields: {
        status: {
            enumLabels: {
                draft: { label: "Draft", color: "gray" },
                needs_review: { label: "Needs Review", color: "orange" },
                published: { label: "Published", color: "green" },
                archived: { label: "Archived", color: "red" }
            }
        },
        content: { Field: CustomMarkdownEditor },
        __order: { hidden: true, disabled: true }
    }
});

const firestoreEvents = defineFirestoreCollection({
    slug: "fs_events",
    path: "events",
    name: "Live Events (Firestore)",
    dataSource: "firestore",
    fields: {
        type: { name: "Event Type", type: "string", required: true },
        payload: { name: "Payload", type: "map" },
        // Cross-engine: the `users` Postgres table.
        customerId: { name: "Customer", type: "reference", target: "users" }
    }
});

// ── The two stores ──────────────────────────────────────────────────────────

type Row = Record<string, unknown>;
const postgres: Record<string, Row[]> = {};
const firestore: Record<string, Row[]> = {};

/** Every read each driver answered, by path. */
const reads: { postgres: string[]; firestore: string[] } = { postgres: [], firestore: [] };

function memoryDriver(key: string, store: Record<string, Row[]>, log: string[]): DataDriver {
    return {
        key,
        fetchCollection: async ({ path }) => {
            log.push(path);
            return store[path] ?? [];
        },
        fetchOne: async ({ path, id }) => {
            log.push(`${path}/${String(id)}`);
            return (store[path] ?? []).find(row => String(row.id) === String(id));
        },
        save: async ({ path, id, values }) => {
            const saved = { ...(store[path] ?? []).find(row => String(row.id) === String(id)), ...values, id };
            store[path] = [...(store[path] ?? []).filter(row => String(row.id) !== String(id)), saved];
            return saved;
        },
        delete: async () => undefined,
        count: async ({ path }) => (store[path] ?? []).length,
        checkUniqueField: async () => true
    };
}

const postgresDriver = memoryDriver("(default)", postgres, reads.postgres);

/** What `useFirestoreDataSource({ key: "firestore", firebaseApp })` hands `<Rebase>`. */
const firestoreSource: DataSourceDefinition & { driver: DataDriver } = {
    key: "firestore",
    engine: "firestore",
    transport: "direct",
    driver: memoryDriver("firestore", firestore, reads.firestore)
};

// ── The client: descriptors from `schema`, rows from the Postgres store ─────

let answerTables: () => Promise<TableDescriptor[]>;
const schema: SchemaAPI = { tables: jest.fn(() => answerTables()) };

const authClient: AuthClient = {
    getUser: async () => null,
    getSession: () => null,
    signOut: async () => undefined,
    onAuthStateChange: () => () => undefined,
    refreshSession: async () => { throw new Error("no session to refresh in this test"); }
};

const rebaseClient: RebaseClient = {
    data: buildSdkData(postgresDriver),
    auth: authClient,
    schema
};

const authController: AuthController = {
    user: { uid: "u-ana", email: "ana@acme.test", displayName: "Ana", photoURL: null, providerId: "password", isAnonymous: false, roles: ["admin"] },
    initialLoading: false,
    authLoading: false,
    loginSkipped: false,
    getAuthToken: async () => "t",
    signOut: async () => undefined,
    extra: null,
    setExtra: () => undefined
};

// ── frontend/src/App.tsx, verbatim but for the client and sources above ─────

function App() {
    return (
        <Rebase client={rebaseClient} dataSources={[firestoreSource]} authController={authController} storageSource={fakeStorageSource()}>
            <RebaseAuth/>
            <RebaseCMS tableCustomizations={[postsCms]} externalCollections={[firestoreEvents]}/>
            <RebaseShell title="Acme Ops"/>
        </Rebase>
    );
}

function renderAt(path: string) {
    const router = createMemoryRouter([{ path: "*", element: <App/> }], { initialEntries: [path] });
    return render(<RouterProvider router={router}/>);
}

/** A promise settled from outside. */
function deferred<T>() {
    let resolve: (value: T) => void = () => undefined;
    let reject: (error: unknown) => void = () => undefined;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

/** Records whether any of `texts` was ever on screen, frame by frame. */
function watchFor(texts: string[]) {
    const seen: string[] = [];
    const check = () => {
        const body = document.body.textContent ?? "";
        for (const text of texts) if (body.includes(text) && !seen.includes(text)) seen.push(text);
    };
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return { seen, stop: () => { check(); observer.disconnect(); } };
}

const NOT_FOUND = ["Collection not found", "Page not found", "Nothing is registered"];

beforeEach(() => {
    // The schema editor asks the backend whether it may write; this one says
    // it serves no such route.
    global.fetch = fakeFetch(async () => jsonResponse({ error: { message: "Not found", code: "NOT_FOUND" } }, { status: 404 }));
    postgres.posts = [{ id: "p1", title: "Hello world", slug: "hello-world", content: "# Hello", status: "draft", publishDate: null, authorId: "u-ana", __order: "a" }];
    postgres.users = [{ id: "u-ana", email: "customer@acme.test", displayName: "Ana Customer" }];
    postgres.tags = [];
    firestore.events = [{ id: "e1", type: "signup", payload: {}, customerId: "u-ana" }];
    reads.postgres.length = 0;
    reads.firestore.length = 0;
    answerTables = async () => served;
    jest.mocked(schema.tables).mockClear();
    clearFetchCache();
    window.localStorage.clear();
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe("<RebaseCMS tableCustomizations externalCollections> (§6.3)", () => {
    it("shows the served tables and the Firestore collection side by side", async () => {
        renderAt("/");
        // The customized table under its own name, the zero-config ones under
        // theirs, and the Firestore collection beside them.
        expect(await screen.findAllByText("Blog Posts")).not.toHaveLength(0);
        expect(screen.getAllByText("Live Events (Firestore)")).not.toHaveLength(0);
        expect(screen.getAllByText("Tags")).not.toHaveLength(0);
        expect(screen.getAllByText("Users")).not.toHaveLength(0);
        expect(schema.tables).toHaveBeenCalledTimes(1);
    });

    it("renders the posts table, and the form draws the customization's Field by value", async () => {
        const table = renderAt("/c/posts");
        expect(await screen.findByText("Hello world")).toBeTruthy();
        expect(reads.postgres).toContain("posts");
        expect(reads.firestore).not.toContain("posts");
        table.unmount();

        renderAt("/c/posts/p1");
        const editor = await screen.findByTestId("custom-markdown-editor");
        expect(editor).toHaveProperty("value", "# Hello");
        await act(async () => {
            fireEvent.change(editor, { target: { value: "# Hello again" } });
        });
        expect(screen.getByTestId("custom-markdown-editor")).toHaveProperty("value", "# Hello again");
    });

    it("reads the Firestore collection through its source, and its reference to a user through the default one", async () => {
        const list = renderAt("/c/fs_events");
        expect(await screen.findByText("signup")).toBeTruthy();
        expect(reads.firestore).toContain("events");
        expect(reads.postgres).not.toContain("events");
        list.unmount();

        // The document's form: its reference chip resolves the Postgres user.
        renderAt("/c/fs_events/e1");
        await waitFor(() => expect(reads.postgres.some(read => read === "users" || read === "users/u-ana")).toBe(true));
        expect(reads.firestore.some(read => read.startsWith("users"))).toBe(false);
        expect(await screen.findAllByText(/Ana Customer|customer@acme\.test/)).not.toHaveLength(0);
    });

    it("waits for the tables on a deep link, without a 'not found' frame", async () => {
        const tables = deferred<TableDescriptor[]>();
        answerTables = () => tables.promise;
        const watcher = watchFor(NOT_FOUND);

        renderAt("/c/posts");
        await act(async () => { await Promise.resolve(); });
        expect(screen.queryByText("Hello world")).toBeNull();

        await act(async () => { tables.resolve(served); });
        expect(await screen.findByText("Hello world")).toBeTruthy();
        watcher.stop();
        expect(watcher.seen).toEqual([]);
    });

    it("says what failed and retries", async () => {
        let fail = true;
        answerTables = async () => {
            if (fail) throw new RebaseApiError("The server is unreachable", { status: 0, code: "NETWORK_ERROR" });
            return served;
        };

        renderAt("/c/posts");
        expect(await screen.findByText(/The server's tables could not be loaded: The server is unreachable/)).toBeTruthy();
        expect(screen.queryByText("Collection not found")).toBeNull();

        fail = false;
        const retry = screen.getByRole("button", { name: "Retry" });
        await act(async () => { fireEvent.click(retry); });
        expect(await screen.findByText("Hello world")).toBeTruthy();
        expect(schema.tables).toHaveBeenCalledTimes(2);
    });

    it("still shows the external collection when the backend serves no tables", async () => {
        answerTables = async () => { throw new RebaseApiError("No tables", { status: 404, code: "SCHEMA_UNAVAILABLE" }); };
        renderAt("/c/fs_events");
        expect(await screen.findByText("signup")).toBeTruthy();
        expect(screen.queryByText(/could not be loaded/)).toBeNull();
    });

    it("names both collections when an external one takes a table's slug", async () => {
        const clash = defineFirestoreCollection({ slug: "tags", name: "Tags (Firestore)", dataSource: "firestore", fields: { name: { type: "string" } } });
        jest.spyOn(console, "error").mockImplementation(() => undefined);
        function Clashing() {
            return (
                <Rebase client={rebaseClient} dataSources={[firestoreSource]} authController={authController} storageSource={fakeStorageSource()}>
                    <RebaseCMS externalCollections={[clash]}/>
                    <RebaseShell title="Acme Ops"/>
                </Rebase>
            );
        }
        const router = createMemoryRouter([{ path: "*", element: <Clashing/> }], { initialEntries: ["/"] });
        render(<RouterProvider router={router}/>);
        const message = await screen.findByText(/"tags" \("Tags \(Firestore\)"\) has the slug of the table "tags"/);
        expect(within(message.closest("div") ?? document.body).getByText(/another slug/)).toBeTruthy();
    });
});
