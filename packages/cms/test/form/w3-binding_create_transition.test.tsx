/**
 * @jest-environment jsdom
 */
/**
 * A record form that creates a record goes on editing it.
 *
 * A create sets the form's status to "existing", and the `entity` prop names
 * the new record only once the caller hands it back. A caller that does not —
 * the binding or the headless form used on its own — left an existing form
 * with no record behind it: `EntityFormBinding` threw "Form has not been
 * initialised" on the next render, and `EntityForm` re-seeded itself with the
 * collection's defaults and refused the next Save for want of an id.
 */
import React from "react";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, render } from "@testing-library/react";
import type { Entity } from "@rebasepro/types";
import type { EntityCustomViewParams, FormContext } from "@rebasepro/cms-types";

class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
}
Object.assign(global, { ResizeObserver: ResizeObserverStub });

type Post = Record<string, unknown>;

const create = jest.fn(async (values: Post) => ({ id: "9", path: "posts", values } as Entity<Post>));
const update = jest.fn(async (id: string | number, values: Post) => ({ id, path: "posts", values } as Entity<Post>));

jest.mock("@rebasepro/app", () => {
    const overrides: Record<string, unknown> = {
        useRebaseContext: () => ({}),
        useCustomizationController: () => ({ plugins: [], propertyConfigs: {}, entityActions: [], entityViews: [], resolvedSlots: [] }),
        useAuthController: () => ({ user: { uid: "u1" } }),
        useSnackbarController: () => ({ open: () => undefined }),
        useData: () => ({ collection: () => ({ create, update, find: async () => ({ data: [] }) }) }),
        useAnalyticsController: () => ({}),
        useSlot: () => null
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
jest.mock("../../src/hooks/navigation/contexts/CollectionRegistryContext", () => ({
    useCollectionRegistryController: () => ({
        getCollection: () => undefined,
        getParentEntityIds: () => [],
        getParentCollectionSlugs: () => []
    })
}));

import { EntityFormBinding } from "../../src/form/EntityFormBinding";
import { EntityForm } from "../../src/form/EntityForm";
import { rowOf, saving } from "../helpers/form_rows";

const collection = {
    slug: "posts",
    name: "Posts",
    properties: {
        title: { type: "string", name: "Title" },
        status: { type: "string", name: "Status", defaultValue: "draft" }
    }
} as never;

let context: FormContext<Post>;
function Capture({ formContext }: EntityCustomViewParams<Post>) {
    context = formContext;
    return null;
}

async function createThenEdit() {
    await act(async () => {
        context.setFieldValue("title", "Hello");
    });
    await act(async () => {
        await context.submit();
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(context.status).toBe("existing");
    expect(context.values).toMatchObject({ title: "Hello" });

    await act(async () => {
        context.setFieldValue("title", "Hello again");
    });
    await act(async () => {
        await context.submit();
    });
}

beforeEach(() => {
    create.mockClear();
    update.mockClear();
});

describe("after a create", () => {
    it("EntityFormBinding edits the record it created", async () => {
        render(<EntityFormBinding<Post>
            path="posts"
            collection={collection}
            initialStatus="new"
            Builder={Capture}/>);

        await createThenEdit();

        expect(create).toHaveBeenCalledTimes(1);
        expect(update).toHaveBeenCalledTimes(1);
        expect(update.mock.calls[0][0]).toBe("9");
        expect(update.mock.calls[0][1]).toEqual({ title: "Hello again" });
    });

    it("the headless EntityForm edits the record it created", async () => {
        const submitted: Post[] = [];
        render(<EntityForm<Post>
            path="posts"
            collection={collection}
            initialStatus="new"
            Builder={Capture}
            onSubmit={saving(async (values: Post) => {
                submitted.push(values);
                return submitted.length === 1
                    ? create(values)
                    : update("9", values);
            })}/>);

        await createThenEdit();

        expect(update).toHaveBeenCalledTimes(1);
        // Only what changed since the create, against the created record.
        expect(submitted[1]).toEqual({ title: "Hello again" });
        expect(context.formex.isSubmitting).toBe(false);
    });
});
