/**
 * @jest-environment jsdom
 */
/**
 * The record form's own notices speak the reader's language. "This entity does
 * not exist yet" and "Please fix the highlighted errors before saving." were
 * English literals in every locale, beside fields labelled in Spanish.
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { act, render, screen } from "@testing-library/react";
import type { FormContext } from "@rebasepro/cms-types";

class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
}
Object.assign(global, { ResizeObserver: ResizeObserverStub });
Element.prototype.scrollIntoView = () => undefined;

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

type Post = Record<string, unknown>;
const collection = {
    slug: "posts",
    name: "Posts",
    properties: { title: { type: "string", name: "Title", validation: { required: true } } }
} as never;

function Form({ entityId, status, onReady }: { entityId?: string; status: "new" | "existing"; onReady?: (c: FormContext<Post>) => void }) {
    return <RebaseI18nProvider locale="es">
        <AuthControllerContext.Provider value={{ user: { uid: "u1" } } as never}>
            <CustomizationControllerContext.Provider
                value={{ plugins: [], propertyConfigs: {}, entityActions: [], entityViews: [], resolvedSlots: [] } as never}>
                <EntityForm<Post>
                    path="posts"
                    entityId={entityId}
                    entity={entityId ? { id: entityId, path: "posts", values: undefined } as never : undefined}
                    collection={collection}
                    initialStatus={status}
                    onFormContextReady={onReady}
                    onSubmit={jest.fn(async (values: Post) => ({ id: "1", path: "posts", values }))}/>
            </CustomizationControllerContext.Provider>
        </AuthControllerContext.Provider>
    </RebaseI18nProvider>;
}

describe("the record form's notices, in Spanish", () => {
    it("says a missing record does not exist", async () => {
        render(<Form entityId="missing" status="existing"/>);
        expect((await screen.findAllByText("Esta entidad no existe en la base de datos")).length).toBeGreaterThan(0);
        expect(screen.queryByText("This entity does not exist yet")).toBeNull();
    });

    it("asks for the highlighted errors to be fixed", async () => {
        let ctx: FormContext<Post> | undefined;
        render(<Form status="new" onReady={(c) => { ctx = c; }}/>);
        await act(async () => {
            await ctx!.submit();
        });
        expect(screen.getByText("Corrija los errores resaltados antes de guardar")).toBeTruthy();
        expect(screen.queryByText("Please fix the highlighted errors before saving.")).toBeNull();
    });
});
