/**
 * @jest-environment jsdom
 */
import React from "react";
import { beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, render, screen, waitFor } from "@testing-library/react";
import { EntityRelation, type Entity, type FindParams, type Relation } from "@rebasepro/types";

/**
 * The rows a picker opens with — the ones already linked — are read in one
 * request per 1,000, not one request each.
 *
 * The relation picker dialog (`SelectionTableBinding`) read every pre-selected
 * id with its own `findById`: a post with 40 tags opened the tag picker with 40
 * requests (CV-13), 200 linked rows with 200. The inline `RelationSelector`
 * did the same for every value that arrived without its row embedded — a
 * relation filter's ids, a to-many `select` widget's value.
 */

type Tag = { name: string };

const tag = (id: string): Entity<Tag> => ({ id, path: "tags", values: { name: `tag ${id}` } });

/** A `tags` collection whose rows exist for every id but the ones in `missing`. */
const missing = new Set<string>();
const find = jest.fn(async (params?: FindParams<Tag>) => {
    const condition = params?.where?.id;
    const ids = Array.isArray(condition) && condition[0] === "in" ? (condition[1] as string[]) : [];
    // Out of order on purpose: the caller puts them back in the order it asked.
    const data = ids.filter(id => !missing.has(id)).map(tag).reverse();
    return { data, meta: { total: data.length, limit: params?.limit ?? 0, offset: 0, hasMore: false } };
});
const findById = jest.fn(async (id: string | number) => missing.has(String(id)) ? undefined : tag(String(id)));
const accessor = { find, findById };
/** What the dialog hands its table to show first: the rows it opened with. */
const useDataTableController = jest.fn((_props: { entitiesDisplayedFirst?: Entity<Tag>[] }) => ({}));

jest.mock("../../src/hooks/useSidePanel", () => {
    const controller = { open: () => undefined, close: () => undefined, replace: () => undefined };
    return { useSidePanel: () => controller };
});
jest.mock("../../src/hooks/navigation/contexts/UrlContext", () => {
    const controller = { resolveDatabasePathsFrom: (p: string) => p };
    return { useUrlController: () => controller };
});
jest.mock("../../src/components/SideDialogs", () => {
    const context = { close: () => undefined, setBlocked: () => undefined };
    return { useSideDialogContext: () => context };
});
jest.mock("../../src/components/CollectionTableBinding", () => ({
    CollectionTableBinding: () => <div/>,
    CollectionRowActions: () => null
}));
jest.mock("../../src/components/EntityPreviewBinding", () => ({
    EntityPreviewBindingData: ({ entity }: { entity: { id: string | number } }) =>
        <div data-testid="preview">{String(entity.id)}</div>,
    EntityPreviewContainer: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>
}));

jest.mock("@rebasepro/app", () => {
    const analytics = { onAnalyticsEvent: () => undefined };
    const data = { collection: () => accessor };
    const columnIds: string[] = [];
    const permissions = { canCreate: () => false };
    const translation = { t: (key: string) => key };
    return {
        CollectionScopeProvider: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
        ErrorView: ({ error }: { error: string }) => <div>{error}</div>,
        IconForView: () => null,
        useAuthController: () => ({}),
        useCustomizationController: () => ({}),
        useAnalyticsController: () => analytics,
        useData: () => data,
        useDataTableController,
        useColumnIds: () => columnIds,
        useLargeLayout: () => true,
        usePermissions: () => permissions,
        useTranslation: () => translation,
        useRelationSelector: () => ({
            items: [],
            isLoading: false,
            hasMore: false,
            error: undefined,
            search: () => undefined,
            loadMore: () => undefined,
            entityToRelationItem: (entity: { id: string | number }, relation: unknown) => ({
                id: entity.id,
                label: String(entity.id),
                data: entity,
                relation
            })
        }),
        getTitlePropertyKey: () => "name"
    };
});

import { SelectionTableBinding } from "../../src/components/ReferenceTable/SelectionTableBinding";
import { RelationSelector } from "../../src/components/RelationSelector";

beforeAll(() => {
    (globalThis as Record<string, unknown>).ResizeObserver = class {
        observe() { /* no layout in jsdom */ }
        unobserve() { /* no layout in jsdom */ }
        disconnect() { /* no layout in jsdom */ }
    };
    Object.assign(Element.prototype, {
        hasPointerCapture: () => false,
        setPointerCapture: () => undefined,
        releasePointerCapture: () => undefined,
        scrollIntoView: () => undefined
    });
});

beforeEach(() => {
    find.mockClear();
    findById.mockClear();
    useDataTableController.mockClear();
    missing.clear();
});

const tags = {
    slug: "tags",
    name: "Tags",
    singularName: "Tag",
    properties: { name: { type: "string", name: "Name" } }
};
/** Rows addressed by two columns: no single column to put the ids in. */
const memberships = {
    slug: "memberships",
    name: "Memberships",
    singularName: "Membership",
    properties: {
        userId: { type: "string", name: "User", isId: true },
        teamId: { type: "string", name: "Team", isId: true }
    }
};

const ids = (n: number) => Array.from({ length: n }, (_, i) => String(i + 1));

describe("the relation picker dialog, opened with rows already linked", () => {
    async function openWith(selectedEntityIds: string[], collection: object = tags) {
        const onMultipleEntitiesSelected = jest.fn<(entities: Entity<Tag>[]) => void>();
        await act(async () => {
            render(<SelectionTableBinding<Tag> collection={collection as never}
                path="tags"
                multiselect={true}
                selectedEntityIds={selectedEntityIds}
                onMultipleEntitiesSelected={onMultipleEntitiesSelected}/>);
        });
        return onMultipleEntitiesSelected;
    }

    it("reads 40 of them in one request, not 40", async () => {
        await openWith(ids(40));

        await waitFor(() => expect(find).toHaveBeenCalledTimes(1));
        expect(findById).not.toHaveBeenCalled();
        expect(find.mock.calls[0][0]).toMatchObject({ where: { id: ["in", ids(40)] }, limit: 40, count: "none" });
    });

    it("reads 2,500 of them in requests of at most 1,000", async () => {
        await openWith(ids(2_500));

        await waitFor(() => expect(find).toHaveBeenCalledTimes(3));
        expect(find.mock.calls.map(([params]) => params?.limit)).toEqual([1_000, 1_000, 500]);
        expect(findById).not.toHaveBeenCalled();
    });

    it("keeps the order it was given and drops a row that is gone, as before", async () => {
        missing.add("2");
        await openWith(["3", "2", "1"]);

        const shownFirst = () => {
            const calls = useDataTableController.mock.calls;
            return (calls[calls.length - 1][0].entitiesDisplayedFirst ?? []).map(e => e.id);
        };
        await waitFor(() => expect(shownFirst()).toEqual(["3", "1"]));
        expect(find).toHaveBeenCalledTimes(1);
    });

    it("reads a row with a two-column key by itself, as before", async () => {
        await openWith(["a:1", "b:2"], memberships);

        await waitFor(() => expect(findById).toHaveBeenCalledTimes(2));
        expect(find).not.toHaveBeenCalled();
    });

    it("falls back to one read per row when the batch is refused", async () => {
        find.mockRejectedValueOnce(new Error("Unknown filter field 'id'"));
        await openWith(ids(3));

        await waitFor(() => expect(findById).toHaveBeenCalledTimes(3));
    });
});

describe("the inline relation picker, given values without their rows", () => {
    const relation = {
        kind: "manyToMany",
        cardinality: "many",
        target: () => tags
    } as unknown as Relation;

    it("reads them in one request, and shows them in the order of the value", async () => {
        missing.add("7");
        const value = ["3", "7", "1", "2"].map(id => new EntityRelation(id, "tags"));
        render(<RelationSelector relation={relation} multiple={true} value={value} onValueChange={() => undefined}/>);

        // "7" has no row: it stays an id-only chip, as before, with no preview.
        await waitFor(() => expect(screen.getAllByTestId("preview").map(e => e.textContent)).toEqual(["3", "1", "2"]));
        expect(find).toHaveBeenCalledTimes(1);
        expect(find.mock.calls[0][0]).toMatchObject({ where: { id: ["in", ["3", "7", "1", "2"]] } });
        expect(findById).not.toHaveBeenCalled();
    });
});
