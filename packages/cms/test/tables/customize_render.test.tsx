/**
 * @jest-environment jsdom
 */
/**
 * A customization, rendered: the record form of a customized table draws the
 * `Field` component the customization imported by value, and an entity action
 * whose `onClick` calls `updateRecord` writes through the panel's data layer,
 * says so, and the form shows the new value.
 */
import React from "react";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BrowserRouter } from "react-router";
import type { DataDriver, PostgresProperties } from "@rebasepro/types";
import { col, defineTable } from "@rebasepro/types";
import type { AdminPostgresCollection, FieldProps } from "@rebasepro/cms-types";
import { Rebase } from "@rebasepro/app";
import { applyTableCustomization, CollectionPanel, CollectionsProvider, customizeTable, RecordForm, updateRecord } from "@rebasepro/cms";
import type { TableCollection } from "@rebasepro/cms";
import { clearFetchCache } from "../../../app/src/hooks/data/useFetch";
import { fakeStorageSource } from "../helpers/fakes";

if (typeof globalThis.ResizeObserver === "undefined") {
    class NoopResizeObserver {
        observe() { /* nothing to observe in jsdom */ }
        unobserve() { /* nothing to observe in jsdom */ }
        disconnect() { /* nothing to observe in jsdom */ }
    }
    Object.defineProperty(globalThis, "ResizeObserver", { value: NoopResizeObserver, configurable: true });
}

// jsdom measures nothing: give the cards a laptop-sized viewport.
jest.mock("react-use-measure", () => {
    const mod = jest.requireActual("react-use-measure") as { default?: (o?: unknown) => unknown };
    const actual = (typeof mod === "function" ? mod : mod.default) as (o?: unknown) => unknown;
    return (options?: { offsetSize?: boolean }) => {
        const real = actual(options) as [unknown, unknown];
        if (options?.offsetSize) return [real[0], { width: 1440, height: 900, top: 0, left: 0, bottom: 0, right: 0, x: 0, y: 0 }];
        return real;
    };
});

const posts = defineTable("posts", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        title: col.text().notNull(),
        content: col.text(),
        status: col.enum(["draft", "published"]).notNull().default("draft"),
        publishDate: col.timestamptz()
    },
    rls: "admin-only"
});

/** What the projector writes for `posts`. */
const projected: AdminPostgresCollection = {
    slug: "posts",
    name: "Posts",
    singularName: "Post",
    table: "posts",
    properties: {
        id: { type: "string", name: "Id", isId: "uuid" },
        title: { type: "string", name: "Title" },
        content: { type: "string", name: "Content" },
        status: { type: "string", name: "Status", enum: [{ id: "draft", label: "Draft" }, { id: "published", label: "Published" }] },
        publishDate: { type: "date", name: "Publish Date", mode: "date_time" }
    }
};

/** The custom editor, imported by value: it shows the value and edits it. */
function CustomMarkdownEditor({ value, setValue }: FieldProps): React.ReactElement {
    return (
        <textarea data-testid="custom-markdown-editor"
            value={typeof value === "string" ? value : ""}
            onChange={event => setValue(event.target.value)}/>
    );
}

const postsCms = customizeTable<typeof posts>("posts", {
    fields: {
        content: { Field: CustomMarkdownEditor },
        status: { enumLabels: { draft: { label: "Draft", color: "gray" }, published: { label: "Published", color: "green" } } }
    },
    entityActions: [{
        key: "publish",
        name: "Publish",
        icon: "Send",
        collapsed: false,
        isEnabled: ({ row }) => row?.status !== "published",
        onClick: ({ id, context }) =>
            updateRecord(context, "posts", id, { status: "published", publishDate: "2026-11-12T10:00:00.000Z" }, "Published")
    }]
});

/**
 * The customized collection as the registry types it today. A `referenceTo`
 * column would make it a reference the legacy `PostgresProperties` does not
 * admit; this table has none, and that is checked rather than asserted.
 */
function registrable(collection: TableCollection): AdminPostgresCollection {
    const properties: PostgresProperties = {};
    for (const [key, property] of Object.entries(collection.properties)) {
        if (property.type === "reference") throw new Error(`"${key}" is a reference`);
        properties[key] = property;
    }
    return { ...collection, properties };
}

type Row = Record<string, unknown>;
let rows: Row[];
const saves: { id?: unknown; values: Row }[] = [];

const driver: DataDriver = {
    key: "memory",
    fetchCollection: async () => rows,
    fetchOne: async ({ id }) => rows.find(r => String(r.id) === String(id)),
    save: async ({ values, id }) => {
        saves.push({ id, values: { ...values } });
        const saved = { ...rows.find(r => String(r.id) === String(id)), ...values, id };
        rows = [...rows.filter(r => String(r.id) !== String(id)), saved];
        return saved;
    },
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
};

function renderIn(children: React.ReactNode) {
    const collection = registrable(applyTableCustomization(projected, postsCms));
    return render(
        <Rebase authController={authController} storageSource={fakeStorageSource()}
            dataSources={[{ key: "(default)", engine: "postgres", driver }]}>
            <BrowserRouter>
                <CollectionsProvider collections={[collection]}>{children}</CollectionsProvider>
            </BrowserRouter>
        </Rebase>
    );
}

beforeEach(() => {
    rows = [{ id: "p1", title: "Hello world", content: "# Hello", status: "draft", publishDate: null }];
    saves.length = 0;
    clearFetchCache();
    window.localStorage.clear();
    window.history.replaceState(null, "", "/my-page");
});

describe("a customized table, rendered", () => {
    it("draws the customization's Field component, by value, with the record's value", async () => {
        renderIn(<RecordForm collection={"posts"} id={"p1"}/>);
        const editor = await screen.findByTestId("custom-markdown-editor");
        expect(editor).toHaveProperty("value", "# Hello");
        // The fields the customization left alone keep the built-in controls.
        expect(await screen.findByDisplayValue("Hello world")).toBeTruthy();

        await act(async () => {
            fireEvent.change(editor, { target: { value: "# Hello again" } });
        });
        expect(screen.getByTestId("custom-markdown-editor")).toHaveProperty("value", "# Hello again");
    });

    it("runs an entity action that writes the record with updateRecord", async () => {
        renderIn(<CollectionPanel collection={"posts"} viewMode={"cards"}/>);
        expect(await screen.findByText("Hello world")).toBeTruthy();

        const publish = await screen.findByRole("button", { name: "Publish" });
        await act(async () => {
            fireEvent.click(publish);
        });

        await waitFor(() => expect(saves).toEqual([
            expect.objectContaining({ id: "p1", values: expect.objectContaining({ status: "published", publishDate: "2026-11-12T10:00:00.000Z" }) })
        ]));
        expect(rows[0]).toMatchObject({ id: "p1", status: "published" });
        // The snackbar `updateRecord` opens.
        expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("Published"));
    });

    it("does not run an action whose isEnabled says no", async () => {
        rows = [{ id: "p1", title: "Hello world", content: "# Hello", status: "published", publishDate: null }];
        renderIn(<CollectionPanel collection={"posts"} viewMode={"cards"}/>);
        expect(await screen.findByText("Hello world")).toBeTruthy();
        for (const publish of screen.queryAllByRole("button", { name: "Publish" })) {
            expect(publish.hasAttribute("disabled") || publish.getAttribute("aria-disabled") === "true").toBe(true);
            fireEvent.click(publish);
        }
        await act(async () => { await Promise.resolve(); });
        expect(saves).toEqual([]);
    });
});
