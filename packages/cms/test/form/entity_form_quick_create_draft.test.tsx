/**
 * @jest-environment jsdom
 */
/**
 * A record created within 300 ms of its last keystroke left its draft behind.
 *
 * The draft backup is written 300 ms after the last edit. A save inside that
 * window cleared the backup, and the timer then wrote it back: the next new
 * record opened with "Unsaved local changes" holding the one just created,
 * and applying them made a duplicate.
 */
import React from "react";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { act, render } from "@testing-library/react";
import type { Entity } from "@rebasepro/types";
import type { EntityCustomViewParams, FormContext } from "@rebasepro/cms-types";

class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
}
Object.assign(global, { ResizeObserver: ResizeObserverStub });

type Row = Record<string, unknown>;

const create = jest.fn<(data: Row) => Promise<Entity<Row>>>();

jest.mock("@rebasepro/app", () => {
    const data = { collection: () => ({ create, update: create }) };
    const overrides: Record<string, unknown> = {
        useRebaseContext: () => ({}),
        useAuthController: () => ({ user: { uid: "u1", roles: ["admin"] } }),
        useCustomizationController: () => ({ plugins: [], propertyConfigs: {}, entityActions: [], entityViews: [], resolvedSlots: [] }),
        useData: () => data,
        useSnackbarController: () => ({ open: () => undefined }),
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

import { RebaseI18nProvider } from "@rebasepro/app";
import { EntityFormBinding } from "../../src/form/EntityFormBinding";

const collection = { slug: "tags", name: "Tags", singularName: "Tag", properties: { name: { type: "string", name: "Name" } } } as never;

let context: FormContext<Row>;
function Capture({ formContext }: EntityCustomViewParams<Row>) {
    context = formContext;
    return null;
}

/** The side panel the form sits in, which closes once the record is saved. */
function NewTagPanel() {
    const [open, setOpen] = React.useState(true);
    if (!open) return null;
    return <EntityFormBinding<Row>
        path="tags"
        collection={collection}
        initialStatus="new"
        onSaved={() => setOpen(false)}
        Builder={Capture}/>;
}

beforeEach(() => {
    sessionStorage.clear();
    create.mockReset();
    create.mockImplementation(async (values) => ({ id: "7", path: "tags", values }));
});

describe("creating a record right after typing it", () => {
    it("leaves no draft for the next new record", async () => {
        render(<RebaseI18nProvider locale="en"><NewTagPanel/></RebaseI18nProvider>);

        await act(async () => {
            context.setFieldValue("name", "physics");
            context.formex.setFieldTouched("name", true);
        });
        await act(async () => {
            await context.submit();
        });
        expect(create).toHaveBeenCalledTimes(1);

        // Past the draft's 300 ms.
        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 400));
        });

        expect(sessionStorage.getItem("entity_cache::tags#new")).toBeNull();
    });
});
