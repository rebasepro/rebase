/**
 * @jest-environment jsdom
 */
/**
 * One keystroke re-renders the field it went into, not the whole form.
 *
 * Every field used to re-render on every keystroke anywhere in the record
 * form: `PropertyFieldBinding`'s memo comparator returned `false` on every
 * path, and the form controller changed identity on every `EntityForm` render
 * because its callbacks closed over inline `validation`/`onSubmit`/`onReset`.
 * In a 40-field form with a 500-item array that was 540 binding renders per
 * character — ~290 ms in React's dev build, visible typing lag in production.
 *
 * What still has to re-render on any change: a field that reads the rest of
 * the form while it renders — a custom `admin.Field`, `dynamicProps`,
 * `conditions` — and a memoised field must still read the current values
 * through `context.values` from its callbacks.
 */
import React from "react";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { FieldProps, FormContext } from "@rebasepro/cms-types";

class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
}
Object.assign(global, { ResizeObserver: ResizeObserverStub });

// Calls of `flattenKeys` on a draft handed to the form, by the draft.
const mockFlattened = new Map<unknown, number>();
jest.mock("@rebasepro/app", () => {
    const actualFlattenKeys = (jest.requireActual("@rebasepro/app") as { flattenKeys: (o: unknown) => string[] }).flattenKeys;
    const overrides: Record<string, unknown> = {
        flattenKeys: (o: unknown) => {
            mockFlattened.set(o, (mockFlattened.get(o) ?? 0) + 1);
            return actualFlattenKeys(o);
        },
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

// Renders of the stock text binding, by property key, and the `context` each
// key was last rendered with.
const mockRenders: Record<string, number> = {};
const mockContexts: Record<string, FormContext> = {};
jest.mock("../../src/form/field_bindings/TextFieldBinding", () => {
    const actual = jest.requireActual("../../src/form/field_bindings/TextFieldBinding") as {
        TextFieldBinding: React.ComponentType<FieldProps>
    };
    const mockReact = jest.requireActual("react") as typeof React;
    return {
        ...actual,
        TextFieldBinding: (props: FieldProps) => {
            mockRenders[props.propertyKey] = (mockRenders[props.propertyKey] ?? 0) + 1;
            mockContexts[props.propertyKey] = props.context;
            return mockReact.createElement(actual.TextFieldBinding, props);
        }
    };
});

import { AuthControllerContext, CustomizationControllerContext, RebaseI18nProvider } from "@rebasepro/app";
import { EntityForm } from "../../src/form/EntityForm";

type Row = Record<string, unknown>;

function renderForm(properties: Row, values: Row) {
    const collection = { slug: "posts", name: "Posts", properties } as never;
    return render(<RebaseI18nProvider locale="en">
        <AuthControllerContext.Provider value={{ user: { uid: "u1" } } as never}>
            <CustomizationControllerContext.Provider
                value={{ plugins: [], propertyConfigs: {}, entityActions: [], entityViews: [], resolvedSlots: [] } as never}>
                <EntityForm<Row>
                    path="posts"
                    entityId="1"
                    collection={collection}
                    entity={{ id: "1", path: "posts", values } as never}
                    initialStatus="existing"
                    onSubmit={jest.fn(async (v: Row) => ({ id: "1", path: "posts", values: v })) as never}
                    computedInitialValues={values}/>
            </CustomizationControllerContext.Provider>
        </AuthControllerContext.Provider>
    </RebaseI18nProvider>);
}

function fortyFields(): { properties: Row, values: Row } {
    const properties: Row = {};
    const values: Row = {};
    for (let i = 0; i < 40; i++) {
        properties["f" + i] = { type: "string", name: "F" + i };
        values["f" + i] = "v" + i;
    }
    return { properties, values };
}

function resetCounts() {
    for (const key of Object.keys(mockRenders)) delete mockRenders[key];
}

function rendersOf(predicate: (key: string) => boolean): number {
    return Object.entries(mockRenders)
        .filter(([key]) => predicate(key))
        .reduce((sum, [, n]) => sum + n, 0);
}

async function type(label: string, value: string) {
    await act(async () => {
        fireEvent.change(screen.getByLabelText(label), { target: { value } });
    });
}

describe("a keystroke in a 40-field form with a 500-item array", () => {

    beforeEach(() => resetCounts());

    it("re-renders the binding typed into, and no other", async () => {
        const { properties, values } = fortyFields();
        properties.items = { type: "array", name: "Items", of: { type: "string", name: "Item" } };
        values.items = Array.from({ length: 500 }, (_, i) => "item" + i);

        renderForm(properties, values);
        await act(async () => { await new Promise(r => setTimeout(r, 0)); });
        expect(rendersOf(key => key.startsWith("items."))).toBe(500);

        for (let k = 1; k <= 3; k++) {
            resetCounts();
            await type("F0", "v0" + "x".repeat(k));
            expect(rendersOf(key => key === "f0")).toBeGreaterThanOrEqual(1);
            expect(rendersOf(key => key === "f0")).toBeLessThanOrEqual(2);
            expect(rendersOf(key => /^f\d+$/.test(key) && key !== "f0")).toBe(0);
            expect(rendersOf(key => key.startsWith("items."))).toBe(0);
        }
        expect((screen.getByLabelText("F0") as HTMLInputElement).value).toBe("v0xxx");
    });

    it("re-renders only the array item typed into", async () => {
        const { properties, values } = fortyFields();
        properties.items = { type: "array", name: "Items", of: { type: "string", name: "Item" } };
        values.items = Array.from({ length: 500 }, (_, i) => "item" + i);

        renderForm(properties, values);
        await act(async () => { await new Promise(r => setTimeout(r, 0)); });

        resetCounts();
        const itemInputs = screen.getAllByLabelText("Item") as HTMLInputElement[];
        await act(async () => {
            fireEvent.change(itemInputs[250], { target: { value: "edited" } });
        });
        expect(rendersOf(key => key === "items.250")).toBeGreaterThanOrEqual(1);
        expect(rendersOf(key => key.startsWith("items.") && key !== "items.250")).toBe(0);
        expect(rendersOf(key => /^f\d+$/.test(key))).toBe(0);
        expect((screen.getAllByLabelText("Item")[250] as HTMLInputElement).value).toBe("edited");
    });

    it("hands a memoised field a context whose values are the current ones", async () => {
        const { properties, values } = fortyFields();
        renderForm(properties, values);
        await act(async () => { await new Promise(r => setTimeout(r, 0)); });

        const f5Context = mockContexts.f5;
        await type("F0", "typed");
        // f5 did not re-render, so it still holds the context it was given at
        // mount — and reading values off it from a callback must see the edit.
        expect(mockContexts.f5).toBe(f5Context);
        expect(f5Context.values.f0).toBe("typed");
        expect(f5Context.formex.values.f0).toBe("typed");
    });

    it("keeps re-rendering fields that read the rest of the form", async () => {
        const { properties, values } = fortyFields();
        const Mirror = ({ context }: FieldProps) =>
            <span data-testid="mirror">{String(context.values.f0)}</span>;
        properties.mirror = { type: "string", name: "Mirror", admin: { Field: Mirror } };
        properties.dyn = {
            type: "string",
            name: "Dyn",
            dynamicProps: ({ values: v }: { values: Row }) => ({ name: "Dyn " + String(v.f0) })
        };
        properties.cond = {
            type: "string",
            name: "Cond",
            conditions: { disabled: { "==": [{ var: "values.f0" }, "lock"] } }
        };
        values.mirror = "m";
        values.dyn = "d";
        values.cond = "c";

        renderForm(properties, values);
        await act(async () => { await new Promise(r => setTimeout(r, 0)); });

        resetCounts();
        await type("F0", "lock");
        expect(screen.getByTestId("mirror").textContent).toBe("lock");
        expect(rendersOf(key => key === "dyn")).toBeGreaterThanOrEqual(1);
        expect(rendersOf(key => key === "cond")).toBeGreaterThanOrEqual(1);
        expect((screen.getByLabelText("Cond") as HTMLInputElement).disabled).toBe(true);
    });
});

describe("the form controller", () => {

    it("keeps its identity across a re-render that changed no state", async () => {
        const { properties, values } = fortyFields();
        const collection = { slug: "posts", name: "Posts", properties } as never;
        const seen: unknown[] = [];
        const Capture = ({ formContext }: { formContext: FormContext<Row> }) => {
            seen.push(formContext.formex);
            return null;
        };
        const onSubmit = jest.fn(async (v: Row) => ({ id: "1", path: "posts", values: v })) as never;
        const form = (tick: number) => <RebaseI18nProvider locale="en">
            <AuthControllerContext.Provider value={{ user: { uid: "u1" } } as never}>
                <CustomizationControllerContext.Provider
                    value={{ plugins: [], propertyConfigs: {}, entityActions: [], entityViews: [], resolvedSlots: [] } as never}>
                    <EntityForm<Row>
                        key="form"
                        path="posts"
                        entityId="1"
                        className={"tick-" + tick}
                        collection={collection}
                        entity={{ id: "1", path: "posts", values } as never}
                        initialStatus="existing"
                        Builder={Capture as never}
                        onSubmit={onSubmit}
                        initialDirtyValues={{ f1: "draft" }}
                        computedInitialValues={values}/>
                </CustomizationControllerContext.Provider>
            </AuthControllerContext.Provider>
        </RebaseI18nProvider>;
        const { rerender } = render(form(0));
        await act(async () => { await new Promise(r => setTimeout(r, 0)); });
        const before = seen[seen.length - 1];
        rerender(form(1));
        rerender(form(2));
        expect(seen[seen.length - 1]).toBe(before);
    });

    it("reads a draft's touched keys once, not on every keystroke", async () => {
        const { properties, values } = fortyFields();
        properties.attributes = { type: "map", name: "Attributes", keyValue: true };
        const attributes: Record<string, string> = {};
        for (let i = 0; i < 50; i++) attributes["k" + i] = "v" + i;
        const draft = { f1: "draft", attributes };
        const collection = { slug: "posts", name: "Posts", properties } as never;
        render(<RebaseI18nProvider locale="en">
            <AuthControllerContext.Provider value={{ user: { uid: "u1" } } as never}>
                <CustomizationControllerContext.Provider
                    value={{ plugins: [], propertyConfigs: {}, entityActions: [], entityViews: [], resolvedSlots: [] } as never}>
                    <EntityForm<Row>
                        path="posts"
                        entityId="1"
                        collection={collection}
                        entity={{ id: "1", path: "posts", values } as never}
                        initialStatus="existing"
                        onSubmit={jest.fn(async (v: Row) => ({ id: "1", path: "posts", values: v })) as never}
                        initialDirtyValues={draft}
                        computedInitialValues={values}/>
                </CustomizationControllerContext.Provider>
            </AuthControllerContext.Provider>
        </RebaseI18nProvider>);
        await act(async () => { await new Promise(r => setTimeout(r, 0)); });
        const atMount = mockFlattened.get(draft) ?? 0;
        expect(atMount).toBeGreaterThanOrEqual(1);

        for (let k = 1; k <= 3; k++) await type("F0", "v0" + "x".repeat(k));

        expect(mockFlattened.get(draft)).toBe(atMount);
    });
});
