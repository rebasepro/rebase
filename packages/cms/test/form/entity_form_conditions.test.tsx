/**
 * @jest-environment jsdom
 */
/**
 * `conditions` and `dynamicProps` are what the form judges on save.
 *
 * The docs teach both (`collections/validation-and-conditions.mdx`) and Studio
 * has a whole editor that writes `conditions`, but the form built its
 * validation from the raw `collection.properties`: a `dynamicProps` validation
 * was never checked, a `conditions.required` rule never required anything, and
 * a required field kept out of the form with `conditions.hidden` blocked every
 * save with nothing on screen to fix.
 *
 * The two documented examples are read out of the page itself, so the docs
 * cannot teach a rule the form does not apply.
 */
import React from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, jest } from "@jest/globals";
import { act, render, screen } from "@testing-library/react";
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
        useAuthController: () => ({ user: { uid: "u1", roles: ["admin"] } }),
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
import { getInitialEntityValues } from "../../src/form/form_utils";

type Row = Record<string, unknown>;

function entityOf(values: Row): Entity<Row> {
    return { id: "1", path: "products", values };
}

async function submit(properties: Record<string, unknown>, values: Row, status: "new" | "existing" = "new") {
    const collection = { slug: "products", name: "Products", properties } as never;
    const onSubmit = jest.fn(async (v: Row) => entityOf(v));
    let ctx: FormContext<Row> | undefined;
    const Capture = ({ formContext }: EntityCustomViewParams<Row>) => {
        ctx = formContext;
        return null;
    };
    render(<EntityForm<Row>
        path="products"
        entityId={status === "existing" ? "1" : undefined}
        entity={status === "existing" ? entityOf(values) : undefined}
        collection={collection}
        initialStatus={status}
        Builder={Capture}
        onFormContextReady={(c) => {
            ctx = c;
        }}
        onSubmit={onSubmit}
        computedInitialValues={values}/>);
    await act(async () => {
        await ctx!.submit();
    });
    return { onSubmit, errors: ctx!.formex.errors };
}

/**
 * The `price: { … }` property of the fence under `heading` in the docs page,
 * evaluated. The fences are object-literal fragments in plain JavaScript.
 */
function documentedPrice(heading: string): Record<string, unknown> {
    const page = readFileSync(
        path.resolve(__dirname, "../../../../website/src/content/docs/docs/collections/validation-and-conditions.mdx"),
        "utf8"
    );
    const section = page.slice(page.indexOf(heading));
    const fence = section.match(/```typescript\n([\s\S]*?)```/);
    if (!fence) throw new Error(`No example under '${heading}'`);
    const body = fence[1].trim();
    if (!body.startsWith("price:")) throw new Error(`The example under '${heading}' no longer declares 'price'`);
    // eslint-disable-next-line no-new-func
    return new Function(`return ({ ${body} });`)().price as Record<string, unknown>;
}

describe("the documented examples are what the form checks", () => {

    it("JSON Logic conditions: a price below the conditional min is refused unless the item is free", async () => {
        const price = documentedPrice("### 1. JSON Logic Conditions");
        const refused = await submit({ is_free: { type: "boolean" }, price }, { is_free: false, price: -5 });
        expect(refused.onSubmit).not.toHaveBeenCalled();
        expect(refused.errors.price).toBeTruthy();

        const missing = await submit({ is_free: { type: "boolean" }, price }, { is_free: false, price: null });
        expect(missing.onSubmit).not.toHaveBeenCalled();
        expect(missing.errors.price).toBe("Required");

        const free = await submit({ is_free: { type: "boolean" }, price }, { is_free: true, price: null });
        expect(free.onSubmit).toHaveBeenCalledTimes(1);
    });

    it("Property builders: a dynamicProps validation is checked on save", async () => {
        const price = documentedPrice("### 2. Property Builders");
        const refused = await submit({ is_free: { type: "boolean" }, price }, { is_free: false, price: -5 });
        expect(refused.onSubmit).not.toHaveBeenCalled();
        expect(refused.errors.price).toBeTruthy();

        const free = await submit({ is_free: { type: "boolean" }, price }, { is_free: true, price: -5 });
        expect(free.onSubmit).toHaveBeenCalledTimes(1);
    });
});

describe("conditions on save", () => {

    it("a conditions.required rule requires the field", async () => {
        const { onSubmit, errors } = await submit({
            title: { type: "string", conditions: { required: { "==": [1, 1] } } }
        }, { title: null });
        expect(onSubmit).not.toHaveBeenCalled();
        expect(errors.title).toBe("Required");
    });

    it("a required property kept out of the form by conditions.hidden does not block the save", async () => {
        const { onSubmit } = await submit({
            title: { type: "string" },
            tenant: { type: "string", validation: { required: true }, conditions: { hidden: true } }
        }, { title: "x", tenant: null });
        expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    it("a required property hidden by a rule that holds does not block the save", async () => {
        const { onSubmit } = await submit({
            kind: { type: "string" },
            vat: {
                type: "string",
                validation: { required: true },
                conditions: { hidden: { "==": [{ var: "values.kind" }, "personal"] } }
            }
        }, { kind: "personal", vat: null });
        expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    it("the same property is required again when the rule stops hiding it", async () => {
        const { onSubmit, errors } = await submit({
            kind: { type: "string" },
            vat: {
                type: "string",
                validation: { required: true },
                conditions: { hidden: { "==": [{ var: "values.kind" }, "personal"] } }
            }
        }, { kind: "business", vat: null });
        expect(onSubmit).not.toHaveBeenCalled();
        expect(errors.vat).toBe("Required");
    });

    it("a condition inside a map is applied to that map's field", async () => {
        const { onSubmit, errors } = await submit({
            address: {
                type: "map",
                properties: {
                    country: { type: "string" },
                    zip: { type: "string", conditions: { required: { "==": [{ var: "values.address.country" }, "IT"] } } }
                }
            }
        }, { address: { country: "IT", zip: null } });
        expect(onSubmit).not.toHaveBeenCalled();
        expect(errors).toHaveProperty(["address", "zip"], "Required");
    });
});

describe("conditions where the field is drawn", () => {

    function renderFields(properties: Record<string, unknown>, values: Row) {
        const collection = { slug: "products", name: "Products", properties } as never;
        render(<RebaseI18nProvider locale="en">
            <AuthControllerContext.Provider value={{ user: { uid: "u1" } } as never}>
                <CustomizationControllerContext.Provider
                    value={{ plugins: [], propertyConfigs: {}, entityActions: [], entityViews: [], resolvedSlots: [] } as never}>
                    <EntityForm<Row>
                        path="products"
                        entityId="1"
                        entity={entityOf(values)}
                        collection={collection}
                        initialStatus="existing"
                        onSubmit={jest.fn(async (v: Row) => entityOf(v))}
                        computedInitialValues={values}/>
                </CustomizationControllerContext.Provider>
            </AuthControllerContext.Provider>
        </RebaseI18nProvider>);
    }

    it("a rule that holds hides the field, label and all", () => {
        renderFields({
            kind: { type: "string", name: "Kind" },
            vat: { type: "string", name: "VAT number", conditions: { hidden: { "==": [{ var: "values.kind" }, "personal"] } } }
        }, { kind: "personal", vat: null });
        expect(screen.queryByText("VAT number")).toBeNull();
    });

    it("a rule that does not hold leaves it on screen", () => {
        renderFields({
            kind: { type: "string", name: "Kind" },
            vat: { type: "string", name: "VAT number", conditions: { hidden: { "==": [{ var: "values.kind" }, "personal"] } } }
        }, { kind: "business", vat: null });
        expect(screen.queryAllByText("VAT number").length).toBeGreaterThan(0);
    });

    it("a disabled rule that holds disables the control", () => {
        renderFields({
            locked: { type: "boolean", name: "Locked" },
            title: { type: "string", name: "Title", conditions: { disabled: { "==": [{ var: "values.locked" }, true] } } }
        }, { locked: true, title: "Fixed" });
        expect((screen.getByDisplayValue("Fixed") as HTMLInputElement).disabled).toBe(true);
    });
});

describe("conditions.defaultValue", () => {
    it("is what a new record opens with", () => {
        const collection = {
            slug: "products",
            name: "Products",
            properties: {
                currency: { type: "string", defaultValue: "USD", conditions: { defaultValue: { cat: ["E", "UR"] } } },
                name: { type: "string" }
            }
        } as never;
        const values = getInitialEntityValues({ user: { uid: "u1" } } as never, collection, "products", "new", undefined);
        expect(values).toEqual({ currency: "EUR", name: null });
    });
});
