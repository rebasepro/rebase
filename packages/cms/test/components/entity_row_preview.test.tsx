/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Entity } from "@rebasepro/types";
import type { AdminCollection } from "@rebasepro/cms-types";

/**
 * A reference or relation in a table cell tall enough for more than a line
 * (row sizes `l` and `xl`) is drawn as a line of that row, not as the form's
 * card.
 *
 * The card — a bordered box with an id line, a title, two supporting lines
 * and an open button — was taller than the row it sat in, so every cell
 * showed its top two thirds, and hovering one drew a second box around it.
 */

const sidePanelOpen = jest.fn();

jest.mock("../../src/hooks/useSidePanel", () => ({
    useSidePanel: () => ({ open: sidePanelOpen, close: jest.fn(), replace: jest.fn() })
}));
jest.mock("../../src/hooks/useEntityDisplay", () => ({
    useEntityTitle: ({ entity }: { entity: Entity<{ name: string }> }) => ({ value: entity.values.name, loading: false })
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

import { EntityPreviewBindingData } from "../../src/components/EntityPreviewBinding";

const customers = {
    slug: "customers",
    name: "Customers",
    properties: {
        name: { type: "string", name: "Name" },
        company: { type: "string", name: "Company" },
        email: { type: "string", name: "Email" },
        city: { type: "string", name: "City" }
    }
} as unknown as AdminCollection;

const karen: Entity<Record<string, unknown>> = {
    id: "c-17",
    path: "customers",
    values: { name: "Karen Johnson", company: "", email: "karen@example.com", city: "Lisbon" }
};

function renderRow(size: "medium" | "large") {
    return render(<EntityPreviewBindingData layout={"row"}
        size={size}
        entity={karen}
        collection={customers}
        previewKeys={["company", "email", "city"]}/>);
}

describe("an entity preview laid out as a table row", () => {

    it("draws no id and no open button: the title is the way in", () => {
        renderRow("medium");
        expect(screen.queryByText("c-17")).toBeNull();
        expect(screen.queryAllByRole("button")).toHaveLength(1);
        expect(screen.getByRole("button").textContent).toBe("Karen Johnson");
    });

    it("opens the record from its title, without moving the focus on the press", () => {
        renderRow("medium");
        const title = screen.getByRole("button");
        // `fireEvent` returns false when the default was prevented: a focus
        // move would select the table cell under the pointer mid-click.
        expect(fireEvent.mouseDown(title)).toBe(false);
        fireEvent.click(title);
        expect(sidePanelOpen).toHaveBeenCalledWith(expect.objectContaining({ entityId: "c-17", path: "customers" }));
    });

    it("skips an empty supporting value instead of drawing an empty bar", () => {
        renderRow("medium");
        // `company` is blank, so the one line an `l` row has room for is the email.
        expect(screen.getByText("karen@example.com")).toBeTruthy();
        expect(screen.queryByText("Lisbon")).toBeNull();
    });

    it("takes a second supporting line where the row is tall enough for it", () => {
        renderRow("large");
        expect(screen.getByText("karen@example.com")).toBeTruthy();
        expect(screen.getByText("Lisbon")).toBeTruthy();
    });
});
