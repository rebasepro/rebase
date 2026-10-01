/**
 * @jest-environment jsdom
 */
/**
 * A text field the user empties holds `null`, not `""`.
 *
 * Typing a letter into a NULL subtitle and deleting it wrote `""` over the
 * NULL: `isNull` filters stopped matching the row, and on an optional unique
 * column (an email, a SKU) the second such record collided with the first. The
 * form already treats `""` as missing for `required`; the value it writes now
 * says the same thing.
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Entity, StringProperty } from "@rebasepro/types";
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
import { getTableBindingForProperty } from "../../src/components/CollectionTableBinding/table_bindings";

type Post = Record<string, unknown>;

const properties = {
    title: { type: "string", name: "Title" },
    subtitle: { type: "string", name: "Subtitle" },
    summary: { type: "string", name: "Summary", admin: { multiline: true } }
};

async function clearAndSave(stored: Post, field: "subtitle" | "summary", typeFirst?: string) {
    const collection = { slug: "posts", name: "Posts", properties } as never;
    const payloads: Post[] = [];
    let ctx: FormContext<Post> | undefined;
    render(<RebaseI18nProvider locale="en">
        <AuthControllerContext.Provider value={{ user: { uid: "u1" } } as never}>
            <CustomizationControllerContext.Provider
                value={{ plugins: [], propertyConfigs: {}, entityActions: [], entityViews: [], resolvedSlots: [] } as never}>
                <EntityForm<Post>
                    path="posts"
                    entityId="1"
                    collection={collection}
                    entity={{ id: "1", path: "posts", values: stored } as Entity<Post>}
                    initialStatus="existing"
                    onFormContextReady={(c) => {
                        ctx = c;
                    }}
                    onSubmit={jest.fn(async (v: Post) => {
                        payloads.push(v);
                        return { id: "1", path: "posts", values: { ...stored, ...v } };
                    })}
                    computedInitialValues={stored}/>
            </CustomizationControllerContext.Provider>
        </AuthControllerContext.Provider>
    </RebaseI18nProvider>);
    const label = field === "subtitle" ? "Subtitle" : "Summary";
    const input = screen.getByLabelText(label) as HTMLInputElement;
    if (typeFirst !== undefined) {
        await act(async () => {
            fireEvent.change(input, { target: { value: typeFirst } });
        });
    }
    await act(async () => {
        fireEvent.change(input, { target: { value: "" } });
    });
    await act(async () => {
        await ctx!.submit();
    });
    return { payloads };
}

describe("an emptied text field", () => {

    it("goes back to NULL, so a stored NULL is not overwritten", async () => {
        const { payloads } = await clearAndSave({ title: "T", subtitle: null }, "subtitle", "x");
        expect(payloads).toEqual([]);
    });

    it("writes NULL when a stored value is cleared", async () => {
        const { payloads } = await clearAndSave({ title: "T", subtitle: "Old" }, "subtitle");
        expect(payloads).toEqual([{ subtitle: null }]);
    });

    it("does the same in a multiline field", async () => {
        const { payloads } = await clearAndSave({ title: "T", summary: "Old" }, "summary");
        expect(payloads).toEqual([{ summary: null }]);
    });
});

describe("an emptied text cell in the table", () => {
    it("writes NULL", async () => {
        const property: StringProperty = { type: "string", name: "Subtitle" };
        const binding = getTableBindingForProperty(property, true)!;
        const updateValue = jest.fn();
        const Cell = binding.Component;
        render(<Cell
            {...({
                propertyKey: "subtitle",
                property,
                disabled: false,
                selected: true,
                size: "m",
                internalValue: "Old",
                updateValue
            } as never)}/>);
        const textarea = screen.getByDisplayValue("Old");
        await act(async () => {
            fireEvent.change(textarea, { target: { value: "" } });
        });
        await waitFor(() => expect(updateValue).toHaveBeenCalled());
        expect(updateValue).toHaveBeenLastCalledWith(null);
    });
});
