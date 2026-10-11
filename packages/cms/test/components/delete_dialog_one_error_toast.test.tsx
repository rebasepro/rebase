/**
 * @jest-environment jsdom
 *
 * A bulk delete that fails row after row says so once.
 *
 * Each failed row opened its own error snackbar, from the per-row failure
 * handler, over a delete that can walk 20,000 rows: a mass foreign-key refusal
 * queued a toast per row, three on screen at a time for as long as it took.
 * The rows' failures are now collected, and the summary names how many and why.
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { Entity } from "@rebasepro/types";
import type { AdminCollection, EntitySelection } from "@rebasepro/cms-types";

const toasts: { type: string; title?: string; message?: string }[] = [];

jest.mock("@rebasepro/app", () => {
    const overrides: Record<string, unknown> = {
        useData: () => ({ collection: () => ({}) }),
        useSnackbarController: () => ({ open: (t: { type: string; title?: string; message?: string }) => toasts.push(t), close: () => undefined }),
        deleteEntityWithCallbacks: async ({ entity, onDeleteFailure }: {
            entity: Entity<Record<string, unknown>>;
            onDeleteFailure: (entity: Entity<Record<string, unknown>>, e: Error) => void;
        }) => {
            if (Number(entity.id) % 4 === 0) return true;
            onDeleteFailure(entity, new Error(`Cannot delete: product ${entity.id} is referenced by "orders".`));
            return false;
        }
    };
    return new Proxy({}, {
        get: (_t, key: string | symbol) =>
            (typeof key === "string" && key in overrides)
                ? overrides[key]
                : (jest.requireActual("@rebasepro/app") as Record<string | symbol, unknown>)[key]
    });
});
jest.mock("../../src/hooks", () => ({ useAdminContext: () => ({}) }));
jest.mock("../../src/components/EntityViewBinding", () => ({ EntityViewBinding: () => null }));

import { RebaseI18nProvider } from "@rebasepro/app";
import { DeleteEntityDialog } from "../../src/components/DeleteEntityDialog";

const collection: AdminCollection<Record<string, unknown>> = { slug: "products", name: "Products", properties: {} };
const rows = Array.from({ length: 40 }, (_, i): Entity<Record<string, unknown>> => ({ id: String(i + 1), path: "products", values: {} }));

describe("DeleteEntityDialog — a bulk delete with failures", () => {
    it("opens one snackbar, naming how many rows failed and the first reason", async () => {
        jest.spyOn(console, "error").mockImplementation(() => undefined);
        render(
            <RebaseI18nProvider locale="en">
                <DeleteEntityDialog
                    target={{ type: "entities", entities: rows } as EntitySelection<Record<string, unknown>>}
                    path="products"
                    collection={collection}
                    open={true}
                    onClose={() => undefined}/>
            </RebaseI18nProvider>
        );
        await act(async () => {
            fireEvent.click(screen.getByRole("button", { name: /ok/i }));
            await new Promise(resolve => setTimeout(resolve, 20));
        });

        expect(toasts).toHaveLength(1);
        expect(toasts[0].type).toBe("warning");
        expect(toasts[0].message).toContain("30");
        expect(toasts[0].message).toContain(`Cannot delete: product 1 is referenced by "orders".`);
    });
});
