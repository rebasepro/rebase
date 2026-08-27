/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, beforeEach } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import { EntityReference, EntityRelation } from "@rebasepro/types";

/**
 * What a preview shows once its target row is gone.
 *
 * `useFetch` gets this right: a realtime update that reports the row deleted
 * clears its cache entry and hands back `entity === undefined`. Both previews
 * then wrote every successful fetch into a module-level `Map` of their own and
 * read the answer back out of it, and nothing ever deleted from that Map — so
 * the card carried on rendering a row that no longer existed, complete with a
 * working "open" button leading to a 404. The "Entity not found" branch was
 * unreachable for any target previewed in that session.
 *
 * The Map was also module-level and unbounded: it survived a sign-out, which
 * is how one user's previews reached the next user in the same tab. That half
 * is pinned in `packages/app/test/auth/fetch_cache_cleared_on_sign_out`.
 */

const fetchState: { entity?: unknown; dataLoading: boolean } = { entity: undefined,
dataLoading: false };

jest.mock("@rebasepro/app", () => ({
    useFetch: () => fetchState,
    useCustomizationController: () => ({}),
    useComponentOverride: (_id: string, fallback: unknown) => fallback,
    CollectionScopeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    ErrorView: ({ error }: { error: unknown }) => <div>{String(error)}</div>
}));

jest.mock("@rebasepro/ui", () => ({
    Skeleton: () => <div data-testid="skeleton"/>,
    ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>
}));

jest.mock("../../src/components/EntityPreviewBinding", () => ({
    EntityPreviewBinding: ({ entity }: { entity: { values: { name: string } } }) =>
        <div data-testid="card">{entity.values.name}</div>,
    EntityPreviewContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}));

jest.mock("../../src/components/InlineEntityPreview", () => ({
    InlineEntityPreview: () => <span/>,
    InlineEntityPreviewMissing: () => <span/>,
    InlineEntityPreviewSkeleton: () => <span/>
}));

jest.mock("../../src/components/EntityPreviewNesting", () => ({
    useIsNestedEntityPreview: () => false
}));

jest.mock("../../src/hooks/navigation/contexts/CollectionRegistryContext", () => ({
    useCollectionRegistryController: () => ({
        getCollection: () => ({ slug: "authors",
name: "Authors",
properties: {} })
    })
}));

import { RelationPreview } from "../../src/preview/components/RelationPreview";
import { ReferencePreview } from "../../src/preview/components/ReferencePreview";

const author = { id: "42",
path: "authors",
values: { name: "Jane Doe" } };

describe("a preview whose target row is deleted", () => {

    beforeEach(() => {
        fetchState.entity = undefined;
        fetchState.dataLoading = false;
    });

    it("stops rendering the relation card the moment the fetch reports it gone", () => {
        const relation = new EntityRelation("42", "authors");

        fetchState.entity = author;
        const view = render(<RelationPreview relation={relation}/>);
        expect(screen.getByTestId("card").textContent).toBe("Jane Doe");

        // The delete arrives: `useFetch` clears the entity, same component,
        // same relation.
        fetchState.entity = undefined;
        view.rerender(<RelationPreview relation={relation}/>);

        expect(screen.queryByTestId("card")).toBeNull();
        expect(screen.getByText("Entity not found")).toBeTruthy();
    });

    it("does the same for a reference", () => {
        const reference = new EntityReference("42", "authors");

        fetchState.entity = author;
        const view = render(<ReferencePreview reference={reference}/>);
        expect(screen.getByTestId("card").textContent).toBe("Jane Doe");

        fetchState.entity = undefined;
        view.rerender(<ReferencePreview reference={reference}/>);

        expect(screen.queryByTestId("card")).toBeNull();
        expect(screen.getByText("Entity not found")).toBeTruthy();
    });

    it("does not resurrect a deleted target for a preview mounted later", () => {
        // The session-wide half: the Map was keyed by `path/id`, so a second
        // component asking for the same target got the pre-deletion copy even
        // though it had never fetched anything itself.
        const relation = new EntityRelation("42", "authors");

        fetchState.entity = author;
        render(<RelationPreview relation={relation}/>);

        fetchState.entity = undefined;
        render(<RelationPreview relation={relation}/>);

        expect(screen.getAllByText("Entity not found").length).toBe(1);
    });
});
