/**
 * @jest-environment jsdom
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
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

/**
 * `formAutoSave`: what reaches the data layer, and when.
 *
 * Opening a New form and doing nothing created a record of defaults two
 * seconds later — a required `title` sent as `null` — because the autosave
 * compared the form against "last saved", which a new record does not have.
 * And no autosave was ever validated: every later edit was written without
 * the checks a Save runs.
 */

type Post = Record<string, unknown>;
const collection = {
    slug: "posts",
    name: "Posts",
    formAutoSave: true,
    properties: {
        title: { type: "string", name: "Title", validation: { required: true } },
        price: { type: "number", name: "Price", validation: { min: 0 } }
    }
} as never;

let context: FormContext<Post>;
function Capture({ formContext }: EntityCustomViewParams<Post>) {
    context = formContext;
    return null;
}

const optional = {
    slug: "notes",
    name: "Notes",
    formAutoSave: true,
    properties: { body: { type: "string", name: "Body" } }
} as never;

function open(status: "new" | "existing", onSubmit: (values: Post) => Promise<Entity<Post>>, of = collection) {
    const entity = status === "existing" ? { id: "1", path: "posts", values: { title: "Stored", price: 1 } } : undefined;
    return render(<EntityForm<Post>
        path="posts"
        entityId={entity?.id}
        collection={of}
        entity={entity}
        initialStatus={status}
        Builder={Capture}
        onSubmit={onSubmit}
        computedInitialValues={entity?.values}/>);
}

const wait = (ms: number) => act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
});

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

describe("autosave", () => {
    const recording = () => {
        const payloads: Post[] = [];
        const onSubmit = jest.fn(async (values: Post) => {
            payloads.push(values);
            return { id: "1", path: "posts", values } as Entity<Post>;
        });
        return { payloads, onSubmit };
    };

    it("writes nothing for a New form nobody touched", async () => {
        const { payloads, onSubmit } = recording();
        open("new", onSubmit);
        await wait(5000);
        expect(payloads).toEqual([]);
    });

    it("writes nothing for a New form nobody touched, even one that would validate", async () => {
        const { payloads, onSubmit } = recording();
        open("new", onSubmit, optional);
        await wait(5000);
        expect(payloads).toEqual([]);
    });

    it("writes nothing while the form does not validate, and writes it once it does", async () => {
        const { payloads, onSubmit } = recording();
        open("new", onSubmit);

        await act(async () => context.setFieldValue("price", 5));
        await wait(5000);
        expect(payloads).toEqual([]);

        await act(async () => context.setFieldValue("title", "Hello"));
        await wait(5000);
        expect(payloads).toHaveLength(1);
        expect(payloads[0]).toMatchObject({ title: "Hello", price: 5 });
    });

    it("does not write an edit that breaks a rule", async () => {
        const { payloads, onSubmit } = recording();
        open("existing", onSubmit);

        await act(async () => context.setFieldValue("price", -3));
        await wait(5000);
        expect(payloads).toEqual([]);

        await act(async () => context.setFieldValue("price", 3));
        await wait(5000);
        expect(payloads).toEqual([{ price: 3 }]);
    });
});
