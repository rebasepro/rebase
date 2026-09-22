/**
 * @jest-environment jsdom
 */
import React from "react";
import { beforeAll, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { EntityRelation, type Relation } from "@rebasepro/types";

/**
 * The picker shows the record its value holds, however the value got there.
 *
 * A local pick leaves a fingerprint of the ids it set, so that the form
 * echoing those same ids back does not trigger a second resolution. The
 * fingerprint was never cleared. Pick A (the field held B), discard (B again),
 * then undo the discard (A again): the incoming ids matched the old
 * fingerprint, the fast path returned without updating what is shown, and the
 * chip kept reading B while the form held — and saved — A.
 */

const sidePanelOpen = jest.fn();

jest.mock("../../src/hooks/useSidePanel", () => ({
    useSidePanel: () => ({
        open: sidePanelOpen,
        close: jest.fn(),
        replace: jest.fn()
    })
}));

jest.mock("../../src/components/EntityPreviewBinding", () => ({
    EntityPreviewBindingData: ({ entity }: { entity: { id: string | number } }) =>
        <div data-testid="preview">{String(entity.id)}</div>,
    EntityPreviewContainer: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>
}));

jest.mock("@rebasepro/app", () => ({
    useData: () => ({
        collection: () => ({
            find: async () => ({ data: [], meta: { hasMore: false } })
        })
    }),
    usePermissions: () => ({ canCreate: () => true }),
    useTranslation: () => ({
        t: (key: string, options?: { name?: string }) => options?.name ? `${key}:${options.name}` : key
    }),
    useRelationSelector: () => ({
        items: [],
        isLoading: false,
        hasMore: false,
        error: undefined,
        search: () => undefined,
        loadMore: () => undefined,
        entityToRelationItem: (entity: { id: string | number, values?: { name?: string } }, relation: unknown) => ({
            id: entity.id,
            label: String(entity.values?.name ?? entity.id),
            data: entity,
            relation
        })
    }),
    getTitlePropertyKey: () => "name"
}));

import { RelationSelector } from "../../src/components/RelationSelector";

beforeAll(() => {
    // cmdk observes its own list; jsdom has no ResizeObserver.
    (globalThis as Record<string, unknown>).ResizeObserver = class {
        observe() { /* no layout in jsdom */ }
        unobserve() { /* no layout in jsdom */ }
        disconnect() { /* no layout in jsdom */ }
    };
    // Radix needs pointer capture and scrollIntoView; jsdom has neither.
    Object.assign(Element.prototype, {
        hasPointerCapture: () => false,
        setPointerCapture: () => undefined,
        releasePointerCapture: () => undefined,
        scrollIntoView: () => undefined
    });
});

const relation = {
    kind: "belongsTo",
    cardinality: "one",
    target: () => ({
        slug: "companies",
        name: "Companies",
        singularName: "Company",
        properties: { name: { type: "string", name: "Name" } }
    })
} as unknown as Relation;

const company = (id: string) => new EntityRelation(id, "companies", { id, path: "companies", values: { name: id } });

const shown = () => screen.getAllByTestId("preview").map(e => e.textContent).join(",");

it("shows the value it holds after the value returns to an earlier local pick", () => {
    const onValueChange = jest.fn();
    const { rerender } = render(<RelationSelector relation={relation} value={company("B")} onValueChange={onValueChange}/>);
    expect(shown()).toBe("B");

    // A local pick: create a company from the picker and take it.
    fireEvent.click(document.querySelector("[data-relation-selector-trigger]")!);
    fireEvent.click(screen.getByText("add_specific:Company"));
    const panel = sidePanelOpen.mock.calls[0][0] as { onUpdate: (params: unknown) => void };
    act(() => panel.onUpdate({ entity: { id: "A", path: "companies", values: { name: "A" } }, status: "new", path: "companies" }));

    // The form echoes the pick, then a discard puts B back, then undo puts A back.
    rerender(<RelationSelector relation={relation} value={company("A")} onValueChange={onValueChange}/>);
    expect(shown()).toBe("A");
    rerender(<RelationSelector relation={relation} value={company("B")} onValueChange={onValueChange}/>);
    expect(shown()).toBe("B");
    rerender(<RelationSelector relation={relation} value={company("A")} onValueChange={onValueChange}/>);
    expect(shown()).toBe("A");
});
