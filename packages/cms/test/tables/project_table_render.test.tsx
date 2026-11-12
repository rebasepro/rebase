/**
 * @jest-environment jsdom
 */
/**
 * The projected `posts` collection, mounted in the real entity form: every
 * field renders, each with the widget its column type picks.
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { act, render } from "@testing-library/react";
import type { Entity } from "@rebasepro/types";
import type { FormContext } from "@rebasepro/cms-types";

class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
}
Object.assign(global, { ResizeObserver: ResizeObserverStub });

jest.mock("@rebasepro/app", () => {
    const overrides: Record<string, unknown> = {
        useRebaseContext: () => ({}),
        useCustomizationController: () => ({ plugins: [], propertyConfigs: {}, entityActions: [], entityViews: [], resolvedSlots: [] }),
        useAuthController: () => ({ user: { uid: "u1", roles: ["editor"] } }),
        useSnackbarController: () => ({ open: () => undefined })
    };
    return new Proxy({}, {
        get: (_t, key: string | symbol) =>
            (typeof key === "string" && key in overrides)
                ? overrides[key]
                : (jest.requireActual("@rebasepro/app") as Record<string | symbol, unknown>)[key]
    });
});

import {
    AuthControllerContext,
    CustomizationControllerContext,
    RebaseDataContext,
    RebaseI18nProvider,
    StorageSourceContext
} from "@rebasepro/app";
import { EntityForm } from "../../src/form/EntityForm";
import { rowOf, saving } from "../helpers/form_rows";
import { fakeAuthController, fakeCustomization, fakeRebaseData, fakeStorageSource, fakeUser } from "../helpers/fakes";
import { collectionFromTable } from "../../src/tables";
import { posts, tags, users } from "./fixtures";

type Row = Record<string, unknown>;

function mount() {
    const collection = collectionFromTable(posts, { tables: [posts, users, tags] });
    const onSubmit = jest.fn(async (v: Row) => ({ id: "1", path: "posts", values: v }) as Entity<Row>);
    let ctx: FormContext<Row> | undefined;
    const view = render(<RebaseI18nProvider locale="en">
        <AuthControllerContext.Provider value={fakeAuthController({ user: fakeUser("u1") })}>
            <CustomizationControllerContext.Provider value={fakeCustomization()}>
                <RebaseDataContext.Provider value={fakeRebaseData()}>
                    <StorageSourceContext.Provider value={fakeStorageSource()}>
                        <EntityForm<Row>
                            path="posts"
                            row={rowOf(undefined)}
                            collection={collection}
                            initialStatus="new"
                            onFormContextReady={(c) => {
                                ctx = c;
                            }}
                            onSubmit={saving(onSubmit)}/>
                    </StorageSourceContext.Provider>
                </RebaseDataContext.Provider>
            </CustomizationControllerContext.Provider>
        </AuthControllerContext.Provider>
    </RebaseI18nProvider>);
    return { view, onSubmit, context: () => ctx };
}

const field = (container: HTMLElement, key: string): HTMLElement | null =>
    container.querySelector(`[data-form-field="${key}"]`);

describe("the projected posts collection in the entity form", () => {
    it("renders each column with its widget", () => {
        const { container } = mount().view;
        const input = (key: string, selector: string) => field(container, key)?.querySelector(selector) ?? null;

        // text / varchar → a text input, labelled from the key.
        expect(input("title", "input[type=text]")).not.toBeNull();
        expect(field(container, "title")?.textContent).toContain("Title");
        expect(input("slug", "input[type=text]")).not.toBeNull();
        // enum → a select, opened on the default and listing every labelled value.
        expect(input("status", "[role=combobox]")).not.toBeNull();
        expect(field(container, "status")?.textContent).toContain("Needs Review");
        // storage with image/* → the upload field, accepting what the column accepts.
        expect(input("heroImage", "input[type=file]")?.getAttribute("accept")).toBe("image/*");
        // timestamptz → the date-time picker.
        expect(input("publishDate", "input[type=datetime-local]")).not.toBeNull();
        // jsonb without a shape → the key-value editor.
        expect(field(container, "metadata")?.textContent).toContain("Add to Metadata");
        // vector → the vector editor.
        expect(field(container, "embedding")?.textContent).toContain("Vector");
        // belongsTo → the relation picker, required.
        expect(field(container, "author")?.textContent).toContain("Select");
        expect(field(container, "author")?.textContent).toContain("*");
        // The tenant column is shown, labelled with its initialism.
        expect(field(container, "orgId")?.textContent).toContain("Org ID");
    });

    it("never renders the raw foreign key beside its relation", () => {
        const { container } = mount().view;
        expect(field(container, "authorId")).toBeNull();
    });

    it("keeps the generated id and the audit dates out of the editable fields", () => {
        const { container } = mount().view;
        for (const key of ["id", "createdAt", "updatedAt"]) expect(field(container, key)).toBeNull();
    });

    it("hides the many-to-many picker: tags is a tab of the record", () => {
        const { container } = mount().view;
        expect(field(container, "tags")).toBeNull();
    });

    it("requires what the table requires and lets the server fill the tenant", async () => {
        const { context, onSubmit } = mount();
        await act(async () => {
            await context()!.submit();
        });
        expect(onSubmit).not.toHaveBeenCalled();
        const errors = context()!.formex.errors;
        expect(errors).toHaveProperty("title");
        expect(errors).toHaveProperty("slug");
        expect(errors).toHaveProperty("author");
        expect(errors).not.toHaveProperty("orgId");
        expect(errors).not.toHaveProperty("status");
        expect(errors).not.toHaveProperty("createdAt");
    });
});
