/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { act, render, screen } from "@testing-library/react";
import type { Entity } from "@rebasepro/types";
import type { EntityCustomViewParams, FormContext } from "@rebasepro/cms-types";
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
        useSnackbarController: () => ({ open: () => undefined })
    };
    return new Proxy({}, {
        get: (_t, key: string | symbol) =>
            (typeof key === "string" && key in overrides)
                ? overrides[key]
                : (jest.requireActual("@rebasepro/app") as Record<string | symbol, unknown>)[key]
    });
});

import { AuthControllerContext, CustomizationControllerContext, RebaseI18nProvider } from "@rebasepro/app";
import { EntityForm } from "../../src/form/EntityForm";

/**
 * What the form sends when a stored record is saved, read where it leaves the
 * form: the `onSubmit` the admin hands to the data layer.
 */

type Post = Record<string, unknown>;

const properties = {
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
};

const collection = { slug: "posts", name: "Posts", properties } as never;

let context: FormContext<Post>;

function CaptureContext({ formContext }: EntityCustomViewParams<Post>) {
    context = formContext;
    return null;
}

function entityOf(values: Post): Entity<Post> {
    return { id: "1", path: "posts", values };
}

/**
 * The record form. With `withBuilder`, a Builder stands in for the fields and
 * only captures the form's context; without it the real fields render, which
 * needs the two controllers they read.
 */
function formFor(values: Post, onSubmit: EntityFormProps<Post>["onSubmit"], withBuilder = true, locale = "en") {
    const form = <EntityForm<Post>
        path="posts"
        entityId="1"
        collection={collection}
        entity={entityOf(values)}
        initialStatus="existing"
        Builder={withBuilder ? CaptureContext : undefined}
        onFormContextReady={(formContext) => { context = formContext; }}
        onSubmit={onSubmit}
        computedInitialValues={values}/>;
    if (withBuilder) return form;
    return <RebaseI18nProvider locale={locale}>
        <AuthControllerContext.Provider value={{ user: { uid: "u1" } } as never}>
            <CustomizationControllerContext.Provider
                value={{ plugins: [], propertyConfigs: {}, entityActions: [], entityViews: [], resolvedSlots: [] } as never}>
                {form}
            </CustomizationControllerContext.Provider>
        </AuthControllerContext.Provider>
    </RebaseI18nProvider>;
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

describe("EntityForm: a record changed elsewhere while the form is open", () => {

    it("a field left alone follows the change, and the save does not write it back", async () => {
        const v1: Post = { title: "T", price: 10 };
        const v2: Post = { title: "T", price: 20 };
        let stored = v1;
        const { payloads, onSubmit } = recordingSubmit(() => stored);
        const view = render(formFor(v1, onSubmit));

        await act(async () => {
            context.setFieldValue("title", "T2");
        });
        // Someone else sets the price; the listener delivers the new record.
        stored = v2;
        await act(async () => {
            view.rerender(formFor(v2, onSubmit));
        });
        expect(context.values.price).toEqual(20);
        expect(context.values.title).toEqual("T2");

        await act(async () => {
            await context.submit();
        });
        expect(payloads).toEqual([{ title: "T2" }]);
    });

    it("an unedited form follows the change and stays clean", async () => {
        const v1: Post = { title: "T", price: 10 };
        const v2: Post = { title: "T", price: 20 };
        const { onSubmit } = recordingSubmit(() => v2);
        const view = render(formFor(v1, onSubmit));

        await act(async () => {
            view.rerender(formFor(v2, onSubmit));
        });
        expect(context.values.price).toEqual(20);
        expect(context.formex.dirty).toBe(false);
        // Nothing the user did, so nothing for Undo to take back.
        expect(context.formex.canUndo).toBe(false);
    });

    it("a field edited here and elsewhere keeps the edit and says it was updated elsewhere, translated", async () => {
        const v1: Post = { title: "T", price: 10 };
        const v2: Post = { title: "T", price: 20 };
        let stored = v1;
        const { payloads, onSubmit } = recordingSubmit(() => stored);
        const view = render(formFor(v1, onSubmit, false));

        await act(async () => {
            context.setFieldValue("price", 15);
        });
        expect(screen.queryByText("This value has been updated elsewhere")).toBeNull();

        stored = v2;
        await act(async () => {
            view.rerender(formFor(v2, onSubmit, false));
        });
        expect(context.values.price).toEqual(15);
        expect(screen.getByText("This value has been updated elsewhere")).toBeTruthy();

        await act(async () => {
            await context.submit();
        });
        expect(payloads).toEqual([{ price: 15 }]);
        expect(screen.queryByText("This value has been updated elsewhere")).toBeNull();
    });

    it("says it in the reader's language", async () => {
        const v1: Post = { title: "T", price: 10 };
        const v2: Post = { title: "T", price: 20 };
        const { onSubmit } = recordingSubmit(() => v2);
        const view = render(formFor(v1, onSubmit, false, "it"));

        await act(async () => {
            context.setFieldValue("price", 15);
        });
        await act(async () => {
            view.rerender(formFor(v2, onSubmit, false, "it"));
        });
        expect(screen.getByText("Questo valore è stato aggiornato altrove")).toBeTruthy();
    });

    it("an autosave sends only what was edited here", async () => {
        const v1: Post = { title: "T", price: 10 };
        const { payloads, onSubmit } = recordingSubmit(() => v1);
        render(<EntityForm<Post>
            path="posts"
            entityId="1"
            collection={{ slug: "posts", name: "Posts", properties, formAutoSave: true } as never}
            entity={entityOf(v1)}
            initialStatus="existing"
            Builder={CaptureContext}
            onSubmit={onSubmit}
            computedInitialValues={v1}/>);

        await act(async () => {
            context.setFieldValue("title", "T2");
        });
        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 2100));
        });
        // The whole record would write back every field this form last
        // heard about, over any change to it still on its way here.
        expect(payloads).toEqual([{ title: "T2" }]);
    });

});

describe("EntityForm: a string transform reaches the save", () => {

    it("sends the trimmed, lowercased value validation passed", async () => {
        const stored: Post = { slug: "old" };
        const { payloads, onSubmit } = recordingSubmit(() => stored);
        render(<EntityForm<Post>
            path="posts"
            entityId="1"
            collection={{
                slug: "posts",
                name: "Posts",
                properties: {
                    slug: {
                        type: "string",
                        name: "Slug",
                        validation: { trim: true, lowercase: true, matches: /^[a-z0-9-]+$/ }
                    }
                }
            } as never}
            entity={entityOf(stored)}
            initialStatus="existing"
            Builder={CaptureContext}
            onSubmit={onSubmit}
            computedInitialValues={stored}/>);

        await act(async () => {
            context.setFieldValue("slug", "  My-Slug ");
        });
        await act(async () => {
            await context.submit();
        });

        expect(payloads).toEqual([{ slug: "my-slug" }]);
    });

});
