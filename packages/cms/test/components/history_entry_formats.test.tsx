/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { render } from "@testing-library/react";
import type { EntityHistoryEntry as HistoryEntry } from "@rebasepro/types";
import type { AdminCollection } from "@rebasepro/cms-types";

/**
 * A history entry used to store the whole row on both sides of an update.
 * Entries written from 0.24 on (`format: 2`) keep, in `previous_values`, only
 * the fields the update changed — the rest of the row is unchanged, so it is
 * in `values`. The admin shows a change as its field's old value struck
 * through over its new one, which needs only the changed fields: both formats
 * must draw the same entry.
 */

jest.mock("@rebasepro/app", () => ({
    useAuthController: () => ({ user: null })
}));
jest.mock("../../src/preview/PropertyPreview", () => ({
    PropertyPreview: ({ value }: { value: unknown }) => <span data-testid="value">{String(value)}</span>
}));

import { EntityHistoryEntry } from "../../src/components/history/EntityHistoryEntry";

const orders = {
    slug: "orders",
    name: "Orders",
    properties: {
        status: { type: "string", name: "Status" },
        total: { type: "number", name: "Total" },
        note: { type: "string", name: "Note" }
    }
} as unknown as AdminCollection;

const update: HistoryEntry = {
    id: "h-1",
    table_name: "orders",
    entity_id: "123",
    action: "update",
    changed_fields: ["status", "note"],
    values: { status: "shipped", total: 99.99, note: "left at the door" },
    previous_values: null,
    updated_by: "admin-user-id",
    updated_at: "2026-10-07T10:30:00Z"
};

/** Before 0.24: the whole row before the write. */
const wholeRow: HistoryEntry = {
    ...update,
    previous_values: { status: "pending", total: 99.99, note: "ring twice" }
};

/** From 0.24: the changed fields only. */
const changedOnly: HistoryEntry = {
    ...update,
    format: 2,
    previous_values: { status: "pending", note: "ring twice" }
};

function drawn(entry: HistoryEntry): string {
    const { container, unmount } = render(<EntityHistoryEntry size="medium" collection={orders} entry={entry}/>);
    const text = container.textContent ?? "";
    const struck = [...container.querySelectorAll(".line-through")].map(node => node.textContent);
    unmount();
    return JSON.stringify({ text, struck });
}

describe("a history entry, in either format", () => {
    it("shows each changed field's previous value struck through over its new one", () => {
        const { container } = render(<EntityHistoryEntry size="medium" collection={orders} entry={changedOnly}/>);
        const struck = [...container.querySelectorAll(".line-through")].map(node => node.textContent);
        expect(struck).toEqual(["pending", "ring twice"]);
        expect(container.textContent).toContain("shipped");
        expect(container.textContent).toContain("left at the door");
    });

    it("is drawn the same whether it stored the whole row or the changed fields", () => {
        expect(drawn(changedOnly)).toBe(drawn(wholeRow));
    });
});
