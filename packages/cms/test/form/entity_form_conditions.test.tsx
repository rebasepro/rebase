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
 * The documented example is read out of the page itself, so the docs cannot
 * teach a rule the form does not apply.
 */
import React from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, jest } from "@jest/globals";
import { act, render, screen } from "@testing-library/react";
import type { Entity, PostgresProperties, PostgresProperty } from "@rebasepro/types";
import type { AdminCollection, EntityCustomViewParams, FormContext, TableCustomizationOptions } from "@rebasepro/cms-types";
import { col, defineTable } from "@rebasepro/types";
import { compileTables } from "@rebasepro/common";

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
import { rowOf, saving } from "../helpers/form_rows";
import { fakeAuthController, fakeCustomization, fakeUser } from "../helpers/fakes";
import { collectionsFromTables } from "../../src/tables/project_table";
import { applyTableCustomization } from "../../src/tables/apply_customization";
import { customizeTable } from "../../src/tables/customize_table";
import { registeredCollection } from "../../src/hooks/navigation/registered_collection";

type Row = Record<string, unknown>;

function entityOf(values: Row): Entity<Row> {
    return { id: "1", path: "products", values };
}

async function submit(properties: PostgresProperties, values: Row, status: "new" | "existing" = "new") {
    const collection: AdminCollection = { slug: "products", name: "Products", properties };
    const onSubmit = jest.fn(async (v: Row) => entityOf(v));
    let ctx: FormContext<Row> | undefined;
    const Capture = ({ formContext }: EntityCustomViewParams<Row>) => {
        ctx = formContext;
        return null;
    };
    render(<EntityForm<Row>
        path="products"
        id={status === "existing" ? "1" : undefined}
        row={rowOf(status === "existing" ? entityOf(values) : undefined)}
        collection={collection}
        initialStatus={status}
        Builder={Capture}
        onFormContextReady={(c) => {
            ctx = c;
        }}
        onSubmit={saving(onSubmit)}
        computedInitialValues={values}/>);
    await act(async () => {
        await ctx!.submit();
    });
    return { onSubmit, errors: ctx!.formex.errors };
}

/**
 * The `customizeTable(...)` of the docs page's "Conditional fields" example,
 * evaluated and folded over an `events` table with the columns it names. The
 * options are an object literal in plain JavaScript.
 */
function documentedEvents(): AdminCollection {
    const page = readFileSync(
        path.resolve(__dirname, "../../../../website/src/content/docs/docs/collections/validation-and-conditions.mdx"),
        "utf8"
    );
    const section = page.slice(page.indexOf("## Conditional fields"));
    const fence = section.match(/```tsx\n([\s\S]*?)```/);
    if (!fence) throw new Error("No example under '## Conditional fields'");
    const call = fence[1].match(/customizeTable<typeof events>\("events", (\{[\s\S]*\})\);/);
    if (!call) throw new Error("The example under '## Conditional fields' no longer customizes the events table");
    // eslint-disable-next-line no-new-func
    const options: TableCustomizationOptions = new Function(`return (${call[1]});`)();
    const events = defineTable("events", {
        rls: "admin-only",
        columns: {
            id: col.uuid().primaryKey().defaultRandom(),
            isFree: col.boolean(),
            price: col.numeric(),
            seats: col.integer()
        }
    });
    const [projected] = collectionsFromTables(compileTables([events]));
    return registeredCollection(applyTableCustomization(projected, customizeTable("events", options)));
}

function documentedProperty(key: string): PostgresProperty {
    const property = documentedEvents().properties[key];
    if (!property) throw new Error(`The documented example no longer customizes '${key}'`);
    return property;
}

describe("the documented example is what the form checks", () => {

    it("JSON Logic conditions: a price below the conditional min is refused unless the event is free", async () => {
        const price = documentedProperty("price");
        const refused = await submit({ isFree: { type: "boolean" }, price }, { isFree: false, price: -5 });
        expect(refused.onSubmit).not.toHaveBeenCalled();
        expect(refused.errors.price).toBeTruthy();

        const missing = await submit({ isFree: { type: "boolean" }, price }, { isFree: false, price: null });
        expect(missing.onSubmit).not.toHaveBeenCalled();
        expect(missing.errors.price).toBe("Required");

        const free = await submit({ isFree: { type: "boolean" }, price }, { isFree: true, price: null });
        expect(free.onSubmit).toHaveBeenCalledTimes(1);
    });

    it("dynamicProps: seats are disabled for a free event and for anyone but an admin", () => {
        const seats = documentedProperty("seats");
        const disabled = (values: Row, roles: string[]): unknown => {
            if (!seats.dynamicProps) throw new Error("The documented seats field has no dynamicProps");
            const resolved = seats.dynamicProps({
                values,
                previousValues: values,
                propertyValue: values.seats,
                path: "events",
                id: "1",
                authController: fakeAuthController({ user: fakeUser("u1", { roles }) })
            });
            return resolved.admin?.disabled;
        };
        expect(disabled({ isFree: false }, ["admin"])).toBe(false);
        expect(disabled({ isFree: true }, ["admin"])).toBe(true);
        expect(disabled({ isFree: false }, ["editor"])).toBe(true);
    });
});

describe("dynamicProps on save", () => {

    it("a dynamicProps validation is checked on save", async () => {
        const price: PostgresProperty = {
            type: "number",
            name: "Price",
            dynamicProps: ({ values }) => ({
                validation: values.isFree ? {} : { required: true, min: 0 }
            })
        };
        const refused = await submit({ isFree: { type: "boolean" }, price }, { isFree: false, price: -5 });
        expect(refused.onSubmit).not.toHaveBeenCalled();
        expect(refused.errors.price).toBeTruthy();

        const free = await submit({ isFree: { type: "boolean" }, price }, { isFree: true, price: -5 });
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

    function renderFields(properties: PostgresProperties, values: Row) {
        const collection: AdminCollection = { slug: "products", name: "Products", properties };
        render(<RebaseI18nProvider locale="en">
            <AuthControllerContext.Provider value={fakeAuthController({ user: fakeUser("u1") })}>
                <CustomizationControllerContext.Provider
                    value={fakeCustomization()}>
                    <EntityForm<Row>
                        path="products"
                        id="1"
                        row={rowOf(entityOf(values))}
                        collection={collection}
                        initialStatus="existing"
                        onSubmit={saving(jest.fn(async (v: Row) => entityOf(v)))}
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
        const collection: AdminCollection = {
            slug: "products",
            name: "Products",
            properties: {
                currency: { type: "string", defaultValue: "USD", conditions: { defaultValue: { cat: ["E", "UR"] } } },
                name: { type: "string" }
            }
        };
        const values = getInitialEntityValues(fakeAuthController({ user: fakeUser("u1") }), collection, "products", "new", undefined);
        expect(values).toEqual({ currency: "EUR", name: null });
    });
});
