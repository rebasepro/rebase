/**
 * @jest-environment jsdom
 */
/**
 * A keystroke elsewhere in the form leaves the entries of a block array alone.
 *
 * Each entry of a `oneOf` array — its type picker, and the `Field` that read
 * the picked type — took the whole form controller from context, so every
 * entry of every block array re-rendered, type select and all, on every
 * keystroke anywhere in the record. Each entry now reads its own type.
 */
import React from "react";
import type { PostgresProperties } from "@rebasepro/types";
import type { AdminCollection } from "@rebasepro/cms-types";
import { describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react";

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

// Renders of each entry's type picker, counted through the chip that shows the
// picked type in it.
const mockChips = { n: 0 };
jest.mock("../../src/preview", () => {
    const actual = jest.requireActual("../../src/preview") as Record<string, unknown> & {
        EnumValuesChip: React.ComponentType<Record<string, unknown>>
    };
    const mockReact = jest.requireActual("react") as typeof React;
    return new Proxy(actual, {
        get: (target, key: string | symbol) => key === "EnumValuesChip"
            ? (props: Record<string, unknown>) => {
                mockChips.n++;
                return mockReact.createElement(target.EnumValuesChip, props);
            }
            : target[key as string]
    });
});

import { AuthControllerContext, CustomizationControllerContext, RebaseI18nProvider } from "@rebasepro/app";
import { EntityForm } from "../../src/form/EntityForm";
import { rowOf, saving } from "../helpers/form_rows";
import { fakeAuthController, fakeCustomization, fakeUser } from "../helpers/fakes";

type Row = Record<string, unknown>;

function renderForm(properties: PostgresProperties, values: Row) {
    const collection: AdminCollection = { slug: "pages", name: "Pages", properties };
    return render(<RebaseI18nProvider locale="en">
        <AuthControllerContext.Provider value={fakeAuthController({ user: fakeUser("u1") })}>
            <CustomizationControllerContext.Provider
                value={fakeCustomization()}>
                <EntityForm<Row>
                    path="pages"
                    id="1"
                    collection={collection}
                    row={rowOf({ id: "1", path: "pages", values })}
                    initialStatus="existing"
                    onSubmit={saving(jest.fn(async (v: Row) => ({ id: "1", path: "pages", values: v })))}
                    computedInitialValues={values}/>
            </CustomizationControllerContext.Provider>
        </AuthControllerContext.Provider>
    </RebaseI18nProvider>);
}

describe("a block array the user is not typing into", () => {
    it("does not re-render its entries", async () => {
        const properties: PostgresProperties = {
            title: { type: "string", name: "Title" },
            content: {
                type: "array",
                name: "Content",
                oneOf: {
                    properties: {
                        text: { type: "string", name: "Text" },
                        quote: { type: "string", name: "Quote" }
                    }
                }
            }
        };
        const values: Row = {
            title: "t",
            content: Array.from({ length: 60 }, (_, i) => ({ type: i % 2 ? "quote" : "text", value: "block " + i }))
        };
        renderForm(properties, values);
        await act(async () => { await new Promise(r => setTimeout(r, 0)); });
        expect(mockChips.n).toBeGreaterThanOrEqual(60);

        for (let k = 1; k <= 3; k++) {
            mockChips.n = 0;
            await act(async () => {
                fireEvent.change(screen.getByLabelText("Title"), { target: { value: "t" + "x".repeat(k) } });
            });
            expect(mockChips.n).toBe(0);
        }
        expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("txxx");
    });
});
