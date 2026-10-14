/**
 * @jest-environment jsdom
 */
import React from "react";
import { beforeAll, expect, it, jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import { EntityRelation, type Relation } from "@rebasepro/types";

/**
 * The relation field's "open this record" button is named in the admin's
 * language.
 *
 * Its tooltip and its accessible name were `Open ${label}`, an English
 * template, on a field whose every other word was translated.
 */

jest.mock("../../src/hooks/useSidePanel", () => ({
    useSidePanel: () => ({ open: jest.fn(), close: jest.fn(), replace: jest.fn() })
}));

jest.mock("../../src/components/EntityPreviewBinding", () => ({
    EntityPreviewBindingData: ({ entity }: { entity: { id: string | number } }) =>
        <div data-testid="preview">{String(entity.id)}</div>,
    EntityPreviewContainer: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>
}));

jest.mock("@rebasepro/app", () => {
    const overrides: Record<string, unknown> = {
        useData: () => ({
            collection: () => ({ find: async () => ({ data: [], meta: { hasMore: false } }) })
        }),
        usePermissions: () => ({ canCreate: () => false }),
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
    };
    return new Proxy({}, {
        get: (_t, key: string | symbol) =>
            (typeof key === "string" && key in overrides)
                ? overrides[key]
                : (jest.requireActual("@rebasepro/app") as Record<string | symbol, unknown>)[key]
    });
});

import { RebaseI18nProvider } from "@rebasepro/app";
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

it("names the button that opens the picked record in French", async () => {
    const acme = new EntityRelation("Acme", "companies", { id: "Acme", path: "companies", values: { name: "Acme" } });
    render(
        <RebaseI18nProvider locale="fr">
            <RelationSelector relation={relation} value={acme} onValueChange={jest.fn()}/>
        </RebaseI18nProvider>
    );

    expect(await screen.findByRole("button", { name: "Ouvrir Acme" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open Acme" })).toBeNull();
});
