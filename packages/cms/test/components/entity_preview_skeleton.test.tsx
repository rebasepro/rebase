/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { render } from "@testing-library/react";
import type { Entity } from "@rebasepro/types";
import type { AdminCollection } from "@rebasepro/cms-types";

/**
 * A relation card that is still loading is drawn as the card it will be.
 *
 * It was a single bar in a 48px box, and grew to the full card — a title, a
 * line of text, a status chip — when the record arrived, pushing everything
 * under it down. The skeleton now has the card's columns and one line per
 * line the card will show, each in that line's own wrapper with its own
 * type, an enum's as a chip: the same height by construction, which is what
 * this checks, since jsdom has no layout to measure.
 */

jest.mock("../../src/hooks/useSidePanel", () => ({
    useSidePanel: () => ({ open: jest.fn(), close: jest.fn(), replace: jest.fn() })
}));
jest.mock("../../src/hooks/useEntityDisplay", () => ({
    useEntityTitle: ({ entity }: { entity: Entity<{ fullName: string }> }) => ({
        value: entity.values.fullName,
        source: { key: "fullName", value: entity.values.fullName },
        loading: false
    })
}));
jest.mock("../../src/hooks/navigation/contexts/CollectionRegistryContext", () => ({
    useCollectionRegistryController: () => ({ getCollection: () => undefined })
}));
jest.mock("@rebasepro/app", () => {
    const overrides: Record<string, unknown> = {
        useAuthController: () => ({ user: null }),
        useCustomizationController: () => ({ plugins: [], propertyConfigs: {}, locale: undefined }),
        useAnalyticsController: () => ({}),
        useTranslation: () => ({ t: (key: string) => key })
    };
    return new Proxy({}, {
        get: (_t, key: string | symbol) =>
            (typeof key === "string" && key in overrides)
                ? overrides[key]
                : (jest.requireActual("@rebasepro/app") as Record<string | symbol, unknown>)[key]
    });
});

import { EntityPreviewBindingData, EntityPreviewBindingSkeleton } from "../../src/components/EntityPreviewBinding";

const contacts: AdminCollection = {
    slug: "contacts",
    name: "Contacts",
    properties: {
        fullName: { type: "string", name: "Name" },
        contactKind: { type: "string", name: "Kind" },
        emailStatus: {
            type: "string",
            name: "Email",
            enum: [{ id: "verified", label: "Verified", color: "green" }, { id: "inferred", label: "Inferred" }]
        }
    },
    display: { title: "fullName" }
};

const magnus: Entity<Record<string, unknown>> = {
    id: "c-1",
    path: "contacts",
    values: { fullName: "Magnus Slind-Naslund", contactKind: "person", emailStatus: "verified" }
};

const previewKeys = ["contactKind", "emailStatus"];

/** The card's columns, and the wrappers of the lines under its title. */
function shape(root: HTMLElement) {
    const columns = Array.from(root.children) as HTMLElement[];
    const lines = Array.from(columns[1].children).slice(1) as HTMLElement[];
    return { columns, lines };
}

describe("a relation card while its record loads", () => {
    const loaded = shape(render(<div data-testid="card"><EntityPreviewBindingData entity={magnus}
        collection={contacts}
        previewKeys={previewKeys}
        includeId={false}/></div>).getAllByTestId("card")[0]);
    const loading = shape(render(<div data-testid="skeleton"><EntityPreviewBindingSkeleton collection={contacts}
        previewKeys={previewKeys}/></div>).getAllByTestId("skeleton")[0]);

    it("has the card's columns: the image slot, the lines and the open button's room", () => {
        expect(loading.columns.map(column => column.className)).toEqual(loaded.columns.map(column => column.className));
        expect(loading.columns[2].querySelector("button")).not.toBeNull();
    });

    it("has a line for each line the card shows, in the same wrapper", () => {
        expect(loading.lines).toHaveLength(2);
        expect(loading.lines.map(line => line.className)).toEqual(loaded.lines.map(line => line.className));
    });

    it("draws a text line in the text's type and an enum as a chip of the chip's size", () => {
        expect(loading.lines[0].firstElementChild?.className).toBe(loaded.lines[0].firstElementChild?.className);
        const chipSize = (line: HTMLElement) => (line.firstElementChild?.className ?? "").split(" ")
            .filter(name => /^(px|py|text-(xs|sm))/.test(name)).sort();
        expect(chipSize(loading.lines[1])).toEqual(chipSize(loaded.lines[1]));
        expect(chipSize(loading.lines[1])).not.toEqual([]);
    });
});
