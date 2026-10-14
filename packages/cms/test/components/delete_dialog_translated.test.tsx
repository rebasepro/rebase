/**
 * @jest-environment jsdom
 *
 * The delete dialog speaks the admin's language, and holds no English of its own.
 *
 * Seven of its `t()` calls were followed by an English default
 * (`t("confirm_delete_selection_unknown") ?? "Delete every row matching the
 * current filter?"`). `t()` always returns a string, so none of them could
 * ever show; each one was a second, drifting copy of the English, written as
 * if the dialog might fall back to it.
 */
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import type { Entity } from "@rebasepro/types";
import type { AdminCollection, EntitySelection } from "@rebasepro/cms-types";

jest.mock("@rebasepro/app", () => {
    const overrides: Record<string, unknown> = {
        useData: () => ({ collection: () => ({}) }),
        useSnackbarController: () => ({ open: () => undefined, close: () => undefined })
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

const SOURCE = path.resolve(__dirname, "../../src/components/DeleteEntityDialog.tsx");

const collection: AdminCollection<Record<string, unknown>> = { slug: "products", name: "Products", properties: {} };

const rows = Array.from({ length: 3 }, (_, i): Entity<Record<string, unknown>> => ({
    id: String(i + 1),
    path: "products",
    values: {}
}));

function renderInGerman(target: Entity<Record<string, unknown>> | EntitySelection<Record<string, unknown>>, variant: "delete" | "unlink") {
    return render(
        <RebaseI18nProvider locale="de">
            <DeleteEntityDialog
                target={target}
                variant={variant}
                path="products"
                collection={collection}
                open={true}
                onClose={() => undefined}/>
        </RebaseI18nProvider>
    );
}

describe("DeleteEntityDialog, in German", () => {
    it("asks to delete a selection in German", async () => {
        renderInGerman({ type: "entities", entities: rows }, "delete");

        expect(await screen.findByText("3 Products löschen?")).toBeTruthy();
        expect(screen.getByText("Dies kann nicht rückgängig gemacht werden. Jede Zeile wird einzeln gelöscht, das kann eine Weile dauern.")).toBeTruthy();
        expect(screen.queryByText("Delete 3 Products?")).toBeNull();
    });

    it("asks to remove one record from this one in German", async () => {
        renderInGerman(rows[0], "unlink");

        expect(await screen.findByText("Dieses Products aus diesem Datensatz entfernen?")).toBeTruthy();
        expect(screen.getByText("Es bleibt in Products und steht anderen Datensätzen weiterhin zur Verfügung.")).toBeTruthy();
    });
});

describe("DeleteEntityDialog's source", () => {
    it("writes no English default after a t() call", () => {
        const source = fs.readFileSync(SOURCE, "utf8");
        // `t(…) ?? "…"`, `t(…) ?? \`…\`` or `t(…) ?? ("…")`, on one line or across two.
        const fallbacks = source.match(/\)\s*\?\?\s*\(?\s*["'`]/g) ?? [];
        expect(fallbacks).toEqual([]);
    });
});
