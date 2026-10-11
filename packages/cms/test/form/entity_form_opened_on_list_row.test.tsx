/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { act, render, screen, waitFor } from "@testing-library/react";
import { EntityRelation, type Entity } from "@rebasepro/types";
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
 * A record opened by clicking its row in a list opens on that row (the record
 * cache), and its listener delivers the stored record a moment later. The two
 * differ: the list row carries every relation property; the listener's frame
 * carries a to-one relation as a bare reference and no to-many relation at all
 * — `useFetch` keeps the opened row's to-many relation for it (pinned in
 * `packages/app/test/hooks/useFetch.undelivered-relations.test.tsx`).
 *
 * What a save sends across that handover, read where it leaves the form. The
 * form sends only what the user changed, so nothing the list row lacked or
 * carried differently is written back; a many-to-many save sets membership, so
 * an edit of `tags` has to start from every stored tag.
 */

type Post = Record<string, unknown>;

const tagsCollection = { slug: "tags", name: "Tags", properties: { name: { type: "string", name: "Name" } } };
const peopleCollection = { slug: "people", name: "People", properties: { name: { type: "string", name: "Name" } } };

const properties = {
    title: { type: "string", name: "Title" },
    head: { type: "relation", name: "Head", relation: { kind: "belongsTo", target: () => peopleCollection, localKey: "head_id" } },
    tags: { type: "relation", name: "Tags", relation: { kind: "manyToMany", target: () => tagsCollection } }
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


const tag = (id: number) => new EntityRelation(id, "tags");

/** The row the list hands over on click. */
const LIST_ROW: Post = { title: "T", headId: 2, head: new EntityRelation(2, "people"), tags: [tag(1), tag(2)] };

/** The listener's frame, as `useFetch` hands it to the form: `tags` kept from the row. */
const RECORD: Post = { title: "T", headId: 2, head: new EntityRelation(2, "people"), tags: [tag(1), tag(2)] };

describe("EntityForm: a record opened on its list row", () => {

    it("saved before the record arrives, sends only the edit", async () => {
        const { payloads, onSubmit } = recordingSubmit(() => LIST_ROW);
        render(formFor(LIST_ROW, onSubmit));
        await act(async () => {
            context.setFieldValue("title", "T2");
        });
        await act(async () => {
            await context.submit();
        });
        expect(payloads).toEqual([{ title: "T2" }]);
    });

    it("once the record arrives, an untouched relation is not sent", async () => {
        const { payloads, onSubmit } = recordingSubmit(() => RECORD);
        const view = render(formFor(LIST_ROW, onSubmit));
        await act(async () => {
            view.rerender(formFor(RECORD, onSubmit));
        });
        await act(async () => {
            context.setFieldValue("title", "T2");
        });
        await act(async () => {
            await context.submit();
        });
        expect(payloads).toEqual([{ title: "T2" }]);
    });

    it.each([["before", false], ["after", true]])("a tag added %s the record arrives is added to every stored tag", async (_when, arrived) => {
        const { payloads, onSubmit } = recordingSubmit(() => RECORD);
        const view = render(formFor(LIST_ROW, onSubmit));
        if (arrived) {
            await act(async () => {
                view.rerender(formFor(RECORD, onSubmit));
            });
        }
        expect(context.values.tags).toEqual([tag(1), tag(2)]);
        await act(async () => {
            context.setFieldValue("tags", [...(context.values.tags as EntityRelation[]), tag(3)]);
        });
        if (!arrived) {
            await act(async () => {
                view.rerender(formFor(RECORD, onSubmit));
            });
        }
        await act(async () => {
            await context.submit();
        });
        expect(payloads).toEqual([{ tags: [tag(1), tag(2), tag(3)] }]);
    });

});
