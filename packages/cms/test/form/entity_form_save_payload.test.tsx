/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { act, render, screen } from "@testing-library/react";
import type { Entity } from "@rebasepro/types";
import type { EntityCustomViewParams } from "@rebasepro/cms-types";
import type { FormContext } from "../../src/types/fields";
import type { EntityFormProps } from "../../src/types/components/EntityFormProps";

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
        useSnackbarController: () => ({ open: () => undefined }),
        useTranslation: () => ({ t: (key: string) => key })
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
 * What the form sends when a stored record is saved, read where it leaves the
 * form: the `onSubmit` the admin hands to the data layer.
 */

type Post = Record<string, unknown>;

const collection = {
    slug: "posts",
    name: "Posts",
    properties: {
        title: { type: "string", name: "Title" },
        price: { type: "number", name: "Price" },
        publishedAt: { type: "date", name: "Published at" },
        address: {
            type: "map",
            name: "Address",
            properties: {
                street: { type: "string", name: "Street" },
                city: { type: "string", name: "City" }
            }
        }
    }
} as unknown as EntityFormProps<Post>["collection"];

let context: FormContext<Post>;

function CaptureContext({ formContext }: EntityCustomViewParams<Post>) {
    context = formContext as FormContext<Post>;
    return null;
}

function entityOf(values: Post): Entity<Post> {
    return { id: "1", path: "posts", values };
}

function formFor(values: Post, onSubmit: EntityFormProps<Post>["onSubmit"], withBuilder = true) {
    return <EntityForm<Post>
        path="posts"
        entityId="1"
        collection={collection}
        entity={entityOf(values)}
        initialStatus="existing"
        Builder={withBuilder ? CaptureContext : undefined}
        onFormContextReady={(formContext) => { context = formContext; }}
        onSubmit={onSubmit}
        computedInitialValues={values}/>;
}

function recordingSubmit(stored: () => Post) {
    const payloads: Post[] = [];
    const onSubmit = jest.fn(async (values: Post) => {
        payloads.push(values);
        return entityOf({ ...stored(), ...values });
    });
    return { payloads, onSubmit };
}

describe("EntityForm: what a save of a stored record sends", () => {

    it("sends an edited date", async () => {
        const stored: Post = { title: "Hello", publishedAt: new Date("2026-01-01T10:00:00Z") };
        const { payloads, onSubmit } = recordingSubmit(() => stored);
        render(formFor(stored, onSubmit));

        const february = new Date("2026-02-01T10:00:00Z");
        await act(async () => {
            context.setFieldValue("publishedAt", february);
        });
        await act(async () => {
            await context.submit();
        });

        expect(payloads).toHaveLength(1);
        expect(Object.keys(payloads[0])).toEqual(["publishedAt"]);
        expect((payloads[0].publishedAt as Date).getTime()).toEqual(february.getTime());
    });

    it("sends a map whole when one of its fields was edited", async () => {
        const stored: Post = { title: "Hello", address: { street: "Main 1", city: "Rome" } };
        const { payloads, onSubmit } = recordingSubmit(() => stored);
        render(formFor(stored, onSubmit));

        await act(async () => {
            context.setFieldValue("address.city", "Milan");
        });
        await act(async () => {
            await context.submit();
        });

        expect(payloads).toEqual([{ address: { street: "Main 1", city: "Milan" } }]);
    });

});
