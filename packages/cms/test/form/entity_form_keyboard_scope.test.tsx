/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render } from "@testing-library/react";
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
 * ⌘S / ⌘Z belong to one record form: the one the focus is in, or — with the
 * focus nowhere in particular — the one opened last (the top panel).
 *
 * Every mounted form listened on `window`, and the first one mounted took the
 * keystroke. With record A edited and related record B opened above it, ⌘S
 * typed in B saved A. In the split view, ⌘Z typed in a table cell's editor
 * undid the record form beside it.
 */

type Post = Record<string, unknown>;
const collection = { slug: "posts", name: "Posts", properties: { title: { type: "string", name: "Title" } } } as never;

const contexts: Record<string, FormContext<Post>> = {};

function formFor(id: string, onSubmit: (values: Post) => Promise<Entity<Post>>) {
    function Capture({ formContext }: EntityCustomViewParams<Post>) {
        contexts[id] = formContext;
        return <input data-testid={`field-${id}`}/>;
    }
    const entity = { id, path: "posts", values: { title: "Stored" } };
    return <EntityForm<Post>
        key={id}
        path="posts"
        entityId={id}
        collection={collection}
        entity={entity}
        initialStatus="existing"
        Builder={Capture}
        onSubmit={onSubmit}
        computedInitialValues={entity.values}/>;
}

function setup() {
    const saved: string[] = [];
    const submit = (id: string) => async (values: Post) => {
        saved.push(id);
        return { id, path: "posts", values: { title: "Stored", ...values } };
    };
    const view = render(<>
        {formFor("A", submit("A"))}
        {formFor("B", submit("B"))}
        <input data-testid="table-cell"/>
    </>);
    return { saved, view };
}

async function editBoth() {
    await act(async () => {
        contexts.A.setFieldValue("title", "Edited A");
        contexts.B.setFieldValue("title", "Edited B");
    });
}

const save = (target: Element | Window) => act(async () => {
    fireEvent.keyDown(target, { key: "s", metaKey: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
});

describe("the form's keyboard shortcuts", () => {
    it("save only the form the focus is in", async () => {
        const { saved, view } = setup();
        await editBoth();

        const fieldA = view.getByTestId("field-A");
        fieldA.focus();
        await save(fieldA);

        expect(saved).toEqual(["A"]);
    });

    it("save the form the focus is in, though another was opened first", async () => {
        const { saved, view } = setup();
        await editBoth();

        const fieldB = view.getByTestId("field-B");
        fieldB.focus();
        await save(fieldB);

        expect(saved).toEqual(["B"]);
    });

    it("save only the form opened last when the focus is in none", async () => {
        const { saved } = setup();
        await editBoth();

        (document.activeElement as HTMLElement | null)?.blur();
        await save(document.body);

        expect(saved).toEqual(["B"]);
    });

    it("leave an editor outside every form to its own undo", async () => {
        setup();
        await editBoth();

        const cell = document.querySelector("[data-testid=table-cell]") as HTMLInputElement;
        cell.focus();
        await act(async () => {
            fireEvent.keyDown(cell, { key: "z", metaKey: true });
        });

        expect(contexts.A.values.title).toBe("Edited A");
        expect(contexts.B.values.title).toBe("Edited B");
    });
});
