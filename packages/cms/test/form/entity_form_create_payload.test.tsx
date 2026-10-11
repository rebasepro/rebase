/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { act, render, waitFor } from "@testing-library/react";
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

/**
 * What a create from the record form sends.
 *
 * It sent a value for every property, the per-type `null` included, and an
 * explicit `NULL` beats a column's `DEFAULT`: `published_at timestamptz
 * DEFAULT now()` was created empty from the panel and fine from the API. A
 * `null` the form opened with and still holds is not a value anyone chose, so
 * it is left out and the database fills the column.
 */

type Post = Record<string, unknown>;
const collection = {
    slug: "posts",
    name: "Posts",
    properties: {
        title: { type: "string", name: "Title" },
        subtitle: { type: "string", name: "Subtitle" },
        publishedAt: { type: "date", name: "Published at" },
        status: { type: "string", name: "Status", defaultValue: "draft" },
        featured: { type: "boolean", name: "Featured" },
        tags: { type: "array", name: "Tags", of: { type: "string" } }
    }
} as never;

let context: FormContext<Post>;
function Capture({ formContext }: EntityCustomViewParams<Post>) {
    context = formContext;
    return null;
}

async function createWith(edit: (formContext: FormContext<Post>) => void): Promise<Post> {
    const payloads: Post[] = [];
    render(<EntityForm<Post>
        path="posts"
        collection={collection}
        initialStatus="new"
        Builder={Capture}
        onSubmit={async (values: Post) => {
            payloads.push(values);
            return { id: "1", path: "posts", values } as Entity<Post>;
        }}/>);
    await act(async () => {
        edit(context);
    });
    await act(async () => {
        await context.submit();
    });
    await waitFor(() => expect(payloads).toHaveLength(1));
    return payloads[0];
}

describe("EntityForm: what a create sends", () => {
    it("leaves out the empty values nobody set, so column defaults apply", async () => {
        const payload = await createWith(c => c.setFieldValue("title", "Hello"));
        expect(payload).toEqual({ title: "Hello", status: "draft", featured: false, tags: [] });
        expect("subtitle" in payload).toBe(false);
        expect("publishedAt" in payload).toBe(false);
    });

    it("sends a null the user chose over a declared default", async () => {
        const payload = await createWith(c => c.setFieldValue("status", null));
        expect(payload).toHaveProperty("status", null);
    });
});
