/**
 * @jest-environment jsdom
 */
/**
 * The record form as parts: `<FormField>` places one field anywhere inside a
 * form, `fields` picks which the generated form shows, and a form showing some
 * of its fields judges those and no others.
 *
 * A form that showed three fields and validated all of them blocked the save
 * on a fourth nobody could see. One that creates a record without a required
 * field it never shows can only fail, so it says which ones when it opens.
 */
import React from "react";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { AdminCollection, EntityCustomViewParams, FieldProps, PostgresProperties, Entity } from "@rebasepro/cms-types";

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

// Renders of the stock text binding, by property key.
const mockRenders: Record<string, number> = {};
jest.mock("../../src/form/field_bindings/TextFieldBinding", () => {
    const actual = jest.requireActual("../../src/form/field_bindings/TextFieldBinding") as {
        TextFieldBinding: React.ComponentType<FieldProps>
    };
    const mockReact = jest.requireActual("react") as typeof React;
    return {
        ...actual,
        TextFieldBinding: (props: FieldProps) => {
            mockRenders[props.propertyKey] = (mockRenders[props.propertyKey] ?? 0) + 1;
            return mockReact.createElement(actual.TextFieldBinding, props);
        }
    };
});

import { AuthControllerContext, CustomizationControllerContext, RebaseI18nProvider } from "@rebasepro/app";
import { EntityForm } from "../../src/form/EntityForm";
import { FormField } from "../../src/form/FormField";
import { useFormexGetter } from "@rebasepro/forms";
import { rowOf, saving } from "../helpers/form_rows";
import { fakeAuthController, fakeCustomization, fakeUser } from "../helpers/fakes";

type Row = Record<string, unknown>;

function Providers({ children }: { children: React.ReactNode }) {
    return <RebaseI18nProvider locale="en">
        <AuthControllerContext.Provider value={fakeAuthController({ user: fakeUser("u1", { roles: ["admin"] }) })}>
            <CustomizationControllerContext.Provider
                value={fakeCustomization()}>
                {children}
            </CustomizationControllerContext.Provider>
        </AuthControllerContext.Provider>
    </RebaseI18nProvider>;
}

const properties: PostgresProperties = {
    name: { type: "string", name: "Name" },
    sku: { type: "string", name: "SKU", validation: { required: true } },
    status: { type: "string", name: "Status" },
    notes: { type: "string", name: "Notes" }
};
const collection: AdminCollection = { slug: "products", name: "Products", properties };

function renderForm({ values, status = "existing", fields, layout, Builder }: {
    values: Row,
    status?: "existing" | "new",
    fields?: string[],
    layout?: React.ReactNode,
    Builder?: React.ComponentType<EntityCustomViewParams<Row>>
}) {
    const onSubmit = jest.fn(async (v: Row) => ({ id: "1", path: "products", values: { ...values, ...v } }) as Entity<Row>);
    const view = render(<Providers>
        <EntityForm<Row>
            path="products"
            id={status === "existing" ? "1" : undefined}
            collection={collection}
            row={rowOf(status === "existing" ? { id: "1", path: "products", values } : undefined)}
            initialStatus={status}
            onSubmit={saving(onSubmit)}
            computedInitialValues={values}
            fields={fields}
            layout={layout}
            Builder={Builder}/>
    </Providers>);
    return { ...view, onSubmit };
}

/** The keys of the field blocks on the page, in document order. */
function shownKeys(): string[] {
    return Array.from(document.querySelectorAll("[data-form-field]")).map(el => el.getAttribute("data-form-field") ?? "");
}

async function settle() {
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
}

async function type(label: string | RegExp, value: string) {
    await act(async () => {
        fireEvent.change(screen.getByLabelText(label), { target: { value } });
    });
}

async function save() {
    await act(async () => {
        fireEvent.submit(document.querySelector("form")!);
        await new Promise(r => setTimeout(r, 0));
    });
}

beforeEach(() => {
    for (const key of Object.keys(mockRenders)) delete mockRenders[key];
});

describe("fields", () => {
    it("shows only the fields named, in their order", async () => {
        renderForm({ values: { name: "Moka", sku: "M1", status: "live", notes: "" }, fields: ["status", "name"] });
        await settle();
        expect(shownKeys()).toEqual(["status", "name"]);
    });

    it("keeps a section's grouping, holding only the fields named, in their order", async () => {
        const sectioned: AdminCollection = {
            slug: "products",
            name: "Products",
            properties,
            form: { sections: [{ key: "main", title: "Main", properties: ["name", "sku", "status"] }] }
        };
        render(<Providers>
            <EntityForm<Row> path="products" id="1" collection={sectioned}
                row={rowOf({ id: "1", path: "products", values: {} })} initialStatus="existing"
                computedInitialValues={{}} fields={["status", "name", "notes"]}/>
        </Providers>);
        await settle();
        expect(screen.getByText("Main")).toBeTruthy();
        expect(shownKeys()).toEqual(["status", "name", "notes"]);
    });

    it("saves an edit without judging a required field it does not show", async () => {
        const { onSubmit } = renderForm({ values: { name: "Moka", sku: null, status: "live" }, fields: ["name"] });
        await settle();
        await type("Name", "Moka pot");
        await save();
        expect(onSubmit).toHaveBeenCalledTimes(1);
        expect(onSubmit.mock.calls[0][0]).toEqual({ name: "Moka pot" });
    });

    it("still judges the fields it shows", async () => {
        const { onSubmit } = renderForm({ values: { name: "Moka", sku: "M1", status: "live" }, fields: ["sku"] });
        await settle();
        await type(/^SKU/, "");
        await save();
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it("refuses to create a record without a required field it does not show, naming it", async () => {
        const { onSubmit } = renderForm({ values: { name: null, sku: null }, status: "new", fields: ["name"] });
        await settle();
        expect(screen.getByText(/without showing SKU/)).toBeTruthy();
        await type("Name", "Moka");
        await save();
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it("creates the record when the required field it does not show already holds a value", async () => {
        const { onSubmit } = renderForm({ values: { name: null, sku: "M1" }, status: "new", fields: ["name"] });
        await settle();
        expect(screen.queryByText(/without showing/)).toBeNull();
        await type("Name", "Moka");
        await save();
        expect(onSubmit).toHaveBeenCalledTimes(1);
    });
});

describe("<FormField> in a layout", () => {
    it("renders the fields the layout places, and none of the generated ones", async () => {
        renderForm({
            values: { name: "Moka", sku: "M1", status: "live", notes: "" },
            layout: <div data-testid="mine"><FormField name="notes"/><FormField name="name"/></div>
        });
        await settle();
        expect(shownKeys()).toEqual(["notes", "name"]);
        // Inside the form, so it binds to it.
        expect(screen.getByTestId("mine").closest("form")).toBeTruthy();
        expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Moka");
    });

    it("saves what is typed into it, judging only the fields it shows", async () => {
        const { onSubmit } = renderForm({
            values: { name: "Moka", sku: null, status: "live" },
            layout: <FormField name="name"/>
        });
        await settle();
        await type("Name", "Moka pot");
        await save();
        expect(onSubmit).toHaveBeenCalledTimes(1);
        expect(onSubmit.mock.calls[0][0]).toEqual({ name: "Moka pot" });
    });

    it("judges a field the edit changed on a tab that is no longer shown", async () => {
        function Tabbed() {
            const [tab, setTab] = React.useState<"codes" | "names">("codes");
            return <>
                <button type="button" onClick={() => setTab("names")}>Names</button>
                {tab === "codes" ? <FormField name="sku"/> : <FormField name="name"/>}
            </>;
        }
        const { onSubmit } = renderForm({ values: { name: "Moka", sku: "M1", status: "live" }, layout: <Tabbed/> });
        await settle();
        await type(/^SKU/, "");
        await act(async () => {
            fireEvent.click(screen.getByText("Names"));
        });
        expect(shownKeys()).toEqual(["name"]);
        await save();
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it("judges what was edited even when the layout places no field", async () => {
        // An edit made some other way than a field: a button of the layout's own.
        function ClearSku() {
            const formex = useFormexGetter<Row>();
            return <button type="button" onClick={() => formex().setFieldValue("sku", "")}>Clear SKU</button>;
        }
        const { onSubmit } = renderForm({ values: { name: "Moka", sku: "M1", status: "live" }, layout: <ClearSku/> });
        await settle();
        expect(shownKeys()).toEqual([]);
        await act(async () => {
            fireEvent.click(screen.getByText("Clear SKU"));
        });
        await save();
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it("refuses to create a record without a required field it does not place", async () => {
        const { onSubmit } = renderForm({
            values: { name: null, sku: null },
            status: "new",
            layout: <FormField name="name"/>
        });
        await settle();
        expect(screen.getByText(/without showing SKU/)).toBeTruthy();
        await type("Name", "Moka");
        await save();
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it("does not refuse once the layout places the required field", async () => {
        renderForm({
            values: { name: null, sku: null },
            status: "new",
            layout: <><FormField name="name"/><FormField name="sku"/></>
        });
        await settle();
        expect(screen.queryByText(/without showing/)).toBeNull();
    });

    it("re-renders the field typed into, and not the one beside it", async () => {
        renderForm({
            values: { name: "Moka", sku: "M1", status: "live", notes: "" },
            layout: <section><FormField name="name"/><FormField name="notes"/></section>
        });
        await settle();
        for (const key of Object.keys(mockRenders)) delete mockRenders[key];
        await type("Name", "Moka pot");
        expect(mockRenders.name ?? 0).toBeGreaterThanOrEqual(1);
        expect(mockRenders.notes ?? 0).toBe(0);
    });

    it("works inside a collection's Builder", async () => {
        const Builder = () => <FormField name="status"/>;
        renderForm({ values: { name: "Moka", sku: "M1", status: "live" }, Builder });
        await settle();
        expect(shownKeys()).toEqual(["status"]);
    });

    it("says where it belongs when rendered outside a form", () => {
        const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
        expect(() => render(<FormField name="name"/>)).toThrow(/outside a record form/);
        spy.mockRestore();
    });

    it("names the field the collection lacks", async () => {
        const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
        renderForm({ values: {}, layout: <FormField name="nope"/> });
        await settle();
        expect(screen.getByText(/"products" has no property or additional field named "nope"/)).toBeTruthy();
        spy.mockRestore();
    });
});

describe("two forms on one page", () => {
    it("give their fields and sections ids of their own, and the same attributes", async () => {
        const values = { name: "Moka", sku: "M1", status: "live" };
        render(<Providers>
            {[1, 2].map(n =>
                <EntityForm<Row> key={n} path="products" id={String(n)} collection={collection}
                    row={rowOf({ id: String(n), path: "products", values })} initialStatus="existing"
                    computedInitialValues={values}/>)}
        </Providers>);
        await settle();

        const ids = Array.from(document.querySelectorAll("[id]")).map(el => el.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(document.querySelectorAll("[data-form-field=\"name\"]")).toHaveLength(2);
        expect(document.querySelectorAll("[data-form-path=\"products\"]")).toHaveLength(2);
    });
});
