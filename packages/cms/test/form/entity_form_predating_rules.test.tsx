/**
 * @jest-environment jsdom
 */
/**
 * A record that predates a rule can still be edited.
 *
 * The form judges the whole record; the server judges what is sent. So a
 * record stored before a `max` was added, or before a field became required,
 * could not have an unrelated field changed from the panel — the save was
 * refused over a value the user had not touched — while a `PATCH` of the same
 * change went through.
 *
 * What the form does now: a field the user edited must be valid. A field they
 * did not touch, that was already invalid in the stored record, is a warning
 * they can save through. A field they did not touch that an edit made invalid
 * (a rule that depends on the edited value) still blocks: that is the edit's
 * problem, not the record's history.
 */
import React from "react";
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

import { RebaseI18nProvider } from "@rebasepro/app";
import { EntityForm } from "../../src/form/EntityForm";

type Row = Record<string, unknown>;

const properties = {
    title: { type: "string", name: "Title" },
    // Added after records were stored: legacy rows have longer codes.
    code: { type: "string", name: "Code", validation: { max: 3 } },
    // Made required after records were stored.
    owner: { type: "string", name: "Owner", validation: { required: true } },
    kind: { type: "string", name: "Kind" },
    vat: {
        type: "string",
        name: "VAT",
        conditions: { required: { "==": [{ var: "values.kind" }, "business"] } }
    }
};

const collection = { slug: "products", name: "Products", properties } as never;

const stored: Row = { title: "Chair", code: "LEGACY-1", owner: null, kind: "personal", vat: null };

function entityOf(values: Row): Entity<Row> {
    return { id: "1", path: "products", values };
}

async function editAndSave(edit: Record<string, unknown>) {
    const onSubmit = jest.fn(async (v: Row) => entityOf({ ...stored, ...v }));
    let ctx: FormContext<Row> | undefined;
    const Capture = ({ formContext }: EntityCustomViewParams<Row>) => {
        ctx = formContext;
        return null;
    };
    render(<RebaseI18nProvider locale="en"><EntityForm<Row>
        path="products"
        entityId="1"
        entity={entityOf(stored)}
        collection={collection}
        initialStatus="existing"
        Builder={Capture}
        onFormContextReady={(c) => {
            ctx = c;
        }}
        onSubmit={onSubmit}
        computedInitialValues={stored}/></RebaseI18nProvider>);
    await act(async () => {
        for (const [key, value] of Object.entries(edit)) ctx!.setFieldValue(key, value);
    });
    await act(async () => {
        await ctx!.submit();
    });
    return { onSubmit, errors: ctx!.formex.errors };
}

describe("a record that predates its rules", () => {

    it("saves an unrelated edit, and says which fields still break a rule", async () => {
        const { onSubmit, errors } = await editAndSave({ title: "Armchair" });
        expect(onSubmit).toHaveBeenCalledTimes(1);
        expect(onSubmit.mock.calls[0][0]).toEqual({ title: "Armchair" });
        expect(errors).toEqual({});
        expect(screen.getByText(/did not change/i)).toBeTruthy();
        expect(screen.getByText(/Code must be max 3 characters long/)).toBeTruthy();
        expect(screen.getByText(/Owner: Required/)).toBeTruthy();
    });

    it("refuses an edited field that breaks its rule", async () => {
        const { onSubmit, errors } = await editAndSave({ title: "Armchair", code: "STILL-TOO-LONG" });
        expect(onSubmit).not.toHaveBeenCalled();
        expect(errors.code).toBe("Code must be max 3 characters long");
    });

    it("refuses an untouched field that the edit itself made invalid", async () => {
        // `vat` was fine while the record was personal; switching it to
        // business is what requires it.
        const { onSubmit, errors } = await editAndSave({ kind: "business" });
        expect(onSubmit).not.toHaveBeenCalled();
        expect(errors.vat).toBe("Required");
    });
});
