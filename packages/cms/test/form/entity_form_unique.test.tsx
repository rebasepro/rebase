/**
 * @jest-environment jsdom
 */
/**
 * `validation.unique` is checked by the form on save.
 *
 * `EntityFormBinding` builds a validator that asks the data source whether
 * another record holds the value, and `EntityForm` threads it into the schema
 * builder — which then never called it. A duplicate went to the server and
 * came back as a failed save with nothing on the field. It is asked on submit
 * (never per keystroke), only for a value this edit set, and only once the
 * value is otherwise valid.
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react";
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

type Row = Record<string, unknown>;

const properties = {
    name: { type: "string", name: "Name" },
    sku: { type: "string", name: "SKU", validation: { unique: true } },
    code: { type: "string", name: "Code", validation: { unique: true, min: 3 } }
};

function entityOf(values: Row): Entity<Row> {
    return { id: "1", path: "products", values };
}

function setup(stored: Row | undefined, taken: string[]) {
    const collection = { slug: "products", name: "Products", properties } as never;
    const onSubmit = jest.fn(async (v: Row) => entityOf(v));
    const uniqueFieldValidator = jest.fn(async ({ value }: { name: string, value: unknown }) => !taken.includes(String(value)));
    let ctx: FormContext<Row> | undefined;
    render(<RebaseI18nProvider locale="en">
        <AuthControllerContext.Provider value={{ user: { uid: "u1" } } as never}>
            <CustomizationControllerContext.Provider
                value={{ plugins: [], propertyConfigs: {}, entityActions: [], entityViews: [], resolvedSlots: [] } as never}>
                <EntityForm<Row>
                    path="products"
                    entityId={stored ? "1" : undefined}
                    entity={stored ? entityOf(stored) : undefined}
                    collection={collection}
                    initialStatus={stored ? "existing" : "new"}
                    onFormContextReady={(c) => { ctx = c; }}
                    onSubmit={onSubmit}
                    uniqueFieldValidator={uniqueFieldValidator}
                    computedInitialValues={stored ?? { name: "", sku: "", code: "" }}/>
            </CustomizationControllerContext.Provider>
        </AuthControllerContext.Provider>
    </RebaseI18nProvider>);
    return {
        onSubmit,
        uniqueFieldValidator,
        ctx: () => ctx!,
        submit: async () => {
            await act(async () => {
                await ctx!.submit();
            });
        }
    };
}

describe("validation.unique in the record form", () => {

    it("refuses a save whose value another record holds, and names the field", async () => {
        const form = setup({ name: "Chair", sku: "A-1", code: "abc" }, ["B-2"]);

        await act(async () => { form.ctx().setFieldValue("sku", "B-2"); });
        await form.submit();

        expect(form.onSubmit).not.toHaveBeenCalled();
        expect(form.uniqueFieldValidator).toHaveBeenCalledTimes(1);
        expect(form.uniqueFieldValidator.mock.calls[0][0]).toMatchObject({ name: "sku", value: "B-2" });
        expect(form.ctx().formex.errors.sku).toMatch(/unique/i);
    });

    it("saves a value nobody else holds", async () => {
        const form = setup({ name: "Chair", sku: "A-1", code: "abc" }, ["B-2"]);

        await act(async () => { form.ctx().setFieldValue("sku", "C-3"); });
        await form.submit();

        expect(form.onSubmit).toHaveBeenCalledTimes(1);
    });

    it("does not ask about a value the edit left alone", async () => {
        // Stored as it is; if another record holds it too, that predates this
        // edit, and the save is about something else.
        const form = setup({ name: "Chair", sku: "A-1", code: "abc" }, ["A-1", "abc"]);

        await act(async () => { form.ctx().setFieldValue("name", "Table"); });
        await form.submit();

        expect(form.uniqueFieldValidator).not.toHaveBeenCalled();
        expect(form.onSubmit).toHaveBeenCalledTimes(1);
    });

    it("does not ask while typing", async () => {
        const form = setup({ name: "Chair", sku: "A-1", code: "abc" }, []);

        for (const value of ["B", "B-", "B-2"]) {
            await act(async () => {
                fireEvent.change(screen.getByLabelText("SKU"), { target: { value } });
            });
        }

        expect(form.uniqueFieldValidator).not.toHaveBeenCalled();
    });

    it("does not ask about a value that is invalid anyway", async () => {
        const form = setup({ name: "Chair", sku: "A-1", code: "abc" }, []);

        await act(async () => { form.ctx().setFieldValue("code", "x"); });
        await form.submit();

        expect(form.uniqueFieldValidator).not.toHaveBeenCalled();
        expect(form.ctx().formex.errors.code).toBeTruthy();
    });

    it("checks every unique value of a new record", async () => {
        const form = setup(undefined, ["A-1"]);

        await act(async () => {
            form.ctx().setFieldValue("sku", "A-1");
            form.ctx().setFieldValue("code", "xyz");
        });
        await form.submit();

        expect(form.uniqueFieldValidator).toHaveBeenCalledTimes(2);
        expect(form.onSubmit).not.toHaveBeenCalled();
        expect(form.ctx().formex.errors.sku).toBeTruthy();
        expect(form.ctx().formex.errors.code).toBeUndefined();
    });
});
