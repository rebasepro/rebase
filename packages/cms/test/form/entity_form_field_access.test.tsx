/**
 * @jest-environment jsdom
 */
/**
 * `property.access` in the record form.
 *
 * The server enforces field access — it strips a field the caller cannot read
 * and refuses a write naming one they cannot set — and the form did not read
 * it. A field the user could not write was an ordinary input whose edit came
 * back as a 400 on save; a field they could not read was an empty input
 * inviting them to fill it; and a new record or a copy sent a default or the
 * original's value for a field the user could not set, so the server refused
 * the whole save over a value nobody typed.
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { act, render, screen } from "@testing-library/react";
import type { Entity, Property } from "@rebasepro/types";
import type { EntityCustomViewParams, FormContext } from "@rebasepro/cms-types";

class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
}
Object.assign(global, { ResizeObserver: ResizeObserverStub });

const auth: { user: { uid: string, roles?: string[] } | null } = { user: { uid: "u1", roles: ["viewer"] } };

jest.mock("@rebasepro/app", () => {
    const overrides: Record<string, unknown> = {
        useRebaseContext: () => ({}),
        useCustomizationController: () => ({ plugins: [], propertyConfigs: {}, entityActions: [], entityViews: [], resolvedSlots: [] }),
        useAuthController: () => auth,
        useSnackbarController: () => ({ open: () => undefined })
    };
    return new Proxy({}, {
        get: (_t, key: string | symbol) =>
            (typeof key === "string" && key in overrides)
                ? overrides[key]
                : (jest.requireActual("@rebasepro/app") as Record<string | symbol, unknown>)[key]
    });
});

import { AuthControllerContext, CustomizationControllerContext, isHidden, isReadOnly, RebaseI18nProvider } from "@rebasepro/app";
import { EntityForm } from "../../src/form/EntityForm";
import { resolveFormProperty } from "../../src/form/resolve_form_properties";

type Row = Record<string, unknown>;

const status: Property = { type: "string", name: "Status", defaultValue: "draft", access: { write: ["editor"] } };
const salary: Property = { type: "number", name: "Salary", access: { read: ["hr"] } };
const secret: Property = { type: "string", name: "Secret", excludeFromApi: true };

const collection = {
    slug: "posts",
    name: "Posts",
    properties: {
        title: { type: "string", name: "Title" },
        status,
        salary,
        secret
    }
} as never;

function resolved(property: Property, roles: string[] | undefined) {
    return resolveFormProperty({
        propertyKey: "field",
        property,
        values: {},
        path: "posts",
        authController: { user: roles === undefined ? null : { uid: "u1", roles } as never }
    })!;
}

describe("how a field with access rules resolves for the form", () => {

    it("is read-only for a user without the write role, and still shown", () => {
        const property = resolved(status, ["viewer"]);
        expect(isReadOnly(property)).toBe(true);
        expect(isHidden(property)).toBe(false);
    });

    it("is editable for a user with the role, and for an admin", () => {
        expect(isReadOnly(resolved(status, ["editor"]))).toBe(false);
        expect(isReadOnly(resolved(status, ["admin"]))).toBe(false);
    });

    it("is hidden from a user without the read role", () => {
        expect(isHidden(resolved(salary, ["viewer"]))).toBe(true);
        expect(isHidden(resolved(salary, ["hr"]))).toBe(false);
    });

    it("is hidden from everybody when it is `excludeFromApi`, admin included", () => {
        expect(isHidden(resolved(secret, ["admin"]))).toBe(true);
    });

    it("treats nobody signed in as a viewer with no roles, not as the trusted server", () => {
        expect(isReadOnly(resolved(status, undefined))).toBe(true);
    });

    it("leaves a field without rules alone", () => {
        const plain: Property = { type: "string", name: "Title" };
        expect(resolved(plain, ["viewer"])).toEqual(plain);
    });
});

function renderForm(values: Row, formStatus: "new" | "copy" | "existing", withFields = false) {
    let ctx: FormContext<Row> | undefined;
    const payloads: Row[] = [];
    const onSubmit = jest.fn(async (v: Row) => {
        payloads.push(v);
        return { id: "1", path: "posts", values: { ...values, ...v } } as Entity<Row>;
    });
    const Capture = ({ formContext }: EntityCustomViewParams<Row>) => {
        ctx = formContext;
        return null;
    };
    const form = <EntityForm<Row>
        path="posts"
        entityId={formStatus === "new" ? undefined : "1"}
        entity={formStatus === "new" ? undefined : { id: "1", path: "posts", values }}
        collection={collection}
        initialStatus={formStatus}
        Builder={withFields ? undefined : Capture}
        onFormContextReady={(c) => {
            ctx = c;
        }}
        onSubmit={onSubmit}
        computedInitialValues={values}/>;
    render(withFields
        ? <RebaseI18nProvider locale={"en"}>
            <AuthControllerContext.Provider value={auth as never}>
                <CustomizationControllerContext.Provider
                    value={{ plugins: [], propertyConfigs: {}, entityActions: [], entityViews: [], resolvedSlots: [] } as never}>
                    {form}
                </CustomizationControllerContext.Provider>
            </AuthControllerContext.Provider>
        </RebaseI18nProvider>
        : form);
    return { payloads, context: () => ctx! };
}

describe("what the form sends for a field the user cannot write", () => {

    it("leaves a new record's default out", async () => {
        const { payloads, context } = renderForm({ title: null, status: "draft" }, "new");
        await act(async () => {
            context().setFieldValue("title", "Hello");
        });
        await act(async () => {
            await context().submit();
        });
        expect(payloads).toHaveLength(1);
        expect(payloads[0]).toHaveProperty("title", "Hello");
        expect(payloads[0]).not.toHaveProperty("status");
    });

    it("leaves a copy's original value out", async () => {
        const { payloads, context } = renderForm({ title: "Hello", status: "published" }, "copy");
        await act(async () => {
            await context().submit();
        });
        expect(payloads).toHaveLength(1);
        expect(payloads[0]).toHaveProperty("title", "Hello");
        expect(payloads[0]).not.toHaveProperty("status");
    });

    it("keeps a value that changed, so the server's refusal says why the save failed", async () => {
        const { payloads, context } = renderForm({ title: null, status: "draft" }, "new");
        await act(async () => {
            context().setFieldValue("title", "Hello");
            context().setFieldValue("status", "published");
        });
        await act(async () => {
            await context().submit();
        });
        expect(payloads[0]).toHaveProperty("status", "published");
    });

    it("sends the field for a user who may write it", async () => {
        auth.user = { uid: "u1", roles: ["editor"] };
        try {
            const { payloads, context } = renderForm({ title: "Hello", status: "published" }, "copy");
            await act(async () => {
                await context().submit();
            });
            expect(payloads[0]).toHaveProperty("status", "published");
        } finally {
            auth.user = { uid: "u1", roles: ["viewer"] };
        }
    });
});

describe("the fields the form renders", () => {

    it("shows an unwritable field as text and leaves an unreadable one out, label included", () => {
        renderForm({ title: "Hello", status: "published", salary: null, secret: null }, "existing", true);
        expect(screen.getAllByRole("textbox")).toHaveLength(1);
        expect(screen.getByText("published")).toBeTruthy();
        expect(screen.queryByText("Salary")).toBeNull();
        expect(screen.queryByText("Secret")).toBeNull();
    });
});
