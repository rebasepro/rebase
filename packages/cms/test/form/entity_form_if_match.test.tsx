/**
 * @jest-environment jsdom
 */
/**
 * The record form saves with `If-Match`.
 *
 * The form rebases an open edit onto every version the listener delivers, but
 * a save racing a write it has not heard of yet still wrote the whole record
 * over it. The entity the form follows carries the version it was read at
 * (`entity.etag`), and the save sends it: a server that sees the row has moved
 * on refuses with 412, and the form says so in words a person can act on
 * instead of the server's protocol message. A record with no version (an older
 * server, a data source that has none) saves unconditionally, as it did.
 */
import React from "react";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { act, render } from "@testing-library/react";
import { RebaseApiError, type Entity } from "@rebasepro/types";

type Row = Record<string, unknown>;

const update = jest.fn<(id: string | number, data: Row, options?: { ifMatch?: string }) => Promise<Entity<Row>>>();
const snackbar = jest.fn();

jest.mock("@rebasepro/app", () => {
    const data = { collection: () => ({ update, create: update }) };
    const overrides: Record<string, unknown> = {
        useAuthController: () => ({ user: { uid: "u1", roles: ["admin"] } }),
        useCustomizationController: () => ({ plugins: [], propertyConfigs: {}, entityActions: [], entityViews: [], resolvedSlots: [] }),
        useData: () => data,
        useSnackbarController: () => ({ open: snackbar }),
        useSlot: () => null,
        useAnalyticsController: () => ({})
    };
    return new Proxy({}, {
        get: (_t, key: string | symbol) =>
            (typeof key === "string" && key in overrides)
                ? overrides[key]
                : (jest.requireActual("@rebasepro/app") as Record<string | symbol, unknown>)[key]
    });
});
jest.mock("../../src/hooks/useSidePanel", () => ({ useSidePanel: () => ({ close: () => undefined }) }));
jest.mock("../../src/hooks/useAdminContext", () => ({ useAdminContext: () => ({}) }));
jest.mock("../../src/hooks/navigation/contexts/CollectionRegistryContext", () => {
    const registry = { getParentCollectionSlugs: () => [], getParentEntityIds: () => [] };
    return { useCollectionRegistryController: () => registry };
});

/** The form itself is not under test: it hands back the submit the binding built. */
let submit: ((values: Row, formex: never) => Promise<unknown>) | undefined;
jest.mock("../../src/form/EntityForm", () => ({
    EntityForm: ({ onSubmit }: { onSubmit: (values: Row, formex: never) => Promise<unknown> }) => {
        submit = onSubmit;
        return null;
    }
}));

import { RebaseI18nProvider } from "@rebasepro/app";
import { EntityFormBinding } from "../../src/form/EntityFormBinding";

const collection = { slug: "posts", name: "Posts", properties: { title: { type: "string", name: "Title" } } } as never;

function renderBinding(entity: Entity<Row>) {
    render(<RebaseI18nProvider locale="en">
        <EntityFormBinding<Row> path="posts" entityId={entity.id} entity={entity} collection={collection} initialStatus="existing"/>
    </RebaseI18nProvider>);
}

async function save(values: Row): Promise<unknown> {
    let outcome: unknown;
    await act(async () => {
        outcome = await submit!(values, {} as never).catch((error: unknown) => error);
    });
    return outcome;
}

describe("the record form saves with If-Match", () => {
    beforeEach(() => {
        update.mockReset();
        snackbar.mockReset();
        submit = undefined;
        jest.spyOn(console, "error").mockImplementation(() => undefined);
    });

    it("sends the version of the record it is editing", async () => {
        update.mockResolvedValue({ id: "1", path: "posts", values: { title: "new" }, etag: "\"v2\"" });
        renderBinding({ id: "1", path: "posts", values: { title: "old" }, etag: "\"v1\"" });
        await save({ title: "new" });
        expect(update).toHaveBeenCalledWith("1", { title: "new" }, { ifMatch: "\"v1\"" });
    });

    it("saves unconditionally a record that came with no version", async () => {
        update.mockResolvedValue({ id: "1", path: "posts", values: { title: "new" } });
        renderBinding({ id: "1", path: "posts", values: { title: "old" } });
        await save({ title: "new" });
        expect(update).toHaveBeenCalledTimes(1);
        expect(update.mock.calls[0]).toHaveLength(2);
    });

    it("says the record changed elsewhere when the server refuses the version", async () => {
        update.mockRejectedValue(new RebaseApiError("The row '1' in 'posts' has changed since it was read.", {
            status: 412,
            code: "PRECONDITION_FAILED"
        }));
        renderBinding({ id: "1", path: "posts", values: { title: "old" }, etag: "\"v1\"" });
        const outcome = await save({ title: "mine" });
        expect(outcome).toBeInstanceOf(RebaseApiError);
        expect(snackbar).toHaveBeenCalledWith(expect.objectContaining({
            type: "error",
            message: expect.stringMatching(/changed since you opened it/)
        }));
    });

    it("any other refusal is shown as the server worded it", async () => {
        update.mockRejectedValue(new RebaseApiError("Title is too long", { status: 400, code: "BAD_REQUEST" }));
        renderBinding({ id: "1", path: "posts", values: { title: "old" }, etag: "\"v1\"" });
        await save({ title: "x".repeat(10) });
        expect(snackbar).toHaveBeenCalledWith(expect.objectContaining({ message: "Title is too long" }));
    });
});
