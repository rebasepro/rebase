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
import type { AdminCollection, EntityCustomViewParams, FormContext, Entity } from "@rebasepro/cms-types";

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
import { col, defineTable } from "@rebasepro/types";
import { compileTables } from "@rebasepro/common";
import { collectionFromTable } from "../../src/tables/project_table";
import { applyTableCustomization } from "../../src/tables/apply_customization";
import { customizeTable } from "../../src/tables/customize_table";
import { rowOf, saving } from "../helpers/form_rows";

/**
 * The reference app's posts, as `app/backend/schema/posts.ts` declares the two
 * columns that matter here — `slug` is NOT NULL and its `beforeSave` derives it
 * from the title — and as `app/frontend/src/cms/posts.tsx` customizes it
 * (`fields.slug.filledByServer`).
 */
const [postsTable] = compileTables([defineTable("posts", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        title: col.text().notNull(),
        slug: col.text().notNull().unique(),
        excerpt: col.text().validate({ max: 300 })
    },
    rls: "admin-only"
})]);
const postsCollection = applyTableCustomization(
    collectionFromTable(postsTable, { tables: [postsTable] }),
    customizeTable("posts", { fields: { slug: { filledByServer: true } } })
);

type Row = Record<string, unknown>;

async function submit(collection: AdminCollection, values: Row, status: "new" | "existing") {
    const onSubmit = jest.fn(async (v: Row) => ({ id: "1", path: "posts", values: v }) as Entity<Row>);
    let ctx: FormContext<Row> | undefined;
    const Capture = ({ formContext }: EntityCustomViewParams<Row>) => {
        ctx = formContext;
        return null;
    };
    render(<EntityForm<Row>
        path="posts"
        id={status === "existing" ? "1" : undefined}
        row={rowOf(status === "existing" ? { id: "1", path: "posts", values } : undefined)}
        collection={collection}
        initialStatus={status}
        Builder={Capture}
        onFormContextReady={(c) => {
            ctx = c;
        }}
        onSubmit={saving(onSubmit)}
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

const collection: AdminCollection = {
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

/**
 * `databaseDefault`: the database fills the column (`NOT NULL DEFAULT
 * gen_random_uuid()`), so the form lets a create leave a required field empty,
 * as `admin.filledByServer` does, and still requires it on an edit.
 */
describe("databaseDefault", () => {
    const withCode: AdminCollection = {
        slug: "posts",
        name: "Posts",
        properties: {
            title: { type: "string", validation: { required: true } },
            slug: { type: "string", validation: { required: true }, databaseDefault: true }
        }
    };

    it("lets a new record be created without the field", async () => {
        const { onSubmit, errors } = await submit(withCode, { title: "Hello world", slug: null }, "new");
        expect(errors).toEqual({});
        expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    it("still requires the field when a stored record is edited", async () => {
        const { onSubmit, errors } = await submit(withCode, { title: "Hello world", slug: "abc" }, "existing");
        expect(onSubmit).not.toHaveBeenCalled();
        expect(errors.slug).toBe("Required");
    });
});
