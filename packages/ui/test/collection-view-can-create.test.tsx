import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { CollectionView } from "../src/views/CollectionView/CollectionView";

/**
 * `canCreate` on the exported `CollectionView`.
 *
 * Documented as "whether creation is allowed (shows the + button)", destructured
 * with a default of `true`, and read nowhere — so the add affordance appeared
 * whatever it was set to. The kanban view draws that affordance exactly when it
 * is given an `onRowCreate`, so withholding the callback is what the prop means.
 */
const properties = {
    title: { name: "Title", type: "string" },
    status: { name: "Status", type: "string", enum: [{ id: "open", label: "Open" }] }
} as never;

function controller(rows: Record<string, unknown>[]) {
    return {
        data: rows,
        loading: false,
        error: undefined,
        hasMore: false,
        loadMore: () => { /* noop */ },
        setFilter: () => { /* noop */ },
        setSort: () => { /* noop */ },
        setSearch: () => { /* noop */ }
    } as never;
}

function renderKanban(canCreate: boolean) {
    return render(<CollectionView
        dataController={controller([{ id: "1", title: "One", status: "open" }])}
        properties={properties}
        viewMode="kanban"
        kanbanProperty="status"
        onRowCreate={() => { /* noop */ }}
        canCreate={canCreate}
    />);
}

describe("CollectionView canCreate", () => {
    it("offers the add affordance when creation is allowed", () => {
        renderKanban(true);
        expect(screen.queryAllByRole("button").length).toBeGreaterThan(0);
    });

    it("withholds it when creation is not allowed", () => {
        const allowed = renderKanban(true).container.querySelectorAll("button").length;
        const refused = renderKanban(false).container.querySelectorAll("button").length;

        expect(refused).toBeLessThan(allowed);
    });
});
