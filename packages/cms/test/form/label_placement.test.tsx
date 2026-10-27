/**
 * @jest-environment jsdom
 */
/**
 * Where a record-form field's label goes.
 *
 * The one-line controls — text, numbers, dates, switches, single selects and a
 * one-line read-only value — carry their label inside their own box, the way
 * FireCMS draws a field, so they all stand the same height and two of them on a
 * row line up box to box. A multi-select keeps its label above: its chips wrap
 * onto more lines, and a label on the first of them reads as one more chip. So
 * do uploads, markdown, relations and anything with a custom editor, which the
 * form cannot vouch for.
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import type { Entity, Property } from "@rebasepro/types";

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
import { FieldBlock } from "../../src/form/components/FieldBlock";
import { labelsInsideControl } from "../../src/form/label_placement";

const inside = (property: object) => labelsInsideControl(property as Property);

describe("labelsInsideControl", () => {

    it("puts the label inside every one-line control", () => {
        expect(inside({ type: "string", name: "Name" })).toBe(true);
        expect(inside({ type: "string", name: "Email", email: true })).toBe(true);
        expect(inside({ type: "string", name: "Notes", admin: { multiline: true } })).toBe(true);
        expect(inside({ type: "number", name: "Price" })).toBe(true);
        expect(inside({ type: "boolean", name: "Featured" })).toBe(true);
        expect(inside({ type: "date", name: "Published" })).toBe(true);
        expect(inside({ type: "string", name: "Status", enum: { draft: "Draft", live: "Live" } })).toBe(true);
        expect(inside({ type: "number", name: "Rating", enum: { 1: "One", 2: "Two" } })).toBe(true);
    });

    it("keeps it above a multi-select, whose chips wrap", () => {
        expect(inside({ type: "array", name: "Tags", of: { type: "string", enum: { a: "A", b: "B" } } })).toBe(false);
        expect(inside({ type: "array", name: "Sizes", of: { type: "number", enum: { 1: "S", 2: "M" } } })).toBe(false);
    });

    it("keeps it above the editors that are not one line", () => {
        expect(inside({ type: "string", name: "Body", admin: { markdown: true } })).toBe(false);
        expect(inside({ type: "string", name: "Image", storage: { storagePath: "images" } })).toBe(false);
        expect(inside({ type: "map", name: "Address", properties: {} })).toBe(false);
        expect(inside({ type: "relation", name: "Author", relationName: "author" })).toBe(false);
    });

    it("keeps it above any editor the form cannot vouch for", () => {
        const Custom = () => null;
        expect(inside({ type: "string", name: "Colour", admin: { Field: Custom } })).toBe(false);
        expect(inside({ type: "string", name: "Colour", propertyConfig: "colour_picker" })).toBe(false);
        // A built-in editor a plugin has replaced is a custom editor too.
        expect(labelsInsideControl(
            { type: "string", name: "Name" } as Property,
            { text_field: { key: "text_field", name: "Text", property: { type: "string", admin: { Field: Custom } } } } as never
        )).toBe(false);
    });

    it("puts it inside a one-line read-only value, and above a long one", () => {
        expect(inside({ type: "number", name: "Subtotal", admin: { readOnly: true } })).toBe(true);
        expect(inside({ type: "date", name: "Created", autoValue: "on_create" })).toBe(true);
        expect(inside({ type: "string", name: "Body", admin: { readOnly: true, markdown: true } })).toBe(false);
    });
});

describe("FieldBlock with the label inside the control", () => {

    const property = {
        type: "number",
        name: "Subtotal",
        description: "Sum of all line items before tax and shipping"
    } as never;

    it("draws no label row, and still the description, indented to the value", () => {
        render(
            <FieldBlock propertyKey={"subtotal"} property={property} showLabel={false} labelInside>
                <span>185.11</span>
            </FieldBlock>
        );
        expect(screen.queryByText("Subtotal")).toBeNull();
        const description = screen.getByText("Sum of all line items before tax and shipping");
        expect(description.parentElement?.className).toContain("ml-3.5");
        // The key the label row used to reveal sits on the description's line.
        expect(description.parentElement?.querySelector("button")).toBeTruthy();
    });

    it("keeps the key hint for a field with no description, hanging below the box", () => {
        const { container } = render(
            <FieldBlock propertyKey={"subtotal"}
                property={{ type: "number", name: "Subtotal" } as never}
                showLabel={false}
                labelInside>
                <span>185.11</span>
            </FieldBlock>
        );
        const hint = container.querySelector("button");
        expect(hint).toBeTruthy();
        expect(hint?.parentElement?.className).toContain("absolute");
    });
});

describe("the record form", () => {

    type Product = Record<string, unknown>;

    const properties = {
        name: { type: "string", name: "Name" },
        status: { type: "string", name: "Status", enum: { draft: "Draft", live: "Live" } },
        tags: { type: "array", name: "Tags", of: { type: "string", enum: { new: "New", sale: "Sale" } } }
    };

    function renderForm() {
        const values: Product = { name: "Moka pot", status: "draft", tags: ["new"] };
        render(<RebaseI18nProvider locale="en">
            <AuthControllerContext.Provider value={{ user: { uid: "u1" } } as never}>
                <CustomizationControllerContext.Provider
                    value={{ plugins: [], propertyConfigs: {}, entityActions: [], entityViews: [], resolvedSlots: [] } as never}>
                    <EntityForm<Product>
                        path="products"
                        entityId="1"
                        collection={{ slug: "products", name: "Products", properties } as never}
                        entity={{ id: "1", path: "products", values } as Entity<Product>}
                        initialStatus="existing"
                        onSubmit={jest.fn(async (v: Product) => ({ id: "1", path: "products", values: v }))}
                        computedInitialValues={values}/>
                </CustomizationControllerContext.Provider>
            </AuthControllerContext.Provider>
        </RebaseI18nProvider>);
    }

    /** The label of a field is a `<label>` when the control draws it inside. */
    const drawnInside = (key: string, name: string) =>
        Boolean(document.getElementById(`form_field_${key}`)
            ?.querySelector("label")
            ?.textContent?.includes(name));

    it("labels a text field and a single select inside their boxes", () => {
        renderForm();
        expect(drawnInside("name", "Name")).toBe(true);
        expect(drawnInside("status", "Status")).toBe(true);
        // Still named by the label it shows.
        expect(screen.getByRole("textbox", { name: "Name" })).toBeTruthy();
        expect(screen.getByRole("combobox", { name: "Status" })).toBeTruthy();
    });

    it("labels a multi-select above its box", () => {
        renderForm();
        expect(drawnInside("tags", "Tags")).toBe(false);
        const block = document.getElementById("form_field_tags");
        expect(block?.firstElementChild?.className).toContain("text-[13px]");
        expect(block?.firstElementChild?.textContent).toContain("Tags");
    });
});
