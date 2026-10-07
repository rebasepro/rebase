/**
 * @jest-environment jsdom
 */
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { renderHook } from "@testing-library/react";
import type { AdminCollection, EntityAction, EntityActionClickProps } from "@rebasepro/cms-types";

/**
 * A record action that fails says so.
 *
 * The record's menu called `onClick` and dropped what it returned, so an
 * action whose request was refused — "Resend to Odoo" against a server that
 * said no — closed the menu and showed nothing: the rejection went to the
 * console as unhandled, and the user was left believing it had worked.
 */

const snackbarOpen = jest.fn();

jest.mock("@rebasepro/app", () => {
    const overrides: Record<string, unknown> = {
        usePermissions: () => ({ canCreate: () => true, canDelete: () => true }),
        useCustomizationController: () => ({ entityActions: [] }),
        useSnackbarController: () => ({ open: snackbarOpen }),
        getIcon: () => undefined
    };
    return new Proxy({}, {
        get: (_t, key: string | symbol) =>
            (typeof key === "string" && key in overrides)
                ? overrides[key]
                : (jest.requireActual("@rebasepro/app") as Record<string | symbol, unknown>)[key]
    });
});

jest.mock("../../src/hooks/useChildViewSource", () => ({ useChildViewSource: () => undefined }));

import { useRecordActions } from "../../src/hooks/useRecordActions";

const entity = { id: "7", path: "customers", values: {} };

function placedFor(action: EntityAction) {
    const collection = {
        name: "Customers",
        slug: "customers",
        properties: {},
        entityActions: [action]
    } as unknown as AdminCollection;
    const clickProps: EntityActionClickProps<Record<string, unknown>> = { view: "form", entity, path: "customers", collection };
    const { result } = renderHook(() => useRecordActions({ collection, path: "customers", entity, clickProps }));
    return result.current!;
}

describe("useRecordActions", () => {

    beforeEach(() => {
        snackbarOpen.mockReset();
        jest.spyOn(console, "error").mockImplementation(() => undefined);
    });

    it("reports an asynchronous failure to the user", async () => {
        const placed = placedFor({
            key: "resend",
            name: "Resend",
            onClick: () => Promise.reject(new Error("Odoo said no"))
        });

        await placed.own[0].run();

        expect(snackbarOpen).toHaveBeenCalledWith({ type: "error", message: "Resend: Odoo said no" });
    });

    it("reports a synchronous failure to the user", () => {
        const placed = placedFor({
            key: "resend",
            name: "Resend",
            onClick: () => {
                throw new Error("no wallet configured");
            }
        });

        expect(placed.own[0].run()).toBeUndefined();
        expect(snackbarOpen).toHaveBeenCalledWith({ type: "error", message: "Resend: no wallet configured" });
    });

    it("carries a disabled action's reason, asked with the record", () => {
        const placed = placedFor({
            key: "shopify",
            name: "Resend to Shopify",
            isEnabled: () => false,
            disabledReason: ({ entity }) => `Customer ${entity?.id} has no Shopify account`,
            onClick: () => undefined
        });

        expect(placed.own[0]).toMatchObject({ enabled: false, disabledReason: "Customer 7 has no Shopify account" });
    });

    it("places a promoted action beside the built-ins it was merged with", () => {
        const placed = placedFor({ key: "recalculate", name: "Recalculate", collapsed: false, onClick: () => undefined });

        expect(placed.inline.map(action => action.name)).toEqual(["Recalculate"]);
        expect(placed.generic.map(action => action.key)).toEqual(["copy"]);
        expect(placed.destructive.map(action => action.key)).toEqual(["delete"]);
    });
});
