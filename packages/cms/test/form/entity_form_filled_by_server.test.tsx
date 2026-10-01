/**
 * @jest-environment jsdom
 */
/**
 * A required field a server hook fills is optional when the form creates.
 *
 * The server's required check steps aside for a collection with a
 * `beforeSave` — the reference app derives `posts.slug` from the title there —
 * but the form still demanded the slug, so the hook could never run from the
 * panel: "Required" on Slug, and no way past it but to type what the hook
 * would have written. `admin.filledByServer` says the field is filled on the
 * server when left empty; the form then lets a create through without it, and
 * still requires it on an edit.
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { act, render } from "@testing-library/react";
import type { Entity } from "@rebasepro/types";
import type { EntityCustomViewParams, FormContext } from "@rebasepro/cms-types";

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
        useAuthController: () => ({ user: { uid: "u1" } }),
        useSnackbarController: () => ({ open: () => undefined })
    };
    return new Proxy({}, {
        get: (_t, key: string | symbol) =>
            (typeof key === "string" && key in overrides)
                ? overrides[key]
                : (jest.requireActual("@rebasepro/app") as Record<string | symbol, unknown>)[key]
    });
});

import { EntityForm } from "../../src/form/EntityForm";
import postsCollection from "../../../../app/config/collections/posts";

type Row = Record<string, unknown>;

async function submit(collection: unknown, values: Row, status: "new" | "existing") {
    const onSubmit = jest.fn(async (v: Row) => ({ id: "1", path: "posts", values: v }) as Entity<Row>);
    let ctx: FormContext<Row> | undefined;
    const Capture = ({ formContext }: EntityCustomViewParams<Row>) => {
        ctx = formContext;
        return null;
    };
    render(<EntityForm<Row>
        path="posts"
        entityId={status === "existing" ? "1" : undefined}
        entity={status === "existing" ? { id: "1", path: "posts", values } : undefined}
        collection={collection as never}
        initialStatus={status}
        Builder={Capture}
        onFormContextReady={(c) => {
            ctx = c;
        }}
        onSubmit={onSubmit}
        computedInitialValues={values}/>);
    if (status === "existing") {
        await act(async () => {
            ctx!.setFieldValue("slug", null);
        });
    }
    await act(async () => {
        await ctx!.submit();
    });
    return { onSubmit, errors: ctx!.formex.errors };
}

const collection = {
    slug: "posts",
    name: "Posts",
    properties: {
        title: { type: "string", validation: { required: true } },
        slug: { type: "string", validation: { required: true }, admin: { filledByServer: true } }
    }
};

describe("admin.filledByServer", () => {

    it("lets a new record be created without the field", async () => {
        const { onSubmit } = await submit(collection, { title: "Hello world", slug: null }, "new");
        expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    it("still requires the field when a stored record is edited", async () => {
        const { onSubmit, errors } = await submit(collection, { title: "Hello world", slug: "hello-world" }, "existing");
        expect(onSubmit).not.toHaveBeenCalled();
        expect(errors.slug).toBe("Required");
    });

    it("leaves the other required fields required", async () => {
        const { onSubmit, errors } = await submit(collection, { title: null, slug: null }, "new");
        expect(onSubmit).not.toHaveBeenCalled();
        expect(errors).toEqual({ title: "Required" });
    });

    it("lets the reference app's post be created with the slug left to its beforeSave", async () => {
        const values = Object.fromEntries(Object.keys(postsCollection.properties).map(key => [key, null]));
        const { errors } = await submit(postsCollection, { ...values, title: "Hello world" }, "new");
        expect(errors).not.toHaveProperty("slug");
    });
});
